import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [migration, html, auth, css] = await Promise.all([
  readFile(new URL('../supabase/migrations/20260922173606_premium_entitlements_foundation.sql', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../cloud-auth.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

test('Premium entitlement ledger is provider-neutral and not client-writable', () => {
  assert.match(migration, /create table public\.premium_entitlements/);
  assert.match(migration, /source in \('gift', 'purchase', 'promotion', 'admin', 'migration'\)/);
  assert.match(migration, /provider text not null/);
  assert.match(migration, /external_reference text/);
  assert.match(migration, /revoke all on table public\.premium_entitlements from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*premium_entitlements.*authenticated/i);
});

test('Premium is a Homestead entitlement with narrow read and gift redemption RPCs', () => {
  assert.match(migration, /homestead_id uuid not null references public\.homesteads/);
  assert.match(migration, /create or replace function public\.current_premium_entitlement\(\)/);
  assert.match(migration, /create or replace function public\.has_premium_feature\(feature_key text\)/);
  assert.match(migration, /create or replace function public\.redeem_premium_gift\(gift_code text\)/);
  assert.match(migration, /Only a Homestead Steward can redeem Premium/);
  assert.match(migration, /for update;/);
  assert.match(migration, /code_hash text not null unique/);
});

test('Cyril Premium plan remains accessible inside Account & Cloud', () => {
  assert.match(html, /data-settings-category="cloud"/);
  assert.match(html, /id="accountCloudPremiumDetails"/);
  assert.match(html, /Cyril the Cellarer/);
  assert.match(html, /Assisted Entry/);
  assert.match(html, /Receipt Reader/);
  assert.match(html, /Consult Cyril/);
  assert.match(html, /<strong>Cloud Sync<\/strong>/);
  assert.match(html, /Purchases are not available yet/);
  assert.match(css, /\.premium-feature-list/);
});

test('cloud context reads effective Premium and redemption refreshes it', () => {
  assert.match(auth, /client\.rpc\('current_premium_entitlement'\)/);
  assert.match(auth, /premium: premiumResult\.entitlement/);
  assert.match(auth, /client\.rpc\('redeem_premium_gift', \{ gift_code: giftCode \}\)/);
  assert.match(auth, /await refreshAccount\(session\)/);
  assert.match(auth, /Premium status is temporarily unavailable\. Cloud Sync is paused/);
});
