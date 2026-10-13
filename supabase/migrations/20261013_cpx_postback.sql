-- CPX Research postback: schema changes (applied 2026-10-13)
alter table public.points_ledger drop constraint if exists points_ledger_reason_check;
alter table public.points_ledger add constraint points_ledger_reason_check check (reason = any (array['offer_approved','withdrawal_hold','withdrawal_refund','admin_adjustment','claim_reversal','survey_reward','survey_reversal']));
alter table public.points_ledger add column if not exists postback_id uuid;
create unique index if not exists points_ledger_postback_uq on public.points_ledger(postback_id, reason) where postback_id is not null;
alter table public.postback_events add column if not exists amount_usd numeric;
alter table public.postback_events add column if not exists amount_local numeric;
alter table public.postback_events add column if not exists note text;
create table if not exists public.postback_rejects(id bigserial primary key, at timestamptz not null default now(), ip_hash text, reason text not null, txn text);
alter table public.postback_rejects enable row level security;
create index if not exists postback_rejects_ip_at on public.postback_rejects(ip_hash, at desc);
revoke all on public.postback_rejects from anon, authenticated;
alter table public.fraud_flags drop constraint fraud_flags_kind_check;
alter table public.fraud_flags add constraint fraud_flags_kind_check check (kind = any (array['shared_device','shared_ip','shared_destination','too_fast','rate_limit','duplicate_postback','bad_signature','reversal','blocked_attempt','new_account_withdrawal','manual','offer_cap','similar_device','ip_reputation','ai_monitor','human_check_failed','postback_held']));
insert into public.settings(key,value) values ('cpx_points_per_usd','1000'),('cpx_max_points_per_event','100000'),('cpx_max_events_per_user_hour','20'),('cpx_reject_limit_per_10min','30') on conflict (key) do nothing;
CREATE OR REPLACE FUNCTION public.cpx_apply_postback(p_txn text, p_type text, p_status integer, p_user uuid, p_usd numeric, p_local numeric, p_raw jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pid uuid; ppu numeric; cap int; per_h int; pts int; ev uuid; orig public.postback_events; bal int; st text; recent int; note text;
begin
  select id into pid from public.partners where name='CPX Research' limit 1;
  if pid is null then return 'no_partner'; end if;
  if not exists(select 1 from auth.users where id=p_user) then return 'unknown_user'; end if;
  select coalesce(nullif(value,'')::numeric,500) into ppu from public.settings where key='cpx_points_per_usd';
  select coalesce(nullif(value,'')::int,50000) into cap from public.settings where key='cpx_max_points_per_event';
  select coalesce(nullif(value,'')::int,20) into per_h from public.settings where key='cpx_max_events_per_user_hour';
  ppu := coalesce(ppu,500); cap := coalesce(cap,50000); per_h := coalesce(per_h,20);
  pts := floor(coalesce(p_usd,0)*ppu)::int;

  if p_status = 2 then
    insert into public.postback_events(partner_id,external_txn_id,event_type,user_id,points,signature_ok,status,raw,amount_usd,amount_local)
      values (pid,p_txn,'reversal',p_user,pts,true,'received',p_raw,p_usd,p_local)
      on conflict (partner_id,external_txn_id,event_type) do nothing returning id into ev;
    if ev is null then return 'duplicate'; end if;
    select * into orig from public.postback_events where partner_id=pid and external_txn_id=p_txn and event_type='conversion' and status='linked';
    if found and orig.user_id = p_user then
      select coalesce(sum(delta),0) into bal from public.points_ledger where user_id=p_user;
      if least(orig.points,bal)>0 then
        insert into public.points_ledger(user_id,delta,reason,postback_id) values (p_user,-least(orig.points,bal),'survey_reversal',ev);
      end if;
      update public.postback_events set status='linked', claim_id=null, note='reversed original '||orig.id where id=ev;
      perform public.add_flag(p_user,'reversal','high','CPX reversed a completed survey '||left(p_txn,40));
      perform public.set_review(p_user,'CPX reversed a completed survey');
      return 'reversed';
    else
      update public.postback_events set note='reversal without a credited original' where id=ev;
      perform public.add_flag(p_user,'reversal','medium','CPX reversal with no credited original '||left(p_txn,40));
      return 'reversal_held';
    end if;
  end if;

  if pts <= 0 then return 'no_points'; end if;
  select count(*) into recent from public.postback_events where user_id=p_user and created_at>now()-interval '1 hour';
  st := 'linked'; note := null;
  if public.user_status(p_user) <> 'normal' then st:='received'; note:='held: user under review or blocked';
  elsif pts > cap then st:='received'; note:='held: amount above per-event cap';
  elsif recent >= per_h then st:='received'; note:='held: too many events for this user in the last hour'; end if;
  insert into public.postback_events(partner_id,external_txn_id,event_type,user_id,points,signature_ok,status,raw,amount_usd,amount_local,note)
    values (pid,p_txn,'conversion',p_user,pts,true,st,p_raw,p_usd,p_local,note)
    on conflict (partner_id,external_txn_id,event_type) do nothing returning id into ev;
  if ev is null then
    perform public.add_flag(p_user,'duplicate_postback','medium','Duplicate CPX postback ignored: '||left(p_txn,40));
    return 'duplicate';
  end if;
  if st='linked' then
    insert into public.points_ledger(user_id,delta,reason,postback_id) values (p_user,pts,'survey_reward',ev);
    return 'credited';
  end if;
  perform public.add_flag(p_user,'postback_held','medium',note||' ('||left(p_txn,40)||')');
  return 'held';
end $function$

;
revoke all on function public.cpx_apply_postback(text,text,int,uuid,numeric,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.cpx_apply_postback(text,text,int,uuid,numeric,numeric,jsonb) to service_role;
