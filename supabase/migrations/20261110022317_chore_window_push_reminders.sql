-- Device-specific Web Push enrollment. The browser owns its subscription;
-- a member can inspect/remove only their own device rows.
create table public.chore_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  endpoint text not null unique check (length(endpoint) between 30 and 2048),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth_secret text not null check (length(auth_secret) between 16 and 100),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);
create index chore_push_subscriptions_homestead_enabled_idx
  on public.chore_push_subscriptions (homestead_id, user_id) where enabled;
alter table public.chore_push_subscriptions enable row level security;
revoke all on public.chore_push_subscriptions from public, anon, authenticated;
grant select, delete on public.chore_push_subscriptions to authenticated;
create policy chore_push_subscriptions_select on public.chore_push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()) and homestead_id = (select public.current_homestead_id()));
create policy chore_push_subscriptions_delete on public.chore_push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()) and homestead_id = (select public.current_homestead_id()));

-- Only a hash is stored. Provision the random sender token out of band in
-- Netlify Functions and this private table; never put it in a migration.
create table private.chore_push_sender_auth (
  singleton boolean primary key default true check (singleton),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$')
);
revoke all on private.chore_push_sender_auth from public, anon, authenticated;
alter table private.chore_push_sender_auth enable row level security;

create table private.chore_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.chore_push_subscriptions(id) on delete cascade,
  chore_window_id uuid not null references public.chore_windows(id) on delete cascade,
  work_date date not null,
  lease_token uuid not null default gen_random_uuid(),
  lease_until timestamptz not null,
  attempts integer not null default 1 check (attempts between 1 and 100),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, chore_window_id, work_date)
);
revoke all on private.chore_push_deliveries from public, anon, authenticated;
alter table private.chore_push_deliveries enable row level security;
create index chore_push_deliveries_pending_idx
  on private.chore_push_deliveries (lease_until) where sent_at is null;

-- A browser endpoint is an unguessable subscription capability, but registration
-- still requires the signed-in member and an active Premium cloud Homestead.
-- Known push-service hosts are allowed; arbitrary URLs must never be sent to.
create function public.register_chore_push_subscription(
  device_id uuid, endpoint text, p256dh text, auth_secret text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  tenant uuid := public.current_homestead_id();
begin
  if actor is null or tenant is null or not public.has_premium_feature('cloud_sync') then
    raise exception 'A connected Premium Homestead is required for reminders' using errcode = '42501';
  end if;
  if device_id is null or endpoint is null or endpoint !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com)/'
    or length(endpoint) > 2048 or p256dh !~ '^[A-Za-z0-9_-]{40,200}$'
    or auth_secret !~ '^[A-Za-z0-9_-]{16,100}$' then
    raise exception 'Invalid push subscription' using errcode = '22023';
  end if;
  delete from public.chore_push_subscriptions
    where endpoint = register_chore_push_subscription.endpoint
       or (user_id = actor and chore_push_subscriptions.device_id = register_chore_push_subscription.device_id);
  insert into public.chore_push_subscriptions
    (homestead_id, user_id, device_id, endpoint, p256dh, auth_secret)
    values (tenant, actor, device_id, endpoint, p256dh, auth_secret);
  return true;
end $$;
revoke execute on function public.register_chore_push_subscription(uuid,text,text,text) from public, anon;
grant execute on function public.register_chore_push_subscription(uuid,text,text,text) to authenticated;

-- The anonymous Data API role can call only with a 256-bit server token.
-- Keep the result minimal: no Task titles, descriptions, Record details, or
-- household identity are needed to decide whether a round has open work.
create function public.claim_due_chore_push(sender_token text)
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
    on conflict (subscription_id, chore_window_id, work_date)
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
revoke execute on function public.claim_due_chore_push(text) from public, authenticated;
grant execute on function public.claim_due_chore_push(text) to anon;

create function public.finish_chore_push(
  sender_token text, delivery_id uuid, lease_token uuid, outcome text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  claimed_subscription uuid;
begin
  if sender_token is null or not exists (
    select 1 from private.chore_push_sender_auth a
    where a.singleton and a.token_hash = encode(extensions.digest(sender_token, 'sha256'), 'hex')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if outcome not in ('sent', 'no_work', 'expired', 'retry') then
    raise exception 'Invalid delivery outcome' using errcode = '22023';
  end if;
  update private.chore_push_deliveries d
    set sent_at = case when outcome = 'retry' then null else now() end,
      lease_until = case when outcome = 'retry' then now() - interval '1 second' else d.lease_until end
    where d.id = delivery_id and d.lease_token = finish_chore_push.lease_token
      and d.sent_at is null
    returning d.subscription_id into claimed_subscription;
  if claimed_subscription is null then return false; end if;
  if outcome = 'expired' then
    update public.chore_push_subscriptions s set enabled = false, updated_at = now()
      where s.id = claimed_subscription;
  end if;
  return true;
end $$;
revoke execute on function public.finish_chore_push(text,uuid,uuid,text) from public, authenticated;
grant execute on function public.finish_chore_push(text,uuid,uuid,text) to anon;
