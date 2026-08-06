# Regula Rustica Authentication Flow

**Version:** 1.0  
**Status:** Adopted

## Purpose

This document defines the user journey for authentication, Homestead creation, invitations, membership, and access recovery.

The flow should remain simple, private, and understandable to a family using Regula Rustica across multiple devices.

## Core Rule

One user may belong to exactly one Homestead.

One Homestead may have many users.

A user must authenticate before accessing synchronized Homestead data.

## Entry Flow

When the application opens, the user is routed according to authentication and membership state.

```text
App Opens
   |
   +-- Existing authenticated session and active Homestead membership
   |      -> Synchronize and open Today
   |
   +-- Authenticated but no Homestead membership
   |      -> Create or Join a Homestead
   |
   +-- Not authenticated
          -> Sign In or Create Account
```

## Create Account

The initial account flow requires:

- Email address
- Password
- Email verification when required by the authentication provider

After successful account creation, the user chooses:

- Create a Homestead
- Accept an existing Homestead invitation

A newly created account does not receive access to any Homestead data until one of these actions is completed.

## Sign In

A returning user signs in with:

- Email address
- Password

After authentication, the system resolves the user's Homestead membership and role before allowing access to synchronized data.

If the device has an authenticated offline session and a local working copy, ordinary offline use may continue until authentication can be refreshed.

## Create a Homestead

A user without a Homestead membership may create a new Homestead.

Required information:

- Homestead name

Upon creation:

- The Homestead is private.
- The creating user becomes its first **Steward**.
- The user is assigned to that Homestead.
- The application creates the initial synchronized data space.
- The user is taken to Today.

Every Homestead must retain at least one Steward.

## Join a Homestead

A user may join a Homestead only through a valid invitation.

Supported invitation forms:

- Email invitation
- Secure invitation link

An invitation must be:

- Random and unguessable
- Single use
- Time limited
- Revocable by a Steward
- Associated with one Homestead
- Associated with a proposed role

The default expiration period is seven days.

No public Homestead directory or open enrollment flow shall exist.

## Invitation Flow

A Steward selects **Invite Member**, provides an email address when appropriate, and chooses a role:

- Steward
- Keeper
- Hand
- Guest

The invitation screen should explain each role in plain language.

The recipient opens the invitation and then:

```text
Invitation Opened
   |
   +-- Existing account
   |      -> Sign in
   |      -> Review Homestead and assigned role
   |      -> Accept invitation
   |
   +-- New account
          -> Create account
          -> Verify email when required
          -> Review Homestead and assigned role
          -> Accept invitation
```

Upon acceptance:

- The invitation is marked used.
- The user becomes a member of the Homestead.
- The user's assigned role becomes active.
- The initial Homestead data is downloaded.
- The user is taken to Today.

If the user already belongs to another Homestead, the invitation cannot be accepted.

## Roles Displayed During Invitation

### Steward

Full Homestead administration and data authority.

### Keeper

Trusted day-to-day management of records, tasks, Chronicle, notes, ledger, and photos.

### Hand

Limited participation in ordinary work, assigned tasks, approved events, and observations.

### Guest

Read-only access.

Permissions are enforced internally through capabilities rather than direct role-name checks.

## Pending and Invalid Invitations

The application should clearly distinguish:

- Pending invitation
- Expired invitation
- Revoked invitation
- Already accepted invitation
- Invitation for an email different from the signed-in account
- User already assigned to another Homestead

Invalid invitations must not reveal private Homestead information beyond what is necessary to explain the error.

## Member Removal

A Steward may remove another member.

When removed:

- Access to cloud data ends immediately.
- Future synchronization is denied.
- The member's prior contributions remain with the Homestead.
- The local device should clear or lock cached Homestead data at the next authorization check.

The final remaining Steward cannot be removed or demoted.

## Role Changes

A Steward may change another member's role.

Role changes take effect on the server immediately and on connected devices at the next authorization refresh.

The system must prevent any action that would leave a Homestead without a Steward.

## Sign Out

Signing out ends the authenticated session on that device.

The user should be warned if unsynchronized changes remain.

The application may retain encrypted or otherwise protected local data for fast return only if the security design supports it. Otherwise, cached Homestead data should be cleared when signing out.

## Password Recovery

A user may request a password-reset link through the authentication provider.

Password recovery must not bypass Homestead membership or role checks.

After successful recovery, the user returns to the same Homestead and role previously assigned.

## Email Change

Changing an account email requires reauthentication and verification through the authentication provider.

Changing an email does not change Homestead membership, ownership of past actions, or role.

## Account Deletion

Account deletion is not part of the first cloud-sync release.

A future implementation must distinguish between:

- Removing a user from a Homestead
- Deleting an authentication account
- Transferring Steward responsibility
- Deleting an entire Homestead

No account or Homestead should be deleted without deliberate confirmation and protection against orphaning the Homestead.

## Offline Authentication Behavior

A previously authenticated device with a valid local session and local working copy should remain useful offline.

While offline, the application may allow actions already permitted by the most recently verified role.

Those actions remain queued until connectivity returns and the server confirms membership and authorization.

If membership was revoked while the device was offline, queued writes must be rejected safely when synchronization resumes.

## Security Requirements

- Every user has an individual account.
- Accounts are never shared.
- Homesteads are private by default.
- Invitations are single use and expire.
- Every request verifies authentication, Homestead membership, and capability.
- Client-side checks improve usability but never replace server-side authorization.
- Authentication secrets and service credentials are never stored in client code.

## First Release Scope

The first cloud-sync authentication release includes:

- Create account
- Sign in
- Sign out
- Password recovery
- Create Homestead
- Invite by email or secure link
- Accept invitation
- Steward, Keeper, Hand, and Guest roles
- Member removal
- Role changes
- Final-Steward protection
- Offline continuation for previously authenticated devices

The first release excludes:

- Social login providers
- Public Homestead discovery
- Multiple Homesteads per user
- Custom roles
- Custom permission matrices
- Account deletion
- Homestead deletion
- Transfer between Homesteads

## Acceptance Criteria

The authentication flow is ready for implementation when:

1. A new user can create an account and a Homestead.
2. The creator becomes the first Steward.
3. A Steward can invite another person with a selected role.
4. A new or existing user can accept a valid invitation.
5. A user cannot belong to more than one Homestead.
6. Removed members lose access without deleting their historical contributions.
7. The final Steward cannot be removed or demoted.
8. Signed-in users are routed directly to their Homestead.
9. Previously authenticated devices can continue ordinary offline work.
10. All cloud access is enforced by server-side membership and capability checks.

## Version History

### Version 1.0 — August 2026

Initial adopted authentication and Homestead membership flow.
