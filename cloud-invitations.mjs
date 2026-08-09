export const INVITATION_ROLES = Object.freeze({
  steward: 'Full Homestead administration and data authority.',
  keeper: 'Trusted day-to-day management of records, tasks, Chronicle, notes, ledger, and photos.',
  hand: 'Limited participation in ordinary work, assigned tasks, approved events, and observations.',
  guest: 'Read-only access.'
});

export function invitationTokenFromUrl(value) {
  try {
    return new URL(value).searchParams.get('invitation')?.trim() || '';
  } catch {
    return '';
  }
}

export function buildInvitationLink(rawToken, pageUrl) {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('invitation', rawToken);
  return url.toString();
}

export function invitationStatus(invitation, now = new Date()) {
  if (invitation.status) return invitation.status;
  if (invitation.accepted_at) return 'accepted';
  if (invitation.revoked_at) return 'revoked';
  return new Date(invitation.expires_at) <= now ? 'expired' : 'pending';
}
