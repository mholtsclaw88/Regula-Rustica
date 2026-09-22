begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select has_table('private', 'premium_feature_usage', 'Premium feature usage is stored privately');
select has_function('public', 'consume_premium_feature', array['text'], 'Premium usage has a narrow RPC');
select ok(not has_table_privilege('authenticated', 'private.premium_feature_usage', 'select'), 'clients cannot read usage rows');
select ok(not has_table_privilege('authenticated', 'private.premium_feature_usage', 'insert,update,delete'), 'clients cannot mutate usage rows');
select ok(not has_function_privilege('anon', 'public.consume_premium_feature(text)', 'execute'), 'anonymous callers cannot consume Premium usage');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000','93000000-0000-0000-0000-000000000001','authenticated','authenticated',
  'cellarer-steward@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000001', true);
select public.create_homestead('Cellarer Homestead') as cellarer_homestead \gset
select results_eq(
  $$select allowed, remaining, reason from public.consume_premium_feature('cellarer_assisted_entry')$$,
  $$values (false, 0, 'premium_required'::text)$$,
  'free Homesteads cannot consume an AI request'
);
reset role;

insert into public.premium_entitlements (homestead_id, source, provider, starts_at, ends_at)
values (:'cellarer_homestead', 'admin', 'regula_rustica', now(), now() + interval '30 days');

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000001', true);
select results_eq(
  $$select allowed, remaining, reason from public.consume_premium_feature('cellarer_assisted_entry')$$,
  $$values (true, 99, 'allowed'::text)$$,
  'Premium Homestead can consume its first Assisted Entry request'
);
reset role;

select is(
  (select request_count from private.premium_feature_usage where homestead_id = :'cellarer_homestead' and feature_key = 'cellarer_assisted_entry'),
  1,
  'usage persists after consumption'
);
update private.premium_feature_usage set request_count = 99 where homestead_id = :'cellarer_homestead' and feature_key = 'cellarer_assisted_entry';

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000001', true);
select results_eq(
  $$select allowed, remaining, reason from public.consume_premium_feature('cellarer_assisted_entry')$$,
  $$values (true, 0, 'allowed'::text)$$,
  'the final daily request is allowed'
);
select results_eq(
  $$select allowed, remaining, reason from public.consume_premium_feature('cellarer_assisted_entry')$$,
  $$values (false, 0, 'quota_reached'::text)$$,
  'the next daily request is refused without incrementing'
);
select throws_ok(
  $$select public.consume_premium_feature('unknown_feature')$$,
  '22023', 'Unsupported Premium feature',
  'unknown feature keys are rejected'
);
reset role;

select is(
  (select request_count from private.premium_feature_usage where homestead_id = :'cellarer_homestead' and feature_key = 'cellarer_assisted_entry'),
  100,
  'refused requests do not increase the persisted count'
);

select * from finish();
rollback;
