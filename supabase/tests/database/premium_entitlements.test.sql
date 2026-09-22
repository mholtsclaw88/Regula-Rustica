begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

select has_table('public', 'premium_entitlements', 'Premium entitlement ledger exists');
select has_table('private', 'premium_gift_codes', 'gift material remains in the private schema');
select ok((select relrowsecurity from pg_class where oid = 'public.premium_entitlements'::regclass), 'entitlement ledger has RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.premium_entitlements', 'select'), 'clients cannot read entitlement rows directly');
select ok(not has_table_privilege('authenticated', 'public.premium_entitlements', 'insert,update,delete'), 'clients cannot mutate entitlement rows directly');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000001','authenticated','authenticated','premium-steward@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"Premium Steward"}',false),
  ('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000002','authenticated','authenticated','premium-keeper@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"Premium Keeper"}',false),
  ('00000000-0000-0000-0000-000000000000','92000000-0000-0000-0000-000000000001','authenticated','authenticated','other-steward@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{"display_name":"Other Steward"}',false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select public.create_homestead('Premium Homestead') as premium_homestead \gset
select is((select plan_key from public.current_premium_entitlement()), 'free', 'a new Homestead begins on the free plan');
select ok(not public.has_premium_feature('cellarer_assisted_entry'), 'free Homestead has no Cyril features');
reset role;

insert into public.homestead_members (homestead_id, user_id, role, status, joined_at)
values (:'premium_homestead', '91000000-0000-0000-0000-000000000002', 'keeper', 'active', now());

select private.issue_premium_gift(30, now() + interval '7 days', 'Test gift') as gift_code \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000002', true);
select throws_ok(
  format('select public.redeem_premium_gift(%L)', :'gift_code'),
  '42501', 'Only a Homestead Steward can redeem Premium',
  'non-Steward household members cannot redeem a gift');
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select lives_ok(
  format('select public.redeem_premium_gift(%L)', :'gift_code'),
  'Steward can redeem a valid gift');
select is((select plan_key from public.current_premium_entitlement()), 'premium', 'gift activates Premium for the Homestead');
select is((select source from public.current_premium_entitlement()), 'gift', 'effective entitlement identifies its source');
select ok(public.has_premium_feature('cellarer_assisted_entry'), 'Assisted Entry is enabled');
select ok(public.has_premium_feature('cellarer_receipt_reader'), 'Receipt Reader is enabled');
select ok(public.has_premium_feature('cellarer_ask_farm_book'), 'Ask the Farm Book is enabled');
select ok(not public.has_premium_feature('unknown_feature'), 'unknown features are not enabled');
select throws_ok(
  format('select public.redeem_premium_gift(%L)', :'gift_code'),
  '22023', 'Premium gift code is invalid or unavailable',
  'a one-time gift cannot be redeemed again');

select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000002', true);
select is((select plan_key from public.current_premium_entitlement()), 'premium', 'Premium applies to the household, not one user');
reset role;

insert into public.premium_entitlements (
  homestead_id, source, provider, external_reference, starts_at, ends_at
) values (
  :'premium_homestead', 'purchase', 'apple_app_store', 'future-transaction-1', now(), now() + interval '1 month'
);
select ok(
  exists(select 1 from public.premium_entitlements where provider = 'apple_app_store' and external_reference = 'future-transaction-1'),
  'provider-neutral ledger accepts a future verified app-store purchase');

select * from finish();
rollback;
