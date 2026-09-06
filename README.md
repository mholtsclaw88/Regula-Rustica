# Regula Rustica

**A local-first homestead stewardship application.**

*Ora et labora · Ut in omnibus glorificetur Deus.*

Regula Rustica helps a household care for the things, work, production, history, and resources entrusted to it. It is designed for ordinary use on a working homestead: quick enough to use from a phone, dependable without constant connectivity, and structured enough to preserve useful history across years and devices.

The application should feel less like enterprise software and more like a durable modern farm ledger or almanac.

## Stewardship Model

Regula Rustica is organized around five primary concepts:

- **Records** — enduring things entrusted to care: Animals, Land, Equipment, Structures, and Works.
- **Tasks** — work that should happen, including one-time, recurring, assigned, and Chore Window work.
- **Journal** — what happened and what should be remembered, including observations and supporting history.
- **Yield** — what the Homestead produced, such as milk, eggs, and harvests.
- **Ledger** — financial stewardship: expenses, income, and Record allocations.

Supporting features include Today, Calendar, Chore Windows, Events, household People and assignments, photos/documents, backup/recovery, and optional private cloud synchronization.

## Daily Use

**Today** is the operational view: what has happened, what is next, and what needs attention now.

**Calendar** provides progressively broader planning:

- Day — inspect a date in detail
- Week — plan the near term
- Month — orient around overall workload and Events

Chore Windows give recurring necessary work a natural place in the day without assigning office-style times to every Task.

## Local First, Not Local Only

Ordinary work is written locally first so the application remains useful when internet service is unavailable.

For synchronized Homesteads, Supabase provides authentication, private Homestead membership, protected cloud persistence, and multi-device convergence. The device remains the immediate working copy; the cloud is the Homestead's shared authoritative state.

Synchronization should normally be automatic and unobtrusive. Current visible Homestead data is user data; obsolete synchronization bookkeeping is not.

## Technology

Regula Rustica is an installable progressive web application deployed through Netlify. The application uses a deliberately lightweight web stack, local browser persistence for offline operation, a service worker, and Supabase for optional authenticated cloud synchronization.

The repository includes migrations, synchronization logic, tests, and governing product/architecture documents.

## Governing Documents

The documentation has three levels:

### Governing — change slowly

- [`CONSTITUTION.md`](CONSTITUTION.md) — purpose and non-negotiable product principles
- [`RECORD_STANDARD.md`](RECORD_STANDARD.md) — meaning and behavior of stewardship information
- [`DESIGN_LANGUAGE.md`](DESIGN_LANGUAGE.md) — interaction and visual principles

### Current technical truth — keep aligned with `main`

- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`CLOUD_ARCHITECTURE.md`](CLOUD_ARCHITECTURE.md)
- [`SYNC_ARCHITECTURE.md`](SYNC_ARCHITECTURE.md)
- [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md)
- [`AUTH_FLOW.md`](AUTH_FLOW.md)
- setup/recovery documentation

### Planning

- [`ROADMAP.md`](ROADMAP.md) — current direction and release priorities
- [`PARKING_LOT.md`](PARKING_LOT.md) — worthwhile ideas intentionally deferred

When documents conflict, the Constitution governs product decisions; current code/migrations govern implementation reality until the technical documentation is corrected.

## Development Principles

- Preserve local-first operation.
- Protect current Homestead data before preserving obsolete implementation history.
- Prefer explicit, testable synchronization behavior over clever generic recovery.
- Reuse the universal stewardship model before creating specialized subsystems.
- Keep common phone workflows short and comfortable.
- Prefer progressive disclosure over dense forms and dashboards.
- Do not add complexity merely because the application can support it.
- Treat accessibility, recovery, and maintainability as part of product quality.

## Status

Regula Rustica is under active development. Its core Records, Tasks, Journal/history, Yield, Ledger, Calendar, Chore Window, household, local-first, authentication, and synchronization foundations are in place. Current work is focused primarily on refinement, reliability, documentation, and preparation for a stable St. Isidore v1.0 release.

See [`ROADMAP.md`](ROADMAP.md) for current priorities.
