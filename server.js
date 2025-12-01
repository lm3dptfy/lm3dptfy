// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const nodemailer = require('nodemailer');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// === ADMIN / EMAIL CONFIG ======================================

// Admin login email (used to log into /admin)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'lm3dptfy+admin@gmail.com';
// Where order notifications are sent
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'lm3dptfy@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error('ERROR: ADMIN_PASSWORD not set in environment variables!');
  process.exit(1);
}

// Gmail credentials
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;
const GMAIL_FROM_NAME = process.env.GMAIL_FROM_NAME || 'LM3DPTFY';

// Google Sheets ID
const GOOGLE_SHEET_ID =
  process.env.GOOGLE_SHEET_ID || '1IAwz8OtfuwSOSQJDIyOuwB_PI_ugHlEzvGKE_uUo2HI';

// Column layout in Sheet
// A: ID, B: Name, C: Email, D: STL Link, E: Details, F: Status,
// G: Fulfilled By, H: Archived, I: Created At
const SHEET_HEADER = [
  'ID',
  'Name',
  'Email',
  'STL Link',
  'Details',
  'Status',
  'Fulfilled By',
  'Archived',
  'Created At',
];

// Valid statuses for workflow
const VALID_STATUSES = [
  'new',
  'responded',
  'quote_approved',
  'printing',
  'completed',
  'shipped',
  'cancelled',
];

// === GLOBAL STATE ===============================================

let requests = []; // in-memory copy, loaded from Google Sheets

// === GOOGLE SHEETS CLIENT =======================================

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

// === EMAIL (GMAIL) CLIENT =======================================

let mailer = null;

if (GMAIL_USER && GMAIL_PASS) {
  mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_PASS,
    },
  });
  console.log('Gmail notifications enabled. Will send to:', NOTIFY_EMAIL);
} else {
  console.warn('GMAIL_USER or GMAIL_PASS not set. Email notifications disabled.');
}

// === EXPRESS MIDDLEWARE =========================================

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
      secure: false,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 day
      sameSite: 'lax',
    },
  })
);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// === HELPERS ====================================================

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin && req.session.admin.email === ADMIN_EMAIL) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function validateStatus(status) {
  return VALID_STATUSES.includes(status);
}

function mapRowToRequest(row) {
  const [
    id,
    name,
    email,
    stlLink,
    details,
    status,
    fulfilledBy,
    archivedText,
    createdAt,
  ] = row;

  if (!id) return null;

  return {
    id: String(id),
    name: name || '',
    email: email || '',
    stlLink: stlLink || '',
    details: details || '',
    status: status || 'new',
    fulfilledBy: fulfilledBy || null,
    archived: archivedText === 'Yes' || archivedText === 'TRUE',
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function requestToRow(r) {
  return [
    r.id,
    r.name,
    r.email,
    r.stlLink,
    r.details || '',
    r.status,
    r.fulfilledBy || '',
    r.archived ? 'Yes' : 'No',
    r.createdAt || new Date().toISOString(),
  ];
}

// === SHEETS <-> MEMORY SYNC =====================================

async function loadRequestsFromSheet() {
  if (!sheetsClient) {
    console.warn('Google Sheets client not initialized; cannot load requests.');
    requests = [];
    return;
  }

  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A1:I10000',
    });

    const values = res.data.values || [];

    if (values.length === 0) {
      console.log('Sheet is empty. Initializing header row.');
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: 'Sheet1!A1',
        valueInputOption: 'RAW',
        requestBody: { values: [SHEET_HEADER] },
      });
      requests = [];
      return;
    }

    // Skip header row
    const rows = values.slice(1);
    const mapped = rows
      .map(mapRowToRequest)
      .filter(Boolean)
      // newest first (by createdAt if parsable)
      .sort((a, b) => {
        const ta = Date.parse(a.createdAt) || 0;
        const tb = Date.parse(b.createdAt) || 0;
        return tb - ta;
      });

    requests = mapped;
    console.log(`Loaded ${requests.length} requests from Google Sheets.`);
  } catch (err) {
    console.error('Error loading requests from Google Sheets:', err);
    requests = [];
  }
}

async function appendRequestToSheet(reqObj) {
  if (!sheetsClient) return;

  const row = requestToRow(reqObj);

  await sheetsClient.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });

  console.log('Appended request to Google Sheets:', reqObj.id);
}

async function writeAllRequestsToSheet() {
  if (!sheetsClient) {
    console.warn('Google Sheets client not initialized; cannot sync.');
    return;
  }

  const values = [SHEET_HEADER, ...requests.map(requestToRow)];

  const res = await sheetsClient.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  console.log(
    `Synced ${requests.length} requests to Google Sheets. Updated cells: ${
      res.data.updates ? res.data.updates.updatedCells : 'N/A'
    }`
  );
}

// === ROUTES =====================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || 'development',
    adminEmail: ADMIN_EMAIL,
    notifyEmail: NOTIFY_EMAIL,
    sheetId: GOOGLE_SHEET_ID,
  });
});

// Create new quote request
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
    fulfilledBy: null,
    archived: false,
  };

  // Keep newest at top
  requests.unshift(newRequest);
  console.log('New request created:', newRequest);

  // Append to Google Sheets
  if (sheetsClient) {
    appendRequestToSheet(newRequest).catch(err =>
      console.error('Auto-append to Sheets failed:', err)
    );
  }

  // Admin email notification
  if (mailer) {
    console.log('Attempting to send admin notification email to:', NOTIFY_EMAIL);
    mailer
      .sendMail({
        from: `"${GMAIL_FROM_NAME}" <${GMAIL_USER}>`,
        to: NOTIFY_EMAIL,
        subject: `New LM3DPTFY quote request from ${name}`,
        html: `
          <h2>New Quote Request</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
          <p><strong>STLFlix link:</strong> <a href="${stlLink}">${stlLink}</a></p>
          <p><strong>Details:</strong> ${details || '(none)'}</p>
          <p><a href="${
            process.env.BACKEND_URL || 'http://localhost:3000'
          }/admin.html">View in Admin Panel</a></p>
        `,
      })
      .then(() => console.log('Admin notification email sent successfully.'))
      .catch(err =>
        console.error('Error sending admin notification email:', err)
      );
  } else {
    console.warn('Mailer not configured; skipping admin notification email.');
  }

  res.status(201).json({ ok: true, id: newRequest.id });
});

// Admin login / logout / session
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
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.admin) {
    return res.json({ admin: req.session.admin });
  }
  res.json({ admin: null });
});

// Get all requests (admin only) – uses in-memory copy
app.get('/api/requests', requireAdmin, (req, res) => {
  res.json(requests);
});

// Update request status
app.post('/api/requests/:id/status', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!validateStatus(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const request = requests.find(r => r.id === id);
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }

  request.status = status;
  request.updatedAt = new Date().toISOString();

  res.json({ ok: true, request });

  if (sheetsClient) {
    writeAllRequestsToSheet().catch(err =>
      console.error('Sheets sync failed (status update):', err)
    );
  }
});

// Mark as fulfilled
app.post('/api/requests/:id/fulfilled', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { fulfilledBy } = req.body;

  const request = requests.find(r => r.id === id);
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }

  request.status = 'completed';
  request.fulfilledBy = fulfilledBy || request.fulfilledBy;
  request.updatedAt = new Date().toISOString();

  res.json({ ok: true, request });

  if (sheetsClient) {
    writeAllRequestsToSheet().catch(err =>
      console.error('Sheets sync failed (fulfilled):', err)
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

  const request = requests.find(r => r.id === id);
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }

  request.archived = archived;
  request.updatedAt = new Date().toISOString();

  res.json({ ok: true, request });

  if (sheetsClient) {
    writeAllRequestsToSheet().catch(err =>
      console.error('Sheets sync failed (archive):', err)
    );
  }
});

// Export CSV (from in-memory requests)
app.get('/api/export/csv', requireAdmin, (req, res) => {
  try {
    const headers = [
      'ID',
      'Created',
      'Name',
      'Email',
      'STL Link',
      'Details',
      'Status',
      'Fulfilled By',
      'Archived',
    ];

    const rows = requests.map(r => [
      r.id,
      new Date(r.createdAt).toLocaleString(),
      r.name,
      r.email,
      r.stlLink,
      r.details || '',
      r.status,
      r.fulfilledBy || '',
      r.archived ? 'Yes' : 'No',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(r =>
        r
          .map(field => `"${String(field).replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="lm3dptfy-requests-${Date.now()}.csv"`
    );
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
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="lm3dptfy-requests-${Date.now()}.json"`
    );
    res.send(JSON.stringify(requests, null, 2));
  } catch (err) {
    console.error('Export JSON error:', err);
    res.status(500).json({ error: 'Failed to export JSON' });
  }
});

// Manual reload from Sheets (IMPORT)
app.post('/api/sheets/reload', requireAdmin, async (req, res) => {
  try {
    await loadRequestsFromSheet();
    res.json({ ok: true, count: requests.length });
  } catch (err) {
    console.error('Reload from Sheets error:', err);
    res.status(500).json({ error: 'Failed to reload from Sheets' });
  }
});

// Manual sync to Sheets (EXPORT ALL)
app.post('/api/sheets/sync', requireAdmin, async (req, res) => {
  try {
    await writeAllRequestsToSheet();
    res.json({ ok: true, count: requests.length });
  } catch (err) {
    console.error('Sync to Sheets error:', err);
    res.status(500).json({ error: 'Failed to sync to Sheets' });
  }
});

// === APP STARTUP ================================================

app.listen(PORT, () => {
  console.log(`LM3DPTFY server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Admin login email: ${ADMIN_EMAIL}`);
  console.log(`Notification email target: ${NOTIFY_EMAIL}`);

  if (sheetsClient) {
    loadRequestsFromSheet().catch(err =>
      console.error('Initial load from Sheets failed:', err)
    );
  }
});
