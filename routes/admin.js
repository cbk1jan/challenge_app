'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { db, getSetting, setSetting, getLeaderboard, generateJoinCode } = require('../db');

// Admin auth middleware
function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.redirect('/login');
  }
  next();
}

router.use(requireAdmin);

// GET /admin -> redirect to dashboard
router.get('/', (req, res) => res.redirect('/admin/dashboard'));

// GET /admin/dashboard
router.get('/dashboard', (req, res) => {
  try {
    const teamCount = db.prepare('SELECT COUNT(*) as c FROM teams').get().c;
    const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
    const submissionCount = db.prepare('SELECT COUNT(*) as c FROM submissions').get().c;
    const pendingCount = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE status = 'pending' OR status = 'in_review'").get().c;
    const recentSubmissions = db.prepare(`
      SELECT s.*, t.name as team_name, tk.title as task_title
      FROM submissions s
      JOIN teams t ON t.id = s.team_id
      JOIN tasks tk ON tk.id = s.task_id
      ORDER BY s.submitted_at DESC LIMIT 10
    `).all();
    const eventName = getSetting('event_name');
    res.render('admin/dashboard', {
      title: 'Dashboard',
      teamCount, taskCount, submissionCount, pendingCount,
      recentSubmissions, eventName
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

// GET /admin/teams
router.get('/teams', (req, res) => {
  try {
    const teams = db.prepare(`
      SELECT t.*,
        COALESCE(SUM(CASE WHEN s.status = 'correct' THEN s.points_awarded ELSE 0 END), 0) + t.points_override AS total_points,
        COUNT(CASE WHEN s.status = 'correct' THEN 1 END) AS solved_count,
        COUNT(s.id) AS submission_count
      FROM teams t
      LEFT JOIN submissions s ON s.team_id = t.id
      GROUP BY t.id
      ORDER BY t.name ASC
    `).all();
    res.render('admin/teams', { title: 'Teams', teams, success: req.query.success, error: req.query.error });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

// POST /admin/teams
router.post('/teams', (req, res) => {
  try {
    const { name, points_override } = req.body;
    if (!name || !name.trim()) {
      return res.redirect('/admin/teams?error=Name+erforderlich');
    }
    let joinCode;
    let attempts = 0;
    do {
      joinCode = generateJoinCode();
      attempts++;
      if (attempts > 100) throw new Error('Konnte keinen eindeutigen Code generieren');
    } while (db.prepare('SELECT id FROM teams WHERE join_code = ?').get(joinCode));

    db.prepare('INSERT INTO teams (name, join_code, points_override) VALUES (?, ?, ?)').run(
      name.trim(), joinCode, parseInt(points_override) || 0
    );
    res.redirect('/admin/teams?success=Team+erstellt');
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes('UNIQUE')) {
      return res.redirect('/admin/teams?error=Team+existiert+bereits');
    }
    res.redirect('/admin/teams?error=' + encodeURIComponent(err.message));
  }
});

// GET /admin/teams/:id/edit
router.get('/teams/:id/edit', (req, res) => {
  try {
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!team) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Team nicht gefunden.', code: 404 });
    res.render('admin/team_edit', { title: 'Team bearbeiten', team, error: null, success: null });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

// POST /admin/teams/:id
router.post('/teams/:id', (req, res) => {
  try {
    const { name, points_override } = req.body;
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
    if (!team) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Team nicht gefunden.', code: 404 });

    db.prepare('UPDATE teams SET name = ?, points_override = ? WHERE id = ?').run(
      name.trim(), parseInt(points_override) || 0, team.id
    );
    res.render('admin/team_edit', { title: 'Team bearbeiten', team: { ...team, name: name.trim(), points_override: parseInt(points_override) || 0 }, error: null, success: 'Gespeichert.' });
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes('UNIQUE')) {
      const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
      return res.render('admin/team_edit', { title: 'Team bearbeiten', team, error: 'Name bereits vergeben.', success: null });
    }
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

// POST /admin/teams/:id/delete
router.post('/teams/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
    res.redirect('/admin/teams?success=Team+gelöscht');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/teams?error=' + encodeURIComponent(err.message));
  }
});

// POST /admin/teams/:id/reset-session
router.post('/teams/:id/reset-session', (req, res) => {
  try {
    db.prepare('UPDATE teams SET session_token = NULL, session_device = NULL WHERE id = ?').run(req.params.id);
    res.redirect('/admin/teams?success=Sitzung+zurückgesetzt');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/teams?error=' + encodeURIComponent(err.message));
  }
});

// GET /admin/tasks
router.get('/tasks', (req, res) => {
  try {
    const tasks = db.prepare('SELECT * FROM tasks ORDER BY sort_order ASC, id ASC').all();
    res.render('admin/tasks', { title: 'Aufgaben', tasks, success: req.query.success, error: req.query.error });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

// GET /admin/tasks/new
router.get('/tasks/new', (req, res) => {
  res.render('admin/task_form', { title: 'Neue Aufgabe', task: null, options: [], error: null });
});

// POST /admin/tasks
router.post('/tasks', (req, res) => {
  const upload = req.app.get('upload');
  upload.single('image')(req, res, (uploadErr) => {
    try {
      if (uploadErr) {
        return res.render('admin/task_form', { title: 'Neue Aufgabe', task: null, options: [], error: uploadErr.message });
      }
      const { title, description, unlock_code, answer_type, correct_answer, auto_check, points, is_active, hints_json, map_lat, map_lng, map_radius, sort_order } = req.body;
      if (!title || !title.trim()) {
        return res.render('admin/task_form', { title: 'Neue Aufgabe', task: null, options: [], error: 'Titel erforderlich.' });
      }

      let hintsArr = [];
      try { hintsArr = JSON.parse(hints_json || '[]'); } catch (_e) { hintsArr = []; }

      const image_path = req.file ? '/uploads/' + req.file.filename : null;

      const result = db.prepare(`
        INSERT INTO tasks (title, description, image_path, unlock_code, answer_type, correct_answer, auto_check, points, is_active, hints, map_lat, map_lng, map_radius, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        title.trim(), description || '', image_path, unlock_code || null,
        answer_type || 'text', correct_answer || '', auto_check === '1' ? 1 : 0,
        parseInt(points) || 10, is_active === '1' ? 1 : 0,
        JSON.stringify(hintsArr),
        map_lat ? parseFloat(map_lat) : null,
        map_lng ? parseFloat(map_lng) : null,
        map_radius ? parseFloat(map_radius) : null,
        parseInt(sort_order) || 0
      );

      // Save task options for multiple choice
      if (answer_type === 'multiple_choice' && req.body.option_text) {
        const optionTexts = Array.isArray(req.body.option_text) ? req.body.option_text : [req.body.option_text];
        const optionCorrects = Array.isArray(req.body.option_correct) ? req.body.option_correct : (req.body.option_correct ? [req.body.option_correct] : []);
        const insertOption = db.prepare('INSERT INTO task_options (task_id, option_text, is_correct) VALUES (?, ?, ?)');
        optionTexts.forEach((text, i) => {
          if (text.trim()) insertOption.run(result.lastInsertRowid, text.trim(), optionCorrects.includes(String(i)) ? 1 : 0);
        });
      }

      res.redirect('/admin/tasks?success=Aufgabe+erstellt');
    } catch (err) {
      console.error(err);
      res.render('admin/task_form', { title: 'Neue Aufgabe', task: null, options: [], error: err.message });
    }
  });
});

// GET /admin/tasks/:id/edit
router.get('/tasks/:id/edit', (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Aufgabe nicht gefunden.', code: 404 });
    const options = db.prepare('SELECT * FROM task_options WHERE task_id = ? ORDER BY id ASC').all(task.id);
    res.render('admin/task_form', { title: 'Aufgabe bearbeiten', task, options, error: null });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

// POST /admin/tasks/:id
router.post('/tasks/:id', (req, res) => {
  const upload = req.app.get('upload');
  upload.single('image')(req, res, (uploadErr) => {
    try {
      if (uploadErr) {
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
        const options = db.prepare('SELECT * FROM task_options WHERE task_id = ?').all(req.params.id);
        return res.render('admin/task_form', { title: 'Aufgabe bearbeiten', task, options, error: uploadErr.message });
      }
      const { title, description, unlock_code, answer_type, correct_answer, auto_check, points, is_active, hints_json, map_lat, map_lng, map_radius, sort_order, remove_image } = req.body;

      const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Aufgabe nicht gefunden.', code: 404 });

      let hintsArr = [];
      try { hintsArr = JSON.parse(hints_json || '[]'); } catch (_e) { hintsArr = []; }

      let image_path = existing.image_path;
      if (req.file) {
        image_path = '/uploads/' + req.file.filename;
      } else if (remove_image === '1') {
        image_path = null;
      }

      db.prepare(`
        UPDATE tasks SET title=?, description=?, image_path=?, unlock_code=?, answer_type=?, correct_answer=?,
        auto_check=?, points=?, is_active=?, hints=?, map_lat=?, map_lng=?, map_radius=?, sort_order=? WHERE id=?
      `).run(
        title.trim(), description || '', image_path, unlock_code || null,
        answer_type || 'text', correct_answer || '', auto_check === '1' ? 1 : 0,
        parseInt(points) || 10, is_active === '1' ? 1 : 0,
        JSON.stringify(hintsArr),
        map_lat ? parseFloat(map_lat) : null,
        map_lng ? parseFloat(map_lng) : null,
        map_radius ? parseFloat(map_radius) : null,
        parseInt(sort_order) || 0,
        req.params.id
      );

      // Update options
      db.prepare('DELETE FROM task_options WHERE task_id = ?').run(req.params.id);
      if (answer_type === 'multiple_choice' && req.body.option_text) {
        const optionTexts = Array.isArray(req.body.option_text) ? req.body.option_text : [req.body.option_text];
        const optionCorrects = Array.isArray(req.body.option_correct) ? req.body.option_correct : (req.body.option_correct ? [req.body.option_correct] : []);
        const insertOption = db.prepare('INSERT INTO task_options (task_id, option_text, is_correct) VALUES (?, ?, ?)');
        optionTexts.forEach((text, i) => {
          if (text.trim()) insertOption.run(req.params.id, text.trim(), optionCorrects.includes(String(i)) ? 1 : 0);
        });
      }

      res.redirect('/admin/tasks?success=Aufgabe+gespeichert');
    } catch (err) {
      console.error(err);
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
      const options = db.prepare('SELECT * FROM task_options WHERE task_id = ?').all(req.params.id);
      res.render('admin/task_form', { title: 'Aufgabe bearbeiten', task, options, error: err.message });
    }
  });
});

// POST /admin/tasks/:id/duplicate
router.post('/tasks/:id/duplicate', (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.redirect('/admin/tasks?error=Aufgabe+nicht+gefunden');
    const result = db.prepare(`
      INSERT INTO tasks (title, description, image_path, unlock_code, answer_type, correct_answer, auto_check, points, is_active, hints, map_lat, map_lng, map_radius, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.title + ' (Kopie)', task.description, task.image_path, task.unlock_code,
      task.answer_type, task.correct_answer, task.auto_check, task.points, 0,
      task.hints, task.map_lat, task.map_lng, task.map_radius, task.sort_order + 1
    );
    const options = db.prepare('SELECT * FROM task_options WHERE task_id = ?').all(task.id);
    const insertOption = db.prepare('INSERT INTO task_options (task_id, option_text, is_correct) VALUES (?, ?, ?)');
    options.forEach(o => insertOption.run(result.lastInsertRowid, o.option_text, o.is_correct));
    res.redirect('/admin/tasks?success=Aufgabe+dupliziert');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/tasks?error=' + encodeURIComponent(err.message));
  }
});

// POST /admin/tasks/:id/delete
router.post('/tasks/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    res.redirect('/admin/tasks?success=Aufgabe+gelöscht');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/tasks?error=' + encodeURIComponent(err.message));
  }
});

// POST /admin/tasks/:id/toggle
router.post('/tasks/:id/toggle', (req, res) => {
  try {
    const task = db.prepare('SELECT is_active FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.redirect('/admin/tasks?error=Aufgabe+nicht+gefunden');
    db.prepare('UPDATE tasks SET is_active = ? WHERE id = ?').run(task.is_active ? 0 : 1, req.params.id);
    res.redirect('/admin/tasks');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/tasks?error=' + encodeURIComponent(err.message));
  }
});

// GET /admin/submissions
router.get('/submissions', (req, res) => {
  try {
    const { status, team_id, task_id } = req.query;
    let query = `
      SELECT s.*, t.name as team_name, tk.title as task_title
      FROM submissions s
      JOIN teams t ON t.id = s.team_id
      JOIN tasks tk ON tk.id = s.task_id
      WHERE 1=1
    `;
    const params = [];
    if (status) { query += ' AND s.status = ?'; params.push(status); }
    if (team_id) { query += ' AND s.team_id = ?'; params.push(team_id); }
    if (task_id) { query += ' AND s.task_id = ?'; params.push(task_id); }
    query += ' ORDER BY s.submitted_at DESC';

    const submissions = db.prepare(query).all(...params);
    const teams = db.prepare('SELECT id, name FROM teams ORDER BY name ASC').all();
    const tasks = db.prepare('SELECT id, title FROM tasks ORDER BY sort_order ASC, id ASC').all();

    res.render('admin/submissions', {
      title: 'Einreichungen', submissions, teams, tasks,
      filter: { status, team_id, task_id },
      success: req.query.success, error: req.query.error
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

// POST /admin/submissions/:id/review
router.post('/submissions/:id/review', (req, res) => {
  try {
    const { status, points_awarded } = req.body;
    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
    if (!sub) return res.redirect('/admin/submissions?error=Einreichung+nicht+gefunden');

    if (!['correct', 'wrong', 'in_review'].includes(status)) {
      return res.redirect('/admin/submissions?error=Ungültiger+Status');
    }

    db.prepare('UPDATE submissions SET status = ?, points_awarded = ?, reviewed_at = datetime(\'now\') WHERE id = ?').run(
      status, parseInt(points_awarded) || 0, req.params.id
    );

    const io = req.app.get('io');
    const { getLeaderboard } = require('../db');
    io.to('leaderboard').emit('leaderboard_update', getLeaderboard());
    io.to('admins').emit('submission_reviewed', { submissionId: req.params.id, status });

    const referer = req.get('Referer') || '/admin/submissions';
    res.redirect(referer.includes('/admin/') ? referer : '/admin/submissions?success=Bewertet');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/submissions?error=' + encodeURIComponent(err.message));
  }
});

// GET /admin/leaderboard
router.get('/leaderboard', (req, res) => {
  try {
    const leaderboard = getLeaderboard();
    res.render('admin/leaderboard', { title: 'Rangliste', leaderboard });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

// GET /admin/settings
router.get('/settings', (req, res) => {
  try {
    const eventName = getSetting('event_name');
    const eventActive = getSetting('event_active');
    res.render('admin/settings', {
      title: 'Einstellungen', eventName, eventActive,
      success: req.query.success, error: req.query.error
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

// POST /admin/settings
router.post('/settings', (req, res) => {
  try {
    const { event_name, event_active } = req.body;
    if (event_name !== undefined) setSetting('event_name', event_name.trim() || 'Schnitzeljagd Event');
    setSetting('event_active', event_active === '1' ? '1' : '0');
    res.redirect('/admin/settings?success=Einstellungen+gespeichert');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/settings?error=' + encodeURIComponent(err.message));
  }
});

// GET /admin/export
router.get('/export', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT t.name as team, tk.title as aufgabe, s.answer_text as antwort,
             s.status, s.points_awarded as punkte, s.submitted_at as eingereicht_am
      FROM submissions s
      JOIN teams t ON t.id = s.team_id
      JOIN tasks tk ON tk.id = s.task_id
      ORDER BY s.submitted_at DESC
    `).all();

    const statusMap = { pending: 'Ausstehend', correct: 'Korrekt', wrong: 'Falsch', in_review: 'In Prüfung' };
    let csv = 'Team,Aufgabe,Antwort,Status,Punkte,Eingereicht am\n';
    for (const row of rows) {
      const cols = [
        `"${(row.team || '').replace(/"/g, '""')}"`,
        `"${(row.aufgabe || '').replace(/"/g, '""')}"`,
        `"${(row.antwort || '').replace(/"/g, '""')}"`,
        `"${statusMap[row.status] || row.status}"`,
        row.punkte,
        `"${row.eingereicht_am || ''}"`
      ];
      csv += cols.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="einreichungen.csv"');
    res.send('\uFEFF' + csv); // BOM for Excel
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

// POST /admin/password
router.post('/password', async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.adminId);
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.redirect('/admin/settings?error=Aktuelles+Passwort+falsch');
    if (new_password !== confirm_password) return res.redirect('/admin/settings?error=Passwörter+stimmen+nicht+überein');
    if (new_password.length < 6) return res.redirect('/admin/settings?error=Passwort+zu+kurz+(min.+6+Zeichen)');
    const hash = await bcrypt.hash(new_password, 10);
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, req.session.adminId);
    res.redirect('/admin/settings?success=Passwort+geändert');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/settings?error=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
