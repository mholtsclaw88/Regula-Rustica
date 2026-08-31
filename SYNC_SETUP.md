# Local-First Synchronization v1

Synchronization is optional. Without cloud configuration or a signed-in account, Regula Rustica continues to use the `regulaRusticaV5` browser dataset and the installed PWA shell.

## Configure locally

Follow `SUPABASE_SETUP.md` to start Supabase, reset migrations, and generate `cloud-runtime-config.js`. Serve the repository over HTTP; service workers and ES modules do not work correctly when `index.html` is opened directly as a file.

The browser configuration contains only the Supabase URL and publishable key. Never add a secret or service-role key.

## First synchronization

After sign-in, the app inspects both sides before enabling sync:

- Local populated, cloud empty: a Steward may choose **Move this Homestead to the cloud**. The app creates and verifies a local safety backup, uploads in dependency order, then verifies cloud IDs, counts, and relationship references.
- Local empty, cloud populated: choose **Download cloud Homestead**.
- Both populated: automatic merge is refused. **Back up this device and use cloud Homestead** exports and retains a safety copy before replacement; Cancel leaves both sides unchanged.
- Both empty: choose **Start cloud synchronization**.

An interrupted or failed migration is not marked complete. Local data, the safety backup, and queued operations remain available for retry. Once a device is bound to a Homestead, new edits are durably queued even while setup or recovery remains incomplete; the header shows **Sync setup** instead of incorrectly reporting **Synced**. Safety copies use `regulaRusticaSyncBackupsV1`; current backups use schema version 6 and include task date windows, Calendar, and Yield. Schema-version 5 backups remain importable.

Legacy v5 IDs are not rewritten. Valid UUIDs remain identical; older non-UUID IDs receive a stable cloud UUID mapping in the separate `regulaRusticaSyncV1` metadata store.

## Normal operation

User actions are saved locally before a durable outbox operation is created. Sync runs after local changes, at startup, when connectivity returns, when the app returns to the foreground, approximately once a minute while the app is visible, and from **Sync now**. These triggers are debounced and share one active sync run. Signing out stops authenticated sync but keeps local data and pending metadata.

Each initialized sync run also reconciles the current local collections against their last accepted cloud rows. This repairs the narrow failure case where a local save completed but an older client never created its outbox item; missing current Tasks, Calendar events, Journal entries, Yield, and Ledger data are queued through the same audited RPC paths. Reconciliation never bypasses version checks. A newer cloud deletion wins over an unqueued stale local copy, while divergent active edits still use normal optimistic-version conflict review.

Every active local domain has an explicit server RPC route. Retryable transport or service failures remain queued, while permanent server rejections are marked as blocked with the domain, operation, local item ID, attempt count, error code, and timestamp retained on the device. A blocked change never causes unrelated healthy changes to be skipped, and the app does not report **Synced** while blocked work remains. **Sync now** retries blocked changes after a correction is deployed. Legacy failed operations are upgraded to retryable operations without clearing the outbox.

Task synchronization treats Record, parent-Task, and Chore Window links as optional references. A reference to a deleted or unavailable Chore Window is removed from the incoming Task instead of blocking the whole device. If an old device updates a Task that was already deleted in cloud, the cloud deletion is returned as the accepted result so the device retires its stale copy. Morning and Evening system Chore Windows are restored or created by migration if historical recovery removed them.

### Legacy backlog recovery

The pre-unification client synchronized the now-retired local domains `routines` and `routine_occurrences`. Their server tables and `apply_routine_sync_operation` contract remain available, but they are intentionally absent from the current `DOMAIN_ORDER`. Existing failed operations are marked locally as recovery work and may use that RPC; a newly created or unknown domain cannot enter this compatibility path. Current operations continue to use the active explicit routing table.

The recurring-Task resync stabilization migration soft-deletes any remaining legacy Routine definitions, occurrences, and open Task descendants while preserving completed Task history. After that migration, every active device must run the current client and reset its working copy from cloud so a retained pre-unification outbox cannot reintroduce retired work.

Recovery preserves each operation ID, idempotency key, target ID, payload, attempt history, and diagnostic fields. Historical Routine creates run after their Record, Chore Window, and Person dependencies; occurrences run after Routines and Tasks; historical Yield waits for a referenced occurrence. Exact replay of an operation that the server already represents is resolved through the returned cloud row without creating a duplicate. Divergent conflicts use the existing conflict review path. Unknown domains, malformed operations, permission failures, missing targets, foreign-Homestead identifiers, and ambiguous versionless updates remain preserved and visible rather than being deleted or guessed.

Attachment bytes use a separate retry path from metadata. An unavailable photo or document remains usable from IndexedDB and reports its own failure; it does not prevent unrelated Records, Tasks, Yield, Calendar, Journal, or Ledger metadata from synchronizing.

Pull cursors are maintained per table as `(updated_at, id)` and advance only after a complete page is saved. Deletion and restoration are explicit soft-state changes.

## Data boundary

The following top-level collections synchronize as Homestead data: Records, Record Documents, attachment metadata, Homestead People, Chore Windows, Tasks, Record relationships, Task assignments, Chronicle/Journal entries, Calendar events, Yield entries, Notes, Ledger entries, and Ledger allocations. Attachment file bytes synchronize separately through the private `record-documents` Storage bucket when cloud sync is connected.

The Homestead display name in local `settings` is currently device-local; making that preference authoritative across devices is a follow-up. Attachment bytes remain local in IndexedDB until each upload succeeds. Migration residue under `legacy`, transient UI state (open page, filters, collapsed sections), local safety backups, device identity, outbox diagnostics, and pull cursors are intentionally local-only and are not application records.

For a stale version, the cloud row and local edit are both retained. **Keep cloud version** accepts the cloud row; **Use my version** queues a new audited update based on its current version. Field-level merging is deferred.

## Offline and recovery testing

1. Load the app online once and confirm the service worker controls it.
2. In browser developer tools, switch Network to Offline and reload.
3. View and edit local data; confirm the status says changes are saved locally.
4. Return online and choose **Sync now** if reconnect sync has not finished.
5. For an interrupted initial migration, reload, sign in to the same Homestead, and retry. Do not clear browser storage because it contains recovery metadata.

Run validation with:

```text
npm run check
npm run test:sync
pnpm dlx supabase@latest db reset
pnpm dlx supabase@latest test db
pnpm dlx supabase@latest db lint --local
```

Photo synchronization, Realtime, automatic two-dataset merging, field-level merging, and multi-Homestead datasets are outside Sync v1.
