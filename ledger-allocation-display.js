'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RegulaRusticaLedgerAllocations = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function activeForEntry(data, entryId) {
    return (data?.ledgerAllocations || []).filter(allocation => !allocation.deletedAt && allocation.ledgerEntryId === entryId);
  }

  function entryAllocationSummary(data, entry) {
    const allocations = activeForEntry(data, entry.id);
    const items = allocations.map(allocation => ({
      allocation,
      record: (data.records || []).find(record => !record.deletedAt && record.id === allocation.recordId) || null,
      amount: Number(allocation.amount || 0)
    }));
    return {
      items,
      allocated: items.reduce((sum, item) => sum + item.amount, 0),
      unallocated: Math.max(0, Number(entry.amount || 0) - items.reduce((sum, item) => sum + item.amount, 0))
    };
  }

  function entriesForRecord(data, recordId) {
    return (data?.ledger || []).filter(entry => !entry.deletedAt).flatMap(entry => {
      const allocations = activeForEntry(data, entry.id);
      if (!allocations.length) {
        return entry.recordId === recordId
          ? [{ entry, amount: Number(entry.amount || 0), allocated: false, allocations: [] }]
          : [];
      }
      const matching = allocations.filter(allocation => allocation.recordId === recordId);
      if (!matching.length) return [];
      return [{
        entry,
        amount: matching.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0),
        allocated: true,
        allocations: matching
      }];
    });
  }

  function totalsForRecord(items) {
    const expenses = items.filter(item => item.entry.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
    const income = items.filter(item => item.entry.type === 'income').reduce((sum, item) => sum + item.amount, 0);
    return { expenses, income, net: income - expenses };
  }

  return { activeForEntry, entryAllocationSummary, entriesForRecord, totalsForRecord };
}));
