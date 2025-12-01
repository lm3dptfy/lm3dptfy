// server.js
require(‘dotenv’).config();

const express = require(‘express’);
const path = require(‘path’);
const session = require(‘express-session’);
const nodemailer = require(‘nodemailer’);
const fs = require(‘fs’);
const cors = require(‘cors’);
const { google } = require(‘googleapis’);

const app = express();
const PORT = process.env.PORT || 3000;

// Data persistence file
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, ‘requests-data.json’);

// Admin credentials
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || ‘lm3dptfy+admin@gmail.com’;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
console.error(‘ERROR: ADMIN_PASSWORD not set in environment variables!’);
process.exit(1);
}

// Gmail credentials
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;
const GMAIL_FROM_NAME = process.env.GMAIL_FROM_NAME || ‘LM3DPTFY’;

// Google Sheets ID (extracted from your URL)
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || ‘1IAwz8OtfuwSOSQJDIyOuwB_PI_ugHlEzvGKE_uUo2HI’;

// Status workflow
const VALID_STATUSES = [
‘new’,
‘responded’,
‘quote_approved’,
‘sent_to_printer’,
‘print_complete’,
‘qc_complete’,
‘shipped’,
‘paid’,
];

// Load requests from file
let requests = [];
function loadRequests() {
try {
if (fs.existsSync(DATA_FILE)) {
const data = fs.readFileSync(DATA_FILE, ‘utf8’);
requests = JSON.parse(data);
console.log(`Loaded ${requests.length} requests from disk.`);
}
} catch (err) {
console.error(‘Error loading requests:’, err);
requests = [];
}
}

function saveRequests() {
try {
fs.writeFileSync(DATA_FILE, JSON.stringify(requests, null, 2));
} catch (err) {
console.error(‘Error saving requests:’, err);
}
}

loadRequests();

// Initialize Google Sheets
let sheetsClient = null;
if (process.env.GOOGLE_SERVICE_ACCOUNT) {
try {
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const auth = new google.auth.GoogleAuth({
credentials,
scopes: [‘https://www.googleapis.com/auth/spreadsheets’],
});
sheetsClient = google.sheets({ version: ‘v4’, auth });
console.log(‘Google Sheets integration enabled.’);
} catch (err) {
console.error(‘Error initializing Google Sheets:’, err);
}
}

// Function to export to Google Sheets (append-only, never deletes)
async function exportToGoogleSheets() {
if (!sheetsClient) {
console.log(‘Google Sheets export skipped (not configured)’);
return null;
}

try {
// First, check if headers exist
const existingData = await sheetsClient.spreadsheets.values.get({
spreadsheetId: GOOGLE_SHEET_ID,
range: ‘Sheet1!A1:I1’,
});

```
const headers = ['ID', 'Created', 'Name', 'Email', 'STL Link', 'Details', 'Status', 'Fulfilled By', 'Archived'];

// If no headers, add them
if (!existingData.data.values || existingData.data.values.length === 0) {
  await sheetsClient.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [headers],
    },
  });
  console.log('Added headers to Google Sheet');
}

// Get all existing IDs from the sheet
const allData = await sheetsClient.spreadsheets.values.get({
  spreadsheetId: GOOGLE_SHEET_ID,
  range: 'Sheet1!A:A', // Get all IDs (column A)
});

const existingIds = new Set(
  (allData.data.values || []).slice(1).map(row => row[0]) // Skip header row
);

// Find new requests that aren't in the sheet yet
const newRequests = requests.filter(r => !existingIds.has(r.id));

if (newRequests.length === 0) {
  console.log('No new requests to add to Google Sheets');
  return { updatedCells: 0 };
}

// Prepare rows for new requests only
const newRows = newRequests.map(r => [
  r.id,
  new Date(r.createdAt).toLocaleString(),
  r.name,
  r.email,
  r.stlLink,
  r.details || '',
  r.status,
  r.fulfilledBy || '',
  r.archived ? 'Yes' : 'No'
]);

// Append new rows to the end
const response = await sheetsClient.spreadsheets.values.append({
  spreadsheetId: GOOGLE_SHEET_ID,
  range: 'Sheet1!A:I',
  valueInputOption: 'RAW',
  insertDataOption: 'INSERT_ROWS',
  requestBody: {
    values: newRows,
  },
});

console.log(`Added ${newRows.length} new requests to Google Sheets`);
return response.data;
```

} catch (err) {
console.error(‘Google Sheets export error:’, err);
throw err;
}
}

// CORS
app.use(cors({
origin: true,
credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
console.error(‘ERROR: SESSION_SECRET not set in environment variables!’);
process.exit(1);
}

// Session configuration
app.use(
session({
secret: SESSION_SECRET,
resave: false,
saveUninitialized: false,
cookie: {
secure: false,
httpOnly: true,
maxAge: 24 * 60 * 60 * 1000,
sameSite: ‘lax’
}
})
);

// Static files
app.use(express.static(path.join(__dirname, ‘public’)));

// Optional mailer
let mailer = null;
if (GMAIL_USER && GMAIL_PASS) {
mailer = nodemailer.createTransport({
service: ‘gmail’,
auth: {
user: GMAIL_USER,
pass: GMAIL_PASS,
},
});
console.log(‘Gmail notifications enabled.’);
} else {
console.warn(‘GMAIL_USER or GMAIL_PASS not set. Email notifications disabled.’);
}

// — Routes —

// Create new quote request
app.post(’/api/requests’, async (req, res) => {
const { stlLink, name, email, details } = req.body;

if (!stlLink || !name || !email) {
return res.status(400).json({ error: ‘Missing required fields.’ });
}

const emailRegex = /^[^\s@]+@[^\s@]+.[^\s@]+$/;
if (!emailRegex.test(email)) {
return res.status(400).json({ error: ‘Invalid email format.’ });
}

const newRequest = {
id: Date.now().toString(),
stlLink,
name,
email,
details: details || ‘’,
status: ‘new’,
archived: false,
fulfilledBy: ‘’,
createdAt: new Date().toISOString(),
};

requests.unshift(newRequest);
saveRequests();

console.log(‘New request:’, newRequest);

// Auto-export to Google Sheets
if (sheetsClient) {
exportToGoogleSheets().catch(err => console.error(‘Auto-export failed:’, err));
}

if (mailer) {
mailer
.sendMail({
from: `"${GMAIL_FROM_NAME}" <${GMAIL_USER}>`,
to: ADMIN_EMAIL,
subject: `New LM3DPTFY quote request from ${name}`,
html: `<h2>New Quote Request</h2> <p><strong>Name:</strong> ${name}</p> <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p> <p><strong>STLFlix link:</strong> <a href="${stlLink}">${stlLink}</a></p> <p><strong>Details:</strong> ${details || '(none)'}</p> <p><a href="${process.env.BACKEND_URL || 'http://localhost:3000'}/admin.html">View in Admin Panel</a></p>`,
})
.catch((err) => console.error(‘Error sending admin notification email:’, err));
}

res.status(201).json({ ok: true, id: newRequest.id });
});

// Admin login
app.post(’/api/login’, (req, res) => {
console.log(‘Login attempt:’, req.body.email);
const { email, password } = req.body;

if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
req.session.admin = { email };
req.session.save((err) => {
if (err) {
console.error(‘Session save error:’, err);
return res.status(500).json({ error: ‘Session error’ });
}
console.log(‘Login successful, session saved’);
return res.json({ ok: true });
});
} else {
console.log(‘Invalid credentials’);
res.status(401).json({ error: ‘Invalid credentials’ });
}
});

// Admin logout
app.post(’/api/logout’, (req, res) => {
req.session.destroy(() => {
res.json({ ok: true });
});
});

// Auth middleware
function requireAdmin(req, res, next) {
if (req.session && req.session.admin && req.session.admin.email === ADMIN_EMAIL) {
return next();
}
res.status(401).json({ error: ‘Unauthorized’ });
}

// Get all requests
app.get(’/api/requests’, requireAdmin, (req, res) => {
res.json(requests);
});

// Export CSV
app.get(’/api/export/csv’, requireAdmin, (req, res) => {
try {
const headers = [‘ID’, ‘Created’, ‘Name’, ‘Email’, ‘STL Link’, ‘Details’, ‘Status’, ‘Archived’];
const rows = requests.map(r => {
return [
r.id,
new Date(r.createdAt).toLocaleString(),
r.name,
r.email,
r.stlLink,
(r.details || ‘’).replace(/”/g, ‘””’),
r.status,
r.archived ? ‘Yes’ : ‘No’
].map(field => `"${field}"`).join(’,’);
});

```
const csv = [headers.join(','), ...rows].join('\n');

res.setHeader('Content-Type', 'text/csv');
res.setHeader('Content-Disposition', `attachment; filename="lm3dptfy-requests-${Date.now()}.csv"`);
res.send(csv);
```

} catch (err) {
console.error(‘Export error:’, err);
res.status(500).json({ error: ‘Export failed’ });
}
});

// Export JSON
app.get(’/api/export/json’, requireAdmin, (req, res) => {
try {
res.setHeader(‘Content-Type’, ‘application/json’);
res.setHeader(‘Content-Disposition’, `attachment; filename="lm3dptfy-requests-${Date.now()}.json"`);
res.json(requests);
} catch (err) {
console.error(‘Export error:’, err);
res.status(500).json({ error: ‘Export failed’ });
}
});

// NEW: Manual export to Google Sheets
app.post(’/api/export/sheets’, requireAdmin, async (req, res) => {
try {
const result = await exportToGoogleSheets();
if (result) {
res.json({ ok: true, updatedCells: result.updatedCells });
} else {
res.status(500).json({ error: ‘Export failed - check configuration’ });
}
} catch (err) {
console.error(‘Export error:’, err);
res.status(500).json({ error: err.message || ‘Export failed’ });
}
});

// Update status
app.post(’/api/requests/:id/status’, requireAdmin, async (req, res) => {
const { id } = req.params;
const { status } = req.body;

if (!VALID_STATUSES.includes(status)) {
return res.status(400).json({ error: ‘Invalid status value.’ });
}

const index = requests.findIndex((r) => r.id === id);
if (index === -1) {
return res.status(404).json({ error: ‘Request not found’ });
}

requests[index].status = status;
saveRequests();

// Send response immediately, don’t wait for Sheets export
res.json({ ok: true, status });

// Auto-export to Sheets on status change (async, don’t block)
if (sheetsClient) {
exportToGoogleSheets().catch(err => console.error(‘Auto-export failed:’, err));
}
});

// Update fulfilled by
app.post(’/api/requests/:id/fulfilled’, requireAdmin, async (req, res) => {
const { id } = req.params;
const { fulfilledBy } = req.body;

const index = requests.findIndex((r) => r.id === id);
if (index === -1) {
return res.status(404).json({ error: ‘Request not found’ });
}

requests[index].fulfilledBy = fulfilledBy || ‘’;
saveRequests();

res.json({ ok: true, fulfilledBy });

if (sheetsClient) {
exportToGoogleSheets().catch(err => console.error(‘Auto-export failed:’, err));
}
});

// Archive / unarchive
app.post(’/api/requests/:id/archive’, requireAdmin, async (req, res) => {
const { id } = req.params;
const { archived } = req.body;

if (typeof archived !== ‘boolean’) {
return res.status(400).json({ error: ‘archived must be boolean’ });
}

const index = requests.findIndex((r) => r.id === id);
if (index === -1) {
return res.status(404).json({ error: ‘Request not found’ });
}

requests[index].archived = archived;
saveRequests();

// Send response immediately, don’t wait for Sheets export
res.json({ ok: true, archived });

// Auto-export to Sheets on archive change (async, don’t block)
if (sheetsClient) {
exportToGoogleSheets().catch(err => console.error(‘Auto-export failed:’, err));
}
});

// Health check
app.get(’/api/health’, (req, res) => {
res.json({
status: ‘ok’,
requests: requests.length,
emailEnabled: !!mailer,
sheetsEnabled: !!sheetsClient
});
});

// Fallback
app.get(’*’, (req, res) => {
res.sendFile(path.join(__dirname, ‘public’, ‘index.html’));
});

app.listen(PORT, () => {
console.log(`LM3DPTFY server running on http://localhost:${PORT}`);
console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

// Schedule weekly export to Google Sheets every Friday at 5 PM
if (sheetsClient) {
scheduleWeeklyExport();
}
});

// Function to schedule weekly exports
function scheduleWeeklyExport() {
// Check every hour if it’s time to export
setInterval(() => {
const now = new Date();
const day = now.getDay(); // 0 = Sunday, 5 = Friday
const hour = now.getHours();
const minute = now.getMinutes();

```
// Friday at 5 PM (17:00)
if (day === 5 && hour === 17 && minute < 60) {
  console.log('Running weekly Google Sheets export...');
  exportToGoogleSheets()
    .then(() => console.log('Weekly export completed successfully'))
    .catch(err => console.error('Weekly export failed:', err));
}
```

}, 60 * 60 * 1000); // Check every hour

console.log(‘Weekly export scheduled: Every Friday at 5 PM’);
}
