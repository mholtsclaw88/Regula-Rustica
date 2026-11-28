-- Preserve the sender-token and lease boundary; disambiguate the conflict target
-- from the PL/pgSQL RETURNS TABLE variables.
create or replace function public.claim_due_chore_push(sender_token text)
returns table (
  delivery_id uuid, lease_token uuid, subscription_id uuid,
  endpoint text, p256dh text, auth_secret text,
  chore_window_id uuid, window_name text, work_date date, task_context jsonb
)
language plpgsql security definer set search_path = '' as $$
begin
  if sender_token is null or not exists (
    select 1 from private.chore_push_sender_auth a
    where a.singleton and a.token_hash = encode(extensions.digest(sender_token, 'sha256'), 'hex')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  with due as materialized (
    select s.id as subscription_id, s.endpoint, s.p256dh, s.auth_secret,
      w.id as chore_window_id, w.name as window_name, day.work_date,
      h.id as homestead_id
    from public.chore_push_subscriptions s
    join public.homestead_members m on m.user_id = s.user_id
      and m.homestead_id = s.homestead_id and m.status = 'active'
    join public.homesteads h on h.id = s.homestead_id and h.deleted_at is null
    join public.chore_windows w on w.homestead_id = h.id
      and w.enabled and w.deleted_at is null and w.end_time is not null
    cross join lateral (values
      ((now() at time zone h.timezone)::date),
      ((now() at time zone h.timezone)::date - 1)
    ) as day(work_date)
    cross join lateral (
      select (day.work_date + w.end_time) at time zone h.timezone as ends_at
    ) clock
    where s.enabled
      and clock.ends_at <= now() and clock.ends_at > now() - interval '30 minutes'
      and exists (
        select 1 from public.premium_entitlements e
        where e.homestead_id = h.id and e.revoked_at is null
          and e.starts_at <= now() and (e.ends_at is null or e.ends_at > now())
          and 'cloud_sync' = any(e.feature_keys)
      )
  ), claimed as (
    insert into private.chore_push_deliveries
      (subscription_id, chore_window_id, work_date, lease_until)
    select d.subscription_id, d.chore_window_id, d.work_date, now() + interval '2 minutes'
    from due d
    on conflict on constraint chore_push_deliveries_subscription_id_chore_window_id_work__key
      do update set lease_token = gen_random_uuid(),
        lease_until = excluded.lease_until,
        attempts = chore_push_deliveries.attempts + 1
      where chore_push_deliveries.sent_at is null
        and chore_push_deliveries.lease_until < now()
        and chore_push_deliveries.attempts < 100
    returning id, chore_push_deliveries.lease_token,
      chore_push_deliveries.subscription_id,
      chore_push_deliveries.chore_window_id,
      chore_push_deliveries.work_date
  )
  select c.id, c.lease_token, d.subscription_id, d.endpoint, d.p256dh,
    d.auth_secret, d.chore_window_id, d.window_name, d.work_date,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'dueDate', t.due_date, 'availableFrom', t.available_from,
        'completed', t.status = 'completed', 'status', t.status,
        'deletedAt', t.deleted_at, 'recurrenceRule', t.recurrence_rule,
        'recordId', t.record_id, 'choreWindowId', t.chore_window_id,
        'createdAt', t.created_at, 'updatedAt', t.updated_at
      ))
      from public.tasks t
      left join public.records r on r.id = t.record_id and r.homestead_id = d.homestead_id
      where t.homestead_id = d.homestead_id and t.chore_window_id = d.chore_window_id
        and (t.record_id is null or (r.id is not null and r.deleted_at is null
          and lower(r.status) not in ('sold','deceased','processed','archived',
            'inactive','out of service','completed','cancelled')))
    ), '[]'::jsonb)
  from claimed c join due d on d.subscription_id = c.subscription_id
    and d.chore_window_id = c.chore_window_id and d.work_date = c.work_date;
end $$;
