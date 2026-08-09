import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITATION_ROLES,
  buildInvitationLink,
  invitationStatus,
  invitationTokenFromUrl
} from '../cloud-invitations.mjs';

test('reads a private invitation token without accepting it', () => {
  assert.equal(invitationTokenFromUrl('https://example.test/?invitation=abc123'), 'abc123');
  assert.equal(invitationTokenFromUrl('not a url'), '');
});

test('builds a same-page invitation link without unrelated query data', () => {
  assert.equal(
    buildInvitationLink('private-token', 'https://example.test/settings?old=value#section'),
    'https://example.test/settings?invitation=private-token'
  );
});

test('derives invitation lifecycle status in a safe order', () => {
  const now = new Date('2026-08-09T12:00:00Z');
  assert.equal(invitationStatus({ status: 'pending' }, now), 'pending');
  assert.equal(invitationStatus({ accepted_at: '2026-08-08', revoked_at: '2026-08-07' }, now), 'accepted');
  assert.equal(invitationStatus({ revoked_at: '2026-08-08' }, now), 'revoked');
  assert.equal(invitationStatus({ expires_at: '2026-08-09T11:59:59Z' }, now), 'expired');
  assert.equal(invitationStatus({ expires_at: '2026-08-09T12:00:01Z' }, now), 'pending');
});

test('provides plain-language descriptions for every supported role', () => {
  assert.deepEqual(Object.keys(INVITATION_ROLES).sort(), ['guest', 'hand', 'keeper', 'steward']);
});
