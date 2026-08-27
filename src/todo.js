/**
 * AZURA To-Do List & Task Management Ecosystem
 * Features:
 * - Persistent Task Storage (data/todo_tasks.json)
 * - Ultra-modern, aesthetic Glassmorphism Web Dashboard (http://203.175.10.163:7860/todo)
 * - REST API Endpoints (/api/todo/*) for instant real-time web interactivity
 * - Natural Language & Slash Command Discord integration (/todo & chat triggers)
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { readSecureJson, writeSecureJson } = require('./security');

const TODO_FILE_PATH = path.join(__dirname, '../data/todo_tasks.enc');
const VPS_PUBLIC_IP = process.env.VPS_IP || '203.175.10.163';
const PORT = process.env.STREAM_PORT || 7860;
const TODO_DASHBOARD_URL = `http://${VPS_PUBLIC_IP}:${PORT}/todo`;

let todoCache = [];
let isLoaded = false;

function loadTodos() {
  if (isLoaded) return;
  try {
    todoCache = readSecureJson(TODO_FILE_PATH, []);
    console.log(`[Todo Engine]: 📋 Loaded ${todoCache.length} tasks from encrypted disk.`);
    isLoaded = true;
  } catch (err) {
    console.error('[Todo Engine Load Error]:', err.message);
    todoCache = [];
    isLoaded = true;
  }
}

/**
 * Clear all tasks completely
 */
function clearAllTodos() {
  todoCache = [];
  saveTodos();
  console.log('[Todo Engine]: 🧹 To-Do list completely reset and emptied.');
  return true;
}

function saveTodos() {
  try {
    writeSecureJson(TODO_FILE_PATH, todoCache);
  } catch (err) {
    console.error('[Todo Engine Save Error]:', err.message);
  }
}

function generateTaskId() {
  const rand = Math.floor(100 + Math.random() * 900);
  return `TASK-${rand}`;
}

/**
 * Add a new To-Do task
 */
function createTodo(title, category = 'General', priority = 'Medium', dueDate = null, notes = '', creatorId = null, creatorName = 'User') {
  loadTodos();
  const id = generateTaskId();
  const newTask = {
    id,
    title: title.trim(),
    category: category.trim() || 'General',
    priority: priority || 'Medium',
    status: 'pending', // 'pending', 'in_progress', 'completed'
    dueDate: dueDate || null,
    notes: notes.trim() || '',
    creatorId,
    creatorName,
    createdAt: new Date().toISOString(),
    completedAt: null
  };

  todoCache.unshift(newTask);
  saveTodos();
  console.log(`[Todo Engine]: ➕ Added task ${id}: "${title}" by ${creatorName}`);
  return newTask;
}

/**
 * Bulk add multiple to-dos from natural language prompt
 */
function bulkCreateTodos(items, creatorId = null, creatorName = 'User', defaultCategory = 'General') {
  loadTodos();
  const created = [];
  for (const rawItem of items) {
    const clean = rawItem.trim().replace(/^[-*•\d.]+\s*/, '');
    if (clean.length > 2) {
      let cat = defaultCategory;
      let prio = 'Medium';
      if (/urgent|penting|darurat|prioritas tinggi/i.test(clean)) {
        prio = 'High';
        cat = 'Urgent';
      } else if (/coding|dev|bug|deploy|fitur|server|bot/i.test(clean)) {
        cat = 'Dev';
      } else if (/kerja|proyek|klien|tugas|meeting/i.test(clean)) {
        cat = 'Work';
      } else if (/pribadi|beli|makan|olahraga|istirahat/i.test(clean)) {
        cat = 'Personal';
      }

      const task = createTodo(clean, cat, prio, null, '', creatorId, creatorName);
      created.push(task);
    }
  }
  return created;
}

/**
 * Toggle task status between pending and completed
 */
function toggleTodoStatus(taskId) {
  loadTodos();
  const task = todoCache.find(t => t.id === taskId || t.id.toLowerCase() === taskId.toLowerCase());
  if (!task) return null;

  if (task.status === 'completed') {
    task.status = 'pending';
    task.completedAt = null;
  } else {
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
  }

  saveTodos();
  return task;
}

/**
 * Update task status explicitly
 */
function updateTodoStatus(taskId, status) {
  loadTodos();
  const task = todoCache.find(t => t.id === taskId || t.id.toLowerCase() === taskId.toLowerCase());
  if (!task) return null;

  task.status = status;
  if (status === 'completed') {
    task.completedAt = new Date().toISOString();
  } else {
    task.completedAt = null;
  }

  saveTodos();
  return task;
}

/**
 * Delete a task
 */
function deleteTodo(taskId) {
  loadTodos();
  const idx = todoCache.findIndex(t => t.id === taskId || t.id.toLowerCase() === taskId.toLowerCase());
  if (idx === -1) return false;
  todoCache.splice(idx, 1);
  saveTodos();
  return true;
}

/**
 * Get all tasks with optional filters
 */
function getTodos(filterStatus = null, filterCategory = null) {
  loadTodos();
  return todoCache.filter(t => {
    if (filterStatus && filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterCategory && filterCategory !== 'all' && t.category.toLowerCase() !== filterCategory.toLowerCase()) return false;
    return true;
  });
}

/**
 * Generate a concise recap summary of To-Do tasks for Discord chat
 */
function generateTodoRecapText(userName = 'Attila') {
  loadTodos();
  const total = todoCache.length;
  const pending = todoCache.filter(t => t.status === 'pending');
  const inProgress = todoCache.filter(t => t.status === 'in_progress');
  const completed = todoCache.filter(t => t.status === 'completed');
  const progressPct = total > 0 ? Math.round((completed.length / total) * 100) : 0;

  let recap = `📋 **[Rekap To-Do List & Agenda Tugas ${userName}]**\n\n`;
  recap += `📊 **Statistik & Progres:** \`${progressPct}% Selesai\` (${completed.length}/${total} Tugas)\n`;
  recap += `⏳ **Pending:** ${pending.length} • 🔄 **In Progress:** ${inProgress.length} • ✅ **Completed:** ${completed.length}\n\n`;

  if (pending.length > 0) {
    recap += `📌 **Tugas Prioritas / Pending Terbaru:**\n`;
    pending.slice(0, 4).forEach((t, i) => {
      const prioBadge = t.priority === 'High' ? '🔴 [High]' : (t.priority === 'Low' ? '🟢 [Low]' : '🟡 [Med]');
      recap += `${i + 1}. **${t.title}** (\`${t.id}\`) ${prioBadge} • *${t.category}*\n`;
    });
    if (pending.length > 4) {
      recap += `*...dan ${pending.length - 4} tugas lainnya.*\n`;
    }
    recap += '\n';
  }

  recap += `🌐 **Buka Website Dashboard To-Do List:**\n👉 **${TODO_DASHBOARD_URL}**\n\n`;
  recap += `*(Tampilan web dashboard jauh lebih lega, estetik, dan interaktif untuk ceklis / kelola tugas langsung!)*`;

  return {
    text: recap,
    total,
    pending: pending.length,
    completed: completed.length,
    progressPct,
    url: TODO_DASHBOARD_URL
  };
}

/**
 * Generate Ultra-Modern Glassmorphism Web Dashboard HTML
 */
function getTodoDashboardHtml() {
  loadTodos();
  const tasksJson = JSON.stringify(todoCache);

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AZURA To-Do & Task Management Hub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0A0D14;
      --bg-card: rgba(18, 24, 38, 0.7);
      --bg-card-hover: rgba(28, 36, 56, 0.85);
      --border-color: rgba(255, 255, 255, 0.08);
      --primary: #00FFB2;
      --primary-glow: rgba(0, 255, 178, 0.25);
      --secondary: #3B82F6;
      --accent-purple: #9333EA;
      --danger: #EF4444;
      --warning: #F59E0B;
      --text-main: #F1F5F9;
      --text-muted: #94A3B8;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }

    body {
      background: var(--bg-dark);
      background-image: 
        radial-gradient(at 0% 0%, rgba(0, 255, 178, 0.08) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(59, 130, 246, 0.08) 0px, transparent 50%);
      color: var(--text-main);
      min-height: 100vh;
      padding: 32px 20px;
    }

    .container {
      max-width: 1100px;
      margin: 0 auto;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border-color);
      flex-wrap: wrap;
      gap: 16px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-logo {
      width: 46px;
      height: 46px;
      border-radius: 14px;
      background: linear-gradient(135deg, #00FFB2, #3B82F6);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 20px var(--primary-glow);
      font-size: 24px;
    }

    .brand-text h1 {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(90deg, #FFFFFF, #94A3B8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .brand-text p {
      font-size: 13px;
      color: var(--text-muted);
    }

    .btn-add {
      background: linear-gradient(135deg, #00FFB2, #059669);
      color: #0A0D14;
      border: none;
      padding: 12px 22px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
      box-shadow: 0 4px 14px var(--primary-glow);
    }

    .btn-add:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px var(--primary-glow);
    }

    /* Stats Banner */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }

    .stat-card {
      background: var(--bg-card);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: transform 0.2s;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.15);
    }

    .stat-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }

    .stat-val {
      font-size: 28px;
      font-weight: 800;
      color: #FFF;
      font-family: 'JetBrains Mono', monospace;
    }

    .progress-bar-container {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 99px;
      margin-top: 8px;
      overflow: hidden;
    }

    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #00FFB2, #3B82F6);
      border-radius: 99px;
      transition: width 0.4s ease;
    }

    /* Controls & Filters */
    .controls-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
    }

    .filter-tabs {
      display: flex;
      background: rgba(18, 24, 38, 0.6);
      border: 1px solid var(--border-color);
      padding: 4px;
      border-radius: 12px;
      gap: 4px;
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .tab-btn.active {
      background: rgba(255, 255, 255, 0.1);
      color: #FFF;
    }

    .search-input {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: #FFF;
      padding: 10px 16px;
      border-radius: 12px;
      font-size: 13px;
      outline: none;
      width: 240px;
      transition: all 0.2s;
    }

    .search-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 10px var(--primary-glow);
    }

    /* Task Cards List */
    .tasks-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .task-card {
      background: var(--bg-card);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 18px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      transition: all 0.2s ease;
    }

    .task-card:hover {
      background: var(--bg-card-hover);
      border-color: rgba(255, 255, 255, 0.15);
      transform: translateX(4px);
    }

    .task-card.completed {
      opacity: 0.6;
    }

    .task-card.completed .task-title {
      text-decoration: line-through;
      color: var(--text-muted);
    }

    .task-left {
      display: flex;
      align-items: center;
      gap: 16px;
      flex: 1;
    }

    .checkbox-custom {
      width: 24px;
      height: 24px;
      border-radius: 8px;
      border: 2px solid rgba(255, 255, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    .task-card.completed .checkbox-custom {
      background: var(--primary);
      border-color: var(--primary);
      color: #0A0D14;
    }

    .task-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .task-title {
      font-size: 15px;
      font-weight: 600;
      color: #FFF;
      line-height: 1.4;
    }

    .task-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      color: var(--text-muted);
      flex-wrap: wrap;
    }

    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    .badge-dev { background: rgba(59, 130, 246, 0.15); color: #60A5FA; border: 1px solid rgba(59, 130, 246, 0.3); }
    .badge-urgent { background: rgba(239, 68, 68, 0.15); color: #F87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-work { background: rgba(147, 51, 234, 0.15); color: #C084FC; border: 1px solid rgba(147, 51, 234, 0.3); }
    .badge-personal { background: rgba(16, 185, 129, 0.15); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-general { background: rgba(148, 163, 184, 0.15); color: #CBD5E1; border: 1px solid rgba(148, 163, 184, 0.3); }

    .prio-high { color: #F87171; font-weight: 700; }
    .prio-med { color: #FBBF24; font-weight: 600; }
    .prio-low { color: #34D399; }

    .task-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-icon {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 8px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }

    .btn-icon:hover {
      background: rgba(239, 68, 68, 0.15);
      color: #F87171;
    }

    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(8px);
      z-index: 100;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .modal-card {
      background: #111827;
      border: 1px solid var(--border-color);
      border-radius: 20px;
      width: 100%;
      max-width: 480px;
      padding: 28px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .modal-header h3 {
      font-size: 18px;
      font-weight: 700;
    }

    .form-group {
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-group label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
    }

    .form-control {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      color: #FFF;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 14px;
      outline: none;
      transition: all 0.2s;
    }

    .form-control:focus {
      border-color: var(--primary);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 24px;
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      border: none;
      color: #FFF;
      padding: 10px 18px;
      border-radius: 10px;
      font-weight: 600;
      cursor: pointer;
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-muted);
    }

    .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-logo">✨</div>
        <div class="brand-text">
          <h1>AZURA To-Do & Task Hub</h1>
          <p>Sistem Manajemen Tugas & Agenda Interaktif Attila</p>
        </div>
      </div>
      <button class="btn-add" onclick="openAddModal()">
        <span>➕</span> Tambah Tugas Baru
      </button>
    </header>

    <!-- Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">Total Tugas</span>
        <span class="stat-val" id="stat-total">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Menunggu (Pending)</span>
        <span class="stat-val" id="stat-pending" style="color: #FBBF24;">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Tuntas (Completed)</span>
        <span class="stat-val" id="stat-completed" style="color: #00FFB2;">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Tingkat Penyelesaian</span>
        <span class="stat-val" id="stat-pct">0%</span>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" id="stat-progress-bar" style="width: 0%;"></div>
        </div>
      </div>
    </div>

    <!-- Controls -->
    <div class="controls-row">
      <div class="filter-tabs">
        <button class="tab-btn active" onclick="setFilter('all')">Semua</button>
        <button class="tab-btn" onclick="setFilter('pending')">Pending</button>
        <button class="tab-btn" onclick="setFilter('completed')">Selesai</button>
      </div>
      <input type="text" class="search-input" id="search-input" placeholder="🔍 Cari tugas..." oninput="renderTasks()">
    </div>

    <!-- Tasks Grid -->
    <div class="tasks-grid" id="tasks-container"></div>
  </div>

  <!-- Modal Tambah Task -->
  <div class="modal-overlay" id="add-modal">
    <div class="modal-card">
      <div class="modal-header">
        <h3>✨ Tambah To-Do Baru</h3>
        <button class="btn-icon" onclick="closeAddModal()">✕</button>
      </div>
      <div class="form-group">
        <label>Judul Tugas / Agenda</label>
        <input type="text" class="form-control" id="new-title" placeholder="Contoh: Deploy update backend VPS">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Kategori</label>
          <select class="form-control" id="new-cat">
            <option value="Dev">Dev / Coding</option>
            <option value="Work">Work / Proyek</option>
            <option value="Urgent">Urgent / Penting</option>
            <option value="Personal">Personal</option>
            <option value="General">Umum</option>
          </select>
        </div>
        <div class="form-group">
          <label>Prioritas</label>
          <select class="form-control" id="new-prio">
            <option value="High">🔴 High</option>
            <option value="Medium" selected>🟡 Medium</option>
            <option value="Low">🟢 Low</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Catatan Tambahan (Opsional)</label>
        <input type="text" class="form-control" id="new-notes" placeholder="Catatan kecil atau link referensi...">
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="closeAddModal()">Batal</button>
        <button class="btn-add" onclick="submitNewTask()">Simpan Tugas</button>
      </div>
    </div>
  </div>

  <script>
    let allTasks = ${tasksJson};
    let currentFilter = 'all';

    function updateStats() {
      const total = allTasks.length;
      const pending = allTasks.filter(t => t.status === 'pending').length;
      const completed = allTasks.filter(t => t.status === 'completed').length;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

      document.getElementById('stat-total').innerText = total;
      document.getElementById('stat-pending').innerText = pending;
      document.getElementById('stat-completed').innerText = completed;
      document.getElementById('stat-pct').innerText = pct + '%';
      document.getElementById('stat-progress-bar').style.width = pct + '%';
    }

    function setFilter(filter) {
      currentFilter = filter;
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.toLowerCase().includes(filter === 'all' ? 'semua' : filter));
      });
      renderTasks();
    }

    function getBadgeClass(cat) {
      const c = (cat || '').toLowerCase();
      if (c === 'dev') return 'badge-dev';
      if (c === 'urgent') return 'badge-urgent';
      if (c === 'work') return 'badge-work';
      if (c === 'personal') return 'badge-personal';
      return 'badge-general';
    }

    function getPrioClass(prio) {
      if (prio === 'High') return 'prio-high';
      if (prio === 'Low') return 'prio-low';
      return 'prio-med';
    }

    function renderTasks() {
      const container = document.getElementById('tasks-container');
      const search = (document.getElementById('search-input').value || '').toLowerCase();

      const filtered = allTasks.filter(t => {
        if (currentFilter !== 'all' && t.status !== currentFilter) return false;
        if (search && !t.title.toLowerCase().includes(search) && !t.category.toLowerCase().includes(search)) return false;
        return true;
      });

      if (filtered.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <div class="empty-icon">🏖️</div>
            <h3>Tidak Ada Tugas</h3>
            <p>Semua agenda rapi dan beres!</p>
          </div>
        \`;
        updateStats();
        return;
      }

      container.innerHTML = filtered.map(t => {
        const isDone = t.status === 'completed';
        const dateStr = t.createdAt ? new Date(t.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '';
        return \`
          <div class="task-card \${isDone ? 'completed' : ''}" id="task-\${t.id}">
            <div class="task-left">
              <div class="checkbox-custom" onclick="toggleTask('\${t.id}')">
                \${isDone ? '✓' : ''}
              </div>
              <div class="task-info">
                <div class="task-title">\${t.title}</div>
                <div class="task-meta">
                  <span class="badge \${getBadgeClass(t.category)}">\${t.category}</span>
                  <span class="\${getPrioClass(t.priority)}">• \${t.priority} Prio</span>
                  <span>• Dibuat \${dateStr}</span>
                  \${t.notes ? \`<span>• 📝 \${t.notes}</span>\` : ''}
                </div>
              </div>
            </div>
            <div class="task-actions">
              <button class="btn-icon" onclick="deleteTask('\${t.id}')" title="Hapus Tugas">🗑️</button>
            </div>
          </div>
        \`;
      }).join('');

      updateStats();
    }

    async function toggleTask(id) {
      try {
        const res = await fetch('/api/todo/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (data.success) {
          const task = allTasks.find(t => t.id === id);
          if (task) {
            task.status = data.task.status;
            renderTasks();
          }
        }
      } catch (err) {
        console.error(err);
      }
    }

    async function deleteTask(id) {
      if (!confirm('Hapus tugas ini?')) return;
      try {
        const res = await fetch('/api/todo/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (data.success) {
          allTasks = allTasks.filter(t => t.id !== id);
          renderTasks();
        }
      } catch (err) {
        console.error(err);
      }
    }

    function openAddModal() {
      document.getElementById('add-modal').style.display = 'flex';
      document.getElementById('new-title').focus();
    }

    function closeAddModal() {
      document.getElementById('add-modal').style.display = 'none';
      document.getElementById('new-title').value = '';
      document.getElementById('new-notes').value = '';
    }

    async function submitNewTask() {
      const title = document.getElementById('new-title').value.trim();
      const category = document.getElementById('new-cat').value;
      const priority = document.getElementById('new-prio').value;
      const notes = document.getElementById('new-notes').value.trim();

      if (!title) {
        alert('Harap isi judul tugas!');
        return;
      }

      try {
        const res = await fetch('/api/todo/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, category, priority, notes })
        });
        const data = await res.json();
        if (data.success) {
          allTasks.unshift(data.task);
          closeAddModal();
          renderTasks();
        }
      } catch (err) {
        alert('Gagal membuat tugas: ' + err.message);
      }
    }

    // Init on load
    renderTasks();
  </script>
</body>
</html>`;
}

module.exports = {
  createTodo,
  bulkCreateTodos,
  toggleTodoStatus,
  updateTodoStatus,
  deleteTodo,
  clearAllTodos,
  getTodos,
  generateTodoRecapText,
  getTodoDashboardHtml,
  TODO_DASHBOARD_URL
};
