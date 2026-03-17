// server.js
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const STATIC_DIR = fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : __dirname;

app.set('trust proxy', 1);

// ========== ADMIN / EMAIL CONFIG =================================

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'lm3dptfy+admin@gmail.com';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'lm3dptfy@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!ADMIN_PASSWORD) {
console.error('ERROR: ADMIN_PASSWORD not set in environment variables!');
process.exit(1);
}

if (!SESSION_SECRET || SESSION_SECRET === 'change_this_in_production') {
console.error('ERROR: SESSION_SECRET is not set or is using the insecure default!');
process.exit(1);
}

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'LM3DPTFY <no-reply@lm3dptfy.online>';
const EMAIL_ENABLED = !!RESEND_API_KEY;

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
if (!GOOGLE_SHEET_ID) {
console.error('ERROR: GOOGLE_SHEET_ID not set in environment variables!');
process.exit(1);
}

const ACTIVE_SHEET_NAME = process.env.GOOGLE_ACTIVE_SHEET || 'Active';
const ARCHIVED_SHEET_NAME = process.env.GOOGLE_ARCHIVED_SHEET || 'Archived';
const SETTINGS_SHEET_NAME = process.env.GOOGLE_SETTINGS_SHEET || 'Settings';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.lm3dptfy.online';

const SHEET_HEADER = [
'ID', 'Created', 'Name', 'Email', 'STL Link',
'Details', 'Status', 'Fulfilled By', 'Archived', 'Admin Notes', 'Tracking #',
];

const VALID_STATUSES = [
'new', 'quoted', 'confirmed', 'printing', 'shipped', 'cancelled',
];

const STATUS_LABELS = {
new: 'New',
quoted: 'Quoted',
confirmed: 'Confirmed',
printing: 'Printing',
shipped: 'Shipped',
cancelled: 'Cancelled',
};

function statusToSheet(status) {
return STATUS_LABELS[status] || STATUS_LABELS.new;
}

function sheetToStatus(value) {
if (!value) return 'new';
const norm = String(value).trim().toLowerCase().replace(/[*\s]+/g, '_');
return VALID_STATUSES.includes(norm) ? norm : 'new';
}

// ========== SETTINGS =============================================

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const REQUESTS_CACHE_FILE = path.join(__dirname, 'requests-cache.json');

function slugify(str) {
return String(str || '').trim().toLowerCase()
.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

function normalizeHost(host) {
return String(host || '').trim().toLowerCase().replace(/^www./, '').replace(/\s+/g, '');
}

function defaultSettings() {
return {
fulfilledByNames: ['Robert', 'Jared', 'Terence'],
supportedSites: [{
id: 'stlflix',
name: 'STLFlix',
hosts: ['stlflix.com', 'platform.stlflix.com'],
browseUrl: 'https://platform.stlflix.com/explore',
enabled: true,
}],
};
}

let settings = defaultSettings();

function sanitizeFulfillers(names) {
const arr = Array.isArray(names) ? names : [];
const clean = arr.map((x) => String(x || '').trim()).filter((x) => x.length > 0).slice(0, 30);
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
const name = String(s && s.name || '').trim();
if (!name) continue;
let id = String(s && s.id || '').trim();
if (!id) id = slugify(name);
id = slugify(id);
if (!id) continue;
let finalId = id;
let i = 2;
while (seenIds.has(finalId)) { finalId = id + '-' + (i++); }
seenIds.add(finalId);
const hostsRaw = Array.isArray(s && s.hosts) ? s.hosts : [];
const hosts = Array.from(new Set(hostsRaw.map(normalizeHost).filter(Boolean).slice(0, 30)));
const browseUrl = String(s && s.browseUrl || '').trim();
const enabled = typeof (s && s.enabled) === 'boolean' ? s.enabled : true;
out.push({ id: finalId, name, hosts, browseUrl: browseUrl || '', enabled });
}
return out;
}

function mergeSettings(incoming) {
const base = defaultSettings();
const merged = {
fulfilledByNames: sanitizeFulfillers(incoming && incoming.fulfilledByNames != null ? incoming.fulfilledByNames : base.fulfilledByNames),
supportedSites: sanitizeSites(incoming && incoming.supportedSites != null ? incoming.supportedSites : base.supportedSites),
};
if (!merged.fulfilledByNames.length) merged.fulfilledByNames = base.fulfilledByNames;
if (!merged.supportedSites.length) merged.supportedSites = base.supportedSites;
return merged;
}

function detectSourceFromLink(urlStr, sites) {
const link = String(urlStr || '').trim();
if (!link) return { name: 'Unknown', supported: false };
let u;
try { u = new URL(link); } catch { return { name: 'Unknown', supported: false }; }
const host = normalizeHost(u.hostname);
for (const site of sites || []) {
if (!Array.isArray(site.hosts)) continue;
const siteHosts = site.hosts.map(normalizeHost);
if (siteHosts.includes(host)) return { name: site.name, supported: !!site.enabled };
for (const h of siteHosts) {
if (h && host.endsWith('.' + h)) return { name: site.name, supported: !!site.enabled };
}
}
return { name: 'Unknown', supported: false };
}

function loadSettingsFromFile() {
try {
if (!fs.existsSync(SETTINGS_FILE)) return;
const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
settings = mergeSettings(JSON.parse(raw));
console.log('Loaded settings from settings.json.');
} catch (err) {
console.warn('Failed to load settings from settings.json:', err && err.message || err);
}
}

function writeSettingsToFile() {
try {
fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
} catch (err) {
console.warn('Failed to write settings.json:', err && err.message || err);
}
}

// ========== GLOBAL STATE =========================================

let requests = [];

function loadRequestsFromFile() {
try {
if (!fs.existsSync(REQUESTS_CACHE_FILE)) return;
const parsed = JSON.parse(fs.readFileSync(REQUESTS_CACHE_FILE, 'utf8'));
if (Array.isArray(parsed)) {
requests = parsed;
console.log('Loaded ' + requests.length + ' requests from requests-cache.json.');
}
} catch (err) {
console.warn('Failed to load requests-cache.json:', err && err.message || err);
}
}

function writeRequestsToFile() {
try {
fs.writeFileSync(REQUESTS_CACHE_FILE, JSON.stringify(requests, null, 2), 'utf8');
} catch (err) {
console.warn('Failed to write requests-cache.json:', err && err.message || err);
}
}

// ========== GOOGLE SHEETS CLIENT =================================

const GALLERY_FOLDER_ID = '1WWjzhZvhK3XzMhvwxvvY0PHYkR5HS7Pc';

let sheetsClient = null;
let driveClient = null;

if (process.env.GOOGLE_SERVICE_ACCOUNT) {
try {
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const auth = new google.auth.JWT(
credentials.client_email, null, credentials.private_key,
['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly']
);
sheetsClient = google.sheets({ version: 'v4', auth });
driveClient = google.drive({ version: 'v3', auth });
console.log('Google Sheets + Drive integration enabled. Service account:', credentials.client_email);
} catch (err) {
console.error('Failed to initialize Google clients:', err);
}
} else {
console.log('GOOGLE_SERVICE_ACCOUNT not set. Google Sheets/Drive integration disabled.');
}

// ========== HTML ESCAPE ==========================================

function escapeHtml(str) {
return String(str == null ? '' : str)
.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ========== EMAIL ================================================

async function sendNotificationEmail(newRequest) {
if (!EMAIL_ENABLED) {
console.warn('RESEND_API_KEY not set; skipping notification email.');
return;
}
const { name, email, stlLink, details } = newRequest;
const src = detectSourceFromLink(stlLink, settings.supportedSites);
const safeName = escapeHtml(name);
const safeEmail = escapeHtml(email);
const safeLink = escapeHtml(stlLink);
const safeDetails = escapeHtml(details);
const safeSrc = escapeHtml(src.name);
const subject = 'New LM3DPTFY quote request from ' + safeName;
const html = '<h2>New Quote Request</h2>'
+ '<p><strong>Name:</strong> ' + safeName + '</p>'
+ '<p><strong>Email:</strong> <a href="mailto:' + safeEmail + '">' + safeEmail + '</a></p>'
+ '<p><strong>Model link:</strong> <a href="' + safeLink + '">' + safeLink + '</a></p>'
+ '<p><strong>Detected source:</strong> ' + safeSrc + (src.supported ? '' : ' (not on supported list)') + '</p>'
+ '<p><strong>Details:</strong> ' + (safeDetails || '(none)') + '</p>'
+ '<p><a href="' + (process.env.BACKEND_URL || 'https://www.lm3dptfy.online') + '/admin.html">View in Admin Panel</a></p>';
try {
const res = await fetch('https://api.resend.com/emails', {
method: 'POST',
headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
body: JSON.stringify({ from: EMAIL_FROM, to: NOTIFY_EMAIL, subject, html }),
});
if (!res.ok) { const txt = await res.text(); throw new Error('Resend error ' + res.status + ': ' + txt); }
console.log('Admin notification email sent successfully via Resend.');
} catch (err) {
console.error('Error sending admin notification email via Resend:', err);
}
}

// ========== MIDDLEWARE ===========================================

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
secret: SESSION_SECRET,
resave: false,
saveUninitialized: false,
cookie: {
secure: process.env.NODE_ENV === 'production',
httpOnly: true,
maxAge: 24 * 60 * 60 * 1000,
sameSite: 'lax',
},
}));

const loginLimiter = rateLimit({
windowMs: 15 * 60 * 1000, max: 10,
message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
standardHeaders: true, legacyHeaders: false,
});

const requestLimiter = rateLimit({
windowMs: 60 * 60 * 1000, max: 15,
message: { error: 'Too many requests from this IP. Please try again later.' },
standardHeaders: true, legacyHeaders: false,
});

app.get('/', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(STATIC_DIR, 'index.html')); });
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.use(express.static(STATIC_DIR, {
  maxAge: '7d',
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ========== HELPERS ==============================================

function requireAdmin(req, res, next) {
if (req.session && req.session.admin && req.session.admin.email === ADMIN_EMAIL) return next();
res.status(401).json({ error: 'Unauthorized' });
}

function validateStatus(status) { return VALID_STATUSES.includes(status); }

function parseCreatedToIso(created) {
if (!created) return new Date().toISOString();
const parsed = Date.parse(created);
if (Number.isNaN(parsed)) return new Date().toISOString();
return new Date(parsed).toISOString();
}

function isValidEmail(email) {
return /^[^\s@]+@[^\s@]+.[^\s@]+$/.test(String(email || ''));
}

function mapRowToRequest(row) {
const id = row[0];
if (!id) return null;
const archived = String(row[8]).trim().toLowerCase() === 'yes' || String(row[8]).trim().toLowerCase() === 'true';
return {
id: String(id),
name: row[2] || '',
email: row[3] || '',
stlLink: row[4] || '',
details: row[5] || '',
status: sheetToStatus(row[6]),
fulfilledBy: row[7] || '',
archived,
adminNotes: row[9] || '',
trackingNumber: row[10] || '',
createdAt: parseCreatedToIso(row[1]),
updatedAt: new Date().toISOString(),
};
}

function requestToRow(r) {
const createdDate = new Date(r.createdAt);
const createdDisplay = Number.isNaN(createdDate.getTime()) ? r.createdAt || '' : createdDate.toLocaleString();
return [
r.id, createdDisplay, r.name || '', r.email || '', r.stlLink || '',
r.details || '', statusToSheet(r.status || 'new'), r.fulfilledBy || '',
r.archived ? 'Yes' : 'No', r.adminNotes || '', r.trackingNumber || '',
];
}

// ========== SHEETS SYNC ==========================================

async function ensureHeader(sheetName) {
const existing = await sheetsClient.spreadsheets.values.get({
spreadsheetId: GOOGLE_SHEET_ID, range: sheetName + '!A1:K1',
});
const current = (existing.data.values && existing.data.values[0]) ? existing.data.values[0] : [];
if (!current.length || current.join('') === '' || current.length < SHEET_HEADER.length) {
const merged = current.slice();
for (let i = 0; i < SHEET_HEADER.length; i++) { if (!merged[i]) merged[i] = SHEET_HEADER[i]; }
await sheetsClient.spreadsheets.values.update({
spreadsheetId: GOOGLE_SHEET_ID, range: sheetName + '!A1',
valueInputOption: 'RAW', requestBody: { values: [merged] },
});
console.log('Initialized/extended header row on sheet "' + sheetName + '".');
}
}

async function loadRequestsFromSheet() {
if (!sheetsClient) { console.warn('Google Sheets client not initialized; cannot load requests.'); return false; }
try {
await Promise.all([ensureHeader(ACTIVE_SHEET_NAME), ensureHeader(ARCHIVED_SHEET_NAME)]);
const [activeRes, archivedRes] = await Promise.all([
sheetsClient.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: ACTIVE_SHEET_NAME + '!A1:K10000' }),
sheetsClient.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: ARCHIVED_SHEET_NAME + '!A1:K10000' }),
]);
const activeRows = (activeRes.data.values || []).slice(1);
const archivedRows = (archivedRes.data.values || []).slice(1);
const activeRequests = activeRows.map(mapRowToRequest).filter(Boolean).map((r) => Object.assign({}, r, { archived: false }));
const archivedRequests = archivedRows.map(mapRowToRequest).filter(Boolean).map((r) => Object.assign({}, r, { archived: true }));
requests = activeRequests.concat(archivedRequests).sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
writeRequestsToFile();
console.log('Loaded ' + requests.length + ' requests from Sheets.');
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
const activeValues = [SHEET_HEADER].concat(active.map(requestToRow));
const archivedValues = [SHEET_HEADER].concat(archived.map(requestToRow));
await Promise.all([
sheetsClient.spreadsheets.values.clear({ spreadsheetId: GOOGLE_SHEET_ID, range: ACTIVE_SHEET_NAME + '!A2:K10000' }),
sheetsClient.spreadsheets.values.clear({ spreadsheetId: GOOGLE_SHEET_ID, range: ARCHIVED_SHEET_NAME + '!A2:K10000' }),
]);
await Promise.all([
sheetsClient.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: ACTIVE_SHEET_NAME + '!A1', valueInputOption: 'RAW', requestBody: { values: activeValues } }),
sheetsClient.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: ARCHIVED_SHEET_NAME + '!A1', valueInputOption: 'RAW', requestBody: { values: archivedValues } }),
]);
writeRequestsToFile();
console.log('Synced to Sheets: ' + active.length + ' active, ' + archived.length + ' archived.');
return true;
}

// ========== SETTINGS SHEET =======================================

async function getSheetTitles() {
const meta = await sheetsClient.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: 'sheets.properties.title' });
return (meta.data.sheets || []).map((s) => s.properties.title);
}

async function ensureSheetTab(title) {
const titles = await getSheetTitles();
if (titles.includes(title)) return;
await sheetsClient.spreadsheets.batchUpdate({
spreadsheetId: GOOGLE_SHEET_ID,
requestBody: { requests: [{ addSheet: { properties: { title } } }] },
});
console.log('Created sheet tab "' + title + '".');
}

async function ensureSettingsHeader() {
await ensureSheetTab(SETTINGS_SHEET_NAME);
const existing = await sheetsClient.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: SETTINGS_SHEET_NAME + '!A1:B1' });
const row = (existing.data.values && existing.data.values[0]) ? existing.data.values[0] : [];
if (row[0] !== 'Key' || row[1] !== 'Value') {
await sheetsClient.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: SETTINGS_SHEET_NAME + '!A1', valueInputOption: 'RAW', requestBody: { values: [['Key', 'Value']] } });
}
}

async function loadSettingsFromSheet() {
if (!sheetsClient) return false;
try {
await ensureSettingsHeader();
const res = await sheetsClient.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: SETTINGS_SHEET_NAME + '!A2:B200' });
const rows = res.data.values || [];
const map = new Map();
for (const r of rows) {
const k = String(r[0] || '').trim();
const v = String(r[1] || '').trim();
if (k) map.set(k, v);
}
const incoming = {};
if (map.has('fulfilledByNames')) { try { incoming.fulfilledByNames = JSON.parse(map.get('fulfilledByNames')); } catch (e) {} }
if (map.has('supportedSites')) { try { incoming.supportedSites = JSON.parse(map.get('supportedSites')); } catch (e) {} }
settings = mergeSettings(incoming);
writeSettingsToFile();
console.log('Loaded settings from Sheets.');
return true;
} catch (err) {
console.warn('Failed to load settings from Sheets:', err && err.message || err);
return false;
}
}

async function writeSettingsToSheet() {
if (!sheetsClient) return false;
await ensureSettingsHeader();
const values = [['Key', 'Value'], ['fulfilledByNames', JSON.stringify(settings.fulfilledByNames)], ['supportedSites', JSON.stringify(settings.supportedSites)]];
await sheetsClient.spreadsheets.values.clear({ spreadsheetId: GOOGLE_SHEET_ID, range: SETTINGS_SHEET_NAME + '!A2:B200' });
await sheetsClient.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: SETTINGS_SHEET_NAME + '!A1', valueInputOption: 'RAW', requestBody: { values } });
return true;
}

async function saveSettings() {
settings = mergeSettings(settings);
writeSettingsToFile();
if (sheetsClient) { writeSettingsToSheet().catch((e) => console.warn('Failed to write settings to Sheets:', e && e.message || e)); }
}

// ========== EXPORT ===============================================

function csvEscape(value) {
const s = String(value == null ? '' : value);
if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
return s;
}

function requestsToCsv(rows) {
const header = ['ID', 'Created', 'Name', 'Email', 'Model Link', 'Details', 'Status', 'Fulfilled By', 'Archived', 'Admin Notes', 'Tracking #'];
const lines = [header.join(',')];
for (const r of rows) {
const createdDisplay = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
lines.push([r.id, createdDisplay, r.name, r.email, r.stlLink, r.details, statusToSheet(r.status), r.fulfilledBy, r.archived ? 'Yes' : 'No', r.adminNotes, r.trackingNumber].map(csvEscape).join(','));
}
return lines.join('\n');
}

// ========== ROUTES ===============================================

app.get('/api/health', requireAdmin, (req, res) => {
res.json({ ok: true, env: process.env.NODE_ENV || 'development', emailEnabled: EMAIL_ENABLED, sheetsEnabled: !!sheetsClient });
});

app.get('/api/public/sites', (req, res) => {
const sites = (settings.supportedSites || []).filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name, hosts: s.hosts, browseUrl: s.browseUrl }));
res.json({ ok: true, sites });
});

app.get('/api/gallery', async (req, res) => {
if (!driveClient) return res.json({ ok: true, files: [] });
try {
const response = await driveClient.files.list({
q: `'${GALLERY_FOLDER_ID}' in parents and trashed=false`,
fields: 'files(id,name,mimeType,createdTime)',
orderBy: 'createdTime desc',
pageSize: 100,
});
const files = (response.data.files || []).map(f => ({
id: f.id,
name: f.name,
mimeType: f.mimeType,
isVideo: f.mimeType.startsWith('video/'),
thumb: `/api/gallery/image/${f.id}`,
full: `/api/gallery/image/${f.id}`,
embed: `https://drive.google.com/file/d/${f.id}/preview`,
}));
res.json({ ok: true, files });
} catch (err) {
console.error('Gallery fetch error:', err.message);
res.status(500).json({ ok: false, error: 'Failed to load gallery.' });
}
});

app.get('/api/gallery/image/:id', async (req, res) => {
if (!driveClient) return res.status(503).send('Drive not configured');
const id = req.params.id;
if (!/^[a-zA-Z0-9_-]+$/.test(id)) return res.status(400).send('Invalid id');
try {
const meta = await driveClient.files.get({ fileId: id, fields: 'mimeType' });
const mimeType = meta.data.mimeType || 'image/jpeg';
const stream = await driveClient.files.get({ fileId: id, alt: 'media' }, { responseType: 'stream' });
res.setHeader('Content-Type', mimeType);
res.setHeader('Cache-Control', 'public, max-age=86400');
stream.data.pipe(res);
} catch (err) {
console.error('Gallery image proxy error:', err.message);
res.status(500).send('Failed to load image');
}
});

app.post('/api/requests', requestLimiter, async (req, res) => {
const { stlLink, name, email, details } = req.body;
if (!stlLink || !name || !email) return res.status(400).json({ error: 'Missing required fields.' });
if (String(name).length > 120) return res.status(400).json({ error: 'Name is too long (max 120 characters).' });
if (String(email).length > 200) return res.status(400).json({ error: 'Email is too long (max 200 characters).' });
if (String(stlLink).length > 2000) return res.status(400).json({ error: 'Model link is too long (max 2000 characters).' });
if (details && String(details).length > 4000) return res.status(400).json({ error: 'Details are too long (max 4000 characters).' });
if (!isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
const nowIso = new Date().toISOString();
const newRequest = {
id: crypto.randomUUID(), stlLink, name, email, details: details || '',
status: 'new', createdAt: nowIso, updatedAt: nowIso,
fulfilledBy: '', archived: false, adminNotes: '', trackingNumber: '',
};
requests.unshift(newRequest);
writeRequestsToFile();
if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
sendNotificationEmail(newRequest).catch(() => {});
res.status(201).json({ ok: true, id: newRequest.id });
});

app.post('/api/login', loginLimiter, (req, res) => {
const { email, password } = req.body;
if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
req.session.admin = { email };
return res.json({ ok: true });
}
res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/settings', requireAdmin, (req, res) => { res.json({ ok: true, settings }); });

async function handleUpdateFulfillers(req, res) {
const names = sanitizeFulfillers(req.body && req.body.names);
if (!names.length) return res.status(400).json({ error: 'Provide at least one name.' });
settings.fulfilledByNames = names;
await saveSettings();
res.json({ ok: true, fulfilledByNames: settings.fulfilledByNames });
}
app.put('/api/settings/fulfillers', requireAdmin, handleUpdateFulfillers);
app.post('/api/settings/fulfillers', requireAdmin, handleUpdateFulfillers);

async function handleUpdateSites(req, res) {
const sites = sanitizeSites(req.body && req.body.sites);
if (!sites.length) return res.status(400).json({ error: 'Provide at least one site.' });
settings.supportedSites = sites;
await saveSettings();
res.json({ ok: true, supportedSites: settings.supportedSites });
}
app.put('/api/settings/sites', requireAdmin, handleUpdateSites);
app.post('/api/settings/sites', requireAdmin, handleUpdateSites);

app.post('/api/settings/reload', requireAdmin, async (req, res) => {
if (sheetsClient) { await loadSettingsFromSheet(); } else { loadSettingsFromFile(); }
res.json({ ok: true, settings });
});

app.get('/api/requests', requireAdmin, (req, res) => { res.json(requests); });

app.post('/api/requests/:id/status', requireAdmin, (req, res) => {
const r = requests.find((x) => x.id === req.params.id);
if (!r) return res.status(404).json({ error: 'Request not found' });
if (!validateStatus(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
r.status = req.body.status; r.updatedAt = new Date().toISOString();
writeRequestsToFile(); res.json({ ok: true, request: r });
if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

app.post('/api/requests/:id/fulfilled', requireAdmin, (req, res) => {
const r = requests.find((x) => x.id === req.params.id);
if (!r) return res.status(404).json({ error: 'Request not found' });
r.fulfilledBy = req.body.fulfilledBy || ''; r.updatedAt = new Date().toISOString();
writeRequestsToFile(); res.json({ ok: true, request: r });
if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

app.post('/api/requests/:id/admin-notes', requireAdmin, (req, res) => {
const r = requests.find((x) => x.id === req.params.id);
if (!r) return res.status(404).json({ error: 'Request not found' });
r.adminNotes = String(req.body.adminNotes || ''); r.updatedAt = new Date().toISOString();
writeRequestsToFile(); res.json({ ok: true, request: r });
if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

app.post('/api/requests/:id/tracking', requireAdmin, (req, res) => {
const r = requests.find((x) => x.id === req.params.id);
if (!r) return res.status(404).json({ error: 'Request not found' });
r.trackingNumber = String(req.body.trackingNumber || '').trim(); r.updatedAt = new Date().toISOString();
writeRequestsToFile(); res.json({ ok: true, request: r });
if (sheetsClient) writeAllRequestsToSheet().catch(console.error);
});

app.post('/api/requests/:id/archive', requireAdmin, (req, res) => {
if (typeof req.body.archived !== 'boolean') return res.status(400).json({ error: 'archived must be boolean' });
const r = requests.find((x) => x.id === req.params.id);
if (!r) return res.status(404).json({ error: 'Request not found' });
r.archived = req.body.archived; r.updatedAt = new Date().toISOString();
writeRequestsToFile(); res.json({ ok: true, request: r });
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

app.get('/api/export/json', requireAdmin, (req, res) => {
res.setHeader('Content-Type', 'application/json; charset=utf-8');
res.setHeader('Content-Disposition', 'attachment; filename="lm3dptfy-requests.json"');
res.send(JSON.stringify(requests, null, 2));
});

app.get('/api/export/csv', requireAdmin, (req, res) => {
res.setHeader('Content-Type', 'text/csv; charset=utf-8');
res.setHeader('Content-Disposition', 'attachment; filename="lm3dptfy-requests.csv"');
res.send(requestsToCsv(requests));
});

// ========== STARTUP ==============================================

(async () => {
try {
loadSettingsFromFile();
loadRequestsFromFile();
if (sheetsClient) {
await loadSettingsFromSheet();
await loadRequestsFromSheet();
}
} catch (err) {
console.warn('Startup load issue:', err && err.message || err);
}
app.listen(PORT, () => { console.log('LM3DPTFY server running on http://localhost:' + PORT); });
})();
