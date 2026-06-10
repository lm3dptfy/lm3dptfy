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
  url.searchParams.set('pending', '1'); // include pending so we can compute true available
  const headers = {};
  if (auth) headers.Authorization = auth;
  const res = await fetchImpl(url.toString(), { headers });
  if (!res.ok) throw new Error(`SimpleFIN fetch failed: ${res.status}`);
  return await res.json();
}

// Per-account balances. Available = posted balance minus pending charges
// (computed from pending transactions, since banks like USAA report available
// equal to posted and don't subtract pending themselves).
function accountsBalance(accountSet) {
  const r = (n) => Math.round(n * 100) / 100;
  const accounts = [];
  let balance = 0, date = null;
  for (const a of accountSet.accounts || []) {
    const bal = Number(a.balance) || 0;
    let pending = 0;
    for (const t of a.transactions || []) if (t.pending) pending += Number(t.amount) || 0;
    balance += bal;
    if (a['balance-date'] && (!date || a['balance-date'] > date)) date = a['balance-date'];
    accounts.push({ id: String(a.id || ''), name: String(a.name || (a.org && a.org.name) || 'Account'), balance: r(bal), available: r(bal + pending), pending: r(pending) });
  }
  return { balance: r(balance), date, accounts };
}

function simplefinToTransactions(accountSet) {
  const out = [];
  for (const account of accountSet.accounts || []) {
    for (const t of account.transactions || []) {
      if (t.pending) continue; // don't store pending — they re-post with final values
      const date = new Date(Number(t.posted) * 1000).toISOString().slice(0, 10);
      const amount = Math.round(Number(t.amount) * 100) / 100;
      const description = String(t.description || '').trim();
      const id = createHash('sha1').update(`${date}|${amount}|${description}`).digest('hex');
      out.push({ id, date, description, amount, category: 'Uncategorized' });
    }
  }
  return out;
}

module.exports = { claimAccessUrl, fetchSimplefinAccounts, simplefinToTransactions, accountsBalance };
