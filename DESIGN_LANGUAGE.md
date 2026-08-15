# Regula Rustica Design Language

**Version:** 1.0  
**Status:** Adopted

## Purpose

The design language defines how Regula Rustica should feel in daily use.

The application should feel calm, dependable, and purposeful. It should support stewardship by reducing friction rather than demanding attention.

Every screen should help the user complete meaningful work and return to the Homestead quickly.

## I. Design Philosophy

Regula Rustica is a tool for daily stewardship.

It is not social media.

It is not enterprise software.

It is not a game.

The interface should disappear into the work being done.

## II. Simplicity

Every feature should earn its place.

When choosing between additional options and a simpler workflow, favor the simpler workflow unless meaningful capability would be lost.

Complexity should remain hidden until it becomes necessary.

## III. Calm Interface

The application should avoid visual noise.

Use:

- Generous spacing
- Restrained color
- Readable typography
- Meaningful icons
- Minimal animation

The interface should communicate confidence rather than urgency.

## IV. Mobile First

Regula Rustica is designed primarily for use on a phone.

Every major feature should be comfortable to use with one hand.

Desktop layouts may enhance the experience but should not become the primary design target.

## V. Common Work in Three Interactions

Whenever practical, a common action should require no more than three deliberate interactions.

Examples include:

- Record milk
- Complete a task
- Record an expense
- Find an animal

If a common workflow exceeds this guideline, it should be reviewed for unnecessary friction.

This is a design goal rather than an absolute rule. Clarity and safety take precedence when an action has significant consequences.

## VI. Plain Language

Use familiar stewardship language rather than technical terminology.

Prefer:

- Homestead
- Record
- Chronicle
- Task
- Steward
- What happened?

Avoid exposing database, synchronization, or implementation terminology during ordinary use.

Users should understand the interface without reading technical documentation.

## VII. Consistency

Every record type should behave similarly.

Users should not need to learn different interfaces for Animals, Land, Equipment, Structures, or Works.

Consistency is more valuable than perfect optimization for each individual record type.

## VIII. Progressive Disclosure

Show only what is needed for the current decision or action.

Reveal additional information only when requested or when the context requires it.

Examples:

- Show basic record fields first
- Keep advanced settings collapsed
- Offer filters and sorting without crowding the default view
- Reveal type-specific fields after the record type is selected

This keeps the interface approachable while preserving useful depth.

## IX. Respect for Attention

The application should interrupt users only when necessary.

Avoid:

- Unnecessary notifications
- Excessive confirmations
- Decorative pop-ups
- Urgency language for ordinary work
- Badges that exist only to attract attention

Attention is a limited resource and should be treated accordingly.

## X. Feedback and Confirmation

The application should provide quiet, immediate feedback when work is saved, synchronized, completed, or cannot be completed.

Routine successful actions should use brief confirmation rather than modal interruptions.

Routine work should follow the Homestead's daily rhythm. Today groups dated
occurrences under calm Chore Window headings; completed windows collapse instead
of competing for attention. Chore Windows are never styled as appointments.

Consequential actions should use clear confirmation proportional to their risk.

Examples:

- Completing an ordinary task should be immediate
- Deleting a record should require confirmation
- Removing the final Steward should be prohibited
- Replacing Homestead data during restore should require explicit confirmation

## XI. Navigation

Primary navigation should remain short, stable, and predictable.

The first-release foundation uses:

- Today
- Records
- Tasks
- Ledger
- Settings

New top-level destinations should be added only when they represent a distinct and frequently used mode of work.

The application should preserve context when a user opens a record and returns to the prior list.

## XII. Lists, Filtering, and Sorting

List-based screens should remain easy to scan before filters are applied.

Filtering and sorting should be available where they meaningfully reduce effort, especially for Records, Tasks, Ledger entries, and Chronicle activity.

The default view should remain useful without configuration.

Prefer:

- Simple type or status filters
- One clear sort control
- Remembered choices when helpful
- Easy return to the unfiltered view

Avoid complex query builders or enterprise-style filter panels unless practical use proves they are needed.

## XIII. Forms

Forms should ask stewardship questions rather than database questions.

Prefer:

- Is this managed individually or as a group?
- What happened?
- Did this cost or earn money?
- When can this work begin?
- When should it be completed?

Fields should adapt to context. Selecting Animal may reveal species and purpose; selecting Equipment may reveal make and model.

Conditional fields should reduce irrelevant choices rather than create long branching forms.

Required fields should be kept to the minimum necessary for a useful record.

## XIV. Tasks and Time

Task design should reflect Homestead work rather than office scheduling.

Support distinctions among:

- Work due on a specific date
- Work that may be done within a date range
- Recurring work
- Work with no date yet

The interface should communicate what is available now, approaching its deadline, due today, or overdue without creating unnecessary alarm.

Times of day should remain optional and should not be required for ordinary Homestead tasks.

## XV. Accessibility

The interface should remain usable by people of varying ages, abilities, and technical experience.

Support:

- Readable text sizes
- Adequate contrast
- Large touch targets
- Clear focus states
- Keyboard navigation where appropriate
- Labels that do not depend only on color or icons
- Reduced motion preferences

Accessibility is part of good stewardship, not an optional refinement.

## XVI. Color

Color should support recognition and hierarchy without becoming decorative noise.

The visual foundation may draw from natural materials and the Homestead landscape:

- Deep greens
- Warm cream and paper tones
- Restrained earth and gold accents
- Muted warning colors

Color should never be the only indicator of status, permission, or error.

## XVII. Typography

Typography should feel durable, readable, and quiet.

A restrained serif may be used for identity, headings, or editorial character. Highly readable system or sans-serif type should be used where it improves forms, metadata, and dense operational information.

Typography should preserve hierarchy without relying on excessive size changes or decorative styling.

## XVIII. Icons and Imagery

Icons should clarify actions and record types, not decorate empty space.

Every icon should have a text label when its meaning may not be immediately obvious.

Photos should support identification, condition, progress, and memory.

The application should not depend on stock imagery to create character.

## XIX. Empty States

Empty states should be useful and calm.

They should explain what belongs in the space and provide one appropriate next action.

Prefer:

> No tasks are due. Add the next useful task.

Avoid celebratory language that turns ordinary stewardship into gamification.

## XX. Errors and Recovery

Errors should explain:

1. What could not be completed
2. Whether the user's data remains safe
3. What action is available next

Technical details should remain available for diagnostics without being placed in the ordinary user experience.

Offline or synchronization failures must not imply that locally saved work has been lost when it remains safely queued.

## XXI. Roles and Permissions

The roles Steward, Keeper, Hand, and Guest should be presented with plain-language descriptions during invitations and settings.

Users should not need to memorize a permission matrix.

Unavailable actions should generally be hidden or clearly explained rather than presented as unexplained failures.

## XXII. The Cellarer

The Cellarer should feel like a trusted practical assistant.

The Cellarer should:

- Be concise
- Explain recommendations when useful
- Ask when uncertain
- Avoid pretending certainty
- Confirm consequential actions
- Complete routine work without unnecessary conversation

The Cellarer exists to help complete work, not to become the center of attention.

The Cellarer should recommend before it automates.

## XXIII. Timelessness

Regula Rustica should avoid short-lived design trends.

Prefer:

- Simple layouts
- Restrained colors
- Durable typography
- Predictable navigation
- Familiar controls

The application should feel as appropriate in ten years as it does today.

## XXIV. Design Review Questions

Before approving a new interface or workflow, ask:

1. Does this help the Steward remember, decide, or act?
2. Can it be used comfortably on a phone with one hand?
3. Is the most common path obvious?
4. Are uncommon options hidden until needed?
5. Does it use plain stewardship language?
6. Does it behave consistently with the rest of the application?
7. Does it protect attention and avoid unnecessary urgency?
8. Can the user recover safely from a mistake?
9. Is the added complexity justified by real use?

If the answer is unclear, simplify the design or leave the feature in the parking lot until practical experience proves the need.

## Governing Principle

> Every interaction should help the Steward return to the Homestead as quickly as possible.

## Version History

### Version 1.0 — August 2026

Initial adopted design language for Regula Rustica.
