# Regula Rustica Roadmap

**Status:** Active development  
**Planning rule:** This document describes what remains to be refined or built. Completed foundations are recorded separately so old implementation phases do not masquerade as future work.

## Shipped Foundation

Regula Rustica has moved beyond its original local-only prototype. The working foundation now includes:

- Governing Constitution, Record Standard, Design Language, and technical documentation
- Installable local-first PWA
- Records for Animals, Land, Equipment, Structures, and Works
- Tasks, assignments, recurrence, completion, skipping, and disabling
- Suggested Tasks and recurring Chore Windows
- Journal/history and supporting attachments
- Yield tracking
- Ledger with Record allocation
- Calendar Day, Week, and Month views
- People and household responsibility
- Authentication and private Homestead membership
- Supabase cloud persistence and Row Level Security
- Offline queue and multi-device synchronization
- Local backup/recovery tools
- Responsive mobile-first interface

These capabilities should now be treated as product foundations to preserve, not phases still waiting to be implemented.

## Current Refinement

Near-term work should improve the application already in use rather than expand scope indiscriminately.

### Daily stewardship
- Refine Today into the operational daily planner
- Keep Today and Calendar visually and behaviorally consistent
- Improve current/next work emphasis without adding office-style Task times
- Keep overdue work available without allowing historical recurrence debt to dominate the day

### Records and work
- Continue simplifying Record workflows from real use
- Keep Suggested Tasks curated, reversible, and easy to understand
- Improve Journal/photo/document workflows where practical
- Preserve useful Record relationships without turning Records into mini-applications

### Reliability
- Treat current-version synchronization defects as high priority
- Avoid new historical sync-recovery layers unless required to protect current user data
- Keep Reset to Cloud as a deliberate clean synchronization boundary
- Maintain deterministic tests for recurrence, sync, Calendar, and daily work

### Documentation
- Keep governing and technical documents aligned with current `main`
- Remove obsolete v4/v5 implementation instructions
- Keep setup and recovery documentation operationally accurate

## Before St. Isidore v1.0

The goal of v1.0 is a stable, understandable private/public-ready application rather than a maximum feature count.

Required before release:

- Production hardening
- End-to-end critical-workflow testing
- Stable migrations and synchronization behavior
- Backup, restore, and device-recovery audit
- Accessibility audit
- Performance audit on ordinary phones
- Onboarding and empty-state refinement
- Privacy policy and required account-management flows
- Documentation complete and consistent
- App-install/update behavior verified
- Clear support/recovery path for synchronization problems

## Later — Proven Needs

Features should move here from the Parking Lot only after real use justifies them.

Likely later areas include:

- The Cellarer / AI-assisted stewardship
- Voice-first entry
- Notifications and reminders
- Deeper reports and production trends
- Weather-aware planning
- Specialized stewardship tools where the universal Record model is insufficient
- Additional export/report formats

## The Cellarer

The Cellarer remains part of the long-term vision, not a prerequisite for the core application to be useful.

Potential capabilities:

- Natural-language Record and Journal entry
- Homestead lookup and summaries
- Task assistance
- Seasonal recommendations
- Reporting assistance

AI should extend the existing stewardship model rather than create a parallel system of record.

## Guiding Principle

Each development sprint should leave Regula Rustica more useful, reliable, or understandable.

Prefer refinement over accumulation. A capable application is desirable; an unnecessarily complicated one is not.
