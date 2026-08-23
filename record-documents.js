'use strict';
(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RegulaRusticaDocuments = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const BUCKET = 'record-documents';
  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  const ALLOWED_TYPES = new Set([...IMAGE_TYPES, 'application/pdf']);
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const DB_NAME = 'regula-rustica-attachments';
  const DB_VERSION = 1;
  const BLOB_STORE = 'blobs';
  let cloudContext = null;
  let databasePromise = null;
  const signedUrls = new Map();
  const localUrls = new Map();

  const timestamp = value => value || new Date().toISOString();
  const safeFilename = value => String(value || 'attachment')
    .normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';

  function normalizeDocument(value = {}) {
    const createdAt = timestamp(value.createdAt);
    return {
      id: value.id || crypto.randomUUID(),
      recordId: value.recordId || null,
      title: value.title || '',
      body: value.body || value.text || '',
      createdAt,
      updatedAt: timestamp(value.updatedAt || createdAt),
      deletedAt: value.deletedAt || null
    };
  }

  function normalizeAttachment(value = {}) {
    const createdAt = timestamp(value.createdAt);
    return {
      id: value.id || crypto.randomUUID(),
      documentId: value.documentId || null,
      recordId: value.recordId || null,
      storagePath: value.storagePath || '',
      filename: value.filename || 'attachment',
      mimeType: value.mimeType || 'application/octet-stream',
      size: Number(value.size || 0),
      syncState: ['local', 'pending', 'synced', 'failed'].includes(value.syncState)
        ? value.syncState
        : value.storagePath ? 'synced' : 'local',
      syncError: value.syncError || '',
      createdAt,
      updatedAt: timestamp(value.updatedAt || createdAt),
      deletedAt: value.deletedAt || null
    };
  }

  function validateFile(file) {
    if (!file || !ALLOWED_TYPES.has(file.type)) throw new Error('Choose a PDF or common image file.');
    if (file.size > MAX_FILE_BYTES) throw new Error('Files must be 10 MB or smaller.');
    return true;
  }

  function setContext(context) {
    cloudContext = context?.session && context?.homesteadId ? context : null;
    signedUrls.clear();
  }

  function canSync() {
    return Boolean(typeof navigator !== 'undefined' && navigator.onLine && cloudContext?.client && cloudContext?.homesteadId);
  }

  function requireCloud() {
    if (!canSync()) throw new Error('Cloud attachment sync is unavailable.');
    return cloudContext;
  }

  function openLocalDatabase() {
    if (databasePromise) return databasePromise;
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Browser attachment storage is unavailable.'));
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(BLOB_STORE)) request.result.createObjectStore(BLOB_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Browser attachment storage could not be opened.'));
      request.onblocked = () => reject(new Error('Browser attachment storage is blocked by another open tab.'));
    });
    return databasePromise;
  }

  async function writeLocal(value) {
    const database = await openLocalDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(BLOB_STORE, 'readwrite');
      transaction.objectStore(BLOB_STORE).put(value);
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error || new Error('The attachment could not be saved on this device.'));
      transaction.onabort = () => reject(transaction.error || new Error('The attachment could not be saved on this device.'));
    });
  }

  async function readLocal(id) {
    const database = await openLocalDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(BLOB_STORE, 'readonly').objectStore(BLOB_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('The local attachment could not be read.'));
    });
  }

  async function removeLocal(ids) {
    if (!ids.length) return;
    const database = await openLocalDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(BLOB_STORE, 'readwrite');
      const store = transaction.objectStore(BLOB_STORE);
      ids.forEach(id => store.delete(id));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('The local attachment could not be deleted.'));
      transaction.onabort = () => reject(transaction.error || new Error('The local attachment could not be deleted.'));
    });
    ids.forEach(id => {
      const url = localUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      localUrls.delete(id);
    });
  }

  async function resizeImage(file) {
    validateFile(file);
    if (!IMAGE_TYPES.has(file.type) || file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file;
    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch (_) { return file; }
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === 'image/jpeg' && file.size < 2 * 1024 * 1024) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The image could not be prepared.')), 'image/jpeg', 0.82));
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  }

  async function saveLocal(file, { attachmentId, recordId }) {
    const prepared = IMAGE_TYPES.has(file.type) ? await resizeImage(file) : file;
    validateFile(prepared);
    await writeLocal({
      id: attachmentId,
      blob: prepared,
      filename: prepared.name,
      mimeType: prepared.type,
      size: prepared.size,
      updatedAt: new Date().toISOString()
    });
    return normalizeAttachment({
      id: attachmentId,
      recordId,
      filename: prepared.name,
      mimeType: prepared.type,
      size: prepared.size,
      syncState: cloudContext ? 'pending' : 'local'
    });
  }

  async function uploadStored(attachment) {
    const context = requireCloud();
    const stored = await readLocal(attachment.id);
    if (!stored?.blob) throw new Error('The local attachment copy is unavailable.');
    const path = attachment.storagePath || `homesteads/${context.homesteadId}/records/${attachment.recordId}/${attachment.id}/${safeFilename(stored.filename)}`;
    const { error } = await context.client.storage.from(BUCKET).upload(path, stored.blob, {
      cacheControl: '3600', contentType: stored.mimeType, upsert: true
    });
    if (error) throw error;
    return { storagePath: path, syncState: 'synced', syncError: '' };
  }

  async function removeRemote(storagePaths) {
    if (!storagePaths.length) return;
    const context = requireCloud();
    const { error } = await context.client.storage.from(BUCKET).remove(storagePaths);
    if (error) throw error;
    storagePaths.forEach(path => signedUrls.delete(path));
  }

  async function signedUrl(path, expiresIn = 3600) {
    if (!path) return '';
    const cached = signedUrls.get(path);
    if (cached && cached.expiresAt > Date.now() + 30000) return cached.url;
    if (!cloudContext?.client || !cloudContext?.session) return '';
    const { data, error } = await cloudContext.client.storage.from(BUCKET).createSignedUrl(path, expiresIn);
    if (error) throw error;
    signedUrls.set(path, { url: data.signedUrl, expiresAt: Date.now() + expiresIn * 1000 });
    return data.signedUrl;
  }

  async function localUrl(id) {
    const cached = localUrls.get(id);
    if (cached) return cached;
    const stored = await readLocal(id);
    if (!stored?.blob) return '';
    const url = URL.createObjectURL(stored.blob);
    localUrls.set(id, url);
    return url;
  }

  async function urlFor(attachment) {
    try {
      const url = await localUrl(attachment.id);
      if (url) return url;
    } catch (_) { /* A cloud-only attachment may not have a local blob. */ }
    return signedUrl(attachment.storagePath);
  }

  function syncLabel(attachment) {
    if (attachment.syncState === 'synced') return 'Synced';
    if (attachment.syncState === 'failed') return 'Sync failed';
    if (attachment.syncState === 'pending') return 'Sync pending';
    return 'On this device';
  }

  function profileReferenceAfterAttachmentDelete(profileAttachmentId, attachmentId) {
    return profileAttachmentId === attachmentId ? null : profileAttachmentId || null;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('regula-rustica:cloud-context', event => setContext(event.detail));
    if (window.REGULA_RUSTICA_CLOUD_CONTEXT) setContext(window.REGULA_RUSTICA_CLOUD_CONTEXT);
  }

  return Object.freeze({
    BUCKET, IMAGE_TYPES, ALLOWED_TYPES, MAX_FILE_BYTES, DB_NAME, BLOB_STORE,
    normalizeDocument, normalizeAttachment, validateFile, safeFilename,
    setContext, canSync, saveLocal, readLocal, removeLocal, uploadStored, removeRemote,
    signedUrl, localUrl, urlFor, syncLabel, profileReferenceAfterAttachmentDelete
  });
}));
