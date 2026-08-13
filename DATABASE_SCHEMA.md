# Regula Rustica Database Schema

**Version:** 1.0  
**Status:** Adopted implementation specification

## Purpose

The database exists to preserve the stewardship history of a Homestead in a durable, understandable, secure, and extensible form.

It shall support local-first synchronization, many users within one Homestead, role-based access, offline changes and later reconciliation, open export and recovery, and The Cellarer through controlled application services.

The schema describes the Homestead itself rather than the current arrangement of screens.

---

# I. Global Conventions

## Naming

Database objects use lowercase `snake_case`. Table names are plural.

Initial tables:

- `homesteads`
- `profiles`
- `homestead_members`
- `invitations`
- `records`
- `record_relationships`
- `tasks`
- `task_assignments`
- `chronicle_entries`
- `notes`
- `ledger_entries`
- `photos`
- `audit_entries`
- `sync_operations`

## Primary Keys

Every application table uses a UUID primary key generated with `gen_random_uuid()` unless a valid UUID is created locally before synchronization.

Once assigned, an ID never changes.

## Homestead Ownership

Every Homestead-owned table includes:

```sql
homestead_id uuid not null references homesteads(id)
```

This is the primary boundary for row-level security, synchronization, export, backup, reporting, and AI authorization.

One user may belong to no more than one active Homestead. One Homestead may have many users.

## Timestamps

User-editable tables generally include:

```sql
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

`updated_at` is maintained automatically by a trigger.

Real-world due days use `date`. Events with meaningful time use `timestamptz`.

## User Attribution

User-created or edited rows generally include:

```sql
created_by uuid references auth.users(id)
updated_by uuid references auth.users(id)
```

Where relevant:

```sql
completed_by uuid references auth.users(id)
completed_at timestamptz
```

Attribution remains even if a member later leaves the Homestead.

## Entry Source

User-editable content includes:

```sql
source text not null default 'manual'
```

Allowed initial values:

- `manual`
- `cellarer`
- `migration`
- `import`
- `system`

A Cellarer-created entry must still identify the human user who authorized it.

## Schema and Row Versions

Synchronized content tables include:

```sql
schema_version integer not null default 1
version integer not null default 1
client_updated_at timestamptz
```

`schema_version` identifies the application payload format. `version` increments whenever the server accepts an update. Server timestamps remain authoritative for auditing.

## Soft Deletion

Normal deletion uses:

```sql
deleted_at timestamptz
deleted_by uuid references auth.users(id)
```

A row is active when `deleted_at is null`.

Ordinary application actions do not physically delete stewardship data. Permanent deletion is reserved for explicit Homestead deletion, privacy or legal requirements, authorized maintenance, expired invitations, and temporary operational data past retention.

## Flexible Record Data

Common searchable fields use dedicated columns. Type-specific content uses JSONB.

For `records`:

```sql
type text not null
name text not null
status text not null
identity jsonb not null default '{}'
stewardship jsonb not null default '{}'
```

## Foreign-Key Behavior

- Homestead-owned content may use `ON DELETE CASCADE` only when the Homestead itself is permanently deleted.
- Optional record links generally use `ON DELETE SET NULL`.
- Historical attribution must survive membership removal.
- Chronicle history must not disappear merely because a related task is removed or archived.

## Money

Money uses:

```sql
amount numeric(12,2)
currency_code char(3) not null default 'USD'
```

Floating-point types must not be used for financial values.

## Measurements

Measurements preserve both value and unit:

```sql
value numeric
unit text
```

The initial schema does not attempt to provide a full unit-conversion engine.

## Validation

The database enforces durable rules through `NOT NULL`, foreign keys, unique constraints, check constraints, row-level security, and protected functions.

Frequently changing domain choices such as animal species remain application-managed rather than PostgreSQL enums.

## Row-Level Security

RLS is enabled on every application table exposed through Supabase.

Default posture:

> No authenticated user may access a row unless a policy explicitly permits it.

Service-role credentials must never be included in the browser application.

---

# II. Identity and Membership

## `homesteads`

Represents the top-level owner of all Regula Rustica data.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | `uuid` | Yes | Primary key |
| `name` | `text` | Yes | User-facing Homestead name |
| `slug` | `text` | No | Unique future URL/internal identifier |
| `timezone` | `text` | Yes | Default `America/New_York` |
| `currency_code` | `char(3)` | Yes | Default `USD` |
| `created_at` | `timestamptz` | Yes | Standard |
| `updated_at` | `timestamptz` | Yes | Standard |
| `created_by` | `uuid` | No | Creator |
| `deleted_at` | `timestamptz` | No | Soft deletion |
| `deleted_by` | `uuid` | No | Deleting user |

## `profiles`

Stores application-level information associated with `auth.users`.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | `uuid` | Yes | Must match `auth.users.id` |
| `display_name` | `text` | Yes | User-facing name |
| `avatar_url` | `text` | No | Optional |
| `created_at` | `timestamptz` | Yes | Standard |
| `updated_at` | `timestamptz` | Yes | Standard |

Email remains managed by Supabase Auth and is not treated as authoritative profile data.

## `homestead_members`

Connects a user to a Homestead and defines role and status.

| Column | Type | Required |
|---|---|---:|
| `id` | `uuid` | Yes |
| `homestead_id` | `uuid` | Yes |
| `user_id` | `uuid` | Yes |
| `role` | `text` | Yes |
| `status` | `text` | Yes |
| `joined_at` | `timestamptz` | No |
| `invited_by` | `uuid` | No |
| `created_at` | `timestamptz` | Yes |
| `updated_at` | `timestamptz` | Yes |
| `removed_at` | `timestamptz` | No |
| `removed_by` | `uuid` | No |

Allowed roles:

- `steward`
- `keeper`
- `hand`
- `guest`

Allowed statuses:

- `active`
- `suspended`
- `removed`

A partial unique index enforces one active Homestead membership per user.

At least one active Steward must always remain.

## `invitations`

Represents a pending invitation.

| Column | Type | Required |
|---|---|---:|
| `id` | `uuid` | Yes |
| `homestead_id` | `uuid` | Yes |
| `email_normalized` | `text` | Yes |
| `role` | `text` | Yes |
| `token_hash` | `text` | Yes |
| `expires_at` | `timestamptz` | Yes |
| `accepted_at` | `timestamptz` | No |
| `accepted_by` | `uuid` | No |
| `revoked_at` | `timestamptz` | No |
| `revoked_by` | `uuid` | No |
| `invited_by` | `uuid` | Yes |
| `created_at` | `timestamptz` | Yes |

Rules:

- Invitation tokens are single-use.
- Only a token hash is stored.
- Default expiration is seven days.
- Acceptance creates the active membership.
- Acceptance occurs through a protected server-side function.
- No public Homestead directory exists.

---

# III. Records

## `records`

Stores every core record type:

- Animal
- Land
- Equipment
- Structure
- Work

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | `uuid` | Yes | Primary key |
| `homestead_id` | `uuid` | Yes | Owner |
| `type` | `text` | Yes | `animal`, `land`, `equipment`, `structure`, `work` |
| `name` | `text` | Yes | User-facing name |
| `status` | `text` | Yes | Lifecycle state |
| `identity` | `jsonb` | Yes | Default `{}` |
| `stewardship` | `jsonb` | Yes | Default `{}` |
| `primary_photo_id` | `uuid` | No | Optional photo reference |
| Standard audit, version, sync, and soft-delete fields |  | Yes |  |

Type check:

```sql
check (type in ('animal','land','equipment','structure','work'))
```

Status remains text because valid states differ by type.

Examples:

Animal identity:

```json
{
  "managed_as": "individual",
  "species": "cattle",
  "breed": "jersey",
  "sex": "female",
  "purpose": "dairy",
  "birth_date": "2022-04-11",
  "tag_number": "D-104"
}
```

Animal group identity:

```json
{
  "managed_as": "group",
  "species": "chicken",
  "breed": "cornish_cross",
  "purpose": "meat",
  "quantity": 48,
  "acquisition_date": "2026-05-12",
  "planned_end_date": "2026-07-08"
}
```

Equipment identity:

```json
{
  "equipment_type": "tractor",
  "make": "Ford",
  "model": "8N",
  "serial_number": "8N123456"
}
```

Stewardship example:

```json
{
  "location": "East Pasture",
  "assigned_member_id": "uuid",
  "current_stage": "Active"
}
```

Initial indexes:

```sql
create index records_homestead_active_idx
  on records (homestead_id, type, status)
  where deleted_at is null;

create index records_homestead_name_idx
  on records (homestead_id, lower(name))
  where deleted_at is null;

create index records_updated_idx
  on records (homestead_id, updated_at desc)
  where deleted_at is null;
```

---

# IV. Record Relationships

## `record_relationships`

Stores durable links between records.

| Column | Type | Required |
|---|---|---:|
| `id` | `uuid` | Yes |
| `homestead_id` | `uuid` | Yes |
| `source_record_id` | `uuid` | Yes |
| `target_record_id` | `uuid` | Yes |
| `relationship_type` | `text` | Yes |
| `started_at` | `timestamptz` | No |
| `ended_at` | `timestamptz` | No |
| `details` | `jsonb` | Yes |
| Standard audit, version, sync, and soft-delete fields |  | Yes |

Initial relationship types:

- `located_on`
- `assigned_to`
- `improves`
- `created`
- `replaces`
- `related_to`
- `parent_of`
- `split_from`

Rules:

- A record cannot relate to itself.
- Both records must belong to the same Homestead.
- Duplicate active relationships of the same type should be prevented where practical.

---

# V. Tasks and Assignments

## `tasks`

Stores future and completed work.

| Column | Type | Required | Notes |
|---|---|---:|---|
| `id` | `uuid` | Yes | Primary key |
| `homestead_id` | `uuid` | Yes | Owner |
| `record_id` | `uuid` | No | Optional linked record |
| `title` | `text` | Yes | Actionable description |
| `description` | `text` | No | Supporting detail |
| `status` | `text` | Yes | `open`, `in_progress`, `completed`, `cancelled` |
| `priority` | `text` | Yes | Default `normal` |
| `available_from` | `date` | No | Earliest appropriate date |
| `due_date` | `date` | No | Final due date |
| `completed_at` | `timestamptz` | No | Completion time |
| `completed_by` | `uuid` | No | Actual completing user |
| `recurrence_rule` | `jsonb` | No | Recurrence definition |
| `parent_task_id` | `uuid` | No | Previous occurrence/source task |
| Standard audit, version, sync, and soft-delete fields |  | Yes |  |

Initial priority values:

- `low`
- `normal`
- `high`
- `urgent`

When both dates exist:

```sql
check (available_from is null or due_date is null or available_from <= due_date)
```

Recurrence example:

```json
{
  "mode": "after_completion",
  "frequency": "weekly",
  "interval": 1,
  "days_of_week": [],
  "end_date": null
}
```

Generic recurring Tasks remain supported. Record-specific daily stewardship is
modeled separately with `routines` and `routine_occurrences`; Task titles are
never interpreted to infer Routine behavior. Older Tasks whose structured
`recurrence_rule.routineType` is `milk_morning`, `milk_evening`, or
`egg_collection` migrate conservatively and remain as hidden historical anchors.

Supported initial modes:

- `fixed_schedule`
- `after_completion`

Only the next occurrence is generated.

## `chore_windows`, `routines`, and `routine_occurrences`

Chore Windows are ordered Homestead-defined parts of the working day, not
appointments. Every new Homestead receives Morning and Evening defaults.

A Routine is a durable definition linked to one Record, with an optional Chore
Window and assignee, a simple daily/weekly/monthly interval, enabled state, and
next date. A Routine occurrence is the dated unit of work. It is pending,
completed, or skipped and records its completion method. Completing an
occurrence creates at most one next occurrence. Milk and Egg Yield may link to
one occurrence and complete it atomically.

## `task_assignments`

Supports one or more assigned members while allowing the first UI to default to one assignee.

| Column | Type | Required |
|---|---|---:|
| `id` | `uuid` | Yes |
| `homestead_id` | `uuid` | Yes |
| `task_id` | `uuid` | Yes |
| `member_id` | `uuid` | Yes |
| `assignment_type` | `text` | Yes |
| `assigned_at` | `timestamptz` | Yes |
| `assigned_by` | `uuid` | No |
| `removed_at` | `timestamptz` | No |

Initial assignment type:

- `assignee`

Future assignment type:

- `watcher`

Indexes:

```sql
create index tasks_due_idx
  on tasks (homestead_id, due_date, status)
  where deleted_at is null;

create index tasks_record_idx
  on tasks (record_id, status)
  where deleted_at is null;

create index task_assignments_member_idx
  on task_assignments (member_id, assigned_at)
  where removed_at is null;
```

---

# VI. Chronicle

## `chronicle_entries`

Stores dated events and significant history.

| Column | Type | Required |
|---|---|---:|
| `id` | `uuid` | Yes |
| `homestead_id` | `uuid` | Yes |
| `record_id` | `uuid` | No |
| `task_id` | `uuid` | No |
| `event_type` | `text` | Yes |
| `occurred_at` | `timestamptz` | Yes |
| `summary` | `text` | No |
| `details` | `jsonb` | Yes |
| `value` | `numeric` | No |
| `unit` | `text` | No |
| `corrects_entry_id` | `uuid` | No |
| Standard audit, version, sync, and soft-delete fields |  | Yes |

Chronicle entries append rather than overwrite whenever practical. Corrections should link to the corrected entry.

Indexes:

```sql
create index chronicle_record_date_idx
  on chronicle_entries (record_id, occurred_at desc)
  where deleted_at is null;

create index chronicle_homestead_date_idx
  on chronicle_entries (homestead_id, occurred_at desc)
  where deleted_at is null;

create index chronicle_type_idx
  on chronicle_entries (homestead_id, event_type, occurred_at desc)
  where deleted_at is null;
```

---

# VII. Notes

## `notes`

Stores enduring knowledge rather than primarily dated events.

| Column | Type | Required |
|---|---|---:|
| `id` | `uuid` | Yes |
| `homestead_id` | `uuid` | Yes |
| `record_id` | `uuid` | No |
| `title` | `text` | No |
| `body` | `text` | Yes |
| `pinned` | `boolean` | Yes |
| Standard audit, version, sync, and soft-delete fields |  | Yes |

Notes may be edited because they represent current knowledge. Significant changes remain auditable.

---

# VIII. Ledger

## `ledger_entries`

Stores simple financial stewardship records.

| Column | Type | Required |
|---|---|---:|
| `id` | `uuid` | Yes |
| `homestead_id` | `uuid` | Yes |
| `record_id` | `uuid` | No |
| `entry_type` | `text` | Yes |
| `entry_date` | `date` | Yes |
| `description` | `text` | Yes |
| `amount` | `numeric(12,2)` | Yes |
| `currency_code` | `char(3)` | Yes |
| `category` | `text` | No |
| `vendor_or_source` | `text` | No |
| `receipt_photo_id` | `uuid` | No |
| Standard audit, version, sync, and soft-delete fields |  | Yes |

Constraints:

```sql
check (amount >= 0)
check (entry_type in ('expense','income'))
```

Initial category examples:

- `feed`
- `veterinary`
- `seed`
- `fertilizer`
- `equipment`
- `fuel`
- `repairs`
- `construction`
- `dairy`
- `preservation`
- `sales`
- `other`

Financial records receive stricter permissions than ordinary events.

---

# IX. Photos

## `photos`

Stores metadata for private files in Supabase Storage. Binary files do not live in PostgreSQL.

| Column | Type | Required |
|---|---|---:|
| `id` | `uuid` | Yes |
| `homestead_id` | `uuid` | Yes |
| `record_id` | `uuid` | No |
| `chronicle_entry_id` | `uuid` | No |
| `storage_bucket` | `text` | Yes |
| `storage_path` | `text` | Yes |
| `file_name` | `text` | Yes |
| `mime_type` | `text` | Yes |
| `file_size_bytes` | `bigint` | Yes |
| `caption` | `text` | No |
| `taken_at` | `timestamptz` | No |
| `is_primary` | `boolean` | Yes |
| `upload_status` | `text` | Yes |
| Standard audit, version, sync, and soft-delete fields |  | Yes |

Upload statuses:

- `pending`
- `uploaded`
- `failed`

Recommended storage path:

```text
homesteads/{homestead_id}/records/{record_id}/{photo_id}/{filename}
```

Buckets remain private and signed URLs are short-lived.

---

# X. Capabilities

Initial capabilities:

- `view_records`
- `create_records`
- `edit_records`
- `archive_records`
- `restore_records`
- `create_tasks`
- `assign_tasks`
- `complete_tasks`
- `record_events`
- `edit_recent_events`
- `add_notes`
- `edit_notes`
- `view_ledger`
- `manage_ledger`
- `upload_photos`
- `manage_members`
- `manage_homestead`
- `export_data`
- `manage_backups`
- `use_cellarer`

Role intent:

### Steward

All capabilities.

### Keeper

All ordinary stewardship capabilities except member administration, Homestead administration, ownership transfer, and final destructive actions.

### Hand

May view records, view ordinary tasks, complete assigned tasks, record permitted events, add observations, and upload permitted photos. No broad editing, financial management, membership management, or destructive actions.

### Guest

Read-only. Ledger visibility defaults off.

Capabilities may initially live in application code or a small database lookup table.

---

# XI. Audit Trail

## `audit_entries`

Stores significant changes for accountability and recovery.

| Column | Type | Required |
|---|---|---:|
| `id` | `uuid` | Yes |
| `homestead_id` | `uuid` | Yes |
| `actor_user_id` | `uuid` | No |
| `source` | `text` | Yes |
| `table_name` | `text` | Yes |
| `row_id` | `uuid` | Yes |
| `action` | `text` | Yes |
| `changed_fields` | `jsonb` | Yes |
| `before_data` | `jsonb` | No |
| `after_data` | `jsonb` | No |
| `created_at` | `timestamptz` | Yes |

Initial actions:

- `insert`
- `update`
- `soft_delete`
- `restore`
- `role_change`
- `invitation_accept`
- `export`
- `cellarer_action`

Audit entries are append-only.

---

# XII. Synchronization Operations

## `sync_operations`

Tracks server-side idempotency and write processing.

| Column | Type | Required |
|---|---|---:|
| `id` | `uuid` | Yes |
| `homestead_id` | `uuid` | Yes |
| `user_id` | `uuid` | Yes |
| `device_id` | `uuid` | Yes |
| `idempotency_key` | `text` | Yes |
| `operation_type` | `text` | Yes |
| `table_name` | `text` | Yes |
| `row_id` | `uuid` | Yes |
| `request_hash` | `text` | No |
| `status` | `text` | Yes |
| `error_code` | `text` | No |
| `created_at` | `timestamptz` | Yes |
| `processed_at` | `timestamptz` | No |

This table may be pruned after a defined retention period such as 30 to 90 days.

Device-specific sync status remains local and is not stored on normal cloud rows.

---

# XIII. Conflict Resolution

Initial policy:

1. New UUID rows merge independently.
2. Different objects do not conflict.
3. Chronicle entries append rather than overwrite.
4. Task completion remains an explicit state transition.
5. Record field conflicts use version checks.
6. The server rejects stale writes when silent overwrite would be unsafe.
7. The client may retry nonconflicting field changes.
8. Last-write-wins is reserved for low-risk fields.

Financial values, membership roles, and destructive changes must not use blind last-write-wins.

---

# XIV. Row-Level Security

Every exposed application table enables RLS.

Recommended helper functions:

```sql
current_homestead_id()
has_capability(capability_name text)
```

These functions must not accept arbitrary client-supplied Homestead IDs.

Default read rule:

```text
row.homestead_id = current_homestead_id()
```

plus any role-specific restrictions.

Default write rule requires:

- Active membership in the row's Homestead
- Required capability
- New rows using the authenticated user's Homestead ID
- Server-maintained fields protected from spoofing

Special protections:

- Only Stewards manage members and Homestead settings.
- The final Steward cannot be removed or demoted.
- Invitation acceptance uses a protected function.
- Guests cannot write.
- Hands cannot manage ledger entries by default.
- Audit entries are not client-editable.
- Service-role keys never reach the browser.
- Storage policies mirror database membership rules.

---

# XV. Required Functions and Triggers

The implementation must provide:

- An `updated_at` trigger
- A row `version` increment trigger
- Audit triggers for significant changes
- A Homestead creation function that atomically creates the Homestead and first Steward membership
- An invitation acceptance function that validates token, email, expiration, and one-Homestead membership
- Final-Steward protection
- A recurring-task function that creates only the next occurrence
- Consistent soft-delete and restore functions

---

# XVI. Indexing Strategy

Every Homestead-owned table should normally index:

- `homestead_id`
- `homestead_id, updated_at`
- Relevant date, type, status, record, or assignee combinations

Avoid indexing every JSONB field. Add JSONB indexes only when actual queries justify them.

Likely future filters include animal species, animal purpose, equipment type, Work status, event type, assignee, and task date windows.

---

# XVII. Realtime

Supabase Realtime should initially publish changes for:

- `records`
- `tasks`
- `task_assignments`
- `chronicle_entries`
- `notes`
- `ledger_entries`
- `photos`
- `homestead_members`

Realtime events are notifications of change, not the permanent data source. Clients reconcile authoritative rows after receiving relevant events.

---

# XVIII. Export and Backup

A complete Homestead export should include:

- Homestead settings
- Profiles required for attribution
- Membership roles and statuses
- Records and relationships
- Tasks and assignments
- Chronicle entries
- Notes
- Ledger entries
- Photo metadata and, where practical, photo files
- Schema version
- Export timestamp

Exports must not include passwords, authentication tokens, service keys, invitation token hashes, or secrets.

The format must remain readable without proprietary software.

---

# XIX. Migration Strategy

All schema changes use version-controlled SQL migrations committed to GitHub.

Rules:

1. Do not modify production schema manually without recording the migration.
2. Prefer forward-safe and reversible migrations.
3. Destructive migrations require tested backups.
4. Data migrations should be idempotent where practical.
5. Track local schema and cloud schema versions separately.
6. Apply migrations to preview/test environments before production.
7. Require RLS tests for every permission change.

The initial local-storage migration must:

1. Require authenticated Steward confirmation.
2. Create a backup before upload.
3. Preserve existing UUIDs where valid.
4. Upload in dependency order.
5. Mark source as `migration`.
6. Verify row counts and relationships.
7. Leave the local copy intact until sync is confirmed.

---

# XX. Initial Release Scope

Required for the first cloud-sync release:

- `homesteads`
- `profiles`
- `homestead_members`
- `invitations`
- `records`
- `record_relationships`
- `tasks`
- `task_assignments`
- `chronicle_entries`
- `notes`
- `ledger_entries`
- `audit_entries`
- `sync_operations`

May be deferred:

- `photos`
- `role_capabilities`
- automatic backup tables
- `cellarer_action_logs`
- notification preferences

Photos may remain a placeholder until private storage and offline upload behavior are tested.

---

# XXI. Future Tables

Potential later additions:

- `recurrence_exceptions`
- `task_watchers`
- `notifications`
- `device_registrations`
- `backup_snapshots`
- `custom_record_types`
- `custom_fields`
- `inventory_items`
- `sales`
- `production_batches`
- `pasture_rotations`
- `cellarer_action_logs`

Future tables must extend the established model rather than bypass it.

---

# XXII. Acceptance Criteria

The database implementation is acceptable when:

1. Every user belongs to no more than one active Homestead.
2. A Homestead supports many active members.
3. Steward, Keeper, Hand, and Guest permissions are enforced.
4. No member can read another Homestead's data.
5. Every core object carries a Homestead boundary.
6. Tasks can link to Records and be assigned to members.
7. Tasks support optional date windows.
8. Recurring tasks generate one next occurrence.
9. Chronicle entries preserve sequence and corrections.
10. Records support all five approved types.
11. Offline-created UUID rows sync without duplication.
12. Retried writes are idempotent.
13. Soft deletion synchronizes correctly.
14. Exports contain the complete Homestead dataset.
15. The Cellarer cannot bypass normal authorization.
16. The app remains locally usable during cloud outages.
17. A new authenticated device can rebuild its local working copy.
18. RLS tests prove isolation between at least two test Homesteads.

---

# Governing Principle

> **The database exists to preserve the stewardship history of a Homestead in a durable, understandable, secure, and extensible form.**

---

# Housekeeping v1 Extension — August 2026

The Housekeeping sprint adds two synchronized Homestead-owned tables using the same standard metadata, stable UUIDs, optimistic versions, audit triggers, soft deletion, explicit grants, and Row-Level Security as the original content tables.

- `calendar_events` stores distinct shared calendar events with an optional Record link, title, start/end dates, optional start/end times, all-day state, location, and notes. Calendar events are not Chronicle entries.
- `yield_entries` is the canonical source for Milk and Egg production. It stores a required Animal Record link, optional unique `task_id`, type, occurrence time, session, quantity, unit, unusable quantity, and JSON details. Yield is rendered into the related Record Chronicle without creating a duplicate `chronicle_entries` row. A linked Milk Yield must match the Task's Homestead, Animal, work date, and configured morning/evening session.

Calendar writes require the ordinary task-management capability. Yield creation requires the event-recording capability; correction and deletion require the event-editing capability. Guests remain read-only, tenant-safe Record relationships are validated server-side, and both tables participate in the existing idempotent local-first synchronization design.

## Assignable Homestead People

`homestead_people` provides one tenant-scoped task-assignee directory for account-backed members and children. Member entries are maintained from active `homestead_members`; child entries deliberately have no `auth.users` row, membership, role, invitation, or authorization capability. `task_assignments.person_id` is the canonical assignee link, while the nullable legacy `member_id` remains populated for account-backed people so existing Hand task visibility and completion checks remain unchanged.

Stewards and Keepers may manage child profiles under the existing `assign_tasks` capability. Hands and Guests may read the directory for task display but cannot create or edit children. Removing a child is a synchronized soft deletion and never grants or revokes authenticated access. The first UI supports one active assignee; the table continues to support multiple assignees. Child kiosk access is explicitly deferred.
