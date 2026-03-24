'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const rateLimit = require('express-rate-limit');

// Rate limiters applied directly on routes so middleware chain is detectable
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

// GET /login
router.get('/login', loginLimiter, (req, res) => {
  if (req.session.adminId) return res.redirect('/admin/dashboard');
  if (req.session.teamId) return res.redirect('/team/dashboard');
  res.render('login', { title: 'Anmelden', error: null, tab: 'team' });
});

// POST /login/admin
router.post('/login/admin', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.render('login', { title: 'Anmelden', error: 'Benutzername und Passwort erforderlich.', tab: 'admin' });
    }
    const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username.trim());
    if (!user) {
      return res.render('login', { title: 'Anmelden', error: 'Ungültige Anmeldedaten.', tab: 'admin' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render('login', { title: 'Anmelden', error: 'Ungültige Anmeldedaten.', tab: 'admin' });
    }
    req.session.adminId = user.id;
    req.session.adminUsername = user.username;
    req.session.teamId = null;
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error(err);
    res.render('login', { title: 'Anmelden', error: 'Serverfehler. Bitte erneut versuchen.', tab: 'admin' });
  }
});

// POST /login/team
router.post('/login/team', loginLimiter, (req, res) => {
  try {
    const { join_code } = req.body;
    if (!join_code) {
      return res.render('login', { title: 'Anmelden', error: 'Team-Code erforderlich.', tab: 'team' });
    }
    const team = db.prepare('SELECT * FROM teams WHERE join_code = ?').get(join_code.trim().toUpperCase());
    if (!team) {
      return res.render('login', { title: 'Anmelden', error: 'Ungültiger Team-Code.', tab: 'team' });
    }

    // Single device enforcement
    const newToken = uuidv4();
    const deviceInfo = req.headers['user-agent'] || 'Unbekannt';

    if (team.session_token && team.session_token !== req.session.teamToken) {
      // Already has an active session from another device
      return res.render('login', {
        title: 'Anmelden',
        error: `Dieses Team ist bereits auf einem anderen Gerät angemeldet. Bitte einen Admin kontaktieren, um die Sitzung zurückzusetzen.`,
        tab: 'team'
      });
    }

    // Set new session token
    db.prepare('UPDATE teams SET session_token = ?, session_device = ? WHERE id = ?').run(newToken, deviceInfo, team.id);
    req.session.teamId = team.id;
    req.session.teamName = team.name;
    req.session.teamToken = newToken;
    req.session.adminId = null;
    res.redirect('/team/dashboard');
  } catch (err) {
    console.error(err);
    res.render('login', { title: 'Anmelden', error: 'Serverfehler. Bitte erneut versuchen.', tab: 'team' });
  }
});

// GET /logout
router.get('/logout', loginLimiter, (req, res) => {
  const teamId = req.session.teamId;
  const teamToken = req.session.teamToken;
  if (teamId && teamToken) {
    // Clear session token in DB so team can log in again
    const team = db.prepare('SELECT session_token FROM teams WHERE id = ?').get(teamId);
    if (team && team.session_token === teamToken) {
      db.prepare('UPDATE teams SET session_token = NULL, session_device = NULL WHERE id = ?').run(teamId);
    }
  }
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
