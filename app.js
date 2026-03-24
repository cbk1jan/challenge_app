'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

// Ensure data and uploads dirs exist
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Trust proxy if running behind reverse proxy (e.g. nginx in Docker)
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

// Session store
const SQLiteStore = require('connect-sqlite3')(session);
const sessionMiddleware = session({
  store: new SQLiteStore({ dir: dataDir, db: 'sessions.db' }),
  secret: process.env.SESSION_SECRET || 'changeme-use-strong-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY === '1'
  }
});

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.test(ext)) return cb(null, true);
    cb(new Error('Nur Bilddateien erlaubt (jpeg, jpg, png, gif, webp)'));
  }
});

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Share io with routes
app.set('io', io);
app.set('upload', upload);

// CSRF middleware: generate token per session, expose to templates
app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.session = req.session;
  res.locals.isAdmin = !!(req.session && req.session.adminId);
  res.locals.isTeam = !!(req.session && req.session.teamId);
  next();
});

// CSRF validation for non-multipart POST/PUT/DELETE
// Multipart routes validate CSRF after multer (token in form body)
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next();
  const ct = req.headers['content-type'] || '';
  if (ct.startsWith('multipart/')) return next(); // handled per-route after multer
  const token = req.body._csrf || req.headers['x-csrf-token'];
  if (!req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).render('error', {
      title: 'Ungültige Anfrage',
      message: 'CSRF-Token ungültig. Bitte Seite neu laden und erneut versuchen.',
      code: 403
    });
  }
  next();
});

// Rate limiting on authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' }
});
app.use('/login', authLimiter);

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const teamRoutes = require('./routes/team');

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/team', teamRoutes);

// Root redirect
app.get('/', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin/dashboard');
  if (req.session.teamId) return res.redirect('/team/dashboard');
  res.redirect('/login');
});

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Seite nicht gefunden', message: 'Die angeforderte Seite wurde nicht gefunden.', code: 404 });
});

// 500
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err.stack);
  res.status(500).render('error', { title: 'Serverfehler', message: 'Ein interner Fehler ist aufgetreten.', code: 500 });
});

// Socket.io session sharing
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (sess && sess.adminId) {
    socket.join('admins');
  }
  if (sess && sess.teamId) {
    socket.join(`team_${sess.teamId}`);
  }
  socket.join('leaderboard');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
  // Initialize DB after server starts
  require('./db').init();
});

module.exports = { app, io };
