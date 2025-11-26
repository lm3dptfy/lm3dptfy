// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin credentials
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'lm3dptfy+admin@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'MJR1125!3dp';

// Gmail credentials (optional, for new-request notifications)
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;
const GMAIL_FROM_NAME = process.env.GMAIL_FROM_NAME || 'LM3DPTFY';

// Status workflow
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

let requests = [];

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'super-secret-change-me',
    resave: false,
    saveUninitialized: false,
  })
);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Optional mailer (only used to notify you of new requests)
let mailer = null;
if (GMAIL_USER && GMAIL_PASS) {
  mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'lm3dptfy@gmail.com',
      pass: 'MJR1125!3dp',
    },
  });
} else {
  console.warn('GMAIL_USER or GMAIL_PASS not set. New-request notifications by email are disabled.');
}

// --- Routes ---

// Create new quote request
app.post('/api/requests', (req, res) => {
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
  };

  requests.unshift(newRequest);
  console.log('New request:', newRequest);

  if (mailer) {
    mailer
      .sendMail({
        from: `"${GMAIL_FROM_NAME}" <${GMAIL_USER}>`,
        to: ADMIN_EMAIL,
        subject: `New LM3DPTFY quote request from ${name}`,
        text: [
          `Name: ${name}`,
          `Email: ${email}`,
          `STLFlix link: ${stlLink}`,
          '',
          `Details: ${details || '(none)'}`,
        ].join('\n'),
      })
      .catch((err) => console.error('Error sending admin notification email:', err));
  }

  res.status(201).json({ ok: true, id: newRequest.id });
});

// Admin login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.admin = { email };
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// Admin logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Auth middleware
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin && req.session.admin.email === ADMIN_EMAIL) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Get all requests
app.get('/api/requests', requireAdmin, (req, res) => {
  res.json(requests);
});

// Update status
app.post('/api/requests/:id/status', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value.' });
  }

  const index = requests.findIndex((r) => r.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Request not found' });
  }

  requests[index].status = status;
  res.json({ ok: true, status });
});

// Fallback: SPA-style
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`LM3DPTFY server running on http://localhost:${PORT}`);
});
