'use strict';
// JSON-file store for the finance section (CommonJS port).
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

const DEFAULTS = {
  settings: { expectedMonthlyIncome: 0, savingsTargetMonthly: 0 },
  transactions: [],
  simplefin: { accessUrl: null, lastSync: null },
  retirement: {
    settings: { currentAge: 0, retirementAge: 0, monthlyContribution: null, goalAmount: null },
    snapshots: [],
  },
};

function createStore(path) {
  function load() {
    if (!existsSync(path)) return structuredClone(DEFAULTS);
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      const base = structuredClone(DEFAULTS);
      return {
        ...base,
        ...parsed,
        simplefin: { ...base.simplefin, ...(parsed.simplefin || {}) },
        retirement: { ...base.retirement, ...(parsed.retirement || {}) },
      };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }
  let data = load();
  function persist() {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
  }
  return {
    getSettings: () => data.settings,
    setSettings: (s) => { data.settings = { ...data.settings, ...s }; persist(); },
    getTransactions: () => data.transactions,
    addTransactions: (txns) => {
      const seen = new Set(data.transactions.map((t) => t.id));
      for (const t of txns) if (!seen.has(t.id)) { data.transactions.push(t); seen.add(t.id); }
      persist();
    },
    getSimplefin: () => data.simplefin,
    setSimplefin: (s) => { data.simplefin = { ...data.simplefin, ...s }; persist(); },
    getRetirementSettings: () => data.retirement.settings,
    setRetirementSettings: (s) => { data.retirement.settings = { ...data.retirement.settings, ...s }; persist(); },
    getSnapshots: () => data.retirement.snapshots,
    addSnapshot: (snap) => {
      data.retirement.snapshots = data.retirement.snapshots.filter((x) => x.date !== snap.date);
      data.retirement.snapshots.push(snap);
      data.retirement.snapshots.sort((a, b) => a.date.localeCompare(b.date));
      persist();
    },
  };
}

module.exports = { createStore };
