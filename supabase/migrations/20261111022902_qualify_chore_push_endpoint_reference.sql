-- Keep the existing privilege boundary and validation; qualify the DELETE
-- target so PL/pgSQL does not confuse columns with function parameters.
create or replace function public.register_chore_push_subscription(
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
  delete from public.chore_push_subscriptions as s
    where s.endpoint = register_chore_push_subscription.endpoint
       or (s.user_id = actor and s.device_id = register_chore_push_subscription.device_id);
  insert into public.chore_push_subscriptions
    (homestead_id, user_id, device_id, endpoint, p256dh, auth_secret)
    values (tenant, actor, register_chore_push_subscription.device_id,
      register_chore_push_subscription.endpoint,
      register_chore_push_subscription.p256dh,
      register_chore_push_subscription.auth_secret);
  return true;
end $$;
