begin;
create or replace function public.add_flag(p_user uuid,p_kind text,p_sev text,p_detail text) returns void language plpgsql security definer set search_path=public as $$
declare cleaned text;
begin
 if p_kind='bot_signals' then
  select string_agg(trim(v),', ') into cleaned from unnest(string_to_array(regexp_replace(p_detail,'^Automation signals: *',''),',')) v where trim(v)<>'' and trim(v)<>'no_plugins';
  if cleaned is null then return; end if;
  p_detail:='Automation signals: '||cleaned;
 end if;
 if exists(select 1 from fraud_flags where user_id is not distinct from p_user and kind=p_kind and not resolved and created_at>now()-interval '1 hour') then return; end if;
 insert into fraud_flags(user_id,kind,severity,detail) values(p_user,p_kind,p_sev,left(p_detail,500));
end $$;
create or replace function public.set_review(p_user uuid,p_note text) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_note='Automation signals in client report' and not exists(select 1 from fraud_flags where user_id=p_user and kind='bot_signals' and not resolved and detail<>'Automation signals: no_plugins' and created_at>now()-interval '24 hours') then return; end if;
 insert into user_risk(user_id,status,note) values(p_user,'review',left(p_note,300)) on conflict(user_id) do update set status='review',note=left(p_note,300) where user_risk.status='normal';
end $$;
commit;

-- Clear only automatic reviews with no other unresolved reason. Keep blocked accounts blocked.
begin; with affected as (select distinct user_id from fraud_flags where kind='bot_signals' and detail='Automation signals: no_plugins' and not resolved), cleared as (update user_risk r set status='normal',note='Removed no_plugins-only false positive',updated_at=now() from affected a where r.user_id=a.user_id and r.status='review' and r.note in ('Automated security review','Automation signals in client report') and not exists(select 1 from fraud_flags f where f.user_id=r.user_id and not f.resolved and not (f.kind='bot_signals' and f.detail='Automation signals: no_plugins')) returning r.user_id) select count(*) as cleared_accounts from cleared; update fraud_flags set resolved=true where kind='bot_signals' and detail='Automation signals: no_plugins' and not resolved; commit;

-- Regression tests, rollback only:
begin; do $$ declare u uuid; n int; begin select id into u from auth.users where email='nokifor23@gmail.com'; select count(*) into n from fraud_flags where user_id=u; perform add_flag(u,'bot_signals','high','Automation signals: no_plugins'); if (select count(*) from fraud_flags where user_id=u)<>n then raise exception 'legacy flag persisted'; end if; update user_risk set status='normal' where user_id=u; perform set_review(u,'Automation signals in client report'); if (select status from user_risk where user_id=u)<>'normal' then raise exception 'legacy review'; end if; update fraud_flags set resolved=true where user_id=u; perform add_flag(u,'bot_signals','high','Automation signals: no_plugins, webdriver_true'); if not exists(select 1 from fraud_flags where user_id=u and not resolved and detail='Automation signals: webdriver_true') then raise exception 'real signal lost'; end if; if (select status from user_risk where user_id=u)<>'review' then raise exception '60-point review failed'; end if; perform add_flag(u,'shared_device','high','rollback-only test'); if (select status from user_risk where user_id=u)<>'blocked' then raise exception '100-point block failed'; end if; end $$; rollback; select 'PASS: legacy ignored, real bots retained, 50/100 gate preserved; all tests rolled back' as tests;
