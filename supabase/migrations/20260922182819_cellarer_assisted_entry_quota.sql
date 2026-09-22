-- Meter Premium AI calls per Homestead. The browser cannot inspect or mutate
-- usage rows directly; authenticated server endpoints consume one request via
-- the narrow RPC before invoking paid infrastructure.

create table private.premium_feature_usage (
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  feature_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (homestead_id, feature_key, window_started_at)
);

revoke all on table private.premium_feature_usage from public, anon, authenticated;

create or replace function public.consume_premium_feature(feature_key text)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  tenant uuid := public.current_homestead_id();
  normalized_feature text := btrim(coalesce(feature_key, ''));
  usage_limit integer;
  window_start timestamptz := date_trunc('day', now());
  next_reset timestamptz := date_trunc('day', now()) + interval '1 day';
  consumed_count integer;
begin
  if actor is null or tenant is null then
    return query select false, 0, next_reset, 'membership_required'::text;
    return;
  end if;

  usage_limit := case normalized_feature
    when 'cellarer_assisted_entry' then 100
    when 'cellarer_receipt_reader' then 30
    when 'cellarer_ask_farm_book' then 100
    else null
  end;
  if usage_limit is null then
    raise exception 'Unsupported Premium feature' using errcode = '22023';
  end if;
  if not public.has_premium_feature(normalized_feature) then
    return query select false, 0, next_reset, 'premium_required'::text;
    return;
  end if;

  insert into private.premium_feature_usage (
    homestead_id, feature_key, window_started_at, request_count, updated_at
  ) values (
    tenant, normalized_feature, window_start, 1, now()
  )
  on conflict on constraint premium_feature_usage_pkey
  do update set
    request_count = private.premium_feature_usage.request_count + 1,
    updated_at = now()
  where private.premium_feature_usage.request_count < usage_limit
  returning private.premium_feature_usage.request_count into consumed_count;

  if consumed_count is null then
    return query select false, 0, next_reset, 'quota_reached'::text;
    return;
  end if;
  return query select true, greatest(usage_limit - consumed_count, 0), next_reset, 'allowed'::text;
end
$$;

revoke execute on function public.consume_premium_feature(text) from public, anon;
grant execute on function public.consume_premium_feature(text) to authenticated;
