# Regula Rustica Sync Architecture

## Purpose

This document defines the synchronization architecture for Regula Rustica.

The application remains **local-first**. A signed-in user works against the local device copy of the Homestead data, and synchronization reconciles that local copy with the shared Supabase copy.

The design goal is not merely convenience. It is to protect Homestead records against data loss, weak rural connectivity, accidental cross-Homestead contamination, duplicate uploads, and silent conflict resolution.

This document governs Sprint 7 and future synchronization work unless superseded by a later approved architecture document.

---

## 1. Core Principles

### 1.1 Local-first operation

User actions save locally first.

The application must remain usable when the network is unavailable, unreliable, or slow.

A temporary loss of connectivity must not block routine recordkeeping.

### 1.2 Cloud as the shared canonical copy

Supabase is the shared canonical copy for a Homestead once cloud synchronization has been enabled.

The local device remains a working replica, not a disposable cache.

### 1.3 Never silently destroy or replace existing data

First synchronization, sign-in, account switching, conflict handling, and migration must prefer preserving data over automation.

If the system cannot safely determine how two datasets should be reconciled, it must stop and ask the user rather than silently merging or overwriting records.

### 1.4 Database security remains authoritative

Synchronization must use the signed-in user session and the browser-safe publishable Supabase key.

The synchronization layer must never bypass Row Level Security.

Service-role or other privileged keys must never be exposed to browser code.

### 1.5 Simplicity over premature sophistication

Sync v1 must solve reliable first migration, push, pull, offline queuing, soft deletion, version conflicts, and recovery.

It must not attempt field-level merging, realtime subscriptions, selective replication, or advanced multi-dataset reconciliation.

---

## 2. Existing Foundation

The synchronization design builds on the Cloud Foundation already present in Regula Rustica.

Relevant existing elements include:

- Supabase Auth
- Homesteads
- one active Homestead membership per user
- Steward / Keeper / Hand / Guest roles
- Row Level Security
- UUID primary keys
- `version`
- `client_updated_at`
- `source`
- soft-delete metadata
- `sync_operations`
- audit history
- task assignments
- record relationships

The synchronization sprint should reuse these structures rather than redesigning the database unless implementation proves a specific change is necessary.

---

## 3. Synchronization Model

The basic model is:

```text
User action
    ↓
Local save
    ↓
Local outbox entry
    ↓
Push when network is available
    ↓
Supabase validates via RLS and database rules
    ↓
Pull newer cloud changes
    ↓
Apply to local replica
```

The user edits the local copy. Synchronization reconciles that copy with the cloud copy.

Synchronization must be retryable and idempotent.

---

## 4. Device Identity

Each installation receives a persistent UUID called `device_id`.

The device ID is generated once and stored locally.

It must survive ordinary application updates and restarts.

It may be regenerated only if the local application data is intentionally reset or removed.

Each synchronization operation should be attributable to:

- user
- Homestead
- device
- operation

The device ID is primarily an internal synchronization and diagnostic identifier. A user-facing device-management interface is deferred.

---

## 5. Local Sync Metadata

The local application should maintain synchronization metadata separate from user-facing record content.

At minimum:

- `device_id`
- `sync_enabled`
- `sync_homestead_id`
- `initial_sync_completed`
- `last_successful_sync_at`
- local outbox operations
- unresolved conflicts
- migration/first-sync state

Synchronization metadata must not be confused with the Homestead records themselves.

---

## 6. First Synchronization

First synchronization is a protected migration workflow, not an ordinary background sync.

The application must inspect both the local dataset and the cloud Homestead before enabling continuous synchronization.

### 6.1 Case A — Local data exists and cloud is empty

This is the normal migration path for an existing local-only Homestead.

The user should be offered an explicit action such as:

> Move this Homestead to the cloud
>
> Your existing records will be uploaded to your Homestead account. A local backup will be created first.

Required sequence:

1. Verify the signed-in user has an active Homestead.
2. Confirm the cloud Homestead contains no synchronized Homestead data.
3. Create an automatic pre-migration backup of local data.
4. Validate local records sufficiently to identify malformed or unsupported data before upload.
5. Upload in dependency-safe order.
6. Verify successful upload.
7. Compare expected and cloud counts for migrated domains.
8. Mark initial synchronization complete only after verification succeeds.
9. Retain the local dataset.
10. Enable normal push/pull synchronization.

A partial or failed upload must never delete local data.

### 6.2 Case B — Local data is empty and cloud contains data

The user should be offered a clear action such as:

> Download Homestead

The cloud dataset is downloaded into the local replica.

Continuous synchronization may begin only after the initial download completes successfully.

### 6.3 Case C — Local data exists and cloud also contains data

Sync v1 must **not automatically merge two independently populated datasets**.

The application must stop and present a protected choice.

Permitted v1 options:

- Use the cloud Homestead on this device
- Keep/export the local data without merging it
- Cancel

Before replacing local data with the cloud dataset, the application must create a local backup.

Advanced merge/import tooling is deferred.

---

## 7. Initial Migration Backup

A backup is mandatory before first upload or before replacing a populated local dataset with a cloud dataset.

The backup must use the existing Regula Rustica backup format wherever practical.

The initial cloud migration backup should not be silently deleted during the migration process.

The migration workflow must fail safely:

```text
Local data
    ↓
Backup created successfully
    ↓
Cloud migration begins
    ↓
Verification succeeds
    ↓
Continuous sync enabled
```

If any required step fails, the application remains in a recoverable local state.

---

## 8. Initial Upload Order

Parent objects must be uploaded before dependent objects.

The implementation should use a deterministic dependency-safe order approximately as follows:

1. Homestead/membership context is already established by Cloud Foundation
2. Records
3. Tasks
4. Record relationships
5. Task assignments
6. Chronicle entries
7. Notes
8. Ledger entries

If implementation discovers additional foreign-key dependencies, the exact order may be adjusted without changing this principle.

Soft-deleted rows that are required for historical integrity should be migrated according to the governing record/database rules rather than discarded solely because they are deleted.

---

## 9. Initial Migration Verification

The application must verify the first upload before marking migration complete.

At minimum, compare local expected counts with cloud counts for migrated domains.

Example:

```text
Local            Cloud
Animals     14   14
Land         7    7
Equipment    5    5
Structures   9    9
Work         3    3
Tasks       18   18
```

Counts alone do not prove perfect equivalence, so implementation should also confirm that every expected migrated UUID exists in the cloud where practical.

`initial_sync_completed` must not be set until required verification succeeds.

If verification fails, the system must report the problem and leave the pre-migration backup available.

---

## 10. Local Outbox

Every local mutation that requires cloud replication creates an outbox operation.

The local record change is committed first. The outbox operation is then eligible for delivery.

A queued operation should contain enough metadata to safely retry and detect conflicts, including at minimum:

- operation ID / idempotency key
- operation type
- table/domain
- row ID
- Homestead ID
- device ID
- base cloud version, where applicable
- client update timestamp
- payload or durable reference to the local payload
- queue status
- retry metadata

The exact local storage representation is an implementation detail.

The outbox must survive page reloads, application restarts, network loss, and ordinary PWA updates.

---

## 11. Push Behavior

Push processing sends pending local operations to Supabase.

### 11.1 General rules

- Process only operations belonging to the currently authenticated Homestead.
- Preserve dependency order where required.
- Use unique idempotency keys.
- Treat retries as normal behavior.
- Do not remove an outbox item until the server has accepted the operation or an equivalent idempotent result is confirmed.
- RLS and database constraints remain authoritative.

### 11.2 Authorization failure

An operation rejected because the current user lacks permission must not be repeatedly retried as though it were a network problem.

It should become a user-actionable sync error.

### 11.3 Network/server failure

Transient connectivity and server failures should leave the operation queued for later retry.

Local data remains available.

---

## 12. Pull Behavior

The device maintains a synchronization cursor, initially based on the last successful synchronization boundary.

The client requests cloud rows changed since that boundary for the user's active Homestead.

Pulled changes may include:

- records
- tasks
- relationships
- assignments
- Chronicle entries
- notes
- ledger entries
- soft deletions/restorations

The implementation must account for deterministic pagination so a large change set cannot be skipped.

The synchronization cursor advances only after the complete pull batch has been successfully applied locally.

If applying a batch fails, the previous successful cursor remains intact so the batch can be retried.

---

## 13. Sync Cursor Safety

A raw client clock must not be treated as perfectly authoritative for synchronization boundaries.

Where practical, the sync cursor should use a server-derived ordering/boundary rather than trusting only the local device time.

If timestamp-based incremental sync is used, the implementation must protect against rows sharing the same timestamp by using a deterministic tie-breaker such as `(updated_at, id)` or another approved server-ordered cursor.

The goal is to avoid missing changes between pages or sync runs.

---

## 14. Version-Based Conflict Detection

Mutable synchronized rows use optimistic concurrency.

The local copy tracks the cloud version on which the local edit was based.

Example:

```text
Local base_version = 7
Cloud current version = 7
```

The update may proceed, and the cloud row becomes version 8.

If instead:

```text
Local base_version = 7
Cloud current version = 8
```

then a conflict exists.

The client must not silently overwrite version 8.

---

## 15. Conflict Policy

Sync v1 uses a conservative whole-record conflict policy.

When a conflict occurs:

1. The current cloud version remains the shared canonical version.
2. The user's conflicting local change is retained.
3. The conflict is recorded locally for review.
4. The user is informed that another device/user changed the same record.

User choices should be limited to clear operations such as:

- Keep cloud version
- Use my version

Choosing **Use my version** must be a deliberate new update based on the current cloud version, not a forced bypass of concurrency controls.

Field-by-field merging is deferred.

---

## 16. Append-Heavy Data

Many Homestead actions naturally create new rows instead of editing existing ones.

Examples include:

- Chronicle events
- production entries
- notes
- ledger entries
- certain task-generated records

Because independently created rows use unique UUIDs, these actions normally coexist without conflicts.

The synchronization design should preserve this append-heavy model and avoid converting ordinary history into a shared mutable document unnecessarily.

---

## 17. Soft Deletion and Restoration

Deletion synchronizes through explicit soft-delete metadata.

A row being absent from a result set is never sufficient evidence that it has been deleted.

Synchronization must propagate:

- `deleted_at`
- `deleted_by`
- restoration back to active state

A device must not resurrect a row merely because its local copy predates a deletion performed elsewhere.

Deletion and restoration must continue to use the approved server functions and authorization rules where required by the database architecture.

---

## 18. Idempotency

Every mutation sent through the synchronization engine must be safe to retry.

Network interruptions may occur after the server commits a change but before the client receives the response.

Therefore, retrying the same logical operation must not create duplicate data or repeated side effects.

The existing `sync_operations` structure should be used for server-side idempotency where appropriate.

The implementation must not rely solely on "request returned successfully" as proof that an operation was or was not committed.

---

## 19. Sign-Out Behavior

Signing out disconnects cloud synchronization for that session.

Signing out does **not** automatically delete the local Homestead dataset.

The user should receive clear language explaining that local Homestead data remains on the device unless they explicitly remove it.

A future separate action may support:

> Sign out and remove local Homestead data from this device

That destructive action is not required for Sync v1.

---

## 20. Signing Into a Different Homestead

A local synchronized dataset is bound to its Homestead ID.

If a user attempts to sign into an account whose active Homestead differs from the Homestead represented by the existing local dataset, the application must not automatically mix the datasets.

The application must stop and require a protected transition such as:

- export/backup existing local data and replace it with the signed-in Homestead
- cancel sign-in / disconnect

Cross-Homestead contamination is a critical failure and must be prevented even if the client code behaves incorrectly; RLS remains the final server-side boundary.

---

## 21. Permission Changes During Offline Work

A user's role may change while a device is offline.

Therefore, local UI permissions are advisory until the server accepts the queued mutation.

When synchronization resumes, Supabase/RLS decides whether an operation is authorized under the user's current role.

If an offline-created operation is no longer permitted, the operation must be retained as a failed/user-actionable sync item rather than silently discarded.

The local content involved should remain recoverable.

---

## 22. User Interface

Synchronization should remain quiet when healthy.

The normal application should expose only a small status indicator, such as:

- Synced
- Syncing…
- 3 changes waiting
- Offline — changes saved locally
- 1 change needs review
- Sync problem

Settings may show additional concise information, for example:

```text
Cloud
Signed in as: user@example.com
Homestead: Wood Thief Homestead
Role: Steward

Synced just now
[Sync now]
```

A complex synchronization dashboard is explicitly deferred.

---

## 23. Manual Sync

The application may provide a **Sync now** action.

Manual sync should use the same engine and safety rules as automatic sync.

It must not implement a separate code path that bypasses outbox, conflict, or idempotency behavior.

---

## 24. Automatic Sync Triggers

Sync v1 may attempt synchronization at simple, low-risk moments such as:

- after a local mutation when online
- application startup after authentication is restored
- browser `online` event
- manual Sync now
- conservative periodic checks while the app is open

True background synchronization while the application is closed is not required for v1.

---

## 25. Failure Recovery

The synchronization engine must fail recoverably.

### 25.1 Failed push

Keep the outbox operation and retry when appropriate.

### 25.2 Failed pull

Do not advance the sync cursor until the pull batch is successfully applied.

### 25.3 Partial first migration

Keep local data and the pre-migration backup. Do not mark migration complete.

### 25.4 Corrupted local sync metadata

Do not guess. Require a protected recovery workflow using the cloud dataset and/or an exported local backup.

### 25.5 Authentication expiration

Pause sync, preserve queued work, refresh/re-authenticate, and resume when a valid user session exists.

---

## 26. Security Boundary

The synchronization layer is not a security authority.

The database must enforce:

- Homestead isolation
- role permissions
- final Steward protection
- allowed mutations
- tenant-safe relationships
- append-only audit behavior
- permitted delete/restore operations

The client may hide or disable actions based on role for usability, but server authorization is final.

---

## 27. Data Sources

The existing `source` field remains meaningful after synchronization.

Synchronization itself does not rewrite a user's manual entry into a different source merely because it traveled through the cloud.

Examples:

- a manual local record stays `manual`
- an imported migration record stays `migration` or `import` as defined by the migration design
- a future Cellarer-created item remains `cellarer`

Sync transport and record provenance are separate concepts.

---

## 28. Realtime

Supabase Realtime is deferred from Sync v1.

The first implementation should use explicit push/pull synchronization because it is easier to reason about, test, recover, and support offline.

Realtime may later be added as an optimization for quickly triggering pull operations, but it must not become the sole mechanism by which devices learn about changes.

A device that has been offline must still be able to catch up reliably without Realtime history.

---

## 29. Photos

Photo synchronization remains deferred until the photo/storage architecture is approved.

Sync v1 must not block record synchronization merely because photo fields or placeholder IDs exist.

Photo references must not be treated as proof that the binary asset is available locally or remotely until the photo subsystem is implemented.

---

## 30. Sync v1 Out of Scope

Do not implement as part of the first synchronization sprint:

- Supabase Realtime subscriptions
- background push notifications
- field-level conflict merging
- automatic merging of two independently populated Homesteads
- multi-Homestead membership
- selective per-record offline storage
- complex sync history UI
- per-record sync toggles
- remote device management UI
- photo upload/synchronization
- The Cellarer / AI
- calendar synchronization
- custom record types
- inventory synchronization beyond any already-governed record data

These may be proposed later without expanding the initial sprint.

---

## 31. Required Testing

Synchronization implementation must include automated and/or deterministic integration tests for at least:

- first upload: populated local / empty cloud
- first download: empty local / populated cloud
- populated local + populated cloud protection
- mandatory migration backup creation
- successful initial migration verification
- failed initial migration recovery
- offline local mutation and later push
- idempotent retry after ambiguous network failure
- pull of changes from another user/device
- soft delete propagation
- restoration propagation
- version conflict detection
- keep-cloud conflict resolution
- use-local conflict resolution as a new versioned write
- sign-out with local data retained
- different-Homestead sign-in protection
- permission/role change while operations are queued offline
- expired authentication with queued work retained
- deterministic pull pagination/cursor behavior
- no cross-Homestead reads or writes

Existing Cloud Foundation security tests must continue to pass.

---

## 32. Acceptance Criteria for Sync v1

Sync v1 is complete only when all of the following are true:

1. Existing local users can safely move their Homestead to Supabase without losing local data.
2. New devices can download an existing cloud Homestead.
3. The application remains usable offline.
4. Local changes queue durably and synchronize later.
5. Cloud changes are pulled without skipping rows.
6. Duplicate requests are idempotent.
7. Conflicting edits are detected rather than silently overwritten.
8. Soft deletes and restorations replicate correctly.
9. Signing out does not unexpectedly delete local data.
10. A device cannot mix two Homesteads.
11. RLS remains authoritative for all synchronized operations.
12. Existing backup/restore behavior remains functional.
13. Continuous sync is not enabled until first-sync verification succeeds.

---

## 33. Future Enhancements

Potential later improvements include:

- Realtime-triggered refresh
- field-level merge assistance
- user-friendly device list
- device revocation
- richer conflict review
- synchronization diagnostics
- photo/storage synchronization
- selective offline caching for very large datasets
- advanced import/merge tools

These are future improvements, not dependencies for a reliable initial synchronization release.

---

## Guiding Rule

When synchronization behavior is ambiguous, choose the behavior that best preserves user data, maintains Homestead isolation, and remains recoverable.

A slower, explicit workflow is preferable to a fast workflow that can silently overwrite, duplicate, or contaminate Homestead records.

### Housekeeping v1 extension — August 2026

The later approved Housekeeping sprint brings `calendar_events` and `yield_entries` into the existing Sync v1 pipeline. Both use local-first writes, the durable outbox, dependency-ordered initial upload, deterministic pull cursors, optimistic version conflicts, idempotent server operations, soft deletion/restoration, and Homestead-bound RLS. This extension supersedes the earlier Calendar deferral only; Realtime, external calendar services, recurrence, attendees, and `.ics` import/export remain deferred.

The same sprint's assignment extension adds `homestead_people` before `tasks` and `task_assignments` in dependency order. Only child entries count as meaningful first-sync content; automatic member-directory rows therefore do not make a newly created cloud Homestead appear populated. Assignments synchronize a canonical `person_id`, with `member_id` retained only as the authorization bridge for account-backed Hands. Child profiles never create authentication or membership state.
