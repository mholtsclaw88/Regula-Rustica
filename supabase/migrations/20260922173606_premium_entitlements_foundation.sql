-- Provider-neutral Premium foundation for Cyril the Cellarer.
-- Entitlements belong to a cloud Homestead, not a device. Clients may inspect
-- the effective entitlement and redeem a one-time gift, but they cannot grant,
-- alter, or revoke Premium directly.

create table public.premium_entitlements (
  id uuid primary key default gen_random_uuid(),
  homestead_id uuid not null references public.homesteads(id) on delete cascade,
  plan_key text not null default 'premium' check (plan_key in ('premium')),
  source text not null check (source in ('gift', 'purchase', 'promotion', 'admin', 'migration')),
  provider text not null default 'manual' check (length(btrim(provider)) between 1 and 80),
  external_reference text,
  feature_keys text[] not null default array[
    'cellarer_assisted_entry',
    'cellarer_receipt_reader',
    'cellarer_ask_farm_book'
  ]::text[],
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (ends_at is null or ends_at > starts_at),
  check (external_reference is null or length(btrim(external_reference)) between 1 and 240),
  check (source <> 'purchase' or external_reference is not null)
);

create unique index premium_entitlements_provider_reference_idx
  on public.premium_entitlements (provider, external_reference)
  where external_reference is not null;
create index premium_entitlements_active_homestead_idx
  on public.premium_entitlements (homestead_id, starts_at, ends_at)
  where revoked_at is null;

-- Gift material is deliberately kept outside the exposed Data API schema.
-- A raw code is returned only once when an operator issues it; only its hash is
-- persisted. This provides gifting now without coupling entitlement state to a
-- future Stripe, Apple, or Google purchase implementation.
create table private.premium_gift_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (length(code_hash) = 64),
  duration_days integer not null check (duration_days between 1 and 3650),
  redeem_by timestamptz not null,
  note text,
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_homestead_id uuid references public.homesteads(id) on delete set null,
  redeemed_by uuid references auth.users(id) on delete set null,
  check ((redeemed_at is null and redeemed_homestead_id is null and redeemed_by is null)
      or (redeemed_at is not null and redeemed_homestead_id is not null and redeemed_by is not null))
);

create or replace function private.issue_premium_gift(
  duration_days integer default 365,
  redeem_by timestamptz default (now() + interval '90 days'),
  gift_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  compact_code text := upper(encode(extensions.gen_random_bytes(8), 'hex'));
  raw_code text;
begin
  if duration_days not between 1 and 3650 then
    raise exception 'Gift duration must be between 1 and 3650 days' using errcode = '22023';
  end if;
  if redeem_by <= now() then
    raise exception 'Gift redemption deadline must be in the future' using errcode = '22023';
  end if;
  raw_code := 'RR-' || substring(compact_code, 1, 4) || '-' || substring(compact_code, 5, 4)
    || '-' || substring(compact_code, 9, 4) || '-' || substring(compact_code, 13, 4);
  insert into private.premium_gift_codes (code_hash, duration_days, redeem_by, note)
  values (
    encode(extensions.digest(upper(regexp_replace(raw_code, '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex'),
    duration_days,
    redeem_by,
    nullif(btrim(gift_note), '')
  );
  return raw_code;
end
$$;

create or replace function public.current_premium_entitlement()
returns table (
  plan_key text,
  status text,
  source text,
  starts_at timestamptz,
  ends_at timestamptz,
  feature_keys text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare tenant uuid;
begin
  perform private.require_user();
  tenant := public.current_homestead_id();
  if tenant is not null then
    return query
      select entitlement.plan_key,
        'active'::text,
        entitlement.source,
        entitlement.starts_at,
        entitlement.ends_at,
        entitlement.feature_keys
      from public.premium_entitlements entitlement
      where entitlement.homestead_id = tenant
        and entitlement.revoked_at is null
        and entitlement.starts_at <= now()
        and (entitlement.ends_at is null or entitlement.ends_at > now())
      order by entitlement.ends_at desc nulls first, entitlement.created_at desc
      limit 1;
    if found then return; end if;
  end if;
  return query select
    'free'::text,
    'inactive'::text,
    null::text,
    null::timestamptz,
    null::timestamptz,
    array[]::text[];
end
$$;

create or replace function public.has_premium_feature(feature_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.premium_entitlements entitlement
    where entitlement.homestead_id = public.current_homestead_id()
      and entitlement.revoked_at is null
      and entitlement.starts_at <= now()
      and (entitlement.ends_at is null or entitlement.ends_at > now())
      and btrim(feature_key) = any (entitlement.feature_keys)
  )
$$;

create or replace function public.redeem_premium_gift(gift_code text)
returns table (
  plan_key text,
  status text,
  source text,
  starts_at timestamptz,
  ends_at timestamptz,
  feature_keys text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_user();
  tenant uuid := public.current_homestead_id();
  normalized_code text := upper(regexp_replace(coalesce(gift_code, ''), '[^A-Za-z0-9]', '', 'g'));
  gift private.premium_gift_codes%rowtype;
  current_end timestamptz;
  grant_start timestamptz := now();
  grant_end timestamptz;
begin
  if tenant is null or not public.has_capability('manage_homestead') then
    raise exception 'Only a Homestead Steward can redeem Premium' using errcode = '42501';
  end if;
  if length(normalized_code) < 10 then
    raise exception 'Premium gift code is invalid or unavailable' using errcode = '22023';
  end if;

  select code.* into gift
  from private.premium_gift_codes code
  where code.code_hash = encode(extensions.digest(normalized_code, 'sha256'), 'hex')
  for update;

  if gift.id is null or gift.redeemed_at is not null or gift.redeem_by <= now() then
    raise exception 'Premium gift code is invalid or unavailable' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.premium_entitlements entitlement
    where entitlement.homestead_id = tenant
      and entitlement.revoked_at is null
      and entitlement.starts_at <= now()
      and entitlement.ends_at is null
  ) then
    raise exception 'This Homestead already has Premium without an end date' using errcode = '22023';
  end if;

  select max(entitlement.ends_at) into current_end
  from public.premium_entitlements entitlement
  where entitlement.homestead_id = tenant
    and entitlement.revoked_at is null
    and entitlement.ends_at > now();
  grant_end := greatest(coalesce(current_end, grant_start), grant_start)
    + make_interval(days => gift.duration_days);

  insert into public.premium_entitlements (
    homestead_id, source, provider, starts_at, ends_at, created_by,
    details
  ) values (
    tenant, 'gift', 'regula_rustica', grant_start, grant_end, actor,
    jsonb_build_object('gift_code_id', gift.id)
  );
  update private.premium_gift_codes
  set redeemed_at = now(), redeemed_homestead_id = tenant, redeemed_by = actor
  where id = gift.id;

  return query select * from public.current_premium_entitlement();
end
$$;

alter table public.premium_entitlements enable row level security;
revoke all on table public.premium_entitlements from public, anon, authenticated;
revoke all on table private.premium_gift_codes from public, anon, authenticated;

revoke execute on function private.issue_premium_gift(integer, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.current_premium_entitlement() from public, anon;
revoke execute on function public.has_premium_feature(text) from public, anon;
revoke execute on function public.redeem_premium_gift(text) from public, anon;
grant execute on function public.current_premium_entitlement() to authenticated;
grant execute on function public.has_premium_feature(text) to authenticated;
grant execute on function public.redeem_premium_gift(text) to authenticated;
