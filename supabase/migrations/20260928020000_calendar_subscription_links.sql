-- A subscription URL is a bearer credential for a read-only calendar feed.
-- Store one high-entropy link per Homestead in a non-exposed schema. Only a
-- Steward with Premium Cloud Sync may issue or revoke it; rotation invalidates
-- every earlier copy immediately.
create table private.calendar_subscription_links (
  homestead_id uuid primary key references public.homesteads(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

revoke all on private.calendar_subscription_links from public, anon, authenticated;

create function public.calendar_subscription_status()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.calendar_subscription_links link
    where link.homestead_id = public.current_homestead_id()
      and public.has_capability('manage_homestead')
  );
$$;

create function public.rotate_calendar_subscription()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  tenant uuid := public.current_homestead_id();
  fresh_token uuid := gen_random_uuid();
begin
  if tenant is null or not public.has_capability('manage_homestead')
    or not public.has_premium_feature('cloud_sync') then
    raise exception 'A Premium Homestead Steward is required to share the calendar' using errcode = '42501';
  end if;
  insert into private.calendar_subscription_links (homestead_id, token, created_at, created_by)
  values (tenant, fresh_token, now(), (select auth.uid()))
  on conflict (homestead_id) do update
    set token = excluded.token, created_at = excluded.created_at, created_by = excluded.created_by;
  return fresh_token;
end;
$$;

create function public.revoke_calendar_subscription()
returns void language plpgsql security definer set search_path = '' as $$
declare tenant uuid := public.current_homestead_id();
begin
  if tenant is null or not public.has_capability('manage_homestead') then
    raise exception 'Only a Homestead Steward can stop calendar sharing' using errcode = '42501';
  end if;
  delete from private.calendar_subscription_links where homestead_id = tenant;
end;
$$;

-- Called by the public, rate-limited Netlify feed endpoint. Knowledge of the
-- UUID is the sole authorization. Never expose the token table or other Farm
-- Book entities through this function.
create function public.read_calendar_subscription(raw_token uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  tenant uuid;
  calendar_name text;
  event_count integer;
  events jsonb;
begin
  select link.homestead_id into tenant
  from private.calendar_subscription_links link where link.token = raw_token;
  if tenant is null then return null; end if;
  if not exists (
    select 1 from public.premium_entitlements entitlement
    where entitlement.homestead_id = tenant and entitlement.revoked_at is null
      and entitlement.starts_at <= now()
      and (entitlement.ends_at is null or entitlement.ends_at > now())
      and 'cloud_sync' = any(entitlement.feature_keys)
  ) then return null; end if;

  select name into calendar_name from public.homesteads where id = tenant;
  select count(*) into event_count from public.calendar_events
    where homestead_id = tenant and deleted_at is null;
  if event_count > 5000 then
    raise exception 'Calendar subscription has too many events' using errcode = '54000';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', event.id, 'title', event.title, 'startDate', event.start_date,
      'endDate', event.end_date, 'allDay', event.all_day,
      'startTime', event.start_time, 'endTime', event.end_time,
      'location', event.location, 'notes', event.notes,
      'recurrenceRule', event.recurrence_rule, 'updatedAt', event.updated_at
    ) order by event.start_date, event.id), '[]'::jsonb)
  into events from public.calendar_events event
  where event.homestead_id = tenant and event.deleted_at is null;
  return jsonb_build_object('name', calendar_name, 'events', events);
end;
$$;

revoke execute on function public.calendar_subscription_status() from public, anon;
revoke execute on function public.rotate_calendar_subscription() from public, anon;
revoke execute on function public.revoke_calendar_subscription() from public, anon;
revoke execute on function public.read_calendar_subscription(uuid) from public;
grant execute on function public.calendar_subscription_status() to authenticated;
grant execute on function public.rotate_calendar_subscription() to authenticated;
grant execute on function public.revoke_calendar_subscription() to authenticated;
grant execute on function public.read_calendar_subscription(uuid) to anon, authenticated;
