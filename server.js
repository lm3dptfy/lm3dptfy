// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const nodemailer = require('nodemailer');
const fs = require('fs');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// Data persistence file
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'requests-data.json');

// Admin credentials
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'lm3dptfy@gmail.com';
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
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1IAwz8OtfuwSOSQJDIyOuwB_PI_ugHlEzvGKE_uUo2HI';

// Status workflow
const VALID_STATUSES = [
  'new',
  'responded',
  'quote_approved',
  'printing',
  'completed',
  'shipped',
  'cancelled',
];

// In-memory requests store
let requests = [];

// Load requests from file
function loadRequests() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      requests = JSON.parse(data);
      console.log(`Loaded ${requests.length} requests from disk.`);
    } else {
      console.log('No existing data file found, starting fresh.');
      requests = [];
    }
  } catch (err) {
    console.error('Error loading requests data:', err);
    requests = [];
  }
}

// Save requests to file
function saveRequests() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(requests, null, 2));
  } catch (err) {
    console.error('Error saving requests:', err);
  }
}

loadRequests();

// Initialize Google Sheets
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

// Optional mailer
let mailer = null;
if (GMAIL_USER && GMAIL_PASS) {
  mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_PASS,
    },
  });
  console.log('Gmail notifications enabled.');
} else {
  console.warn('GMAIL_USER or GMAIL_PASS not set. Email notifications disabled.');
}

// Middleware
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
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  })
);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Helper functions
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin && req.session.admin.email === ADMIN_EMAIL) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function validateStatus(status) {
  return VALID_STATUSES.includes(status);
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

// Create new quote request
app.post('/api/requests', async (req, res) => {
  const { stlLink, name, email, details } = req.body;

  if (!stlLink || !name || !email) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const newRequest = {
    id: Date.now().toString(),
    stlLink,
    name,
    email,
    details: details || '',
    status: 'new',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fulfilledBy: null,
    archived: false,
  };

  requests.unshift(newRequest);
  saveRequests();

  console.log('New request:', newRequest);

  // Auto-export to Google Sheets
  if (sheetsClient) {
    exportToGoogleSheets().catch((err) =>
      console.error('Auto-export failed:', err)
    );
  }

  // Admin email notification
  if (mailer) {
    mailer
      .sendMail({
        from: `"${GMAIL_FROM_NAME}" <${GMAIL_USER}>`,
        to: ADMIN_EMAIL,
        subject: `New LM3DPTFY quote request from ${name}`,
        html: `
          <h2>New Quote Request</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
          <p><strong>STLFlix link:</strong> <a href="${stlLink}">${stlLink}</a></p>
          <p><strong>Details:</strong> ${details || '(none)'}</p>
          <p><a href="${process.env.BACKEND_URL || 'http://localhost:3000'}/admin.html">View in Admin Panel</a></p>
        `,
      })
      .catch((err) =>
        console.error('Error sending admin notification email:', err)
      );
  }

  res.status(201).json({ ok: true, id: newRequest.id });
});

// Admin login
app.post('/api/login', (req, res) => {
  console.log('Login attempt:', req.body.email);
  const { email, password } = req.body;
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

// Get current admin session info
app.get('/api/me', (req, res) => {
  if (req.session && req.session.admin) {
    return res.json({ admin: req.session.admin });
  }
  res.json({ admin: null });
});

// Get all requests (admin only)
app.get('/api/requests', requireAdmin, (req, res) => {
  res.json({ requests });
});

// Update request status (admin only)
app.post('/api/requests/:id/status', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!validateStatus(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const request = requests.find((r) => r.id === id);
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }

  request.status = status;
  request.updatedAt = new Date().toISOString();
  saveRequests();

  res.json({ ok: true, request });
});

// Mark as fulfilled (admin only)
app.post('/api/requests/:id/fulfilled', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { fulfilledBy } = req.body;

  const request = requests.find((r) => r.id === id);
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }

  request.status = 'completed';
  request.fulfilledBy = fulfilledBy || request.fulfilledBy;
  request.updatedAt = new Date().toISOString();
  saveRequests();

  res.json({ ok: true, request });
});

// Archive/unarchive request (admin only)
app.post('/api/requests/:id/archive', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { archived } = req.body;

  const request = requests.find((r) => r.id === id);
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }

  request.archived = Boolean(archived);
  request.updatedAt = new Date().toISOString();
  saveRequests();

  res.json({ ok: true, request });
});

// Export to CSV (admin only)
app.get('/api/export/csv', requireAdmin, async (req, res) => {
  try {
    const headers = [
      'ID',
      'Name',
      'Email',
      'STL Link',
      'Details',
      'Status',
      'Fulfilled By',
      'Archived',
      'Created At',
      'Updated At',
    ];

    const rows = requests.map((r) => {
      return [
        r.id,
        r.name,
        r.email,
        r.stlLink,
        (r.details || '').replace(/"/g, '""'),
        r.status,
        r.fulfilledBy || '',
        r.archived ? 'Yes' : 'No',
        r.createdAt,
        r.updatedAt,
      ].map((field) => `"${field}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="lm3dptfy-requests-${Date.now()}.csv"`
    );
    res.send(csv);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Export to Google Sheets
async function exportToGoogleSheets() {
  if (!sheetsClient) {
    console.warn('Google Sheets client not initialized.');
    return;
  }

  const rows = [
    [
      'ID',
      'Name',
      'Email',
      'STL Link',
      'Details',
      'Status',
      'Fulfilled By',
      'Archived',
      'Created At',
      'Updated At',
    ],
    ...requests.map((r) => [
      r.id,
      r.name,
      r.email,
      r.stlLink,
      r.details || '',
      r.status,
      r.fulfilledBy || '',
      r.archived ? 'Yes' : 'No',
      r.createdAt,
      r.updatedAt,
    ]),
  ];

  await sheetsClient.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: {
      values: rows,
    },
  });

  console.log('Exported requests to Google Sheets.');
}

// Schedule weekly export (Friday at 5 PM)
function scheduleWeeklyExport() {
  const now = new Date();
  const day = now.getDay(); // 0-6, 5 = Friday
  const targetDay = 5;
  let daysUntilFriday = (targetDay - day + 7) % 7;

  if (daysUntilFriday === 0 && now.getHours() >= 17) {
    daysUntilFriday = 7;
  }

  const nextFriday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + daysUntilFriday,
    17,
    0,
    0
  );

  const delay = nextFriday.getTime() - now.getTime();

  setTimeout(() => {
    exportToGoogleSheets().catch((err) =>
      console.error('Scheduled export failed:', err)
    );

    setInterval(() => {
      exportToGoogleSheets().catch((err) =>
        console.error('Scheduled export failed:', err)
      );
    }, 7 * 24 * 60 * 60 * 1000);
  }, delay);

  console.log('Weekly export scheduled: Every Friday at 5 PM');
}

app.listen(PORT, () => {
  console.log(`LM3DPTFY server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  if (sheetsClient) {
    scheduleWeeklyExport();
  }
});
