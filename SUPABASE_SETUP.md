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

If `supabase` is not installed globally, Windows PowerShell can run the same
verified commands through npm without changing the execution policy:

```powershell
npx.cmd --yes supabase@latest start
npx.cmd --yes supabase@latest db reset
npx.cmd --yes supabase@latest test db supabase/tests/database
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
- `homestead_people`, containing assignable members and account-free children
- `chronicle_entries`, `notes`, and `ledger_entries`
- `record_documents` and `record_attachments`, with metadata synchronized separately from file bytes
- `calendar_events` and canonical `yield_entries`
- `chore_windows` and recurring `tasks`; legacy `routines` and `routine_occurrences` remain only for recoverable migration history
- append-only `audit_entries`
- idempotent `sync_operations`

Record attachment bytes are local-first. The browser keeps photos and PDFs in the `regula-rustica-attachments` IndexedDB database, keyed by the stable attachment ID; localStorage and exported Record JSON contain metadata only. Signed-out and offline users can add, preview, open, and delete those local attachments.

When cloud sync is connected, the same bytes are uploaded idempotently to the private `record-documents` Storage bucket before their metadata enters the cloud outbox. Object paths begin with `homesteads/<homestead-id>/`, Storage policies enforce the same active-membership and role capabilities as metadata rows, and the browser obtains short-lived signed URLs rather than public object URLs. Upload failure leaves the IndexedDB copy usable and marks the metadata for a later retry. A Record profile photo is only a `primary_photo_id` reference to an active image attachment; changing it never duplicates file bytes, and deleting the active image clears the reference safely.

All application tables have RLS enabled. The `anon` role receives no table or function access. The `authenticated` role receives explicit, minimal Data API grants, with tenant and capability checks applied by policies. Security-definer functions use an empty `search_path`, validate `auth.uid()`, and derive the active Homestead from membership rather than accepting a client-supplied Homestead ID.

The protected RPC surface is:

- `create_homestead(homestead_name, homestead_timezone, homestead_currency)`
- `create_invitation(invitation_email, invitation_role)`
- `list_invitations()`
- `revoke_invitation(invitation_id)`
- `accept_invitation(invitation_token)`
- `current_homestead_id()`
- `current_member_role()`
- `has_capability(capability)`
- `complete_recurring_task(task_to_complete, operation_key, client_device_id)`
- `soft_delete_row(target_table, target_id)`
- `restore_row(target_table, target_id)`
- `apply_sync_operation(operation_key, client_device_id, target_table, target_id, operation_kind, expected_version, client_timestamp, operation_payload)`
- `apply_housekeeping_sync_operation(operation_key, client_device_id, target_table, target_id, operation_kind, expected_version, client_timestamp, operation_payload)`
- `apply_people_sync_operation(operation_key, client_device_id, target_table, target_id, operation_kind, expected_version, client_timestamp, operation_payload)`
- `apply_routine_sync_operation(operation_key, client_device_id, target_table, target_id, operation_kind, expected_version, client_timestamp, operation_payload)`
- `apply_task_sync_operation(operation_key, client_device_id, target_table, target_id, operation_kind, expected_version, client_timestamp, operation_payload)`
- `apply_document_sync_operation(operation_key, client_device_id, target_table, target_id, operation_kind, expected_version, client_timestamp, operation_payload)`
- `apply_ledger_allocation_sync_operation(operation_key, client_device_id, target_table, target_id, operation_kind, expected_version, client_timestamp, operation_payload)`

`create_invitation` generates a cryptographically random token on the server and returns the raw token once so the Steward can share the resulting link through a private channel. Only its lowercase SHA-256 hash is stored. Tokens are single-use, revocable, and expire after seven days by default. Notification delivery is deliberately deferred; Regula Rustica does not email invitation links automatically.

## Validation

Run before proposing a deployment:

```sh
npm run check
npm run test:cloud-auth
npm run test:sync
supabase db reset
supabase test db supabase/tests/database
supabase db lint --local --level warning
```

The unchanged 48-assertion Cloud Foundation suite proves the original membership, role, isolation, invitation, recurrence, deletion, audit, and final-Steward guarantees. The 21-assertion member-invitation suite covers invitation lifecycle and Steward-only access. Sync v1 adds 21 assertions; Housekeeping adds 39; Homestead people adds 37; and the 33-assertion Task/Yield suite remains as migration compatibility coverage. The first-class Routine suite adds 35 assertions for defaults, definition/occurrence separation, assignment-aware completion, Yield completion, recurrence idempotency, tenant isolation, all four roles, soft deletion, auditing, and RLS. The Records Documents suite adds 23 assertions covering private storage, tenant paths, permissions, metadata lifecycle, auditing, synchronization, and RLS. The recurring-Task resync suite adds 10 assertions for guarded legacy retirement, inactive Chore Window cleanup, completed-history preservation, descendant cleanup, and idempotency. The cloud-sync reference-stability suite adds 22 assertions covering deleted Task convergence, stale Chore Window sanitization, completed Task replay/reopening, conflict-row recovery, invalid historical date normalization, recurring completion, and operation idempotency. The Chore Window sync-convergence suite adds 8 assertions covering recovered Morning/Evening semantic identity, uniqueness, canonical-row responses, and idempotency. The current database total is 356 assertions across 17 pgTAP files. Client suites cover conservative Task-backed migration, recurrence, matching, synchronization, reconciliation of missed local outbox entries, recovery, conflicts, IndexedDB attachment persistence, and attachment retry/lifecycle helpers.

## Deliberately deferred

- Realtime subscriptions
- Image transformations beyond the client-side 1200 px JPEG preparation
- Cellarer/AI integration
- Social login, MFA, and account deletion
- Notification delivery and automatic backups
- Child kiosk access and child task completion

These belong to later roadmap phases and should not be added to this foundation migration.
