import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { premiumCloudEntitled, premiumSyncAvailable } from '../sync/premium-access.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [runtime, migration, html, onboarding, auth] = await Promise.all([
  read('sync/runtime.mjs'), read('supabase/migrations/20260925020421_premium_cloud_sync_gate.sql'),
  read('index.html'), read('onboarding.js'), read('cloud-auth.js')
]);
const connected = { session: { access_token: 'session' }, homesteadId: 'home', premium: { plan_key: 'premium', status: 'active', feature_keys: ['cloud_sync'], ends_at: null } };

test('Cloud Sync pauses without an active Premium entitlement but preserves local writes', () => {
  assert.equal(premiumSyncAvailable(connected), true);
  assert.equal(premiumSyncAvailable({ ...connected, premium: null }), false);
  assert.equal(premiumSyncAvailable({ ...connected, premium: { status: 'inactive' } }), false);
  assert.equal(premiumSyncAvailable({ ...connected, premium: { plan_key: 'free', status: 'active', feature_keys: ['cloud_sync'] } }), false);
  assert.equal(premiumSyncAvailable({ ...connected, premium: { plan_key: 'premium', status: 'active', feature_keys: ['cellarer_assisted_entry'] } }), true);
  assert.equal(premiumSyncAvailable({ ...connected, premium: { plan_key: 'premium', status: 'active', ends_at: '2026-01-01T00:00:00Z' } }, Date.parse('2026-02-01T00:00:00Z')), false);
  assert.equal(premiumSyncAvailable({ ...connected, premium: { plan_key: 'premium', status: 'active', ends_at: '2026-12-01T00:00:00Z' } }, Date.parse('2026-02-01T00:00:00Z')), true);
  assert.equal(premiumSyncAvailable({ ...connected, session: null }), false);
  assert.match(runtime, /engine\.queueLocalChanges\(event\.detail\.before, event\.detail\.after\)/);
  assert.match(runtime, /if \(!premiumSyncAvailable\(context\)\) \{/);
  assert.match(runtime, /return navigator\.onLine && premiumSyncAvailable\(context\)/);
  assert.match(runtime, /button\.disabled = !premiumSyncAvailable\(context\)/);
  assert.match(runtime, /Premium needed · local work is safe/);
});

test('active Premium grants created before cloud_sync exists remain valid in deploy previews', () => {
  assert.equal(premiumCloudEntitled({ plan_key: 'premium', status: 'active', feature_keys: ['cellarer_assisted_entry'], ends_at: null }), true);
  assert.match(auth, /premiumCloudEntitled\(premiumResult\.entitlement\)/);
  assert.match(auth, /premiumCloudEntitled\(entitlement\)/);
});

test('Premium Cloud Sync is checked at the database boundary, not only in the browser', () => {
  assert.match(migration, /'cloud_sync'/);
  assert.match(migration, /update public\.premium_entitlements/);
  assert.match(migration, /as restrictive for all to authenticated/);
  assert.match(migration, /create trigger premium_cloud_write before insert or update or delete/);
  assert.match(migration, /premium_homestead_update on public\.homesteads/);
  assert.match(migration, /premium_invitation_create on public\.invitations/);
  assert.match(migration, /public\.has_premium_feature\('cloud_sync'\)/);
  assert.match(migration, /premium_record_documents_storage on storage\.objects/);
  assert.match(migration, /person_type <> 'child'/);
  assert.match(migration, /revoke execute on function private\.require_premium_cloud_write/);
  assert.match(html, /Cloud Sync connects this Homestead across your devices/);
  assert.match(onboarding, /onboardingReturningSignIn/);
  assert.match(auth, /Cloud Sync is paused until this Homestead has Premium/);
});
