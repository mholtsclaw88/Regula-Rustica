# Regula Rustica Design Language

**Version:** 2.0  
**Status:** Adopted governing design standard

## Purpose

Regula Rustica should feel calm, durable, purposeful, and at home in daily stewardship.

The visual metaphor is a **modern farm ledger or almanac**: orderly enough to preserve years of useful information, quick enough to use with dirty boots and one hand on a phone, and restrained enough that the software never becomes the center of attention.

## I. Design Philosophy

Regula Rustica is a tool for stewardship.

It is not social media, enterprise software, a game, or a generic productivity dashboard.

Every screen should help the user remember, decide, act, or understand—and then return to the Homestead.

## II. Simplicity with Depth

The application may be robust without appearing complicated.

Common workflows should remain obvious. Advanced information should appear through progressive disclosure rather than crowding the default view.

When capability and simplicity conflict, first ask whether the complexity can be hidden until it is needed.

## III. Mobile First

Phone use is the primary design constraint.

Major workflows should be comfortable around 360–390px and usable with one hand where practical. Desktop may use additional space but should not establish a separate visual language.

## IV. Common Work Quickly

Whenever practical, common actions should require no more than about three deliberate interactions.

Examples:

- complete a Task;
- record milk or eggs;
- enter an expense;
- find a Record;
- add an observation.

This is a guideline, not permission to remove necessary clarity or confirmation from consequential actions.

## V. Plain Stewardship Language

Prefer familiar terms:

- Homestead
- Record
- Task
- Journal
- Yield
- Ledger
- Chore Window
- Other Work
- What happened?

Do not expose database, synchronization, tombstone, projection, or implementation terminology in ordinary use.

## VI. Visual Character

The application should draw from paper, ink, wood, brass, fields, and durable agricultural ledgers without becoming decorative nostalgia.

Core semantics:

- **Forest green** — structure, orientation, primary navigation, active framing
- **Parchment / warm cream** — working surface
- **Brass / restrained gold** — boundaries, selection, Events, useful ornament
- **Dark ink** — primary content
- **Muted sepia/earth** — metadata and secondary context
- **Muted warning tones** — genuine attention states

Color should communicate hierarchy, not decorate every object.

Color must never be the only indicator of state.

## VII. Typography

Use restrained serif typography for identity, headings, and ledger character. Use highly readable system/sans-serif typography where it improves dense metadata, forms, controls, and operational information.

Hierarchy should come from weight, spacing, grouping, and modest size changes—not giant dashboard typography.

## VIII. Compact Ledger Rows

Operational lists should favor compact ledger rows over large cards.

A collapsed Task row generally shows:

- checkbox;
- Task title;
- one useful quiet context line;
- disclosure caret when more detail is available.

Do not repeat context already obvious from the surrounding section. For example, a Task nested under Evening does not need `Evening` repeated in every collapsed row.

Expanded detail may reveal recurrence, Record, assignee, Yield, due state, Chore Window, and actions.

## IX. Progressive Disclosure

Show the minimum information necessary for the current decision.

Examples:

- compact Task row → expand for details;
- simple Record summary → edit for deeper fields;
- Needs Attention → collapsed until needed;
- advanced cloud diagnostics → available in Settings, not ordinary Today use.

Progressive disclosure is the primary way Regula Rustica remains simple as capability grows.

## X. Time and Human Rhythm

Do not force homestead work into an office calendar model.

- Calendar Events may have times.
- Chore Windows have start/end times.
- Ordinary Tasks generally do not need individual times.
- Tasks associated with a Chore Window inherit that period's place in the day.
- Date-scheduled Tasks without a Chore Window remain visible as **Other Work**.

Chore Windows are structural periods of recurring care, not appointments.

## XI. Today and Calendar

These views share components but have different jobs.

### Today — operate

Today answers: **Where are we in the day, and what needs to happen next?**

It may emphasize progress, completed/past work, current/next Chore Window or Event, Other Work, and restrained overdue attention.

### Calendar Day — inspect

Day answers: **What belongs on this date?**

It presents Chore Windows, Events, and Other Work in a detailed daily ledger.

### Calendar Week — plan

Week summarizes enough Chore Window work, Events, and Other Work to understand the near-term plan without rendering seven full Day views.

### Calendar Month — orient

Month emphasizes overall workload and date selection. Detail decreases as the time horizon expands.

A useful governing rule is:

> **Detail decreases as the time horizon expands.**

Week and Month day selections should naturally drill into Day rather than create parallel navigation systems.

## XII. Information Density

Do not confuse simplicity with emptiness.

Regula Rustica may show meaningful operational density when it is well organized. Prefer compact rows, strong grouping, quiet metadata, and clear hierarchy over oversized cards and excessive whitespace.

The user should be able to scan a real working day without excessive scrolling.

## XIII. Calm Attention

Protect attention.

Avoid:

- unnecessary notifications;
- gamification;
- celebratory confetti for ordinary work;
- badges designed merely to attract attention;
- urgency language for routine chores;
- modal confirmations for harmless reversible actions.

Overdue work should be available without allowing historical recurrence debt to dominate today's legitimate work.

## XIV. Feedback and Consequence

Routine successful actions should provide quiet immediate feedback.

Consequential actions deserve proportional confirmation.

Examples:

- complete Task → immediate;
- disable recurring series → clear but reversible;
- delete ordinary Task → confirmation when warranted;
- delete Record or destructive restore/reset → explicit confirmation;
- remove final Steward → prohibited.

## XV. Navigation

Navigation should remain short, stable, and predictable.

Primary mobile destinations currently center on:

- Records
- Tasks
- Yield
- Ledger
- Calendar

Today/Home and Settings remain readily available from the application header/navigation structure.

Do not add a top-level destination merely because a data type exists.

Preserve selected date/list/Record context when practical.

## XVI. Records

Animals, Land, Equipment, Structures, and Works should feel like variations of one application.

Type-specific fields and Suggested Tasks may adapt to context, but navigation, forms, history, Task behavior, and visual hierarchy should remain familiar.

## XVII. Forms

Forms should ask stewardship questions rather than database questions.

Required fields should be the minimum needed for a useful object. Conditional fields should remove irrelevant choices rather than create long branching forms.

Favor clear selectors and ordinary language over clever controls.

## XVIII. Lists, Filtering, and Sorting

Default lists should be useful without configuration.

Filtering and sorting should reduce effort, especially in Records, Tasks, Yield, Ledger, and Journal/history.

Avoid enterprise query builders unless practical use proves a real need.

## XIX. Empty States

Empty states should be calm and useful.

Explain what belongs there and offer one appropriate next action when needed.

Prefer:

> No other work for this day.

Avoid gamified congratulations for the absence of work.

## XX. Accessibility

Accessibility is part of good stewardship.

Support:

- readable text;
- adequate contrast;
- large touch targets;
- visible focus;
- keyboard navigation where appropriate;
- labels that do not depend only on color/icons;
- reduced motion preferences;
- responsive layouts without horizontal overflow.

Workload shading or color status must always have a textual/structural counterpart.

## XXI. Errors, Offline State, and Sync

Errors should explain:

1. what could not be completed;
2. whether the user's data remains safe;
3. what action is available next.

Ordinary sync status should be quiet: Synced, Syncing/Waiting, Issue, Offline, or Local Only as appropriate.

Detailed queue/retry/conflict diagnostics belong behind a troubleshooting surface.

Never imply that safely stored local work is lost merely because synchronization is delayed.

## XXII. Roles and Responsibility

Roles such as Steward, Keeper, Hand, and Guest should be explained in plain language. Task assignment to a household person is not the same as granting application access.

Unavailable actions should generally be hidden or clearly explained rather than fail mysteriously.

## XXIII. The Cellarer

The Cellarer should feel like a trusted practical assistant.

It should be concise, explain recommendations when useful, acknowledge uncertainty, and confirm consequential actions.

Recommend before automating. The Cellarer assists the stewardship model; it does not create a parallel one.

## XXIV. Timelessness

Avoid short-lived interface trends.

Prefer durable typography, natural restrained color, familiar controls, simple layouts, and clear hierarchy.

The application should feel appropriate years from now, not merely fashionable today.

## XXV. Design Review Questions

Before approving an interface or workflow, ask:

1. Does this help the steward remember, decide, act, or understand?
2. Can it be used comfortably on a phone?
3. Is the common path obvious?
4. Are uncommon details disclosed only when needed?
5. Does it use plain stewardship language?
6. Does it behave like the rest of Regula Rustica?
7. Does it protect attention?
8. Can the user recover safely from mistakes?
9. Does the information density match the screen's purpose?
10. Is the added complexity justified by real use?

If the answer is unclear, simplify or defer.

## Governing Principle

> Every interaction should help the Steward return to the Homestead as quickly as possible.

## Version History

### Version 2.0 — September 2026

Updated the original design language to reflect the mature local-first application, farm-ledger/almanac identity, compact operational rows, Chore Windows, and the distinct Today/Calendar Day/Week/Month information hierarchy.

### Version 1.0 — August 2026

Initial adopted design language.
