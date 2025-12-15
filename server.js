// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

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

/**
 * New columns added:
 * - Admin Notes
 * - Tracking Number
 *
 * Order (A-K):
 * ID, Created, Name, Email, STL Link, Details, Admin Notes, Status, Fulfilled By, Tracking Number, Archived
 */
const SHEET_HEADER = [
  'ID',
  'Created',
  'Name',
  'Email',
  'STL Link',
  'Details',
  'Admin Notes',
  'Status',
  'Fulfilled By',
  'Tracking Number',
  'Archived',
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
  const norm = String(value)
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '_'); // "Quote approved" -> "quote_approved"
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
  const baseUrl = process.env.BACKEND_URL || 'https://www.lm3dptfy.online';

  const html = `
    <h2>New Quote Request</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
    <p><strong>STLFlix link:</strong> <a href="${stlLink}">${stlLink}</a></p>
    <p><strong>Details:</strong> ${details || '(none)'}</p>
    <p><a href="${baseUrl}/admin">Open Admin Panel</a></p>
  `;

  try {
    console.log('Attempting to send admin notification email via Resend to:', NOTIFY_EMAIL);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: NOTIFY_EMAIL, // IMPORTANT: single string
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

// Needed for secure cookies behind Render/NGINX proxies
app.set('trust proxy', 1);

const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_in_production';

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: (process.env.NODE_ENV || '').toLowerCase() === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 day
      sameSite: 'lax',
    },
  })
);

// ========== HELPERS ==============================================

function isAdminAuthed(req) {
  return !!(req.session && req.session.admin && req.session.admin.email === ADMIN_EMAIL);
}

function requireAdmin(req, res, next) {
  if (isAdminAuthed(req)) return next();
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
  // Support older rows that may be missing new columns.
  const [
    id,
    created,
    name,
    email,
    stlLink,
    details,
    adminNotes,
    statusRaw,
    fulfilledBy,
    trackingNumber,
    archivedText,
  ] = row;

  if (!id) return null;

  const createdAt = parseCreatedToIso(created);

  const archived =
    String(archivedText || '').trim().toLowerCase() === 'yes' ||
    String(archivedText || '').trim().toLowerCase() === 'true';

  const status = sheetToStatus(statusRaw);

  return {
    id: String(id),
    name: name || '',
    email: email || '',
    stlLink: stlLink || '',
    details: details || '',
    adminNotes: adminNotes || '',
    status,
    fulfilledBy: fulfilledBy || '',
    trackingNumber: trackingNumber || '',
    archived,
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
    reqObj.adminNotes || '',
    statusToSheet(reqObj.status || 'new'),
    reqObj.fulfilledBy || '',
    reqObj.trackingNumber || '',
    reqObj.archived ? 'Yes' : 'No',
  ];
}

// ========== SHEETS <-> MEMORY SYNC ===============================

async function ensureHeader(sheetName) {
  const existing = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!A1:K1`,
  });
  const values = existing.data.values || [];

  const current = values[0] || [];
  const needsInit = !values.length || current.join('') === '';
  const needsUpgrade =
    !needsInit &&
    (current.length !== SHEET_HEADER.length ||
      current.some((v, i) => String(v || '').trim() !== String(SHEET_HEADER[i] || '').trim()));

  if (needsInit || needsUpgrade) {
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [SHEET_HEADER] },
    });
    console.log(
      needsInit
        ? `Initialized header row on sheet "${sheetName}".`
        : `Upgraded header row on sheet "${sheetName}" to include new columns.`
    );
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

    const activeRequests = activeRows
      .map(mapRowToRequest)
      .filter(Boolean)
      .map(r => ({ ...r, archived: false }));

    const archivedRequests = archivedRows
      .map(mapRowToRequest)
      .filter(Boolean)
      .map(r => ({ ...r, archived: true }));

    const merged = [...activeRequests, ...archivedRequests].sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      return tb - ta;
    });

    requests = merged;

    console.log(
      `Loaded ${requests.length} requests from Sheets (${activeRequests.length} active, ${archivedRequests.length} archived).`
    );
  } catch (err) {
    console.error('Error loading requests from Google Sheets:', err);
    requests = [];
  }
}

async function writeAllRequestsToSheet() {
  if (!sheetsClient) {
    console.warn('Google Sheets client not initialized; cannot sync to Sheets.');
    return;
  }

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

  const [activeUpdate, archivedUpdate] = await Promise.all([
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

  console.log(
    `Synced to Sheets: ${active.length} active, ${archived.length} archived. Updated cells: active=${
      activeUpdate.data.updates ? activeUpdate.data.updates.updatedCells : 'N/A'
    }, archived=${archivedUpdate.data.updates ? archivedUpdate.data.updates.updatedCells : 'N/A'}`
  );
}

// ========== ADMIN PAGE GATE (HIDE FROM PUBLIC) ====================

const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_DASHBOARD_FILE = path.join(PUBLIC_DIR, 'admin.html');

function adminLoginHtml() {
  const logoPath = process.env.LOGO_PATH || '/lm3dptfy-logo-tp-cropped.png';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Admin Login · Let Me 3D Print That For You</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: radial-gradient(1000px 600px at 50% -10%, rgba(37,99,235,.12), transparent 60%),
                  radial-gradient(900px 500px at 10% 20%, rgba(0,0,0,.06), transparent 55%),
                  #f6f7fb;
      padding: 24px;
    }
    .card {
      width: 100%; max-width: 520px; background: rgba(255,255,255,.85);
      border: 1px solid rgba(0,0,0,.08); border-radius: 22px;
      box-shadow: 0 12px 40px rgba(0,0,0,.08);
      backdrop-filter: blur(10px);
      padding: 22px;
    }
    .top { display:flex; align-items:center; gap:12px; margin-bottom: 14px; }
    .logo {
      width: 40px; height: 40px; border-radius: 14px; background: #fff;
      display:grid; place-items:center; border: 1px solid rgba(0,0,0,.08);
      overflow:hidden;
    }
    .logo img { width: 100%; height: 100%; object-fit: contain; }
    h1 { font-size: 22px; margin: 0; }
    p { margin: 10px 0 18px; color: rgba(0,0,0,.68); line-height: 1.35; }
    label { display:block; font-size: 13px; margin: 10px 0 6px; color: rgba(0,0,0,.72); }
    input {
      width: 100%; height: 46px; border-radius: 14px; border: 1px solid rgba(0,0,0,.14);
      padding: 0 14px; font-size: 15px; outline: none; background: #fff;
    }
    input:focus { border-color: rgba(37,99,235,.55); box-shadow: 0 0 0 4px rgba(37,99,235,.12); }
    button {
      width: 100%; height: 48px; border-radius: 14px; border: none; cursor: pointer;
      background: linear-gradient(180deg, #3b82f6, #2563eb);
      color: #fff; font-size: 16px; font-weight: 700; margin-top: 14px;
    }
    button:disabled { opacity: .6; cursor: not-allowed; }
    .err { margin-top: 12px; color: #b91c1c; font-size: 14px; display:none; }
    .hint { margin-top: 14px; font-size: 12px; color: rgba(0,0,0,.55); }
  </style>
</head>
<body>
  <div class="card">
    <div class="top">
      <div class="logo"><img src="${logoPath}" alt="LM3DPTFY logo" onerror="this.style.display='none'"/></div>
      <div>
        <h1>Admin Login</h1>
        <div style="font-size:12px;color:rgba(0,0,0,.55)">Let Me 3D Print That For You</div>
      </div>
    </div>
    <p>Sign in to view and manage quote requests.</p>

    <form id="f">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" placeholder="lm3dptfy+admin@gmail.com" required />

      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />

      <button id="btn" type="submit">Sign in</button>
      <div class="err" id="err"></div>
      <div class="hint">Tip: Bookmark <b>/admin</b>. The dashboard is not linked publicly.</div>
    </form>
  </div>

  <script>
    (async function(){
      try {
        const me = await fetch('/api/me');
        const data = await me.json();
        if (data && data.admin) location.replace('/admin');
      } catch(e){}
    })();

    const f = document.getElementById('f');
    const btn = document.getElementById('btn');
    const err = document.getElementById('err');

    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.style.display = 'none';
      btn.disabled = true;

      const payload = {
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value
      };

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Invalid credentials');
        location.replace('/admin');
      } catch (e) {
        err.textContent = 'Login failed. Check your email/password.';
        err.style.display = 'block';
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

// Block direct public access to admin static assets (dashboard stays behind /admin)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();

  const p = req.path;

  // Let /admin.html redirect to /admin
  if (p === '/admin.html') return next();

  const isAdminAsset =
    p === '/admin.js' ||
    p === '/admin.css' ||
    /^\/admin.*\.(map|js|css)$/i.test(p);

  if (isAdminAsset && !isAdminAuthed(req)) {
    return res.status(404).send('Not found');
  }

  return next();
});

// Serve public assets
app.use(express.static(PUBLIC_DIR));

// Admin route (private)
app.get('/admin', (req, res) => {
  if (!isAdminAuthed(req)) return res.status(200).send(adminLoginHtml());
  return res.sendFile(ADMIN_DASHBOARD_FILE);
});

// Back-compat
app.get('/admin.html', (req, res) => res.redirect('/admin'));

// ========== ROUTES ===============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || 'development',
    emailEnabled: EMAIL_ENABLED,
    sheetsEnabled: !!sheetsClient,
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
    adminNotes: '',
    trackingNumber: '',
    status: 'new',
    createdAt: nowIso,
    updatedAt: nowIso,
    fulfilledBy: '',
    archived: false,
  };

  requests.unshift(newRequest);
  console.log('New request created:', newRequest);

  if (sheetsClient) {
    writeAllRequestsToSheet().catch(err =>
      console.error('Sheets sync failed (new request):', err)
    );
  }

  sendNotificationEmail(newRequest).catch(() => {});
  res.status(201).json({ ok: true, id: newRequest.id });
});

// Admin auth
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  console.log('Login attempt for:', email);

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.admin = { email };
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.admin) return res.json({ admin: req.session.admin });
  res.json({ admin: null });
});

// Admin: get all requests
app.get('/api/requests', requireAdmin, (req, res) => {
  res.json(requests);
});

// Update status
app.post('/api/requests/:id/status', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!validateStatus(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const r = requests.find(x => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.status = status;
  r.updatedAt = new Date().toISOString();

  res.json({ ok: true, request: r });

  if (sheetsClient) {
    writeAllRequestsToSheet().catch(err =>
      console.error('Sheets sync failed (status update):', err)
    );
  }
});

// Update fulfilledBy
app.post('/api/requests/:id/fulfilled', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { fulfilledBy } = req.body;

  const r = requests.find(x => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.fulfilledBy = fulfilledBy || '';
  r.updatedAt = new Date().toISOString();

  res.json({ ok: true, request: r });

  if (sheetsClient) {
    writeAllRequestsToSheet().catch(err =>
      console.error('Sheets sync failed (fulfilledBy update):', err)
    );
  }
});

// Update admin notes
app.post('/api/requests/:id/admin_notes', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { adminNotes } = req.body;

  const r = requests.find(x => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.adminNotes = String(adminNotes || '');
  r.updatedAt = new Date().toISOString();

  res.json({ ok: true, request: r });

  if (sheetsClient) {
    writeAllRequestsToSheet().catch(err =>
      console.error('Sheets sync failed (admin notes update):', err)
    );
  }
});

// Update tracking number
app.post('/api/requests/:id/tracking', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { trackingNumber } = req.body;

  const r = requests.find(x => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.trackingNumber = String(trackingNumber || '');
  r.updatedAt = new Date().toISOString();

  res.json({ ok: true, request: r });

  if (sheetsClient) {
    writeAllRequestsToSheet().catch(err =>
      console.error('Sheets sync failed (tracking update):', err)
    );
  }
});

// Archive / unarchive
app.post('/api/requests/:id/archive', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { archived } = req.body;

  if (typeof archived !== 'boolean') {
    return res.status(400).json({ error: 'archived must be boolean' });
  }

  const r = requests.find(x => x.id === id);
  if (!r) return res.status(404).json({ error: 'Request not found' });

  r.archived = archived;
  r.updatedAt = new Date().toISOString();

  res.json({ ok: true, request: r });

  if (sheetsClient) {
    writeAllRequestsToSheet().catch(err =>
      console.error('Sheets sync failed (archive update):', err)
    );
  }
});

// Export CSV
app.get('/api/export/csv', requireAdmin, (req, res) => {
  try {
    const headers = SHEET_HEADER;
    const rows = requests.map(requestToRow);

    const csv = [
      headers.join(','),
      ...rows.map(r =>
        r.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="lm3dptfy-requests-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Export CSV error:', err);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

// Export JSON
app.get('/api/export/json', requireAdmin, (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="lm3dptfy-requests-${Date.now()}.json"`);
    res.send(JSON.stringify(requests, null, 2));
  } catch (err) {
    console.error('Export JSON error:', err);
    res.status(500).json({ error: 'Failed to export JSON' });
  }
});

// Manual reload from Sheets
app.post('/api/sheets/reload', requireAdmin, async (req, res) => {
  try {
    await loadRequestsFromSheet();
    res.json({ ok: true, count: requests.length });
  } catch (err) {
    console.error('Reload from Sheets error:', err);
    res.status(500).json({ error: 'Failed to reload from Sheets' });
  }
});

// Manual sync to Sheets
app.post('/api/sheets/sync', requireAdmin, async (req, res) => {
  try {
    await writeAllRequestsToSheet();
    res.json({ ok: true, count: requests.length });
  } catch (err) {
    console.error('Sync to Sheets error:', err);
    res.status(500).json({ error: 'Failed to sync to Sheets' });
  }
});

// ========== APP STARTUP ==========================================

app.listen(PORT, () => {
  console.log(`LM3DPTFY server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Admin login email: ${ADMIN_EMAIL}`);
  console.log(`Notification email target: ${NOTIFY_EMAIL}`);
  console.log(`Email notifications enabled (Resend): ${EMAIL_ENABLED}`);

  if (sheetsClient) {
    loadRequestsFromSheet().catch(err =>
      console.error('Initial load from Sheets failed:', err)
    );
  }
});
