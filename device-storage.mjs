// Large Farm Book snapshots and safety backups must not share localStorage's
// small quota with account sessions. Keep the existing JSON format unchanged.
export const DEVICE_STORAGE_KEYS = Object.freeze([
  'regulaRusticaV5', 'regulaRusticaV4', 'regulaRusticaV3',
  'regulaRusticaPreV5Backup', 'regulaRusticaBeforeImport',
  'regulaRusticaSyncV1', 'regulaRusticaSyncBackupsV1'
]);

const DB_NAME = 'regulaRusticaDeviceV1';
const STORE_NAME = 'values';

export class IndexedDbBackend {
  constructor(database) { this.database = database; }

  static open(indexedDB) {
    if (!indexedDB) return Promise.reject(new Error('Saved Farm Book storage is unavailable in this browser.'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      request.onerror = () => reject(request.error || new Error('Saved Farm Book storage could not be opened.'));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Close other Regula Rustica tabs, then reopen the app to access your saved Farm Book.'));
      };
      request.onsuccess = () => {
        const database = request.result;
        if (blocked) { database.close(); return; }
        database.onversionchange = () => database.close();
        resolve(new IndexedDbBackend(database));
      };
    });
  }

  readAll() {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAll();
      transaction.oncomplete = () => resolve(new Map(request.result.map(row => [row.key, row.value])));
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Saved Farm Book data could not be read.'));
    });
  }

  commit(values) {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(STORE_NAME, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Changes could not be saved on this device.'));
      const store = transaction.objectStore(STORE_NAME);
      for (const [key, value] of values) store.put({ key, value });
    });
  }
}

export class DeviceStorage {
  constructor({ backend, legacyStorage, onError = () => {} }) {
    this.backend = backend;
    this.legacyStorage = legacyStorage;
    this.onError = onError;
    this.values = new Map();
    this.dirty = new Map();
    this.pending = null;
  }

  async initialize() {
    this.values = await this.backend.readAll();
    const legacy = new Map();
    for (const key of DEVICE_STORAGE_KEYS) {
      const value = this.legacyStorage.getItem(key);
      if (value === null) continue;
      // A still-open older app must not silently replace the new device copy.
      if (this.values.has(key) && this.values.get(key) !== value) {
        throw new Error('Another app copy changed saved data. Download the previous browser copy below, then close other Regula Rustica tabs before reopening.');
      }
      legacy.set(key, value);
    }
    if (legacy.size) {
      await this.backend.commit(legacy);
      const verified = await this.backend.readAll();
      for (const [key, value] of legacy) {
        if (verified.get(key) !== value) throw new Error('Saved data could not be verified. The previous browser copy has been kept.');
        if (this.legacyStorage.getItem(key) !== value) throw new Error('Saved data changed in another tab. Close other Regula Rustica tabs and reopen this app.');
      }
      this.values = verified;
      // Free quota only after the entire migration committed and was read back.
      for (const key of legacy.keys()) this.legacyStorage.removeItem(key);
    }
    return this;
  }

  getItem(key) { return this.values.get(key) ?? null; }

  setItem(key, value) {
    if (!DEVICE_STORAGE_KEYS.includes(key)) throw new Error('Unrecognized Farm Book storage key.');
    const raw = String(value);
    this.values.set(key, raw);
    this.dirty.set(key, raw);
    return this.flush();
  }

  flush() {
    if (this.pending) return this.pending;
    if (!this.dirty.size) return Promise.resolve();
    // Coalesce synchronous entity/outbox edits into one transaction, retaining
    // every latest snapshot for retry if a transaction aborts.
    this.pending = Promise.resolve().then(async () => {
      try {
        while (this.dirty.size) {
          const batch = new Map(this.dirty);
          await this.backend.commit(batch);
          for (const [key, value] of batch) {
            if (this.dirty.get(key) === value) this.dirty.delete(key);
          }
        }
      } catch (error) {
        this.onError(error);
        throw error;
      } finally { this.pending = null; }
    });
    // Legacy event handlers may ignore the return value. Keep their work in
    // memory for export/retry and report failures through the shared notice.
    this.pending.catch(() => {});
    return this.pending;
  }
}

export async function openDeviceStorage({ legacyStorage = localStorage, indexedDB = globalThis.indexedDB, onError } = {}) {
  const backend = await IndexedDbBackend.open(indexedDB);
  return new DeviceStorage({ backend, legacyStorage, onError }).initialize();
}
