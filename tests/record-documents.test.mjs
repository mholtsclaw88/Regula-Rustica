import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { COLLECTIONS, DOMAIN_ORDER, attachmentCloudReady, fromCloud, operationOrder, toCloud } from '../sync/entities.mjs';

const require = createRequire(import.meta.url);
const documents = require('../record-documents.js');
const state = {
  entity: (table, id) => ({ cloudId: id ? `cloud-${table}-${id}` : null }),
  localIdForCloud: (table, id) => id?.replace(`cloud-${table}-`, '')
};

function installFakeIndexedDb() {
  const rows = new Map();
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction: () => {
      const transaction = {
        objectStore: () => ({
          put: value => rows.set(value.id, value),
          delete: id => rows.delete(id),
          get: id => {
            const request = {};
            setImmediate(() => { request.result = rows.get(id); request.onsuccess?.(); });
            return request;
          }
        })
      };
      setImmediate(() => transaction.oncomplete?.());
      return transaction;
    }
  };
  globalThis.indexedDB = {
    open: () => {
      const request = { result: database };
      setImmediate(() => request.onsuccess?.());
      return request;
    }
  };
}

test('document and attachment metadata normalize without binary payloads', () => {
  const entry = documents.normalizeDocument({ id: 'doc-1', recordId: 'daisy', title: 'Registration', body: 'Renew in April' });
  const attachment = documents.normalizeAttachment({ id: 'file-1', documentId: entry.id, recordId: 'daisy', storagePath: 'homesteads/h/records/daisy/file-1/registration.pdf', filename: 'registration.pdf', mimeType: 'application/pdf', size: 4200 });
  assert.equal(entry.body, 'Renew in April');
  assert.equal(attachment.size, 4200);
  assert.equal(attachment.syncState, 'synced');
  assert.equal('payload' in attachment || 'base64' in attachment || 'file' in attachment, false);
});

test('local attachments retain stable identity and quiet sync state without binary metadata', () => {
  const attachment = documents.normalizeAttachment({ id: 'file-local', documentId: 'doc-1', recordId: 'daisy', filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1000 });
  assert.equal(attachment.id, 'file-local');
  assert.equal(attachment.storagePath, '');
  assert.equal(attachment.syncState, 'local');
  assert.equal(documents.syncLabel(attachment), 'On this device');
  assert.equal(attachmentCloudReady(attachment), false);
  assert.equal(attachmentCloudReady({ ...attachment, storagePath: 'homesteads/h/file-local', syncState: 'synced' }), true);
  assert.equal('blob' in attachment || 'base64' in attachment, false);
});

test('profile reference clears only when its active attachment is deleted', () => {
  assert.equal(documents.profileReferenceAfterAttachmentDelete('photo-1', 'photo-1'), null);
  assert.equal(documents.profileReferenceAfterAttachmentDelete('photo-1', 'photo-2'), 'photo-1');
});

test('document domains retain dependency order and cloud references', () => {
  assert.ok(DOMAIN_ORDER.indexOf('records') < DOMAIN_ORDER.indexOf('record_documents'));
  assert.ok(DOMAIN_ORDER.indexOf('record_documents') < DOMAIN_ORDER.indexOf('record_attachments'));
  assert.equal(COLLECTIONS.record_documents, 'documents');
  assert.equal(COLLECTIONS.record_attachments, 'attachments');
  const cloudDocument = toCloud('record_documents', { id: 'doc-1', recordId: 'daisy', title: 'Vet note', body: 'Healthy', createdAt: '2026-08-20T00:00:00Z' }, state);
  const cloudAttachment = toCloud('record_attachments', { id: 'file-1', documentId: 'doc-1', recordId: 'daisy', storagePath: 'homesteads/h/records/daisy/file-1/photo.jpg', filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1000, createdAt: '2026-08-20T00:00:00Z' }, state);
  assert.equal(cloudDocument.record_id, 'cloud-records-daisy');
  assert.equal(cloudAttachment.document_id, 'cloud-record_documents-doc-1');
  assert.equal(cloudAttachment.record_id, 'cloud-records-daisy');
  const local = fromCloud('record_attachments', { id: 'cloud-record_attachments-file-1', document_id: cloudAttachment.document_id, record_id: cloudAttachment.record_id, storage_path: cloudAttachment.storage_path, file_name: 'photo.jpg', mime_type: 'image/jpeg', file_size_bytes: 1000, created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z' }, state);
  assert.equal(local.documentId, 'doc-1');
  assert.equal(local.recordId, 'daisy');
});

test('record profile photo maps by attachment identity without duplicating the file', () => {
  const cloud = toCloud('records', { id: 'daisy', type: 'Animal', name: 'Daisy', status: 'Active', identity: {}, stewardship: {}, profilePhotoAttachmentId: 'file-1', createdAt: '2026-08-20T00:00:00Z' }, state);
  assert.equal(cloud.primary_photo_id, 'cloud-record_attachments-file-1');
  assert.equal(Object.keys(cloud).some(key => /file|payload|base64/i.test(key) && key !== 'primary_photo_id'), false);
  const local = fromCloud('records', { ...cloud, type: 'animal', created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z' }, state);
  assert.equal(local.profilePhotoAttachmentId, 'file-1');
});

test('setting a profile photo waits for attachment metadata creation', () => {
  const attachmentCreate = { table: 'record_attachments', type: 'create', payload: {} };
  const profileUpdate = { table: 'records', type: 'update', payload: { primary_photo_id: 'cloud-record_attachments-file-1' } };
  assert.ok(operationOrder(profileUpdate) > operationOrder(attachmentCreate));
});

test('file validation accepts supported images/PDFs and rejects unsupported or oversized files', () => {
  assert.equal(documents.validateFile({ type: 'application/pdf', size: 100 }), true);
  assert.equal(documents.validateFile({ type: 'image/webp', size: 100 }), true);
  assert.throws(() => documents.validateFile({ type: 'text/plain', size: 100 }), /PDF or common image/);
  assert.throws(() => documents.validateFile({ type: 'image/jpeg', size: documents.MAX_FILE_BYTES + 1 }), /10 MB/);
});

test('IndexedDB keeps the local copy through cloud upload failure and retries by stable ID', async () => {
  installFakeIndexedDb();
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  const file = new Blob(['%PDF-local'], { type: 'application/pdf' });
  Object.defineProperty(file, 'name', { value: 'local.pdf' });
  Object.defineProperty(file, 'lastModified', { value: 1 });
  const uploads = [];
  let fail = true;
  const client = { storage: { from: () => ({
    upload: async (path, blob, options) => {
      uploads.push({ path, blob, options });
      return fail ? { error: new Error('network unavailable') } : { error: null };
    }
  }) } };
  documents.setContext({ client, session: { user: {} }, homesteadId: 'home-1' });
  const attachment = await documents.saveLocal(file, { attachmentId: 'stable-file-id', recordId: 'daisy' });
  assert.equal(attachment.id, 'stable-file-id');
  await assert.rejects(documents.uploadStored(attachment), /network unavailable/);
  assert.equal((await documents.readLocal(attachment.id)).blob.size, file.size);
  fail = false;
  const synced = await documents.uploadStored(attachment);
  assert.match(synced.storagePath, /stable-file-id\/local\.pdf$/);
  assert.equal(uploads.at(-1).options.upsert, true);
});
