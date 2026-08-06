# Regula Rustica Cloud Architecture

**Version:** 1.0  
**Status:** Adopted  
**Adopted:** August 2026

## Purpose

The cloud architecture exists to allow members of a Homestead to securely share stewardship records across multiple devices while preserving Regula Rustica's local-first philosophy.

Cloud synchronization is intended to enhance stewardship, not replace local ownership.

A Steward should be able to record chores, livestock observations, expenses, events, and other work regardless of internet availability. Synchronization should occur automatically when connectivity returns.

Regula Rustica treats the Homestead, not the individual user, as the primary unit of stewardship.

The architecture shall prioritize:

- Privacy
- Reliability
- Offline operation
- Data ownership
- Simplicity
- Long-term maintainability

Every design decision should support these principles.

---

# I. Guiding Principles

## I.I Local First

Every action should be written to the local device immediately.

Cloud synchronization occurs in the background and should never delay ordinary work.

The application should remain useful without internet access.

## I.II Homestead Ownership

Every synchronized object belongs to a Homestead.

Users are members of a Homestead. Users do not personally own Homestead records.

If a member leaves the Homestead, the information remains with the Homestead.

## I.III Shared Source of Truth

The local device is the Steward's working copy.

The cloud is the Homestead's shared source of truth.

Each device maintains a local copy of the Homestead data necessary for offline operation, and every device should eventually converge to the same shared state.

## I.IV Exportability

A Homestead should be able to export its complete data at any time in an open, documented format.

No Homestead should become dependent upon a proprietary cloud service to access its own records.

## I.V Privacy

Homestead data is private.

Only authenticated members of the Homestead may access that Homestead's information.

No Homestead may access another Homestead's data.

## I.VI Graceful Degradation

When cloud services are unavailable:

- Recording work continues.
- Tasks remain usable.
- Records remain editable.
- Previously downloaded photos remain available.
- Synchronization resumes automatically when service returns.

The Steward should never lose the ability to care for the Homestead because a cloud service is unavailable.

---

# II. Authentication and Membership

Authentication identifies a person.

Membership grants access to a Homestead.

These are separate concepts.

Every person accessing synchronized Homestead data must authenticate using an individual account.

Each user belongs to exactly one Homestead.

One Homestead may have many users.

## II.I Creating a Homestead

When a new user creates an account, the user may create a new Homestead.

The creating user becomes the first Steward of that Homestead.

## II.II Joining a Homestead

A user may join an existing Homestead only through an invitation.

Supported invitation methods:

- Email invitation
- Secure invitation link

Future versions may support a short invitation code if practical need justifies it.

Invitations should be:

- Single use
- Cryptographically random
- Time limited
- Revocable before acceptance
- Invalidated immediately after acceptance

The default expiration period should be seven days.

No public directory of Homesteads shall exist.

## II.III Membership Changes

A Steward may:

- Invite members
- Remove members
- Change member roles

A removed member immediately loses access to Homestead data.

The data remains with the Homestead.

## II.IV Stewardship Continuity

Every Homestead must always have at least one Steward.

The system shall prevent removal or demotion of the final Steward unless another Steward has already been assigned.

---

# III. Roles and Permissions

Roles determine what a member may do within a Homestead.

Permissions should remain simple, predictable, and easy to understand.

Regula Rustica favors a small number of well-defined roles over highly customizable permission systems.

## III.I Steward

The Steward is responsible for administration of the Homestead.

A Steward may:

- Manage Homestead settings
- Invite and remove members
- Assign and change roles
- Create, edit, archive, restore, and delete records
- Manage all tasks
- Record and correct events
- Manage notes
- Manage ledger entries
- Export Homestead data
- Manage backups
- Approve integrations

A Steward may not remove or demote the final remaining Steward.

## III.II Keeper

A Keeper is a trusted adult or participant who helps manage the daily stewardship of the Homestead.

A Keeper may:

- Create and edit records
- Record events
- Create and complete tasks
- Add notes
- Create ledger entries
- Upload photos
- Manage ordinary workflows

A Keeper may not:

- Manage Homestead membership
- Change member roles
- Delete the Homestead
- Transfer Stewardship

## III.III Hand

A Hand is a helper who participates in the work with limited authority.

A Hand may:

- View records
- View and complete assigned tasks
- Record approved ordinary events
- Add observations or notes

A Hand may not:

- Delete or archive records
- Manage members
- Change Homestead settings
- Edit historical financial entries
- Perform high-consequence administrative actions

## III.IV Guest

A Guest has read-only access.

A Guest may view:

- Records
- Tasks
- Chronicle
- Notes
- Photos

A Guest may not modify Homestead data.

## III.V Capability-Based Authorization

Internally, permissions should be represented as capabilities rather than hard-coded role checks.

Examples:

- `can_manage_homestead`
- `can_manage_members`
- `can_edit_records`
- `can_record_events`
- `can_manage_finances`
- `can_view_finances`

Roles grant bundles of capabilities.

The user-facing roles remain Steward, Keeper, Hand, and Guest.

## III.VI Progressive Trust

Security should increase with the consequence of the action.

Ordinary stewardship actions should remain quick.

High-consequence actions should require stronger authorization or explicit confirmation.

Examples:

- Viewing a record requires minimal friction.
- Recording an ordinary event should be quick.
- Inviting members requires Steward authority.
- Deleting records requires confirmation.
- Deleting a Homestead requires multiple confirmations.

---

# IV. Synchronization

## IV.I Purpose

Synchronization exists to keep all devices belonging to a Homestead consistent while preserving the application's ability to operate without an internet connection.

Synchronization should occur automatically whenever practical and should require little or no user intervention.

## IV.II Local-First Operation

Every change made by a user shall be written to the local device immediately.

The application shall not require a network connection to:

- Create records
- Edit records
- Complete tasks
- Record events
- Add notes
- Add ledger entries
- View previously synchronized data

## IV.III Synchronization Queue

Every local change is placed into a synchronization queue.

When connectivity is available, queued changes are transmitted to the cloud and then propagated to other authorized devices.

Users should not manually manage the queue during ordinary use.

## IV.IV Sync Status

The application should communicate synchronization status simply.

Examples:

- Synced
- Waiting to Sync (3)
- Sync Error

Technical diagnostics should be available when needed but should not clutter ordinary use.

## IV.V Conflict Resolution

Conflicts should be rare and resolved predictably.

### Different fields

When two users edit different fields of the same object, both changes should be preserved when practical.

### Same field

When two users edit the same field before synchronization, the most recent accepted change becomes the active value.

Where appropriate, the prior value should remain recoverable through history or audit information.

The application should avoid complex merge dialogs unless real use proves them necessary.

## IV.VI Failed Synchronization

If synchronization fails:

- Local data remains intact.
- Changes remain in the synchronization queue.
- The application retries automatically.
- The user is informed only if the problem persists.

Synchronization failure must never prevent continued work.

## IV.VII Device Independence

Every authenticated device maintains its own local working copy.

A newly authenticated device downloads the current Homestead state from the cloud and then participates in normal synchronization.

## IV.VIII Manual Synchronization

Synchronization should normally be automatic.

A manual **Sync Now** action may be available in Settings for troubleshooting and reassurance, but it should not be required for ordinary use.

## IV.IX Eventual Consistency

Not every device must update instantly.

It is acceptable for a device to be seconds or minutes behind while connectivity is limited.

Given sufficient time and connectivity, all authorized devices should converge to the same Homestead state.

## IV.X Future Activity View

A future version may provide an optional Activity view showing recent synchronization activity and significant cross-device changes.

This should serve transparency and troubleshooting without becoming part of the normal daily workflow.

---

# V. Data Model

## V.I Purpose

The cloud data model shall faithfully represent the Record Standard while remaining simple, extensible, and easy to synchronize.

The database exists to preserve the stewardship history of a Homestead, not merely its current state.

## V.II Homestead Ownership

The Homestead is the top-level owner of all synchronized information.

Every synchronized object belongs to exactly one Homestead.

## V.III Core Record Types

Regula Rustica supports five primary record types:

- Animal
- Land
- Equipment
- Structure
- Work

Future record types must conform to the Record Standard.

## V.IV Universal Record Structure

Every record supports:

- Identity
- Stewardship
- Tasks
- Chronicle
- Notes
- Ledger
- Photos

This consistency allows new record types to be introduced without redesigning the application.

## V.V Relationships

A Record may have:

- Many Tasks
- Many Chronicle Events
- Many Notes
- Many Ledger Entries
- Many Photos

Each related object belongs to one Homestead and may optionally belong to one Record.

## V.VI Stable Identity

Every synchronized object shall have a globally unique identifier that never changes.

Names and descriptions may change.

Identifiers do not.

## V.VII State and History

Current condition belongs in Identity or Stewardship.

Changes over time belong in the Chronicle.

Example:

- Current location: North Paddock — Stewardship
- Moved to North Paddock on August 3 — Chronicle

The Chronicle explains how the current state came to be.

## V.VIII Historical Integrity

Chronicle entries represent historical facts.

As a general rule:

- Chronicle entries should not be silently modified.
- Corrections should remain transparent.
- Deletions should be rare and deliberate.

## V.IX Extensibility

Future capabilities should extend the existing model rather than replace it.

Potential future areas include:

- Beekeeping
- Maple syrup
- Forestry
- Cheese aging
- Inventory
- Orchard management

These should extend the Record Standard rather than become unrelated subsystems.

## V.X Future Relationships

Future versions may allow relationships among records, tasks, events, notes, ledger entries, and photos through their stable identifiers.

This should be added only when practical use justifies it.

## V.XI Design Principle

> The database should describe the Homestead, not the user interface.

---

# VI. Artificial Intelligence

## VI.I The Cellarer

The Regula Rustica AI assistant is known as **The Cellarer**.

Historically, the cellarer was entrusted with practical care of goods and daily operations.

Within Regula Rustica, The Cellarer assists with records, tasks, and information while remaining subordinate to the Steward.

The Cellarer is an assistant, not an authority.

## VI.II Purpose

Artificial intelligence exists to reduce the effort required to maintain accurate Homestead records.

AI should help users spend less time using software and more time stewarding the Homestead.

## VI.III System of Record

Regula Rustica remains the system of record.

The Cellarer does not own Homestead data.

All approved changes are written through Regula Rustica and synchronized normally.

## VI.IV Capabilities

The Cellarer may eventually:

- Search records
- Answer questions about the Homestead
- Create tasks
- Complete tasks
- Record events
- Add notes
- Create ledger entries
- Summarize activity
- Suggest recurring tasks
- Suggest seasonal work

Capabilities should be added gradually and tested against real use.

## VI.V Human Confirmation

The Cellarer should confirm actions that:

- Delete information
- Modify financial records
- Change member roles
- Archive records
- Perform other irreversible or high-consequence actions

Routine record creation and ordinary task management should not require unnecessary confirmation.

## VI.VI Security Boundary

The Cellarer shall never receive unrestricted access to the database.

All AI requests shall pass through authenticated Regula Rustica services that:

- Verify identity
- Verify Homestead membership
- Validate requests
- Enforce permissions
- Record the action

## VI.VII Transparency

When practical, the application should indicate when an action was created or modified through The Cellarer.

AI assists.

People decide.

## VI.VIII Recommend Before Automating

The Cellarer should recommend before it automates.

If uncertain, it should ask.

If confident, it should assist.

If intent cannot be determined with reasonable confidence, it should seek clarification rather than guess.

## VI.IX Future Vision

The Cellarer may eventually assist with:

- Plant or livestock identification from photographs
- Ear-tag or label reading
- Maintenance suggestions based on equipment history
- Seasonal work summaries
- Production trend summaries
- Reports
- Cross-Homestead record search within the user's own Homestead

These capabilities must support stewardship rather than replace observation, judgment, or experience.

---

# VII. Data Ownership, Backup, and Recovery

## VII.I Data Ownership

All data entered into Regula Rustica belongs to the Homestead.

OpenAI, Supabase, Netlify, and any future service provider store or process data only on behalf of the Homestead.

## VII.II Export

A Steward may export the complete Homestead at any time.

Exports should use an open, documented format such as JSON.

An export should include:

- Records
- Tasks
- Chronicle
- Notes
- Ledger
- Photos or photo references
- Settings
- Membership information excluding passwords and authentication secrets

## VII.III Import and Restore

A Steward may restore a Homestead from a valid backup.

The application should validate the backup before importing.

Restoration should not overwrite existing data without explicit confirmation.

## VII.IV Automatic Backups

The system should periodically create recoverable backups of the Homestead.

Backups should occur without interrupting normal use.

Automatic backups complement, but do not replace, manual exports.

## VII.V Device Recovery

If a device is lost, replaced, or reset:

1. The user signs in.
2. The application downloads the Homestead from the cloud.
3. Local synchronization resumes automatically.

No manual reconstruction should be required.

## VII.VI Vendor Independence

Regula Rustica should avoid unnecessary dependence on any single cloud provider.

Whenever practical:

- Data formats should remain open.
- Database structures should remain understandable.
- The Homestead should retain the ability to migrate elsewhere.

## VII.VII Audit Trail

Significant actions should remain traceable.

Where appropriate, the system should record:

- When a change occurred
- Who made the change
- Whether it was entered manually or through The Cellarer

The purpose is accountability and troubleshooting, not surveillance.

## VII.VIII Continuity

A Homestead may outlast any individual member.

The architecture should permit Stewardship to be transferred to another authorized member without loss of records or history.

## VII.IX Design Principle

> The Homestead should always be able to leave with its data.

---

# VIII. Security

## VIII.I Purpose

Security exists to protect Homestead information without making stewardship difficult.

Security measures should be proportional to the risks faced by a private Homestead.

## VIII.II Authentication

Every person accessing synchronized data shall use an individual account.

Accounts should not be shared.

Authentication credentials shall not be stored by Regula Rustica.

Authentication is delegated to a trusted identity service.

## VIII.III Authorization

Every request shall verify:

- User identity
- Homestead membership
- Assigned role
- Required capability

## VIII.IV Least Privilege

Members should receive only the permissions required for their responsibilities.

The application should favor granting additional permissions intentionally rather than by default.

## VIII.V Encrypted Communication

All communication between devices and cloud services shall use encrypted connections.

Sensitive information shall not be transmitted in plain text.

## VIII.VI Secrets

Application secrets, service-role keys, API keys, and server credentials shall never be stored in the client application or committed to the repository.

Secrets belong only in trusted server-side infrastructure or approved environment-variable storage.

## VIII.VII Row-Level Security

The database shall enforce Homestead isolation using row-level security or an equivalent server-side control.

Client-side filtering is not a security boundary.

No member may read or modify another Homestead's data.

## VIII.VIII Artificial Intelligence

The Cellarer shall operate within the same permission model as human members.

AI shall not bypass authorization, validation, auditing, or confirmation requirements.

## VIII.IX Privacy by Default

A newly created Homestead is private.

Homestead information is never publicly searchable.

Data is not shared outside the Homestead unless explicitly exported or authorized by a Steward.

## VIII.X Logging

Operational logs should contain only the information necessary to diagnose problems and maintain reliability.

Sensitive Homestead data should not be unnecessarily included in logs.

## VIII.XI Future Security

Notifications, third-party integrations, external APIs, and future automation should inherit the authentication and authorization model established here.

## VIII.XII Design Principle

> Security should be largely invisible during ordinary stewardship.

---

# IX. Implementation Boundaries

The initial cloud-sync implementation should remain deliberately narrow.

## Included in the first cloud-sync release

- Email and password authentication
- Create a Homestead
- Join by secure invitation
- Steward, Keeper, Hand, and Guest roles
- Cloud storage for records, tasks, events, notes, and ledger entries
- Local working copy
- Synchronization queue
- Automatic synchronization
- Basic sync status
- Row-level security
- Manual export and restore

## Deferred until later

- Embedded AI assistant
- ChatGPT Actions
- Photos and document storage
- Push notifications
- Complex conflict-resolution screens
- Multiple Homesteads per user
- Custom roles and permission matrices
- Public sharing
- Full automatic backup scheduling

Deferrals are intentional and should not be treated as omissions from the first release.

---

# X. Future Architecture

This architecture is expected to evolve through practical experience rather than speculative completeness.

New capabilities should extend the principles established here instead of replacing them.

Simplicity, stewardship, privacy, resilience, and long-term maintainability shall guide future revisions.

Changes to this document should be deliberate, reviewed, and versioned.

---

# Version History

## Version 1.0 — August 2026

Initial adopted Cloud Architecture for Regula Rustica.

Defines:

- Local-first cloud synchronization
- One Homestead per user and many users per Homestead
- Steward, Keeper, Hand, and Guest roles
- Capability-based authorization
- Shared cloud source of truth
- Data ownership and exportability
- The Cellarer AI security boundary
- Backup, recovery, privacy, and security principles
