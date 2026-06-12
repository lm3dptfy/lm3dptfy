'use strict';
// Read-only price watcher: fetches a public quote (no brokerage login) and
// fires threshold-crossing alerts. Crossings use the PREVIOUS checked price, so
// a threshold only fires when the price actually moves across it — never on the
// first check, and never repeatedly while it sits past the level.

const round = (n) => Math.round(n * 100) / 100;

// Weekdays, 8am–8pm ET (covers pre/post-market for a volatile name) — cheap
// gate so we don't poll the quote API overnight or on weekends.
function inMarketWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === 'weekday').value;
  let hr = Number(parts.find((p) => p.type === 'hour').value);
  if (hr === 24) hr = 0;
  if (wd === 'Sat' || wd === 'Sun') return false;
  return hr >= 8 && hr < 20;
}

// Which thresholds the price just crossed, given the previous price.
function evaluateCrossings(thresholds, lastPrice, price) {
  const fired = [];
  if (lastPrice == null || price == null) return fired; // prime / no data -> never fire
  for (const t of thresholds || []) {
    if (t.enabled === false) continue;
    if (t.direction === 'above' && lastPrice < t.level && price >= t.level) fired.push(t);
    else if (t.direction === 'below' && lastPrice > t.level && price <= t.level) fired.push(t);
  }
  return fired;
}

// Live quote from Yahoo Finance (public, no API key, no login).
async function fetchQuote(symbol, fetchImpl = fetch) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`quote ${symbol} HTTP ${r.status}`);
  const j = await r.json();
  const meta = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error(`no price for ${symbol}`);
  return {
    price: round(meta.regularMarketPrice),
    currency: meta.currency || 'USD',
    name: meta.longName || meta.shortName || symbol,
    marketTime: meta.regularMarketTime || null,
  };
}

// Build the alert email for a fired threshold.
function alertEmail(symbol, name, price, threshold, shares = 0) {
  const posValue = shares > 0 ? round(shares * price) : null;
  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const headline = threshold.direction === 'above'
    ? `${symbol} hit ${money(threshold.level)} — now ${money(price)}`
    : `${symbol} dropped below ${money(threshold.level)} — now ${money(price)}`;
  const body = threshold.direction === 'above'
    ? `${symbol} reached your ${money(threshold.level)} sell target. If this is your exit, place the sell in Robinhood.`
    : `${symbol} fell below your ${money(threshold.level)} floor. Decide whether to cut or hold.`;
  const posLine = posValue != null
    ? `<p style="font-size:14px;margin:6px 0 0">Your ${shares} share(s): <b>${money(posValue)}</b></p>` : '';
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">
    <h2 style="margin:0 0 8px">📈 ${symbol} alert</h2>
    <div style="font-size:30px;font-weight:800;color:${threshold.direction === 'above' ? '#059669' : '#dc2626'}">${money(price)}</div>
    <p style="font-size:15px;margin:10px 0 0">${body}</p>
    ${posLine}
    <p style="color:#64748b;font-size:13px;margin:10px 0 0">${name}</p>
    <p style="color:#94a3b8;font-size:12px;margin:14px 0 0">This is a heads-up only — it does not place any trades.</p>
  </div>`;
  return { subject: headline, html };
}

module.exports = { inMarketWindow, evaluateCrossings, fetchQuote, alertEmail, round };
