-- 1. Fix admin_set_setting to allow withdrawals_enabled and rate settings
CREATE OR REPLACE FUNCTION public.admin_set_setting(p_key text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_key not in ('ip_score_threshold','review_on_proxy','human_check_minutes','withdrawals_enabled','points_per_usd','cpx_points_per_usd') then
    raise exception 'unknown setting';
  end if;
  insert into public.settings(key, value, updated_at)
  values (p_key, left(p_value, 40), now())
  on conflict (key) do update set value = left(p_value, 40), updated_at = now();
end $function$;

-- 2. Fast single-call Profile & Dashboard summary RPC
CREATE OR REPLACE FUNCTION public.my_profile_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  u_email text;
  u_name text;
  u_created timestamptz;
  is_ver boolean;
  r_status text;
  bal int;
  total_earned int;
  claims_cnt int;
  pending_wd int;
begin
  if uid is null then raise exception 'not signed in'; end if;

  select email, raw_user_meta_data->>'name', created_at
    into u_email, u_name, u_created
    from auth.users where id = uid;

  select exists(select 1 from public.email_verified where user_id = uid) into is_ver;
  select public.user_status(uid) into r_status;
  select coalesce(sum(delta), 0)::int into bal from public.points_ledger where user_id = uid;
  select coalesce(sum(delta), 0)::int into total_earned from public.points_ledger where user_id = uid and delta > 0;
  select count(*)::int into claims_cnt from public.offer_claims where user_id = uid;
  select count(*)::int into pending_wd from public.withdrawal_requests where user_id = uid and status in ('requested','under_review','approved');

  return jsonb_build_object(
    'id', uid,
    'email', coalesce(u_email, ''),
    'name', coalesce(u_name, 'Member'),
    'created_at', u_created,
    'email_verified', is_ver,
    'status', r_status,
    'balance', bal,
    'total_earned', total_earned,
    'claims_count', claims_cnt,
    'pending_withdrawals', pending_wd,
    'is_admin', public.is_admin()
  );
end $function$;

-- 3. In-database fingerprint similarity check (replaces 2,000-row fetch in Edge Function)
CREATE OR REPLACE FUNCTION public.check_fp_similarity(p_user uuid, p_fp jsonb)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(distinct user_id)::int
  from public.devices
  where user_id <> p_user
    and fp is not null
    and coalesce(p_fp->>'gpu', '') <> ''
    and fp->>'gpu' = p_fp->>'gpu'
    and fp->>'screen' = p_fp->>'screen'
    and fp->>'tz' = p_fp->>'tz'
    and fp->>'cores' = p_fp->>'cores';
$function$;

-- 4. Unified Multi-Network Offerwall Postback RPC (Supports CPX, Torox, BitLabs, TimeWall, etc.)
CREATE OR REPLACE FUNCTION public.apply_offerwall_postback(
  p_network text,
  p_txn text,
  p_type text,
  p_status integer,
  p_user uuid,
  p_usd numeric,
  p_points_override integer,
  p_raw jsonb
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pid uuid;
  ppu numeric;
  cap int;
  per_h int;
  pts int;
  ev uuid;
  orig public.postback_events;
  bal int;
  st text;
  recent int;
  note text;
begin
  -- Find or auto-register the partner network
  select id into pid from public.partners where lower(name) = lower(p_network) limit 1;
  if pid is null then
    insert into public.partners(name, network_type, status, active)
    values (p_network, 'offerwall', 'partner', true)
    returning id into pid;
  end if;

  if not exists(select 1 from auth.users where id = p_user) then
    return 'unknown_user';
  end if;

  select coalesce(nullif(value,'')::numeric, 1000) into ppu from public.settings where key = 'cpx_points_per_usd';
  select coalesce(nullif(value,'')::int, 100000) into cap from public.settings where key = 'cpx_max_points_per_event';
  select coalesce(nullif(value,'')::int, 20) into per_h from public.settings where key = 'cpx_max_events_per_user_hour';

  if p_points_override is not null and p_points_override > 0 then
    pts := p_points_override;
  else
    pts := floor(coalesce(p_usd, 0) * coalesce(ppu, 1000))::int;
  end if;

  -- Handle Reversal / Chargeback (p_status = 2)
  if p_status = 2 then
    insert into public.postback_events(partner_id,external_txn_id,event_type,user_id,points,signature_ok,status,raw,amount_usd)
      values (pid, p_txn, 'reversal', p_user, pts, true, 'received', p_raw, p_usd)
      on conflict (partner_id, external_txn_id, event_type) do nothing returning id into ev;
    if ev is null then return 'duplicate'; end if;

    select * into orig from public.postback_events
      where partner_id = pid and external_txn_id = p_txn and event_type = 'conversion' and status = 'linked';

    if found and orig.user_id = p_user then
      select coalesce(sum(delta), 0) into bal from public.points_ledger where user_id = p_user;
      if least(orig.points, bal) > 0 then
        insert into public.points_ledger(user_id, delta, reason, postback_id)
        values (p_user, -least(orig.points, bal), 'survey_reversal', ev);
      end if;
      update public.postback_events set status = 'linked', note = 'reversed original ' || orig.id where id = ev;
      perform public.add_flag(p_user, 'reversal', 'high', p_network || ' reversed transaction ' || left(p_txn, 40));
      perform public.set_review(p_user, p_network || ' chargeback/reversal');
      return 'reversed';
    else
      update public.postback_events set note = 'reversal without a credited original' where id = ev;
      perform public.add_flag(p_user, 'reversal', 'medium', p_network || ' reversal without original ' || left(p_txn, 40));
      return 'reversal_held';
    end if;
  end if;

  -- Handle Conversion / Reward (p_status = 1)
  if pts <= 0 then return 'no_points'; end if;

  select count(*) into recent from public.postback_events where user_id = p_user and created_at > now() - interval '1 hour';
  st := 'linked'; note := null;

  if public.user_status(p_user) <> 'normal' then
    st := 'received'; note := 'held: user under review or blocked';
  elsif pts > cap then
    st := 'received'; note := 'held: amount above per-event cap';
  elsif recent >= per_h then
    st := 'received'; note := 'held: too many events for this user in the last hour';
  end if;

  insert into public.postback_events(partner_id,external_txn_id,event_type,user_id,points,signature_ok,status,raw,amount_usd,note)
    values (pid, p_txn, 'conversion', p_user, pts, true, st, p_raw, p_usd, note)
    on conflict (partner_id, external_txn_id, event_type) do nothing returning id into ev;

  if ev is null then
    perform public.add_flag(p_user, 'duplicate_postback', 'medium', 'Duplicate ' || p_network || ' postback ignored: ' || left(p_txn, 40));
    return 'duplicate';
  end if;

  if st = 'linked' then
    insert into public.points_ledger(user_id, delta, reason, postback_id)
    values (p_user, pts, 'survey_reward', ev);
    return 'credited';
  end if;

  perform public.add_flag(p_user, 'postback_held', 'medium', note || ' (' || left(p_txn, 40) || ')');
  return 'held';
end $function$;

revoke all on function public.apply_offerwall_postback(text,text,text,int,uuid,numeric,int,jsonb) from public, anon, authenticated;
grant execute on function public.apply_offerwall_postback(text,text,text,int,uuid,numeric,int,jsonb) to service_role;

revoke all on function public.check_fp_similarity(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.check_fp_similarity(uuid,jsonb) to service_role;
revoke all on function public.my_profile_summary() from public, anon;
grant execute on function public.my_profile_summary() to authenticated;
