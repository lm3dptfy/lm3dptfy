// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Prefer a /public folder if you have one, otherwise fall back to repo root (this repo ships HTML/CSS in root)
const PUBLIC_DIR_PREFERRED = path.join(__dirname, 'public');
const PUBLIC_DIR = fs.existsSync(PUBLIC_DIR_PREFERRED) ? PUBLIC_DIR_PREFERRED : __dirname;

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

// ========== GLOBAL STATE =========================================

let requests = []; // in-memory list, hydrated from Sheets

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

  const subject = `New LM3DPTFY quote request from ${name}`;
  const adminUrlBase = process.env.BACKEND_URL || 'https://www.lm3dptfy.online';
  const html = `
    <h2>New Quote Request</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
    <p><strong>STLFlix link:</strong> <a href="${stlLink}">${stlLink}</a></p>
    <p><strong>Details:</strong> ${details || '(none)'}</p>
    <p><a href="${adminUrlBase}/admin.html">View in Admin Panel</a></p>
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

if (isProd) {
  // Render/most PaaS sit behind a proxy; this makes secure cookies work correctly
  app.set('trust proxy', 1);
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_in_production';
if (isProd && SESSION_SECRET === 'change_this_in_production') {
  console.warn('WARNING: SESSION_SECRET is using the default value. Set SESSION_SECRET in production.');
}

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProd, // ✅ secure cookies in production (https)
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  })
);

// If we fall back to serving static from repo root, block sensitive files from being served.
const BLOCKED_STATIC_NAMES = new Set([
  'server.js',
  'package.json',
  'package-lock.json',
  '.env',
  '.env.local',
  '.env.production',
]);

app.use((req, res, next) => {
  // Only applies to static-like GET/HEAD requests
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const pathname = (req.path || '').toLowerCase();
  const base = path.basename(pathname);
  const ext = path.extname(base);

  if (BLOCKED_STATIC_NAMES.has(base)) return res.status(404).end();
  if (ext === '.js' || ext === '.json' || ext === '.lock' || ext === '.map') return res.status(404).end();

  next();
});

// IMPORTANT: force homepage to index.html (prevents admin becoming root)
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// optional nice alias
app.get('/admin', (req, res) => res.redirect('/admin.html'));

// Static assets + pages
app.use(express.static(PUBLIC_DIR));

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
  // Old layout (9 cols): A..I
  // New layout (11 cols): A..K where:
  // J = Admin Notes, K = Tracking #
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

  // If header is empty or shorter than expected, write/extend it
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
    requests = [];
    return;
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

    const activeRequests = activeRows.map(mapRowToRequest).filter(Boolean).map(r => ({ ...r, archived: false }));
    const archivedRequests = archivedRows.map(mapRowToRequest).filter(Boolean).map(r => ({ ...r, archived: true }));

    requests = [...activeRequests, ...archivedRequests].sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      return tb - ta;
    });

    console.log(`Loaded ${requests.length} requests from Sheets.`);
  } catch (err) {
    console.error('Error loading requests from Google Sheets:', err);
    requests = [];
  }
}

async function writeAllRequestsToSheet() {
  if (!sheetsClient) return;

  const active = requests.filter(r => !r.archived);
  const archived = requests.filter(r => r.archived);

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

  console.log(`Synced to Sheets: ${active.length} active, ${archived.length} archived.`);
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
  });
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

app.get('/api/requests', requireAdmin, (req, res) => {
  res.json(requests);
});

app.post('/api/requests/:id/status', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!validateStatus(status)) return res.status(400).json({ error: 'Invalid status' });

  const r = requests.find(x => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.status = status;
  r.updatedAt = new Date().toISOString();

  res.json({ ok: true, request: r });
  if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

app.post('/api/requests/:id/fulfilled', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { fulfilledBy } = req.body;

  const r = requests.find(x => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.fulfilledBy = fulfilledBy || '';
  r.updatedAt = new Date().toISOString();

  res.json({ ok: true, request: r });
  if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

// Admin notes
app.post('/api/requests/:id/admin-notes', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { adminNotes } = req.body;

  const r = requests.find(x => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.adminNotes = String(adminNotes || '');
  r.updatedAt = new Date().toISOString();

  res.json({ ok: true, request: r });
  if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

// Tracking number
app.post('/api/requests/:id/tracking', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { trackingNumber } = req.body;

  const r = requests.find(x => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.trackingNumber = String(trackingNumber || '').trim();
  r.updatedAt = new Date().toISOString();

  res.json({ ok: true, request: r });
  if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

app.post('/api/requests/:id/archive', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { archived } = req.body;

  if (typeof archived !== 'boolean') return res.status(400).json({ error: 'archived must be boolean' });

  const r = requests.find(x => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.archived = archived;
  r.updatedAt = new Date().toISOString();

  res.json({ ok: true, request: r });
  if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

app.post('/api/sheets/reload', requireAdmin, async (req, res) => {
  await loadRequestsFromSheet();
  res.json({ ok: true, count: requests.length });
});

app.post('/api/sheets/sync', requireAdmin, async (req, res) => {
  await writeAllRequestsToSheet();
  res.json({ ok: true, count: requests.length });
});

// ====== Admin exports (these links already exist in admin.html) ======

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

app.get('/api/export/json', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="lm3dptfy-requests-${new Date().toISOString().replace(/[:.]/g, '-')}.json"`
  );
  res.send(JSON.stringify(requests, null, 2));
});

app.get('/api/export/csv', requireAdmin, (req, res) => {
  const header = [
    'id',
    'createdAt',
    'name',
    'email',
    'stlLink',
    'details',
    'status',
    'fulfilledBy',
    'archived',
    'adminNotes',
    'trackingNumber',
    'updatedAt',
  ];

  const rows = requests.map(r => [
    r.id,
    r.createdAt,
    r.name,
    r.email,
    r.stlLink,
    r.details,
    r.status,
    r.fulfilledBy,
    r.archived,
    r.adminNotes,
    r.trackingNumber,
    r.updatedAt,
  ]);

  const csv = [
    header.map(csvEscape).join(','),
    ...rows.map(row => row.map(csvEscape).join(',')),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="lm3dptfy-requests-${new Date().toISOString().replace(/[:.]/g, '-')}.csv"`
  );
  res.send(csv);
});

// ========== APP STARTUP ==========================================

app.listen(PORT, () => {
  console.log(`LM3DPTFY server running on http://localhost:${PORT}`);
  if (sheetsClient) loadRequestsFromSheet().catch(console.error);
});
