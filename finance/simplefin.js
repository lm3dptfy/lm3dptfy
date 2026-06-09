'use strict';
// SimpleFIN read-only client (CommonJS port).
const { createHash } = require('node:crypto');

async function claimAccessUrl(setupToken, fetchImpl = fetch) {
  const url = Buffer.from(setupToken, 'base64').toString('utf8').trim();
  const res = await fetchImpl(url, { method: 'POST' });
  if (!res.ok) throw new Error(`SimpleFIN claim failed: ${res.status}`);
  return (await res.text()).trim();
}

function splitAuth(accessUrl) {
  const u = new URL(accessUrl);
  const auth = u.username
    ? 'Basic ' + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')
    : null;
  u.username = ''; u.password = '';
  return { base: u.toString().replace(/\/$/, ''), auth };
}

async function fetchSimplefinAccounts(accessUrl, { startDate, fetchImpl = fetch } = {}) {
  const { base, auth } = splitAuth(accessUrl);
  const url = new URL(base + '/accounts');
  if (startDate) url.searchParams.set('start-date', String(startDate));
  const headers = {};
  if (auth) headers.Authorization = auth;
  const res = await fetchImpl(url.toString(), { headers });
  if (!res.ok) throw new Error(`SimpleFIN fetch failed: ${res.status}`);
  return await res.json();
}

function simplefinToTransactions(accountSet) {
  const out = [];
  for (const account of accountSet.accounts || []) {
    for (const t of account.transactions || []) {
      const date = new Date(Number(t.posted) * 1000).toISOString().slice(0, 10);
      const amount = Math.round(Number(t.amount) * 100) / 100;
      const description = String(t.description || '').trim();
      const id = createHash('sha1').update(`${date}|${amount}|${description}`).digest('hex');
      out.push({ id, date, description, amount, category: 'Uncategorized' });
    }
  }
  return out;
}

module.exports = { claimAccessUrl, fetchSimplefinAccounts, simplefinToTransactions };
