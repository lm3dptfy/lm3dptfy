// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const nodemailer = require('nodemailer');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Data persistence file
const DATA_FILE = path.join(__dirname, 'requests-data.json');

// Admin credentials
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'lm2dptfy+admin@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'MJR1125!3dp';

if (!ADMIN_PASSWORD) {
  console.error('ERROR: ADMIN_PASSWORD not set in environment variables!');
  process.exit(1);
}

// Gmail credentials
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

// Load requests from file
let requests = [];
function loadRequests() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      requests = JSON.parse(data);
      console.log(`Loaded ${requests.length} requests from disk.`);
    }
  } catch (err) {
    console.error('Error loading requests:', err);
    requests = [];
  }
}

function saveRequests() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(requests, null, 2));
  } catch (err) {
    console.error('Error saving requests:', err);
  }
}

loadRequests();

// CORS - Allow credentials
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('ERROR: SESSION_SECRET not set in environment variables!');
  process.exit(1);
}

const isProduction = process.env.NODE_ENV === 'production';

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
      sameSite: 'lax'
    }
  })
);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Optional mailer
let mailer = null;
if (GMAIL_USER && GMAIL_PASS) {
  mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'lm3dptfy@gmail.com',
      pass: 'MJR1125!3dp',
    },
  });
  console.log('Gmail notifications enabled.');
} else {
  console.warn('GMAIL_USER or GMAIL_PASS not set. Email notifications disabled.');
}

// --- Routes ---

// Create new quote request
app.post('/api/requests', (req, res) => {
  const { stlLink, name, email, details } = req.body;

  if (!stlLink || !name || !email) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }

  const newRequest = {
    id: Date.now().toString(),
    stlLink,
    name,
    email,
    details: details || '',
    status: 'new',
    archived: false,
    createdAt: new Date().toISOString(),
  };

  requests.unshift(newRequest);
  saveRequests();
  
  console.log('New request:', newRequest);

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
      .catch((err) => console.error('Error sending admin notification email:', err));
  }

  res.status(201).json({ ok: true, id: newRequest.id });
});

// Admin login
app.post('/api/login', (req, res) => {
  console.log('Login attempt:', req.body.email);
  const { email, password } = req.body;
  
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.admin = { email };
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Session error' });
      }
      console.log('Login successful, session saved');
      return res.json({ ok: true });
    });
  } else {
    console.log('Invalid credentials');
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Admin logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Auth middleware
function requireAdmin(req, res, next) {
  console.log('Auth check - Session:', req.session);
  if (req.session && req.session.admin && req.session.admin.email === ADMIN_EMAIL) {
    console.log('Auth check passed');
    return next();
  }
  console.log('Auth check failed');
  res.status(401).json({ error: 'Unauthorized' });
}

// Get all requests
app.get('/api/requests', requireAdmin, (req, res) => {
  res.json(requests);
});

// NEW: Export requests as CSV
app.get('/api/export/csv', requireAdmin, (req, res) => {
  try {
    // CSV headers
    const headers = ['ID', 'Created', 'Name', 'Email', 'STL Link', 'Details', 'Status', 'Archived'];
    
    // Convert requests to CSV rows
    const rows = requests.map(r => {
      return [
        r.id,
        new Date(r.createdAt).toLocaleString(),
        r.name,
        r.email,
        r.stlLink,
        (r.details || '').replace(/"/g, '""'), // Escape quotes
        r.status,
        r.archived ? 'Yes' : 'No'
      ].map(field => `"${field}"`).join(',');
    });
    
    const csv = [headers.join(','), ...rows].join('\n');
    
    // Send as downloadable file
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="lm3dptfy-requests-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// NEW: Export requests as JSON (for backup)
app.get('/api/export/json', requireAdmin, (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="lm3dptfy-requests-${Date.now()}.json"`);
    res.json(requests);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Export failed' });
  }
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
  saveRequests();
  res.json({ ok: true, status });
});

// Archive / unarchive
app.post('/api/requests/:id/archive', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { archived } = req.body;

  if (typeof archived !== 'boolean') {
    return res.status(400).json({ error: 'archived must be boolean' });
  }

  const index = requests.findIndex((r) => r.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Request not found' });
  }

  requests[index].archived = archived;
  saveRequests();
  res.json({ ok: true, archived });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    requests: requests.length,
    emailEnabled: !!mailer 
  });
});

// Fallback: serve homepage
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`LM3DPTFY server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
