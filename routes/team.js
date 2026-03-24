'use strict';

const express = require('express');
const router = express.Router();
const { db, getSetting, getLeaderboard, getTeamPoints, getTeamRank, getTasksWithStatus } = require('../db');

// Team auth middleware
function requireTeam(req, res, next) {
  if (!req.session.teamId) {
    return res.redirect('/login');
  }
  // Validate session token still matches DB
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.session.teamId);
  if (!team || team.session_token !== req.session.teamToken) {
    req.session.destroy(() => {
      res.redirect('/login?error=session');
    });
    return;
  }
  req.team = team;
  next();
}

router.use(requireTeam);

// GET /team/dashboard
router.get('/dashboard', (req, res) => {
  try {
    const eventActive = getSetting('event_active');
    const eventName = getSetting('event_name');
    const tasks = getTasksWithStatus(req.team.id);
    const totalPoints = getTeamPoints(req.team.id);
    const rank = getTeamRank(req.team.id);
    const totalTeams = db.prepare('SELECT COUNT(*) as c FROM teams').get().c;

    res.render('team/dashboard', {
      title: 'Meine Aufgaben',
      team: req.team, tasks, totalPoints, rank, totalTeams,
      eventActive, eventName
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

// GET /team/tasks/:id
router.get('/tasks/:id', (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND is_active = 1').get(req.params.id);
    if (!task) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Aufgabe nicht gefunden.', code: 404 });

    const submission = db.prepare('SELECT * FROM submissions WHERE team_id = ? AND task_id = ?').get(req.team.id, task.id);
    const usedHints = db.prepare('SELECT * FROM hint_usage WHERE team_id = ? AND task_id = ?').all(req.team.id, task.id);
    const options = db.prepare('SELECT * FROM task_options WHERE task_id = ? ORDER BY id ASC').all(task.id);

    let hints = [];
    try { hints = JSON.parse(task.hints || '[]'); } catch (_e) { hints = []; }

    res.render('team/task', {
      title: task.title, task, submission, usedHints, options, hints,
      team: req.team, error: req.query.error, success: req.query.success
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

// POST /team/tasks/:id/submit
router.post('/tasks/:id/submit', (req, res) => {
  const upload = req.app.get('upload');
  upload.single('image')(req, res, (uploadErr) => {
    try {
      if (uploadErr) {
        return res.redirect(`/team/tasks/${req.params.id}?error=` + encodeURIComponent(uploadErr.message));
      }

      const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND is_active = 1').get(req.params.id);
      if (!task) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Aufgabe nicht gefunden.', code: 404 });

      // Check if already submitted and correct
      const existing = db.prepare('SELECT * FROM submissions WHERE team_id = ? AND task_id = ?').get(req.team.id, task.id);
      if (existing && existing.status === 'correct') {
        return res.redirect(`/team/tasks/${task.id}?error=Bereits+korrekt+beantwortet`);
      }

      // Unlock code check
      if (task.unlock_code) {
        const submitted_code = (req.body.unlock_code || '').trim().toUpperCase();
        if (submitted_code !== task.unlock_code.trim().toUpperCase()) {
          return res.redirect(`/team/tasks/${task.id}?error=Falscher+Freischaltcode`);
        }
      }

      const answer_text = (req.body.answer_text || '').trim();
      const image_path = req.file ? '/uploads/' + req.file.filename : null;

      // Auto-check
      let status = 'pending';
      let points_awarded = 0;

      if (task.auto_check) {
        if (task.answer_type === 'text' && task.correct_answer) {
          if (answer_text.toLowerCase() === task.correct_answer.toLowerCase()) {
            status = 'correct';
          } else {
            status = 'wrong';
          }
        } else if (task.answer_type === 'multiple_choice') {
          const correctOption = db.prepare('SELECT * FROM task_options WHERE task_id = ? AND is_correct = 1').get(task.id);
          if (correctOption && answer_text === String(correctOption.id)) {
            status = 'correct';
          } else {
            status = 'wrong';
          }
        }
      }

      if (status === 'correct') {
        // Calculate points after hint deductions
        const usedHints = db.prepare('SELECT * FROM hint_usage WHERE team_id = ? AND task_id = ?').all(req.team.id, task.id);
        let hints = [];
        try { hints = JSON.parse(task.hints || '[]'); } catch (_e) { hints = []; }
        const hintCost = usedHints.reduce((sum, h) => {
          const hint = hints[h.hint_index];
          return sum + (hint ? (hint.cost || 0) : 0);
        }, 0);
        points_awarded = Math.max(0, task.points - hintCost);
      }

      const hints_used_arr = db.prepare('SELECT hint_index FROM hint_usage WHERE team_id = ? AND task_id = ?').all(req.team.id, task.id).map(h => h.hint_index);

      if (existing) {
        db.prepare(`UPDATE submissions SET answer_text=?, image_path=COALESCE(?,image_path), status=?, points_awarded=?, hints_used=?, submitted_at=datetime('now'), reviewed_at=NULL WHERE id=?`).run(
          answer_text, image_path, status, points_awarded, JSON.stringify(hints_used_arr), existing.id
        );
      } else {
        db.prepare(`INSERT INTO submissions (team_id, task_id, answer_text, image_path, status, points_awarded, hints_used) VALUES (?,?,?,?,?,?,?)`).run(
          req.team.id, task.id, answer_text, image_path, status, points_awarded, JSON.stringify(hints_used_arr)
        );
      }

      const io = req.app.get('io');
      io.to('admins').emit('submission_new', { teamName: req.team.name, taskTitle: task.title, status });
      if (status === 'correct') {
        io.to('leaderboard').emit('leaderboard_update', getLeaderboard());
      }

      if (status === 'correct') {
        return res.redirect(`/team/tasks/${task.id}?success=Korrekt!+Du+erhältst+${points_awarded}+Punkte`);
      } else if (status === 'wrong') {
        return res.redirect(`/team/tasks/${task.id}?error=Leider+falsch.+Versuche+es+erneut`);
      }
      res.redirect(`/team/tasks/${task.id}?success=Antwort+eingereicht`);
    } catch (err) {
      console.error(err);
      res.redirect(`/team/tasks/${req.params.id}?error=` + encodeURIComponent(err.message));
    }
  });
});

// POST /team/tasks/:id/hint/:index
router.post('/tasks/:id/hint/:index', (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND is_active = 1').get(req.params.id);
    if (!task) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Aufgabe nicht gefunden.', code: 404 });

    const hintIndex = parseInt(req.params.index);
    let hints = [];
    try { hints = JSON.parse(task.hints || '[]'); } catch (_e) { hints = []; }

    if (hintIndex < 0 || hintIndex >= hints.length) {
      return res.redirect(`/team/tasks/${task.id}?error=Hinweis+nicht+gefunden`);
    }

    // Check if already used
    const alreadyUsed = db.prepare('SELECT id FROM hint_usage WHERE team_id = ? AND task_id = ? AND hint_index = ?').get(req.team.id, task.id, hintIndex);
    if (alreadyUsed) {
      return res.redirect(`/team/tasks/${task.id}?error=Hinweis+bereits+verwendet`);
    }

    db.prepare('INSERT INTO hint_usage (team_id, task_id, hint_index) VALUES (?, ?, ?)').run(req.team.id, task.id, hintIndex);
    res.redirect(`/team/tasks/${task.id}?success=Hinweis+freigeschaltet`);
  } catch (err) {
    console.error(err);
    res.redirect(`/team/tasks/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

// GET /team/leaderboard
router.get('/leaderboard', (req, res) => {
  try {
    const leaderboard = getLeaderboard();
    const eventName = getSetting('event_name');
    res.render('team/leaderboard', { title: 'Rangliste', leaderboard, team: req.team, eventName });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Fehler', message: err.message, code: 500 });
  }
});

module.exports = router;
