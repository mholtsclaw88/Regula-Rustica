import { access, readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20260806034255_cloud_foundation.sql', import.meta.url);
const invitationMigrationPath = new URL('../supabase/migrations/20260809204827_member_invitations.sql', import.meta.url);
const housekeepingMigrationPath = new URL('../supabase/migrations/20260810031921_housekeeping_tasks_calendar_yield.sql', import.meta.url);
const [migration, invitationMigration, housekeepingMigration, config, html, worker, tests, invitationTests, housekeepingTests] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(invitationMigrationPath, 'utf8'),
  readFile(housekeepingMigrationPath, 'utf8'),
  readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/tests/database/cloud_foundation.test.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/tests/database/member_invitations.test.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/tests/database/housekeeping.test.sql', import.meta.url), 'utf8')
]);

const tables = [
  'homesteads', 'profiles', 'homestead_members', 'invitations', 'records',
  'record_relationships', 'tasks', 'task_assignments', 'chronicle_entries',
  'notes', 'ledger_entries', 'audit_entries', 'sync_operations'
];
const housekeepingTables = ['calendar_events', 'yield_entries'];
const functions = [
  'create_homestead', 'accept_invitation', 'current_homestead_id',
  'current_member_role', 'has_capability', 'protect_final_steward',
  'complete_recurring_task'
];
const invitationFunctions = ['create_invitation', 'list_invitations', 'revoke_invitation'];
const housekeepingFunctions = ['apply_housekeeping_sync_operation'];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

for (const table of tables) {
  assert(new RegExp(`create table public\\.${table}\\b`, 'i').test(migration), `Missing table: ${table}`);
  assert(new RegExp(`alter table public\\.${table} enable row level security`, 'i').test(migration), `RLS not enabled: ${table}`);
  assert(tests.includes(`'${table}'`), `Test suite does not name table: ${table}`);
}

for (const table of housekeepingTables) {
  assert(new RegExp(`create table public\\.${table}\\b`, 'i').test(housekeepingMigration), `Missing table: ${table}`);
  assert(new RegExp(`alter table public\\.${table} enable row level security`, 'i').test(housekeepingMigration), `RLS not enabled: ${table}`);
  assert(housekeepingTests.includes(`'${table}'`), `Housekeeping tests do not name table: ${table}`);
}

for (const fn of functions) {
  assert(new RegExp(`function public\\.${fn}\\b`, 'i').test(migration), `Missing function: ${fn}`);
}
for (const fn of invitationFunctions) {
  assert(new RegExp(`function public\\.${fn}\\b`, 'i').test(invitationMigration), `Missing invitation function: ${fn}`);
}
for (const fn of housekeepingFunctions) {
  assert(new RegExp(`function public\\.${fn}\\b`, 'i').test(housekeepingMigration), `Missing housekeeping function: ${fn}`);
}

assert(!/create table public\.photos\b/i.test(migration), 'Photos must remain deferred.');
const allMigrations = [migration, invitationMigration, housekeepingMigration].join('\n');
assert(!/grant\s+.+\s+to\s+anon\b/i.test(allMigrations), 'The anon role must receive no grants.');
assert(!/security definer(?!\s+set search_path\s*=\s*'')/i.test(allMigrations), 'Every SECURITY DEFINER function must set an empty search_path.');
assert(/enable_anonymous_sign_ins\s*=\s*false/.test(config), 'Anonymous sign-in must be disabled.');
assert(/minimum_password_length\s*=\s*8/.test(config), 'Minimum password length must be eight.');
assert(/id="cloudAuthForm"/.test(html) && /id="cloudOnboarding"/.test(html), 'Cloud auth UI is incomplete.');
assert(/select plan\(48\)/.test(tests), 'pgTAP plan must match the test suite.');
assert(/select plan\(21\)/.test(invitationTests), 'Invitation pgTAP plan must match the test suite.');
assert(/select plan\(39\)/.test(housekeepingTests), 'Housekeeping pgTAP plan must match the test suite.');
assert(/drop constraint if exists invitations_role_check/i.test(invitationMigration), 'Steward invitations must be permitted.');
assert(/revoke select, insert, update on public\.invitations from authenticated/i.test(invitationMigration), 'Direct invitation table access must be revoked.');
assert(/id="cloudMemberManagement"/.test(html) && /id="cloudInvitationForm"/.test(html), 'Steward invitation UI is incomplete.');

const assetMatch = worker.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\]/);
assert(assetMatch, 'Service worker asset list is missing.');
const assets = [...assetMatch[1].matchAll(/'\.\/(.*?)'/g)].map(match => match[1]).filter(Boolean);
for (const asset of assets) await access(new URL(`../${asset}`, import.meta.url));

console.log(`Cloud foundation checks passed (${tables.length + housekeepingTables.length} RLS tables, ${functions.length + invitationFunctions.length + housekeepingFunctions.length} required functions, ${assets.length} cached assets).`);
