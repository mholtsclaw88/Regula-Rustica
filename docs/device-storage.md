# Device storage and quota recovery

The Farm Book, sync state, and safety backups use IndexedDB database
`regulaRusticaDeviceV1`, object store `values`. Account sessions stay in
localStorage. JSON schemas and downloaded backup files are unchanged.

At startup, `app-bootstrap.mjs` opens and hydrates device storage before loading
the application and its extensions. On the first upgraded launch, the seven
historical Farm Book and backup keys are copied in one transaction and read back
byte for byte. Only verified copies are removed from localStorage. Migration
failure leaves the original keys intact and blocks startup; it cannot create a
new empty Homestead. A competing older tab's different copy also blocks startup
and remains available for export. An explicit choice can open either copy only
after both original replicas, including sync metadata, are archived and verified.

`DeviceStorage` stages synchronous JSON snapshots and coalesces them into
transactions. `flush()` waits until every staged snapshot is committed; an
aborted transaction retains staged values for export and retry. The application
emits `data-saved` after persistence and calculates successive diffs against the
preceding committed application snapshot.

Sync flushes durable outbox identities before cloud writes. Pull awaits each
local page write before moving its cursor. First upload and cloud replacement
await safety-backup commits and verification. The existing cloud boundary,
conflict, soft-delete, and backup-retention rules still apply. No Supabase schema,
authorization, or cloud data changes are required by this migration.

Run `npm test` and `npm run check` for all unit regressions and source checks.
For native browser regressions, install `playwright@1.58.2` without saving it,
run `npx playwright install --with-deps chromium --only-shell`, and run
`npm run test:browser`. The GitHub validation workflow runs all three checks.
Browser tests run in Chromium and WebKit using a temporary localhost server and isolated synthetic devices;
they do not connect to a live Supabase Homestead.

A failed Reset from Cloud remains a recovery, not first-time setup. Reopening or
reconnecting continues the previously chosen download only when the original
backup is readable and the working copy contains only backed-up or downloaded
rows. Pending edits, conflicts, or untracked newer work pause recovery and expose
a backup-and-confirm retry action. That action retains both the original backup
and the newer working copy. Recovery never uses the queued-upload fallback and
cannot send normal sync writes until its clean cloud baseline is accepted.

WebKit's offline case stops the origin server and confirms the navigation is
served by the service worker; a fresh context without a worker must fail to
connect. This avoids Playwright's documented WebKit offline-emulation defect
([microsoft/playwright#42775](https://github.com/microsoft/playwright/issues/42775))
while still verifying actual network-failure cache recovery.

The storage browser fixture finishes first worker activation and verifies a
matching activated controller before its first large-copy reload. A navigation
started during initial installation can commit after the activation-time claim
has finished and remain uncontrolled. The later controller and real offline
reload assertions are retained. Failure-only diagnostics report worker states,
registration scope, controller, page visibility, and cache names.

`service-worker-lifecycle.browser.mjs` gates a precache-only asset and the reload
HTML response to verify this setup without sleeps. With the origin stopped it
fetches every required asset, checking status, exact SHA256 bytes, and delivery
by the worker. It also checks native Farm Book data, a worker-served reload,
and rejection by a fresh context without a worker. This changes test
lifecycle setup; the application's service-worker behavior is unchanged.

Backup & Restore uses a keyboard-operable Restore button. Selecting a supported
backup validates and previews it without changing the working copy or safety
copy. Cancel and Escape return to Restore. Only Replace Farm Book saves and reads
back the pre-restore copy from committed device storage before replacement.
While that operation is pending, duplicate activation and cancellation are
blocked. Errors remain visible in Backup & Restore and never claim success.
After replacement, Download pre-restore copy exports the prior Farm Book as a
normal JSON backup; it remains available after reopening the app, until the next
confirmed restore. These actions use local device storage and require no network.
The native browser suite also covers these restore and failure paths.

An explicitly empty Chore Window list in a current-schema Farm Book remains
empty through reload and ordinary local saves. Missing lists and older schemas
still receive the initial defaults. This keeps an accepted empty cloud baseline
from generating new local Chore Windows and an unintended upload queue on reopen.
Native recovery checks wait for the completed Account & Storage overview as well
as internal sync state before inspecting persistence and the write-free outbox.

Note, event, and document forms retain a draft identity across failed main commits.
Document selections stay available until the Farm Book commit finishes. Prepared
attachments are reused by file name/type/content digest within that draft; removed
selection bytes are deleted only after the updated document metadata commits.
Partial attachment preparation failures clean up only newly prepared files, leaving
retained draft attachments readable. A fresh modal starts a fresh preparation memo.
Attachment rows now store exact ArrayBuffer bytes to avoid native WebKit Blob/File
IndexedDB preparation failures. readLocal reconstructs the existing Blob API;
legacy Blob rows remain readable without destructive migration. Filename, MIME
type, size, IDs, private upload paths, and attachment metadata are unchanged.
