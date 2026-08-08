# Supabase Cloud Foundation Setup

The Cloud Foundation provides authentication, tenant isolation, and the database used by optional local-first synchronization. Local data, backup, restore, installability, and offline behavior remain available without Supabase. See `SYNC_SETUP.md` for first-sync choices, conflicts, and recovery.

## Prerequisites

- Supabase CLI 2.111.0 or newer
- Docker Desktop for the local Supabase stack
- Node.js 20 or newer for the runtime configuration helper

No service-role key or database password belongs in this repository or in browser code.

## Local setup

From the repository root:

```sh
supabase start
supabase db reset
supabase test db supabase/tests/database
```

`supabase db reset` applies every file in `supabase/migrations` and then runs the intentionally empty `supabase/seed.sql`. Tests create their own users and data inside a transaction and roll everything back.

The local Auth mail viewer is available at the Inbucket URL printed by `supabase status`. The generated configuration uses email/password authentication, allows sign-up, disables anonymous sign-in, and requires passwords with at least eight characters containing letters and digits.

## Browser configuration

The account controls in Settings read a generated `cloud-runtime-config.js`. Generate it only from environment variables:

```sh
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key \
npm run build:cloud-config
```

In PowerShell:

```powershell
$env:SUPABASE_URL = 'https://your-project.supabase.co'
$env:SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_your_key'
npm run build:cloud-config
```

The generated file is ignored by Git. A publishable key is intended for browser use and is constrained by Row Level Security; never substitute a secret key or service-role key.

When no runtime configuration exists, the account card reports that cloud access is unavailable and the local application continues normally. Cloud authentication requires a network connection. Synchronization begins only after the user chooses the explicit first-sync action described in `SYNC_SETUP.md`.

## Hosted project

1. Create a Supabase project without adding tables in the Dashboard.
2. Link the repository with `supabase link --project-ref <project-ref>`.
3. Review pending migrations with `supabase db push --dry-run`.
4. Apply them with `supabase db push` only in the intended environment.
5. In Auth URL Configuration, set the production Site URL and allow the exact local and production password-reset redirect URLs.
6. Keep Email enabled. Leave social providers, anonymous sign-in, and MFA disabled for this sprint.
7. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the hosting provider, then run `npm run build:cloud-config` as part of the build.

This branch does not deploy a hosted project. Linking and pushing a migration are explicit environment-owner actions.

## Database boundary

The foundation migration creates:

- `homesteads`, `profiles`, `homestead_members`, and `invitations`
- `records` and `record_relationships`
- `tasks` and `task_assignments`
- `chronicle_entries`, `notes`, and `ledger_entries`
- append-only `audit_entries`
- idempotent `sync_operations`

Photos remain deferred, as permitted by `DATABASE_SCHEMA.md`.

All application tables have RLS enabled. The `anon` role receives no table or function access. The `authenticated` role receives explicit, minimal Data API grants, with tenant and capability checks applied by policies. Security-definer functions use an empty `search_path`, validate `auth.uid()`, and derive the active Homestead from membership rather than accepting a client-supplied Homestead ID.

The protected RPC surface is:

- `create_homestead(homestead_name, homestead_timezone, homestead_currency)`
- `accept_invitation(invitation_token)`
- `current_homestead_id()`
- `current_member_role()`
- `has_capability(capability)`
- `complete_recurring_task(task_to_complete, operation_key, client_device_id)`
- `soft_delete_row(target_table, target_id)`
- `restore_row(target_table, target_id)`
- `apply_sync_operation(operation_key, client_device_id, target_table, target_id, operation_kind, expected_version, client_timestamp, operation_payload)`

Invitation creators must generate a cryptographically random token, give the raw token to the invited person through a private channel, and store only its lowercase SHA-256 hash in `invitations.token_hash`. The token is single-use and expires after seven days by default.

## Validation

Run before proposing a deployment:

```sh
npm run check
npm run test:sync
supabase db reset
supabase test db supabase/tests/database
supabase db lint --local --level warning
```

The unchanged 48-assertion Cloud Foundation suite proves the original membership, role, isolation, invitation, recurrence, deletion, audit, and final-Steward guarantees. The additive Sync v1 suite brings the database total to 69 assertions and covers atomic idempotent writes, server-derived Homestead identity, optimistic conflicts, synchronized soft deletion/restoration, restricted roles, audit behavior, and recurring completion through sync. The client suite covers first-sync cases, recovery, durable queuing, ordering, conflicts, and legacy-ID mapping.

## Deliberately deferred

- Realtime subscriptions
- Photo storage and upload processing
- Cellarer/AI integration
- Social login, MFA, and account deletion
- Notification delivery and automatic backups

These belong to later roadmap phases and should not be added to this foundation migration.
