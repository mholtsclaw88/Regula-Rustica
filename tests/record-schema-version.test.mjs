import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  clear() { this.values.clear(); }
}

async function dataApi() {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const dataFoundation = source.slice(0, source.indexOf('let data = loadData();'));
  const localStorage = new MemoryStorage();
  const context = {
    Blob,
    console,
    crypto: webcrypto,
    Date,
    Intl,
    localStorage,
    structuredClone,
    URL,
    window: {
      RegulaRusticaHousekeeping: {
        historicalYieldCandidate: () => null,
        normalizeRecurrenceRule: value => value || null
      },
      RegulaRusticaTasks: {
        DEFAULT_WINDOWS: [],
        YIELD_TYPES: { milk: {}, eggs: {}, harvest: {}, hay_forage: {}, meat_harvest: {} },
        normalizeWindow: value => value
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(`${dataFoundation}\n;globalThis.__dataApi = { isSupportedData, loadData, normalizeData, prepareImportedData, storageKey: STORAGE_KEY };`, context);
  return { ...context.__dataApi, localStorage };
}

const record = (type, identity, stewardship = {}) => ({
  id: `${type.toLowerCase()}-one`,
  type,
  name: `${type} One`,
  status: 'Active',
  identity,
  stewardship,
  createdAt: '2026-08-19T12:00:00.000Z',
  updatedAt: '2026-08-19T12:00:00.000Z'
});

const currentData = records => ({
  schemaVersion: 10,
  settings: { homesteadName: 'Test Homestead' },
  records,
  tasks: [],
  people: [],
  assignments: [],
  events: [],
  notes: [],
  ledger: [],
  calendarEvents: [],
  yieldEntries: [],
  choreWindows: []
});

test('v10 Animal purposes survive normalize, persistence, and reload', async () => {
  for (const purpose of ['Dairy', 'Eggs', 'Meat']) {
    const api = await dataApi();
    const normalized = api.normalizeData(currentData([
      record('Animal', { managedAs: 'Individual', species: 'Cattle', purpose }, { location: 'North barn', responsiblePersonId: 'keeper-1' })
    ]));
    api.localStorage.setItem(api.storageKey, JSON.stringify(normalized));

    const reloaded = api.loadData();
    assert.equal(reloaded.records[0].identity.purpose, purpose);
    assert.equal(reloaded.records[0].stewardship.location, 'North barn');
    assert.equal(reloaded.records[0].stewardship.responsiblePersonId, 'keeper-1');
  }
});

test('v10 non-Animal identity fields survive persistence and reload', async () => {
  const api = await dataApi();
  const normalized = api.normalizeData(currentData([
    record('Land', { landType: 'Orchard' }),
    record('Equipment', { equipmentType: 'Tractor', make: 'Ford', model: '8N' }),
    record('Work', { workType: 'Construction', linkedRecordId: 'land-one' })
  ]));
  api.localStorage.setItem(api.storageKey, JSON.stringify(normalized));

  const [land, equipment, work] = api.loadData().records;
  assert.equal(land.identity.landType, 'Orchard');
  assert.equal(equipment.identity.make, 'Ford');
  assert.equal(equipment.identity.model, '8N');
  assert.equal(work.identity.workType, 'Construction');
  assert.equal(work.identity.linkedRecordId, 'land-one');
});

test('v5 through v9 backups remain supported and legacy data still migrates', async () => {
  const api = await dataApi();
  for (const schemaVersion of [5, 6, 7, 8, 9]) {
    const imported = api.prepareImportedData({
      ...currentData([record('Animal', { purpose: 'Dairy' }, { location: 'Milking barn' })]),
      schemaVersion
    });
    assert.equal(imported.records[0].identity.purpose, 'Dairy');
    assert.equal(imported.records[0].stewardship.location, 'Milking barn');
  }

  const migrated = api.prepareImportedData({
    records: [{ id: 'legacy-cow', type: 'Livestock', name: 'Bess', details: { kind: 'Jersey cow', purpose: 'Dairy', location: 'Old barn' } }]
  }, 'legacy-backup.json');
  assert.equal(migrated.records[0].type, 'Animal');
  assert.equal(migrated.records[0].identity.purpose, 'Dairy');
  assert.equal(migrated.records[0].stewardship.location, 'Old barn');
});
