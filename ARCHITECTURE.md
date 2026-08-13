# Regula Rustica Architecture

**Version:** 1.0  
**Applies to:** v5 Record Foundation

## Purpose

This document defines the technical structure for Regula Rustica v5. It should be read together with `CONSTITUTION.md` and `RECORD_STANDARD.md`.

The architecture should preserve three priorities:

1. Simplicity for the household using the app.
2. Durability and maintainability for future development.
3. A clean path from local-only storage to shared cloud storage later.

## Current Delivery Model

Regula Rustica is a static progressive web application deployed through Netlify.

Current stack:

- HTML
- CSS
- Vanilla JavaScript
- Browser local storage
- Web app manifest
- Service worker for offline use

No framework or build system is required for v5.

## v5 Scope

v5 is a local-first architectural refactor.

It includes:

- Separation of HTML, CSS, and JavaScript
- Universal record model
- Record, task, event, note, and ledger engines
- Migration from the prior local-storage schema
- Continued offline capability
- Backup and restore

It does not include:

- Supabase
- Authentication
- Shared household sync
- Photo uploads
- ChatGPT or MCP integration
- Push notifications

## Recommended File Structure

```text
/
├── index.html
├── styles.css
├── app.js
├── manifest.webmanifest
├── service-worker.js
├── icons/
├── CONSTITUTION.md
├── RECORD_STANDARD.md
└── ARCHITECTURE.md
```

The first v5 refactor should remain deliberately small. Further JavaScript splitting is allowed only when the single `app.js` becomes difficult to understand or test.

A future structure may separate concerns into:

```text
js/
├── app.js
├── storage.js
├── records.js
├── tasks.js
├── events.js
├── ledger.js
└── ui.js
```

Do not create this additional structure prematurely.

## Core Data Model

The local data object should use an explicit schema version.

```json
{
  "schemaVersion": 7,
  "settings": {},
  "records": [],
  "people": [],
  "tasks": [],
  "assignments": [],
  "events": [],
  "calendarEvents": [],
  "yieldEntries": [],
  "notes": [],
  "ledger": []
}
```

### Records

Records describe things entrusted to the household's care.

Supported v5 types:

- Animal
- Land
- Equipment
- Structure
- Work

Each record contains:

```json
{
  "id": "stable-id",
  "type": "Animal",
  "name": "Daisy",
  "status": "Active",
  "identity": {},
  "stewardship": {},
  "createdAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp"
}
```

Type-specific fields belong inside `identity` and `stewardship`. They should not create separate databases or separate page architectures.

### Tasks

Tasks represent future work.

```json
{
  "id": "stable-id",
  "title": "Trim hooves",
  "availableFrom": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD",
  "recordId": "optional-record-id",
  "completed": false,
  "createdAt": "ISO-8601 timestamp",
  "completedAt": null
}
```

`availableFrom` and `dueDate` are independently optional. Schema version 6 adds distinct local collections for shared calendar events and canonical Milk/Egg yield entries. Schema version 7 adds an assignable Homestead people directory and normalized task assignments. Older schema-version 5 and 6 backups remain importable.

Optional recurrence metadata uses a daily, weekly, or monthly frequency, a positive interval, and either a fixed schedule based on the prior due date or a schedule based on completion. Completing a recurring task creates only its next occurrence. A Homestead that has never initialized cloud synchronization generates that occurrence locally; after cloud initialization, the idempotent database completion path owns generation and the client receives the next occurrence through synchronization.

### Homestead People and Task Assignments

`people` is the local-first assignee directory. Account-backed entries have `personType: "member"` and a membership link supplied by the cloud; `personType: "child"` entries have no account, role, membership, or access. Tasks reference people through the separate `assignments` collection so assignment history is not duplicated on the task. The first UI exposes one active assignee while the underlying model continues to support multiple assignments.

Completing a linked task may create a Chronicle event automatically.

### Events

Events represent dated happenings and form the Chronicle.

```json
{
  "id": "stable-id",
  "recordId": "record-id",
  "eventType": "Morning Milk",
  "date": "YYYY-MM-DD",
  "value": "1.6",
  "unit": "gal",
  "details": "optional text",
  "createdAt": "ISO-8601 timestamp"
}
```

The UI action is labeled **Record** and asks **What happened?**

### Notes

Notes contain enduring knowledge rather than dated happenings.

```json
{
  "id": "stable-id",
  "recordId": "record-id",
  "text": "Stands better when fed first.",
  "createdAt": "ISO-8601 timestamp",
  "updatedAt": "ISO-8601 timestamp"
}
```

### Ledger

The ledger is intentionally simple.

```json
{
  "id": "stable-id",
  "type": "expense",
  "date": "YYYY-MM-DD",
  "amount": 42.00,
  "description": "Layer feed",
  "recordId": "optional-record-id",
  "createdAt": "ISO-8601 timestamp"
}
```

Supported types are `expense` and `income`.

## Storage Layer

v5 uses browser local storage as the source of truth.

Requirements:

- Use one primary storage key for schema version 5.
- Detect the prior v3/v4 key and migrate once.
- Preserve a backup before destructive migrations when practical.
- Normalize missing arrays and settings during load.
- Never silently discard unknown legacy data.
- Keep JSON export and restore available.

The storage interface should be conceptually limited to:

- `loadData()`
- `saveData(data)`
- `migrateData(data)`
- `exportData()`
- `importData(file)`

## UI Architecture

The primary navigation for v5 is:

- Today
- Records
- Tasks
- Ledger
- Settings

### Today

Answers: **What requires attention now?**

Displays:

- Morning, Evening, and custom Chore Windows with due Routine occurrences
- Due and overdue ordinary Tasks
- Today's Calendar Events
- Quick add task
- Quick add record
- Basic counts

Routines are first-class synchronized definitions, distinct from generic Tasks.
Only their dated occurrences appear in Today and Calendar. Completed Chore
Windows collapse quietly, and yield-backed occurrences can record Yield without
requiring a second completion action. The Tasks page excludes Routine noise.

### Records

Answers: **What do we know about the things entrusted to us?**

Groups records by type:

- Animals
- Land
- Equipment
- Structures
- Works

### Record Detail

Every record uses the same layout:

- Identity summary
- Stewardship summary
- Record action
- Add task
- Add note
- Record expense or income
- Edit record
- Tasks panel
- Chronicle panel
- Notes panel
- Ledger panel
- Photos placeholder

### Tasks

Provides a consolidated task list with simple status, record, assignee, timing, and due-date filtering. The task menu supports daily, weekly, and monthly recurrence from either the due date or completion date.

### Ledger

Provides total expenses, total income, net amount, and linked entries.

### Settings

Contains:

- Homestead name
- Backup and restore
- Reset sample data
- Future sync settings placeholder only when needed

## Record Type Configuration

Record types should share one engine and differ through configuration.

Configuration may define:

- Display name
- Identity fields
- Stewardship fields
- Status choices
- Common event choices

Every event list includes `Other`.

Purpose- or species-specific event shortcuts may be added for Animals, but should remain limited.

## Work Completion

A Work may be:

- Completed and archived
- Completed and kept visible
- Linked to an existing record
- Converted into another record type

For v5, completion status and linking are required. Full conversion may be implemented only if it can be done safely without duplicating tasks or losing Chronicle history. Otherwise, leave a clear TODO.

## Offline Behavior

The service worker should cache only the current static assets required to load the app:

- `/`
- `index.html`
- `styles.css`
- `app.js`
- `manifest.webmanifest`
- required icons

Increment the cache name whenever cached assets change materially.

Avoid aggressive caching strategies that make updates difficult to receive.

## Security and Privacy

For v5:

- All data remains in the user's browser.
- No analytics are required.
- No external scripts are required.
- No secrets or credentials belong in client code.

For future cloud sync:

- Supabase Row Level Security is mandatory.
- Service-role credentials must never be exposed to the browser.
- Household membership must scope every shared record.

## Development Rules

- Work on `v5-record-foundation` until the refactor is reviewed.
- Preserve a functioning app after each logical commit.
- Prefer a small number of understandable files over premature modularization.
- Avoid adding features outside the v5 scope.
- Test mobile layout at narrow widths.
- Test create, edit, complete, delete, export, restore, and migration flows.
- Keep the current green, cream, and muted-gold visual character unless usability requires a change.

## Acceptance Criteria for v5 Foundation

The foundation is ready for review when:

1. The app loads without console errors.
2. HTML, CSS, and JavaScript are separated.
3. Existing local data migrates without crashing.
4. Records use the five approved types.
5. Individual and group Animal records can be created.
6. Common events plus `Other` can be recorded.
7. Events appear in each record's Chronicle.
8. Tasks can be linked, edited, completed, and filtered.
9. Notes and ledger entries can be linked to records.
10. Backup and restore work.
11. The app remains installable and usable offline.
12. No cloud sync or authentication has been added.

## Future Architecture

After v5 stabilizes, the same data model may move behind a repository interface.

```text
UI
 ↓
Application services
 ↓
Data repository
 ├── Local storage repository
 └── Supabase repository
```

This allows cloud sync to change where data is stored without changing the meaning of records, tasks, events, notes, or ledger entries.
