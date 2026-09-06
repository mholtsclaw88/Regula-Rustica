# Regula Rustica Architecture

**Version:** 2.0  
**Status:** Current architectural overview  
**Applies to:** current `main`

## Purpose

This document describes the current architectural shape of Regula Rustica. It should be read with `CONSTITUTION.md`, `RECORD_STANDARD.md`, `DESIGN_LANGUAGE.md`, `DATABASE_SCHEMA.md`, `CLOUD_ARCHITECTURE.md`, and `SYNC_ARCHITECTURE.md`.

Unlike historical v4/v5 planning documents, this file describes the application as it exists now: a local-first PWA with optional authenticated multi-device cloud synchronization.

## Architectural Priorities

1. Ordinary Homestead work remains available locally and offline.
2. Shared Homestead data converges safely across authorized devices.
3. The domain model remains understandable and durable.
4. Recovery is explicit and testable.
5. The UI stays simple even when the underlying application is capable.
6. New features extend the stewardship model rather than bypass it.

## Delivery Model

Regula Rustica is an installable progressive web application deployed through Netlify.

The application remains intentionally lightweight and web-native. It includes:

- HTML/CSS/JavaScript application UI
- service worker and web app manifest
- local browser persistence for the working copy and synchronization state
- local attachment storage where appropriate
- Supabase authentication and PostgreSQL persistence for synchronized Homesteads
- protected database functions/RPCs and Row Level Security
- database migrations and pgTAP coverage
- application/domain/synchronization tests

The project should not adopt a framework or large dependency merely because the product has grown. Added tooling must solve a concrete maintainability or capability problem.

## Local First, Not Local Only

Local-first is a product requirement, not a temporary migration stage.

A user should be able to create and edit Records, complete Tasks, record Journal activity and Yield, and enter Ledger activity without waiting for a network request.

For a synchronized Homestead:

- the device holds the immediate working copy;
- local mutations are recorded durably for synchronization;
- the cloud holds the Homestead's shared authoritative state;
- authorized devices eventually converge to that state.

Cloud failure must not prevent ordinary local stewardship work.

## Domain Model

The durable product model has five primary concepts.

### Records

Records describe things entrusted to care.

Current core types:

- Animal
- Land
- Equipment
- Structure
- Work

Records use stable IDs and shared foundations rather than separate application architectures for each type.

### Tasks

Tasks describe work that should happen.

They may be:

- one-time or recurring;
- linked to one or more Records where supported;
- assigned to a Homestead person;
- scheduled/due on a date;
- associated with a Chore Window;
- linked to Yield capture;
- generated from a curated Suggested Task definition.

Recurring Tasks use durable series/occurrence semantics. Completion, skip, disable, and deletion must remain distinct operations.

### Journal

Journal represents dated history and intentional documentation: what happened and what should be remembered.

Journal/history may include observations, significant Record activity, supporting notes, photos/documents, and other dated stewardship information. Historical data should be corrected deliberately rather than silently rewritten.

### Yield

Yield represents production output such as milk, eggs, and harvests. Yield is first-class operational data rather than merely a generic Event value.

Yield may be linked to Records and may be captured as part of completing an appropriate Task.

### Ledger

Ledger represents financial stewardship: expenses and income. A transaction is canonical and may allocate amounts across Records rather than duplicating the full transaction for every relationship.

## Supporting Domain Concepts

### People and assignments

The Homestead maintains a people directory for responsibility and Task assignment. Account-backed members and non-account household people are distinct concepts; assignment does not itself grant application access.

### Chore Windows

Chore Windows represent recurring periods of necessary work such as Morning and Evening. They own start/end times and group recurring Tasks into a human daily rhythm.

Ordinary Tasks do not require individual times.

### Calendar Events

Calendar Events represent scheduled happenings and may have their own time. They are distinct from Tasks and Journal history.

### Suggested Tasks

Suggested Tasks are curated recommendations associated with relevant Record types/purposes. Built-in suggestions should be reversible through Enabled/Disabled state rather than permanently destroyed as ordinary Tasks can be.

## Presentation Architecture

The principal user-facing modes are:

- Today — run the current day
- Records — understand and care for enduring things
- Tasks — manage work
- Yield — review production
- Ledger — review financial stewardship
- Calendar — inspect and plan dates
- Settings — Homestead, people, daily rhythm, cloud/sharing, data/recovery, and app settings

Journal is integrated into stewardship history and Record workflows rather than treated as an unrelated application.

### Today

Today is operational. It answers: **Where are we in the day, and what needs to happen next?**

It should project from Chore Windows, Tasks, Events, completion state, and legitimate overdue work rather than persist a second Today-specific source of truth.

### Calendar

Calendar is a planning projection:

- Day — inspect a date in detail
- Week — plan near-term workload
- Month — orient around overall scheduled load

Chore Window Tasks, Other Work, and Events remain distinguishable. Month/Week summaries are derived projections, not persisted summary records.

## Persistence Layers

### Local working copy

The local application state supports immediate/offline operation. Stable schema versioning and normalization protect upgrades.

### Attachments

Attachment metadata and attachment bytes may have different persistence/synchronization paths. Large binary data should not be forced through ordinary JSON synchronization merely for conceptual uniformity.

### Cloud persistence

Supabase PostgreSQL stores synchronized Homestead data. Every synchronized domain object is scoped to a Homestead and protected through authentication, membership, capabilities, RLS, and protected write paths.

See `DATABASE_SCHEMA.md` and `CLOUD_ARCHITECTURE.md` for current details.

## Synchronization Boundary

Synchronization is a distinct subsystem and should remain explicit.

Key principles:

- local changes are durable before network transmission;
- active domains use explicit supported synchronization routes;
- retryable, blocked, dependency-blocked, and conflict states are distinguishable;
- cloud and local representations are normalized before deciding that a meaningful change exists;
- tombstones/deletions must converge without recreating obsolete data;
- current visible Homestead data is user data;
- obsolete historical synchronization bookkeeping is not itself user data.

### Reset to Cloud

**Reset this device from cloud** is a deliberate hard synchronization boundary.

It means:

> Discard this device's local synchronization history and make the current cloud Homestead the authoritative baseline for this device.

A successful reset downloads current supported cloud data, establishes it as the accepted local baseline, and leaves no historical pending/conflict/retry work. It must not upload the discarded local synchronization history during the reset.

This operation affects the device working copy/sync state, not the authoritative cloud Homestead.

See `SYNC_ARCHITECTURE.md` for detailed rules.

## Authentication and Authorization

Authentication identifies an account. Homestead membership grants access. Capabilities determine permitted actions.

Client-side permission checks are presentation aids only. Cloud authorization is enforced server-side.

Every Homestead must retain at least one Steward. Household people who are not authenticated members may still exist for assignment purposes without receiving data access.

See `AUTH_FLOW.md` and `CLOUD_ARCHITECTURE.md`.

## Backup and Recovery

Local-first does not remove the need for recovery.

The application should preserve:

- open/documented exports where practical;
- deliberate restore behavior;
- device recovery from the cloud for synchronized Homesteads;
- safe handling of schema upgrades;
- clear separation between user data and disposable synchronization bookkeeping.

Destructive recovery actions require explicit user intent.

## Service Worker and Updates

The service worker caches the assets required for installable/offline operation. Cache versions must change when required to prevent stale application shells from surviving meaningful releases.

Caching must favor reliable offline loading without making production updates difficult to receive.

## Testing Expectations

Changes should be tested at the layer they affect.

Important coverage includes:

- schema normalization/migration
- Record CRUD and relationships
- Task recurrence, skip, disable, completion, and deletion
- Chore Window materialization
- Yield-linked completion
- Calendar/Today projections
- local-first persistence
- synchronization and clean-device convergence
- authorization/RLS and protected database functions
- backup/recovery
- narrow mobile layouts and desktop

Synchronization changes require focused sync tests and database tests where server behavior is involved.

## Development Rules

- Start from current `main` unless a sprint explicitly says otherwise.
- Preserve a functioning application after each logical change.
- Diagnose root causes before adding compatibility/recovery code.
- Do not add historical recovery layers merely to preserve obsolete sync bookkeeping.
- Prefer small explicit modules/helpers over broad rewrites.
- Avoid schema or synchronization changes for presentation-only work.
- Keep mobile use around 360–390px as a first-class validation target.
- Preserve the established forest, parchment, brass, ink, and muted-sepia visual language.
- Update technical documentation when architecture materially changes.

## Governing Principle

The architecture should be robust enough to protect years of Homestead history while remaining simple enough that the software itself never becomes the Homestead's main chore.
