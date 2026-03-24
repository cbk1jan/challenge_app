/* Client-side JS for challenge app */

// Socket.io leaderboard updates
if (typeof io !== 'undefined') {
  const socket = io();

  socket.on('leaderboard_update', function(data) {
    if (typeof updateLeaderboard === 'function') {
      updateLeaderboard(data);
    }
  });

  socket.on('submission_new', function(data) {
    // Show notification for admins
    const banner = document.getElementById('submission-notify');
    if (banner) {
      banner.textContent = '🔔 Neue Einreichung: ' + data.teamName + ' – ' + data.taskTitle;
      banner.style.display = 'block';
      setTimeout(() => { banner.style.display = 'none'; }, 5000);
    }
    // Reload submissions count badge if present
    const badge = document.getElementById('pending-count');
    if (badge) {
      const cur = parseInt(badge.textContent) || 0;
      badge.textContent = cur + 1;
    }
  });

  socket.on('submission_reviewed', function() {
    // Optionally refresh page
  });
}

// Confirm dialogs for destructive actions
document.addEventListener('DOMContentLoaded', function() {

  // Confirm before delete / reset forms
  document.querySelectorAll('form[data-confirm]').forEach(function(form) {
    form.addEventListener('submit', function(e) {
      if (!confirm(form.getAttribute('data-confirm'))) {
        e.preventDefault();
      }
    });
  });

  // Confirm buttons
  document.querySelectorAll('[data-confirm-btn]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      if (!confirm(btn.getAttribute('data-confirm-btn'))) {
        e.preventDefault();
      }
    });
  });

  // Tab switching
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      const target = btn.getAttribute('data-tab');
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = document.getElementById('tab-' + target);
      if (pane) pane.classList.add('active');
    });
  });

  // Image upload preview
  document.querySelectorAll('input[type="file"][data-preview]').forEach(function(input) {
    input.addEventListener('change', function() {
      const previewId = input.getAttribute('data-preview');
      const preview = document.getElementById(previewId);
      if (!preview) return;
      if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
          preview.src = e.target.result;
          preview.classList.add('visible');
        };
        reader.readAsDataURL(input.files[0]);
      } else {
        preview.classList.remove('visible');
      }
    });
  });

  // Mobile navbar toggle
  const toggle = document.getElementById('navbar-toggle');
  const nav = document.getElementById('navbar-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function() {
      nav.classList.toggle('open');
    });
    // Close on link click
    nav.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('click', function() {
        nav.classList.remove('open');
      });
    });
  }

  // Dynamic task options for multiple choice
  const answerTypeSelect = document.getElementById('answer_type');
  const mcSection = document.getElementById('mc-options-section');
  if (answerTypeSelect && mcSection) {
    function toggleMcSection() {
      mcSection.style.display = answerTypeSelect.value === 'multiple_choice' ? 'block' : 'none';
    }
    answerTypeSelect.addEventListener('change', toggleMcSection);
    toggleMcSection();
  }

  // Add option button
  const addOptionBtn = document.getElementById('add-option-btn');
  const optionsContainer = document.getElementById('options-container');
  if (addOptionBtn && optionsContainer) {
    addOptionBtn.addEventListener('click', function() {
      const rows = optionsContainer.querySelectorAll('.option-row');
      const idx = rows.length;
      const row = document.createElement('div');
      row.className = 'option-row';
      row.innerHTML = `
        <input type="text" name="option_text" class="form-control" placeholder="Option ${idx + 1}" />
        <label style="display:flex;align-items:center;gap:4px;white-space:nowrap">
          <input type="checkbox" name="option_correct" value="${idx}" /> Korrekt
        </label>
        <button type="button" class="btn btn-sm btn-danger remove-option">✕</button>
      `;
      optionsContainer.appendChild(row);
      row.querySelector('.remove-option').addEventListener('click', function() {
        row.remove();
        reindexOptions();
      });
    });

    optionsContainer.querySelectorAll('.remove-option').forEach(function(btn) {
      btn.addEventListener('click', function() {
        btn.closest('.option-row').remove();
        reindexOptions();
      });
    });
  }

  function reindexOptions() {
    if (!optionsContainer) return;
    optionsContainer.querySelectorAll('.option-row').forEach(function(row, i) {
      const inp = row.querySelector('input[type="text"]');
      if (inp) inp.placeholder = 'Option ' + (i + 1);
      const chk = row.querySelector('input[type="checkbox"]');
      if (chk) chk.value = String(i);
    });
  }

  // Hints editor
  const hintsEditor = document.getElementById('hints-editor');
  const hintsInput = document.getElementById('hints_json');
  const addHintBtn = document.getElementById('add-hint-btn');

  function renderHints() {
    if (!hintsEditor || !hintsInput) return;
    let hints = [];
    try { hints = JSON.parse(hintsInput.value || '[]'); } catch(_e) { hints = []; }
    hintsEditor.innerHTML = '';
    hints.forEach(function(hint, i) {
      const row = document.createElement('div');
      row.className = 'option-row';
      row.style.marginBottom = '0.5rem';
      row.innerHTML = `
        <input type="text" class="form-control hint-text-input" placeholder="Hinweistext" value="${escHtml(hint.text || '')}" data-idx="${i}" />
        <input type="number" class="form-control hint-cost-input" placeholder="Kosten" value="${hint.cost || 0}" style="width:80px" data-idx="${i}" min="0" />
        <button type="button" class="btn btn-sm btn-danger remove-hint-btn" data-idx="${i}">✕</button>
      `;
      hintsEditor.appendChild(row);
    });
    // Re-bind events
    hintsEditor.querySelectorAll('.hint-text-input, .hint-cost-input').forEach(function(input) {
      input.addEventListener('input', syncHints);
    });
    hintsEditor.querySelectorAll('.remove-hint-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        let hints2 = [];
        try { hints2 = JSON.parse(hintsInput.value || '[]'); } catch(_e) { hints2 = []; }
        hints2.splice(parseInt(btn.getAttribute('data-idx')), 1);
        hintsInput.value = JSON.stringify(hints2);
        renderHints();
      });
    });
  }

  function syncHints() {
    if (!hintsEditor || !hintsInput) return;
    const rows = hintsEditor.querySelectorAll('.option-row');
    const hints = [];
    rows.forEach(function(row) {
      const text = (row.querySelector('.hint-text-input') || {}).value || '';
      const cost = parseInt((row.querySelector('.hint-cost-input') || {}).value) || 0;
      hints.push({ text, cost });
    });
    hintsInput.value = JSON.stringify(hints);
  }

  if (addHintBtn) {
    addHintBtn.addEventListener('click', function() {
      let hints = [];
      try { hints = JSON.parse(hintsInput.value || '[]'); } catch(_e) { hints = []; }
      hints.push({ text: '', cost: 2 });
      hintsInput.value = JSON.stringify(hints);
      renderHints();
    });
    renderHints();
  }
});

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Leaderboard live update
function updateLeaderboard(data) {
  const tbody = document.getElementById('leaderboard-tbody');
  if (!tbody || !data) return;
  tbody.innerHTML = '';
  data.forEach(function(team, i) {
    const rank = i + 1;
    let rankClass = 'rank-other';
    let medal = rank;
    if (rank === 1) { rankClass = 'rank-1'; medal = '🥇'; }
    else if (rank === 2) { rankClass = 'rank-2'; medal = '🥈'; }
    else if (rank === 3) { rankClass = 'rank-3'; medal = '🥉'; }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="rank-badge ${rankClass}">${medal}</span></td>
      <td class="font-bold">${escHtml(team.name)}</td>
      <td class="font-bold">${team.total_points}</td>
      <td>${team.solved_count}</td>
    `;
    tbody.appendChild(tr);
  });
}
