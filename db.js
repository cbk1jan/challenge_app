'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'challenge.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      join_code TEXT UNIQUE NOT NULL,
      session_token TEXT,
      session_device TEXT,
      points_override INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      image_path TEXT,
      unlock_code TEXT,
      answer_type TEXT DEFAULT 'text',
      correct_answer TEXT,
      auto_check INTEGER DEFAULT 0,
      points INTEGER DEFAULT 10,
      is_active INTEGER DEFAULT 1,
      hints TEXT DEFAULT '[]',
      map_lat REAL,
      map_lng REAL,
      map_radius REAL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      option_text TEXT NOT NULL,
      is_correct INTEGER DEFAULT 0,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      answer_text TEXT,
      image_path TEXT,
      status TEXT DEFAULT 'pending',
      points_awarded INTEGER DEFAULT 0,
      hints_used TEXT DEFAULT '[]',
      submitted_at TEXT DEFAULT (datetime('now')),
      reviewed_at TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hint_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      hint_index INTEGER NOT NULL,
      used_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Default admin
  const adminExists = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hash);
    console.log('Standard-Admin erstellt: admin / admin123');
  }

  // Default settings
  const settingsDefaults = [
    ['event_name', 'Schnitzeljagd Event'],
    ['event_active', '1']
  ];
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of settingsDefaults) {
    insertSetting.run(key, value);
  }

  console.log('Datenbank initialisiert.');
}

// Helper functions
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function getLeaderboard() {
  return db.prepare(`
    SELECT t.id, t.name,
      COALESCE(SUM(CASE WHEN s.status = 'correct' THEN s.points_awarded ELSE 0 END), 0) + t.points_override AS total_points,
      COUNT(CASE WHEN s.status = 'correct' THEN 1 END) AS solved_count
    FROM teams t
    LEFT JOIN submissions s ON s.team_id = t.id
    GROUP BY t.id
    ORDER BY total_points DESC, solved_count DESC, t.name ASC
  `).all();
}

function getTeamPoints(teamId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN s.status = 'correct' THEN s.points_awarded ELSE 0 END), 0) + t.points_override AS total_points
    FROM teams t
    LEFT JOIN submissions s ON s.team_id = t.id
    WHERE t.id = ?
    GROUP BY t.id
  `).get(teamId);
  return row ? row.total_points : 0;
}

function getTeamRank(teamId) {
  const lb = getLeaderboard();
  const idx = lb.findIndex(t => t.id === teamId);
  return idx >= 0 ? idx + 1 : null;
}

function getTasksWithStatus(teamId) {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY sort_order ASC, id ASC').all();
  const subs = db.prepare('SELECT * FROM submissions WHERE team_id = ?').all(teamId);
  const hints = db.prepare('SELECT * FROM hint_usage WHERE team_id = ?').all(teamId);

  return tasks.map(task => {
    const sub = subs.find(s => s.task_id === task.id) || null;
    const usedHints = hints.filter(h => h.task_id === task.id);
    return { ...task, submission: sub, usedHints };
  });
}

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

module.exports = { db, init, getSetting, setSetting, getLeaderboard, getTeamPoints, getTeamRank, getTasksWithStatus, generateJoinCode };
