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

An interrupted or failed migration is not marked complete. Local data, the safety backup, and queued operations remain available for retry. Safety copies use `regulaRusticaSyncBackupsV1`; ordinary backup export and restore remain schema-version 5 compatible.

Legacy v5 IDs are not rewritten. Valid UUIDs remain identical; older non-UUID IDs receive a stable cloud UUID mapping in the separate `regulaRusticaSyncV1` metadata store.

## Normal operation

User actions are saved locally before a durable outbox operation is created. Sync runs after local changes, at startup, when connectivity returns, and from **Sync now**. Signing out stops authenticated sync but keeps local data and pending metadata.

Pull cursors are maintained per table as `(updated_at, id)` and advance only after a complete page is saved. Deletion and restoration are explicit soft-state changes.

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
