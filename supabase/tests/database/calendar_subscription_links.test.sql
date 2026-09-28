begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select has_table('private', 'calendar_subscription_links', 'subscription credentials are private');
select ok(not has_table_privilege('anon', 'private.calendar_subscription_links', 'select'), 'anonymous users cannot read credentials');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('00000000-0000-0000-0000-000000000000','93000000-0000-0000-0000-000000000001','authenticated','authenticated','feed-steward@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false),
  ('00000000-0000-0000-0000-000000000000','93000000-0000-0000-0000-000000000002','authenticated','authenticated','feed-keeper@example.test',crypt('password',gen_salt('bf')),now(),now(),now(),'{}','{}',false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000001', true);
select public.create_homestead('Subscription test') as homestead_id \gset
select throws_ok('select public.rotate_calendar_subscription()', '42501', 'A Premium Homestead Steward is required to share the calendar', 'free Homesteads cannot issue feed links');
reset role;

insert into public.premium_entitlements (homestead_id, source, provider, external_reference, starts_at)
values (:'homestead_id', 'purchase', 'test', 'calendar-test-premium', now());
insert into public.homestead_members (homestead_id, user_id, role, status, joined_at)
values (:'homestead_id', '93000000-0000-0000-0000-000000000002', 'keeper', 'active', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000002', true);
select throws_ok('select public.rotate_calendar_subscription()', '42501', 'A Premium Homestead Steward is required to share the calendar', 'non-Stewards cannot issue feed links');
select set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000001', true);
select public.rotate_calendar_subscription() as first_token \gset
select ok(public.calendar_subscription_status(), 'Steward sees active subscription status');
insert into public.calendar_events (homestead_id, title, start_date, end_date, created_by)
values (:'homestead_id', 'Harvest day', '2026-10-01', '2026-10-01', '93000000-0000-0000-0000-000000000001');
select is(public.read_calendar_subscription(:'first_token'::uuid) -> 'events' -> 0 ->> 'title', 'Harvest day', 'valid link returns Calendar events');
select public.rotate_calendar_subscription() as second_token \gset
select ok(public.read_calendar_subscription(:'first_token'::uuid) is null, 'rotation invalidates the old link');
reset role;

set local role anon;
select ok(public.read_calendar_subscription(:'second_token'::uuid) is not null, 'anonymous subscription clients can read with the private link');
select ok(public.read_calendar_subscription('00000000-0000-0000-0000-000000000000'::uuid) is null, 'unknown link reveals nothing');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000001', true);
select public.revoke_calendar_subscription();
select ok(public.read_calendar_subscription(:'second_token'::uuid) is null, 'revocation stops the feed');
reset role;

select * from finish();
rollback;
