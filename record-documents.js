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
  let cloudContext = null;
  const signedUrls = new Map();

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

  function requireCloud() {
    if (!navigator.onLine) throw new Error('Attachments cannot be uploaded while offline. Notes without files still work offline.');
    if (!cloudContext?.client || !cloudContext?.homesteadId) throw new Error('Connect this Homestead to cloud sync before adding files.');
    return cloudContext;
  }

  async function resizeImage(file) {
    validateFile(file);
    if (!IMAGE_TYPES.has(file.type) || file.type === 'image/gif') return file;
    const bitmap = await createImageBitmap(file);
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

  async function upload(file, { attachmentId, recordId }) {
    const context = requireCloud();
    const prepared = IMAGE_TYPES.has(file.type) ? await resizeImage(file) : file;
    validateFile(prepared);
    const path = `homesteads/${context.homesteadId}/records/${recordId}/${attachmentId}/${safeFilename(prepared.name)}`;
    const { error } = await context.client.storage.from(BUCKET).upload(path, prepared, {
      cacheControl: '3600', contentType: prepared.type, upsert: false
    });
    if (error) throw error;
    return normalizeAttachment({ id: attachmentId, recordId, storagePath: path, filename: prepared.name, mimeType: prepared.type, size: prepared.size });
  }

  async function remove(storagePaths) {
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

  function profileReferenceAfterAttachmentDelete(profileAttachmentId, attachmentId) {
    return profileAttachmentId === attachmentId ? null : profileAttachmentId || null;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('regula-rustica:cloud-context', event => setContext(event.detail));
    if (window.REGULA_RUSTICA_CLOUD_CONTEXT) setContext(window.REGULA_RUSTICA_CLOUD_CONTEXT);
  }

  return Object.freeze({
    BUCKET, IMAGE_TYPES, ALLOWED_TYPES, MAX_FILE_BYTES,
    normalizeDocument, normalizeAttachment, validateFile, safeFilename,
    setContext, upload, remove, signedUrl, profileReferenceAfterAttachmentDelete
  });
}));
