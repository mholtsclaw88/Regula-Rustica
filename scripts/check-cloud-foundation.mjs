import { access, readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20260806034255_cloud_foundation.sql', import.meta.url);
const [migration, config, html, worker, tests] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/tests/database/cloud_foundation.test.sql', import.meta.url), 'utf8')
]);

const tables = [
  'homesteads', 'profiles', 'homestead_members', 'invitations', 'records',
  'record_relationships', 'tasks', 'task_assignments', 'chronicle_entries',
  'notes', 'ledger_entries', 'audit_entries', 'sync_operations'
];
const functions = [
  'create_homestead', 'accept_invitation', 'current_homestead_id',
  'current_member_role', 'has_capability', 'protect_final_steward',
  'complete_recurring_task'
];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

for (const table of tables) {
  assert(new RegExp(`create table public\\.${table}\\b`, 'i').test(migration), `Missing table: ${table}`);
  assert(new RegExp(`alter table public\\.${table} enable row level security`, 'i').test(migration), `RLS not enabled: ${table}`);
  assert(tests.includes(`'${table}'`), `Test suite does not name table: ${table}`);
}

for (const fn of functions) {
  assert(new RegExp(`function public\\.${fn}\\b`, 'i').test(migration), `Missing function: ${fn}`);
}

assert(!/create table public\.photos\b/i.test(migration), 'Photos must remain deferred.');
assert(!/grant\s+.+\s+to\s+anon\b/i.test(migration), 'The anon role must receive no grants.');
assert(!/security definer(?!\s+set search_path\s*=\s*'')/i.test(migration), 'Every SECURITY DEFINER function must set an empty search_path.');
assert(/enable_anonymous_sign_ins\s*=\s*false/.test(config), 'Anonymous sign-in must be disabled.');
assert(/minimum_password_length\s*=\s*8/.test(config), 'Minimum password length must be eight.');
assert(/id="cloudAuthForm"/.test(html) && /id="cloudOnboarding"/.test(html), 'Cloud auth UI is incomplete.');
assert(/select plan\(48\)/.test(tests), 'pgTAP plan must match the test suite.');

const assetMatch = worker.match(/const ASSETS=\[(.*?)\]/);
assert(assetMatch, 'Service worker asset list is missing.');
const assets = [...assetMatch[1].matchAll(/'\.\/(.*?)'/g)].map(match => match[1]).filter(Boolean);
for (const asset of assets) await access(new URL(`../${asset}`, import.meta.url));

console.log(`Cloud foundation checks passed (${tables.length} RLS tables, ${functions.length} required functions, ${assets.length} cached assets).`);
