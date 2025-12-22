// server.js
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Static files normally live in /public. Some environments flatten files at the repo root.
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC_DIR = fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : __dirname;

// Trust proxy (Render/Heroku/etc.) so secure cookies work behind HTTPS proxies
app.set('trust proxy', 1);

// ========== ADMIN / EMAIL CONFIG =================================

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'lm3dptfy+admin@gmail.com';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'lm3dptfy@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error('ERROR: ADMIN_PASSWORD not set in environment variables!');
  process.exit(1);
}

// Resend HTTP email API (no SMTP)
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'LM3DPTFY <no-reply@lm3dptfy.online>';
const EMAIL_ENABLED = !!RESEND_API_KEY;

// Sheets
const GOOGLE_SHEET_ID =
  process.env.GOOGLE_SHEET_ID || '1IAwz8OtfuwSOSQJDIyOuwB_PI_ugHlEzvGKE_uUo2HI';
const ACTIVE_SHEET_NAME = process.env.GOOGLE_ACTIVE_SHEET || 'Active';
const ARCHIVED_SHEET_NAME = process.env.GOOGLE_ARCHIVED_SHEET || 'Archived';
const SETTINGS_SHEET_NAME = process.env.GOOGLE_SETTINGS_SHEET || 'Settings';

// Original 9 columns + appended 2 columns (safe — no shifting)
const SHEET_HEADER = [
  'ID',
  'Created',
  'Name',
  'Email',
  'STL Link',
  'Details',
  'Status',
  'Fulfilled By',
  'Archived',
  'Admin Notes',
  'Tracking #',
];

// internal status codes
const VALID_STATUSES = [
  'new',
  'responded',
  'quote_approved',
  'sent_to_printer',
  'print_complete',
  'qc_complete',
  'shipped',
  'paid',
];

// mapping internal → pretty-for-sheets
const STATUS_LABELS = {
  new: 'New',
  responded: 'Responded',
  quote_approved: 'Quote approved',
  sent_to_printer: 'Sent to printer',
  print_complete: 'Print complete',
  qc_complete: 'QC complete',
  shipped: 'Shipped',
  paid: 'Paid',
};

function statusToSheet(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.new;
}

function sheetToStatus(value) {
  if (!value) return 'new';
  const norm = String(value).trim().toLowerCase().replace(/[_\s]+/g, '_');
  return VALID_STATUSES.includes(norm) ? norm : 'new';
}

// ========== SETTINGS (FULFILLERS + SUPPORTED SITES) ===============

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const REQUESTS_CACHE_FILE = path.join(__dirname, 'requests-cache.json');

function slugify(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function normalizeHost(host) {
  return String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\s+/g, '');
}

function defaultSettings() {
  return {
    fulfilledByNames: ['Robert', 'Jared', 'Terence'],
    supportedSites: [
      {
        id: 'stlflix',
        name: 'STLFlix',
        hosts: ['stlflix.com', 'platform.stlflix.com'],
        browseUrl: 'https://platform.stlflix.com/explore',
        enabled: true,
      },
    ],
  };
}

let settings = defaultSettings();

function sanitizeFulfillers(names) {
  const arr = Array.isArray(names) ? names : [];
  const clean = arr
    .map((x) => String(x || '').trim())
    .filter((x) => x.length > 0)
    .slice(0, 30);

  const out = [];
  const seen = new Set();
  for (const n of clean) {
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function sanitizeSites(sites) {
  const arr = Array.isArray(sites) ? sites : [];
  const out = [];
  const seenIds = new Set();

  for (const s of arr) {
    const name = String(s?.name || '').trim();
    if (!name) continue;

    let id = String(s?.id || '').trim();
    if (!id) id = slugify(name);
    id = slugify(id);
    if (!id) continue;

    let finalId = id;
    let i = 2;
    while (seenIds.has(finalId)) {
      finalId = `${id}-${i++}`;
    }
    seenIds.add(finalId);

    const hostsRaw = Array.isArray(s?.hosts) ? s.hosts : [];
    const hosts = hostsRaw
      .map(normalizeHost)
      .filter(Boolean)
      .slice(0, 30);

    const hostSet = Array.from(new Set(hosts));

    const browseUrl = String(s?.browseUrl || '').trim();
    const enabled = typeof s?.enabled === 'boolean' ? s.enabled : true;

    out.push({
      id: finalId,
      name,
      hosts: hostSet,
      browseUrl: browseUrl || '',
      enabled,
    });
  }

  return out;
}

function mergeSettings(incoming) {
  const base = defaultSettings();

  const merged = {
    fulfilledByNames: sanitizeFulfillers(incoming?.fulfilledByNames ?? base.fulfilledByNames),
    supportedSites: sanitizeSites(incoming?.supportedSites ?? base.supportedSites),
  };

  if (!merged.fulfilledByNames.length) merged.fulfilledByNames = base.fulfilledByNames;
  if (!merged.supportedSites.length) merged.supportedSites = base.supportedSites;

  return merged;
}

function detectSourceFromLink(urlStr, sites) {
  const link = String(urlStr || '').trim();
  if (!link) return { name: 'Unknown', supported: false };

  let u;
  try {
    u = new URL(link);
  } catch {
    return { name: 'Unknown', supported: false };
  }

  const host = normalizeHost(u.hostname);
  for (const site of sites || []) {
    if (!Array.isArray(site.hosts)) continue;
    if (site.hosts.map(normalizeHost).includes(host)) {
      return { name: site.name, supported: !!site.enabled };
    }
    for (const h of site.hosts.map(normalizeHost)) {
      if (h && host.endsWith('.' + h)) {
        return { name: site.name, supported: !!site.enabled };
      }
    }
  }

  return { name: 'Unknown', supported: false };
}

function loadSettingsFromFile() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return;
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    settings = mergeSettings(parsed);
    console.log('Loaded settings from settings.json.');
  } catch (err) {
    console.warn('Failed to load settings from settings.json:', err?.message || err);
  }
}

function writeSettingsToFile() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.warn('Failed to write settings.json:', err?.message || err);
  }
}

// ========== GLOBAL STATE =========================================

let requests = [];

function loadRequestsFromFile() {
  try {
    if (!fs.existsSync(REQUESTS_CACHE_FILE)) return;
    const raw = fs.readFileSync(REQUESTS_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      requests = parsed;
      console.log(`Loaded ${requests.length} requests from requests-cache.json.`);
    }
  } catch (err) {
    console.warn('Failed to load requests-cache.json:', err?.message || err);
  }
}

function writeRequestsToFile() {
  try {
    fs.writeFileSync(REQUESTS_CACHE_FILE, JSON.stringify(requests, null, 2), 'utf8');
  } catch (err) {
    console.warn('Failed to write requests-cache.json:', err?.message || err);
  }
}

// ========== GOOGLE SHEETS CLIENT =================================

let sheetsClient = null;

if (process.env.GOOGLE_SERVICE_ACCOUNT) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.JWT(
      credentials.client_email,
      null,
      credentials.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('Google Sheets integration enabled.');
  } catch (err) {
    console.error('Failed to initialize Google Sheets client:', err);
  }
} else {
  console.log('GOOGLE_SERVICE_ACCOUNT not set. Google Sheets integration disabled.');
}

// ========== EMAIL VIA RESEND =====================================

async function sendNotificationEmail(newRequest) {
  if (!EMAIL_ENABLED) {
    console.warn('RESEND_API_KEY not set; skipping notification email.');
    return;
  }

  const { name, email, stlLink, details } = newRequest;
  const src = detectSourceFromLink(stlLink, settings.supportedSites);

  const subject = `New LM3DPTFY quote request from ${name}`;
  const html = `
    <h2>New Quote Request</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
    <p><strong>Model link:</strong> <a href="${stlLink}">${stlLink}</a></p>
    <p><strong>Detected source:</strong> ${src.name}${src.supported ? '' : ' (not on supported list)'}</p>
    <p><strong>Details:</strong> ${details || '(none)'}</p>
    <p><a href="${process.env.BACKEND_URL || 'https://www.lm3dptfy.online'}/admin.html">View in Admin Panel</a></p>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: NOTIFY_EMAIL,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Resend error ${res.status}: ${txt}`);
    }

    console.log('Admin notification email sent successfully via Resend.');
  } catch (err) {
    console.error('Error sending admin notification email via Resend:', err);
  }
}

// ========== EXPRESS MIDDLEWARE ===================================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_in_production';

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  })
);

// IMPORTANT: force homepage to index.html (prevents admin becoming root)
app.get('/', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

app.get('/admin', (req, res) => res.redirect('/admin.html'));

app.use(express.static(STATIC_DIR));

// ========== HELPERS ==============================================

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin && req.session.admin.email === ADMIN_EMAIL) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function validateStatus(status) {
  return VALID_STATUSES.includes(status);
}

function parseCreatedToIso(created) {
  if (!created) return new Date().toISOString();
  const parsed = Date.parse(created);
  if (Number.isNaN(parsed)) return new Date().toISOString();
  return new Date(parsed).toISOString();
}

function mapRowToRequest(row) {
  const id = row[0];
  if (!id) return null;

  const created = row[1];
  const name = row[2];
  const email = row[3];
  const stlLink = row[4];
  const details = row[5];
  const statusRaw = row[6];
  const fulfilledBy = row[7];
  const archivedText = row[8];

  const adminNotes = row[9] || '';
  const trackingNumber = row[10] || '';

  const createdAt = parseCreatedToIso(created);

  const archived =
    String(archivedText).trim().toLowerCase() === 'yes' ||
    String(archivedText).trim().toLowerCase() === 'true';

  const status = sheetToStatus(statusRaw);

  return {
    id: String(id),
    name: name || '',
    email: email || '',
    stlLink: stlLink || '',
    details: details || '',
    status,
    fulfilledBy: fulfilledBy || '',
    archived,
    adminNotes: adminNotes || '',
    trackingNumber: trackingNumber || '',
    createdAt,
    updatedAt: new Date().toISOString(),
  };
}

function requestToRow(reqObj) {
  const createdDate = new Date(reqObj.createdAt);
  const createdDisplay = Number.isNaN(createdDate.getTime())
    ? reqObj.createdAt || ''
    : createdDate.toLocaleString();

  return [
    reqObj.id,
    createdDisplay,
    reqObj.name || '',
    reqObj.email || '',
    reqObj.stlLink || '',
    reqObj.details || '',
    statusToSheet(reqObj.status || 'new'),
    reqObj.fulfilledBy || '',
    reqObj.archived ? 'Yes' : 'No',
    reqObj.adminNotes || '',
    reqObj.trackingNumber || '',
  ];
}

// ========== SHEETS <-> MEMORY SYNC ===============================

async function ensureHeader(sheetName) {
  const existing = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!A1:K1`,
  });

  const current = (existing.data.values && existing.data.values[0]) ? existing.data.values[0] : [];

  if (!current.length || current.join('') === '' || current.length < SHEET_HEADER.length) {
    const merged = [...current];
    for (let i = 0; i < SHEET_HEADER.length; i++) {
      if (!merged[i]) merged[i] = SHEET_HEADER[i];
    }

    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [merged] },
    });

    console.log(`Initialized/extended header row on sheet "${sheetName}".`);
  }
}

async function loadRequestsFromSheet() {
  if (!sheetsClient) {
    console.warn('Google Sheets client not initialized; cannot load requests.');
    return false;
  }

  try {
    await Promise.all([ensureHeader(ACTIVE_SHEET_NAME), ensureHeader(ARCHIVED_SHEET_NAME)]);

    const [activeRes, archivedRes] = await Promise.all([
      sheetsClient.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${ACTIVE_SHEET_NAME}!A1:K10000`,
      }),
      sheetsClient.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${ARCHIVED_SHEET_NAME}!A1:K10000`,
      }),
    ]);

    const activeValues = activeRes.data.values || [];
    const archivedValues = archivedRes.data.values || [];

    const activeRows = activeValues.slice(1);
    const archivedRows = archivedValues.slice(1);

    const activeRequests = activeRows.map(mapRowToRequest).filter(Boolean).map((r) => ({ ...r, archived: false }));
    const archivedRequests = archivedRows.map(mapRowToRequest).filter(Boolean).map((r) => ({ ...r, archived: true }));

    requests = [...activeRequests, ...archivedRequests].sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      return tb - ta;
    });

    writeRequestsToFile();
    console.log(`Loaded ${requests.length} requests from Sheets.`);
    return true;
  } catch (err) {
    console.error('Error loading requests from Google Sheets:', err);
    return false;
  }
}

async function writeAllRequestsToSheet() {
  if (!sheetsClient) return false;

  const active = requests.filter((r) => !r.archived);
  const archived = requests.filter((r) => r.archived);

  const activeValues = [SHEET_HEADER, ...active.map(requestToRow)];
  const archivedValues = [SHEET_HEADER, ...archived.map(requestToRow)];

  await Promise.all([
    sheetsClient.spreadsheets.values.clear({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${ACTIVE_SHEET_NAME}!A2:K10000`,
    }),
    sheetsClient.spreadsheets.values.clear({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${ARCHIVED_SHEET_NAME}!A2:K10000`,
    }),
  ]);

  await Promise.all([
    sheetsClient.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${ACTIVE_SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: activeValues },
    }),
    sheetsClient.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${ARCHIVED_SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: archivedValues },
    }),
  ]);

  writeRequestsToFile();
  console.log(`Synced to Sheets: ${active.length} active, ${archived.length} archived.`);
  return true;
}

// ========== SETTINGS SHEET SYNC ==================================

async function getSheetTitles() {
  const meta = await sheetsClient.spreadsheets.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    fields: 'sheets.properties.title',
  });
  return (meta.data.sheets || []).map((s) => s.properties.title);
}

async function ensureSheetTab(title) {
  const titles = await getSheetTitles();
  if (titles.includes(title)) return;

  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });

  console.log(`Created sheet tab "${title}".`);
}

async function ensureSettingsHeader() {
  await ensureSheetTab(SETTINGS_SHEET_NAME);

  const existing = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SETTINGS_SHEET_NAME}!A1:B1`,
  });

  const row = (existing.data.values && existing.data.values[0]) ? existing.data.values[0] : [];
  if (row[0] !== 'Key' || row[1] !== 'Value') {
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SETTINGS_SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Key', 'Value']] },
    });
  }
}

async function loadSettingsFromSheet() {
  if (!sheetsClient) return false;

  try {
    await ensureSettingsHeader();

    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SETTINGS_SHEET_NAME}!A2:B200`,
    });

    const rows = res.data.values || [];
    const map = new Map();
    for (const r of rows) {
      const k = String(r[0] || '').trim();
      const v = String(r[1] || '').trim();
      if (!k) continue;
      map.set(k, v);
    }

    const incoming = {};

    if (map.has('fulfilledByNames')) {
      try { incoming.fulfilledByNames = JSON.parse(map.get('fulfilledByNames')); } catch {}
    }

    if (map.has('supportedSites')) {
      try { incoming.supportedSites = JSON.parse(map.get('supportedSites')); } catch {}
    }

    settings = mergeSettings(incoming);
    writeSettingsToFile();

    console.log('Loaded settings from Sheets.');
    return true;
  } catch (err) {
    console.warn('Failed to load settings from Sheets:', err?.message || err);
    return false;
  }
}

async function writeSettingsToSheet() {
  if (!sheetsClient) return false;

  await ensureSettingsHeader();

  const values = [
    ['Key', 'Value'],
    ['fulfilledByNames', JSON.stringify(settings.fulfilledByNames)],
    ['supportedSites', JSON.stringify(settings.supportedSites)],
  ];

  await sheetsClient.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SETTINGS_SHEET_NAME}!A2:B200`,
  });

  await sheetsClient.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${SETTINGS_SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  return true;
}

async function saveSettings() {
  settings = mergeSettings(settings);
  writeSettingsToFile();
  if (sheetsClient) {
    writeSettingsToSheet().catch((e) => console.warn('Failed to write settings to Sheets:', e?.message || e));
  }
}

// ========== EXPORT HELPERS =======================================

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function requestsToCsv(rows) {
  const header = [
    'ID',
    'Created',
    'Name',
    'Email',
    'Model Link',
    'Details',
    'Status',
    'Fulfilled By',
    'Archived',
    'Admin Notes',
    'Tracking #',
  ];

  const lines = [header.join(',')];
  for (const r of rows) {
    const createdDisplay = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
    const line = [
      r.id,
      createdDisplay,
      r.name,
      r.email,
      r.stlLink,
      r.details,
      statusToSheet(r.status),
      r.fulfilledBy,
      r.archived ? 'Yes' : 'No',
      r.adminNotes,
      r.trackingNumber,
    ].map(csvEscape);
    lines.push(line.join(','));
  }
  return lines.join('\n');
}

// ========== ROUTES ===============================================

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || 'development',
    adminEmail: ADMIN_EMAIL,
    notifyEmail: NOTIFY_EMAIL,
    sheetId: GOOGLE_SHEET_ID,
    emailEnabled: EMAIL_ENABLED,
    sheetsEnabled: !!sheetsClient,
  });
});

// Public: list supported sites (enabled only)
app.get('/api/public/sites', (req, res) => {
  const sites = (settings.supportedSites || []).filter((s) => s.enabled).map((s) => ({
    id: s.id,
    name: s.name,
    hosts: s.hosts,
    browseUrl: s.browseUrl,
  }));
  res.json({ ok: true, sites });
});

// Public: create new quote request
app.post('/api/requests', async (req, res) => {
  const { stlLink, name, email, details } = req.body;

  if (!stlLink || !name || !email) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const nowIso = new Date().toISOString();

  const newRequest = {
    id: Date.now().toString(),
    stlLink,
    name,
    email,
    details: details || '',
    status: 'new',
    createdAt: nowIso,
    updatedAt: nowIso,
    fulfilledBy: '',
    archived: false,
    adminNotes: '',
    trackingNumber: '',
  };

  requests.unshift(newRequest);
  writeRequestsToFile();

  if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
  sendNotificationEmail(newRequest).catch(() => {});

  res.status(201).json({ ok: true, id: newRequest.id });
});

// Admin auth
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.admin = { email };
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Admin: read settings
app.get('/api/settings', requireAdmin, (req, res) => {
  res.json({ ok: true, settings });
});

// Admin: update fulfillers (PUT + POST for compatibility)
async function handleUpdateFulfillers(req, res) {
  const names = sanitizeFulfillers(req.body?.names);
  if (!names.length) return res.status(400).json({ error: 'Provide at least one name.' });

  settings.fulfilledByNames = names;
  await saveSettings();
  res.json({ ok: true, fulfilledByNames: settings.fulfilledByNames });
}
app.put('/api/settings/fulfillers', requireAdmin, handleUpdateFulfillers);
app.post('/api/settings/fulfillers', requireAdmin, handleUpdateFulfillers);

// Admin: update supported sites (PUT + POST for compatibility)
async function handleUpdateSites(req, res) {
  const sites = sanitizeSites(req.body?.sites);
  if (!sites.length) return res.status(400).json({ error: 'Provide at least one site.' });

  settings.supportedSites = sites;
  await saveSettings();
  res.json({ ok: true, supportedSites: settings.supportedSites });
}
app.put('/api/settings/sites', requireAdmin, handleUpdateSites);
app.post('/api/settings/sites', requireAdmin, handleUpdateSites);

// Admin: reload settings from Sheets (or file)
app.post('/api/settings/reload', requireAdmin, async (req, res) => {
  if (sheetsClient) {
    await loadSettingsFromSheet();
  } else {
    loadSettingsFromFile();
  }
  res.json({ ok: true, settings });
});

// Admin: requests
app.get('/api/requests', requireAdmin, (req, res) => {
  res.json(requests);
});

app.post('/api/requests/:id/status', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!validateStatus(status)) return res.status(400).json({ error: 'Invalid status' });

  const r = requests.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.status = status;
  r.updatedAt = new Date().toISOString();

  writeRequestsToFile();
  res.json({ ok: true, request: r });
  if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

app.post('/api/requests/:id/fulfilled', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { fulfilledBy } = req.body;

  const r = requests.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.fulfilledBy = fulfilledBy || '';
  r.updatedAt = new Date().toISOString();

  writeRequestsToFile();
  res.json({ ok: true, request: r });
  if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

app.post('/api/requests/:id/admin-notes', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { adminNotes } = req.body;

  const r = requests.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.adminNotes = String(adminNotes || '');
  r.updatedAt = new Date().toISOString();

  writeRequestsToFile();
  res.json({ ok: true, request: r });
  if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

app.post('/api/requests/:id/tracking', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { trackingNumber } = req.body;

  const r = requests.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.trackingNumber = String(trackingNumber || '').trim();
  r.updatedAt = new Date().toISOString();

  writeRequestsToFile();
  res.json({ ok: true, request: r });
  if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

app.post('/api/requests/:id/archive', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { archived } = req.body;

  if (typeof archived !== 'boolean') return res.status(400).json({ error: 'archived must be boolean' });

  const r = requests.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.archived = archived;
  r.updatedAt = new Date().toISOString();

  writeRequestsToFile();
  res.json({ ok: true, request: r });
  if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

app.post('/api/sheets/reload', requireAdmin, async (req, res) => {
  if (!sheetsClient) return res.status(501).json({ error: 'Google Sheets integration is not enabled.' });

  const ok = await loadRequestsFromSheet();
  res.json({ ok: true, loaded: ok, count: requests.length });
});

app.post('/api/sheets/sync', requireAdmin, async (req, res) => {
  if (!sheetsClient) return res.status(501).json({ error: 'Google Sheets integration is not enabled.' });

  const ok = await writeAllRequestsToSheet();
  res.json({ ok: true, synced: ok, count: requests.length });
});

// Admin: exports
app.get('/api/export/json', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="lm3dptfy-requests.json"');
  res.send(JSON.stringify(requests, null, 2));
});

app.get('/api/export/csv', requireAdmin, (req, res) => {
  const csv = requestsToCsv(requests);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="lm3dptfy-requests.csv"');
  res.send(csv);
});

// ========== APP STARTUP ==========================================

(async () => {
  try {
    loadSettingsFromFile();
    loadRequestsFromFile();

    if (sheetsClient) {
      await loadSettingsFromSheet();
      await loadRequestsFromSheet();
    }
  } catch (err) {
    console.warn('Startup load issue:', err?.message || err);
  }

  app.listen(PORT, () => {
    console.log(`LM3DPTFY server running on http://localhost:${PORT}`);
  });
})();
