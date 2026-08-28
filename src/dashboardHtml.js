/**
 * AZURA Master Web Dashboard UI (Glassmorphism Cyber Theme)
 * Features:
 * - Realtime Live Sync with To-Do tasks & Discord /report /advice tickets
 * - Dual Engine Integration (Tasks + User Feedback + Bug Reports)
 * - Modern Glassmorphism & Cyber-Neon Aesthetics
 * - Interactive Tabs, Real-Time Search, Filters, Quick Actions, and Modals
 */

function generateMasterDashboardHtml(initialTodos = [], initialFeedbacks = []) {
  const todosJson = JSON.stringify(initialTodos);
  const feedbacksJson = JSON.stringify(initialFeedbacks);

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AZURA • Task & Feedback Command Center</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-base: #060911;
      --bg-surface: rgba(15, 23, 42, 0.7);
      --bg-surface-hover: rgba(30, 41, 59, 0.8);
      --border-subtle: rgba(255, 255, 255, 0.08);
      --border-glow: rgba(0, 255, 178, 0.3);
      
      --neon-cyan: #00FFB2;
      --neon-blue: #38BDF8;
      --neon-purple: #A855F7;
      --neon-amber: #FBBF24;
      --neon-rose: #FB7185;
      --neon-emerald: #34D399;

      --text-main: #F8FAFC;
      --text-muted: #94A3B8;
      --text-dim: #64748B;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }

    body {
      background-color: var(--bg-base);
      background-image: 
        radial-gradient(at 0% 0%, rgba(0, 255, 178, 0.08) 0px, transparent 45%),
        radial-gradient(at 100% 0%, rgba(56, 189, 248, 0.08) 0px, transparent 45%),
        radial-gradient(at 50% 100%, rgba(168, 85, 247, 0.06) 0px, transparent 50%);
      color: var(--text-main);
      min-height: 100vh;
      padding: 28px 18px;
    }

    .container {
      max-width: 1280px;
      margin: 0 auto;
    }

    /* ── HEADER ── */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 28px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border-subtle);
      flex-wrap: wrap;
      gap: 16px;
    }

    .brand-group {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-icon {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--neon-cyan), var(--neon-blue));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      box-shadow: 0 0 24px rgba(0, 255, 178, 0.35);
    }

    .brand-text h1 {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(90deg, #FFFFFF, #CBD5E1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .brand-text p {
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      background-color: var(--neon-cyan);
      border-radius: 50%;
      display: inline-block;
      box-shadow: 0 0 10px var(--neon-cyan);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(1.2); }
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .btn-action {
      background: linear-gradient(135deg, var(--neon-cyan), #059669);
      color: #060911;
      border: none;
      padding: 10px 20px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
      box-shadow: 0 4px 16px rgba(0, 255, 178, 0.25);
    }

    .btn-action:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 255, 178, 0.4);
    }

    /* ── METRICS GRID ── */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }

    .metric-card {
      background: var(--bg-surface);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border-subtle);
      border-radius: 18px;
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 16px;
      transition: all 0.25s ease;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    }

    .metric-card:hover {
      transform: translateY(-3px);
      border-color: rgba(255, 255, 255, 0.15);
    }

    .metric-icon {
      width: 46px;
      height: 46px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
    }

    .metric-info h3 {
      font-size: 24px;
      font-weight: 800;
      font-family: 'JetBrains Mono', monospace;
    }

    .metric-info p {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* ── TAB NAVIGATION ── */
    .tab-bar {
      display: flex;
      gap: 10px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 12px;
      overflow-x: auto;
    }

    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 10px 18px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .tab-btn:hover {
      color: var(--text-main);
      background: rgba(255, 255, 255, 0.04);
    }

    .tab-btn.active {
      background: var(--bg-surface);
      color: var(--neon-cyan);
      border-color: rgba(0, 255, 178, 0.3);
      box-shadow: 0 0 16px rgba(0, 255, 178, 0.15);
    }

    .tab-badge {
      background: rgba(255, 255, 255, 0.1);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 700;
    }

    .tab-btn.active .tab-badge {
      background: rgba(0, 255, 178, 0.2);
      color: var(--neon-cyan);
    }

    /* ── SEARCH & CONTROLS ── */
    .control-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .search-box {
      flex: 1;
      min-width: 260px;
      position: relative;
    }

    .search-box input {
      width: 100%;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      padding: 12px 16px 12px 40px;
      border-radius: 12px;
      color: var(--text-main);
      font-size: 13px;
      outline: none;
      transition: all 0.2s;
    }

    .search-box input:focus {
      border-color: var(--neon-cyan);
      box-shadow: 0 0 16px rgba(0, 255, 178, 0.2);
    }

    .search-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 15px;
      color: var(--text-dim);
    }

    .filter-group {
      display: flex;
      gap: 10px;
    }

    .filter-select {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      outline: none;
      cursor: pointer;
    }

    /* ── ITEM CARDS LIST ── */
    .cards-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .item-card {
      background: var(--bg-surface);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      padding: 18px 22px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
      transition: all 0.2s ease;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    }

    .item-card:hover {
      border-color: rgba(255, 255, 255, 0.18);
      transform: translateX(3px);
    }

    .item-card.completed {
      opacity: 0.65;
    }

    .item-card.completed .item-title {
      text-decoration: line-through;
      color: var(--text-dim);
    }

    .item-main {
      flex: 1;
      min-width: 0;
    }

    .item-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }

    .item-id {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 700;
      color: var(--neon-blue);
      background: rgba(56, 189, 248, 0.1);
      padding: 3px 8px;
      border-radius: 6px;
      border: 1px solid rgba(56, 189, 248, 0.2);
    }

    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .badge-adv { background: rgba(251, 191, 36, 0.15); color: var(--neon-amber); border: 1px solid rgba(251, 191, 36, 0.3); }
    .badge-rep { background: rgba(251, 113, 133, 0.15); color: var(--neon-rose); border: 1px solid rgba(251, 113, 133, 0.3); }
    .badge-todo { background: rgba(0, 255, 178, 0.15); color: var(--neon-cyan); border: 1px solid rgba(0, 255, 178, 0.3); }
    
    .badge-status-pending { background: rgba(251, 191, 36, 0.1); color: var(--neon-amber); }
    .badge-status-in_progress, .badge-status-accepted { background: rgba(56, 189, 248, 0.15); color: var(--neon-blue); }
    .badge-status-completed, .badge-status-done { background: rgba(52, 211, 153, 0.15); color: var(--neon-emerald); }
    .badge-status-rejected { background: rgba(239, 68, 68, 0.15); color: #EF4444; }

    .item-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-main);
      margin-bottom: 6px;
      word-break: break-word;
    }

    .item-notes {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 10px;
      line-height: 1.5;
      word-break: break-word;
    }

    .item-footer {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 12px;
      color: var(--text-dim);
      flex-wrap: wrap;
    }

    .item-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-circle {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid var(--border-subtle);
      background: rgba(255, 255, 255, 0.03);
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      transition: all 0.2s ease;
    }

    .btn-circle:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-main);
      transform: scale(1.08);
    }

    .btn-circle.btn-done:hover {
      background: rgba(52, 211, 153, 0.2);
      color: var(--neon-emerald);
      border-color: var(--neon-emerald);
    }

    .btn-circle.btn-delete:hover {
      background: rgba(239, 68, 68, 0.2);
      color: #EF4444;
      border-color: #EF4444;
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-dim);
    }

    .empty-icon {
      font-size: 42px;
      margin-bottom: 12px;
      opacity: 0.6;
    }

    /* ── MODAL ── */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 999;
      padding: 16px;
    }

    .modal-overlay.active {
      display: flex;
    }

    .modal-card {
      background: #0D1322;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      width: 100%;
      max-width: 520px;
      padding: 26px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.6);
      animation: modalIn 0.2s ease;
    }

    @keyframes modalIn {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .modal-title {
      font-size: 18px;
      font-weight: 800;
      margin-bottom: 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .form-group {
      margin-bottom: 14px;
    }

    .form-group label {
      display: block;
      font-size: 12px;
      font-weight: 700;
      color: var(--text-muted);
      margin-bottom: 6px;
      text-transform: uppercase;
    }

    .form-group input, .form-group select, .form-group textarea {
      width: 100%;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-subtle);
      padding: 11px 14px;
      border-radius: 10px;
      color: var(--text-main);
      font-size: 13px;
      outline: none;
    }

    .form-group input:focus, .form-group textarea:focus {
      border-color: var(--neon-cyan);
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-muted);
      border: none;
      padding: 10px 18px;
      border-radius: 10px;
      font-weight: 600;
      cursor: pointer;
    }

    .reject-reason-box {
      margin-top: 8px;
      padding: 8px 12px;
      background: rgba(239, 68, 68, 0.1);
      border-left: 3px solid #EF4444;
      border-radius: 6px;
      font-size: 12px;
      color: #FCA5A5;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- HEADER -->
    <header>
      <div class="brand-group">
        <div class="brand-icon">✨</div>
        <div class="brand-text">
          <h1>AZURA Command Center</h1>
          <p><span class="pulse-dot"></span> Real-Time Live Sync Active • VPS Stream Hub</p>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn-action" onclick="openAddModal()">➕ Tambah Tugas</button>
      </div>
    </header>

    <!-- METRICS OVERVIEW -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-icon" style="background: rgba(0, 255, 178, 0.12); color: var(--neon-cyan);">📋</div>
        <div class="metric-info">
          <h3 id="stat-todos" style="color: var(--neon-cyan);">0</h3>
          <p>Agenda To-Do Aktif</p>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-icon" style="background: rgba(251, 191, 36, 0.12); color: var(--neon-amber);">💡</div>
        <div class="metric-info">
          <h3 id="stat-advices" style="color: var(--neon-amber);">0</h3>
          <p>Saran & Advice Masuk</p>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-icon" style="background: rgba(251, 113, 133, 0.12); color: var(--neon-rose);">🐛</div>
        <div class="metric-info">
          <h3 id="stat-bugs" style="color: var(--neon-rose);">0</h3>
          <p>Laporan Bug Masuk</p>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-icon" style="background: rgba(52, 211, 153, 0.12); color: var(--neon-emerald);">🚀</div>
        <div class="metric-info">
          <h3 id="stat-done" style="color: var(--neon-emerald);">0</h3>
          <p>Tuntas & Live</p>
        </div>
      </div>
    </div>

    <!-- TABS -->
    <div class="tab-bar">
      <button class="tab-btn active" onclick="switchTab('all')" id="tab-all">
        <span>🌐 Semua Item</span>
        <span class="tab-badge" id="badge-all">0</span>
      </button>
      <button class="tab-btn" onclick="switchTab('todos')" id="tab-todos">
        <span>📋 Agenda To-Do</span>
        <span class="tab-badge" id="badge-todos">0</span>
      </button>
      <button class="tab-btn" onclick="switchTab('advices')" id="tab-advices">
        <span>💡 Saran Member</span>
        <span class="tab-badge" id="badge-advices">0</span>
      </button>
      <button class="tab-btn" onclick="switchTab('bugs')" id="tab-bugs">
        <span>🐛 Laporan Bug</span>
        <span class="tab-badge" id="badge-bugs">0</span>
      </button>
      <button class="tab-btn" onclick="switchTab('completed')" id="tab-completed">
        <span>✅ Selesai / Arsip</span>
        <span class="tab-badge" id="badge-completed">0</span>
      </button>
    </div>

    <!-- CONTROLS -->
    <div class="control-row">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" id="searchInput" placeholder="Cari berdasarkan judul, pesan, username, atau ID tiket..." oninput="renderItems()">
      </div>
      <div class="filter-group">
        <select class="filter-select" id="statusFilter" onchange="renderItems()">
          <option value="all">Semua Status</option>
          <option value="pending">Pending / Antrean</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Selesai</option>
          <option value="rejected">Ditolak</option>
        </select>
      </div>
    </div>

    <!-- LIST CONTAINER -->
    <div class="cards-list" id="cardsContainer">
      <!-- Injected via JavaScript -->
    </div>
  </div>

  <!-- MODAL TAMBAH TUGAS -->
  <div class="modal-overlay" id="addModal">
    <div class="modal-card">
      <div class="modal-title">
        <span>➕ Tambah Agenda To-Do Baru</span>
        <span style="cursor: pointer; opacity: 0.6;" onclick="closeAddModal()">✕</span>
      </div>
      <div class="form-group">
        <label>Judul Agenda / Tugas *</label>
        <input type="text" id="taskTitle" placeholder="Contoh: Implementasi integrasi API baru">
      </div>
      <div class="form-group">
        <label>Kategori</label>
        <select id="taskCategory">
          <option value="Dev">Dev / Coding</option>
          <option value="Feature">Feature Request</option>
          <option value="Urgent">Urgent / Penting</option>
          <option value="General" selected>General</option>
        </select>
      </div>
      <div class="form-group">
        <label>Prioritas</label>
        <select id="taskPriority">
          <option value="High">🔴 High Priority</option>
          <option value="Medium" selected>🟡 Medium Priority</option>
          <option value="Low">🟢 Low Priority</option>
        </select>
      </div>
      <div class="form-group">
        <label>Catatan / Detail Tambahan</label>
        <textarea id="taskNotes" rows="3" placeholder="Tambahkan rincian instruksi jika ada..."></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="closeAddModal()">Batal</button>
        <button class="btn-action" onclick="submitNewTask()">Simpan Agenda</button>
      </div>
    </div>
  </div>

  <script>
    let globalTodos = ${todosJson};
    let globalFeedbacks = ${feedbacksJson};
    let currentTab = 'all';

    function switchTab(tabName) {
      currentTab = tabName;
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.getElementById('tab-' + tabName).classList.add('active');
      renderItems();
    }

    function openAddModal() {
      document.getElementById('addModal').classList.add('active');
      document.getElementById('taskTitle').focus();
    }

    function closeAddModal() {
      document.getElementById('addModal').classList.remove('active');
      document.getElementById('taskTitle').value = '';
      document.getElementById('taskNotes').value = '';
    }

    async function submitNewTask() {
      const title = document.getElementById('taskTitle').value.trim();
      if (!title) return alert('Judul agenda tidak boleh kosong!');

      const category = document.getElementById('taskCategory').value;
      const priority = document.getElementById('taskPriority').value;
      const notes = document.getElementById('taskNotes').value.trim();

      try {
        const res = await fetch('/api/todo/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, category, priority, notes })
        });
        const json = await res.json();
        if (json.success) {
          closeAddModal();
          fetchLatestData();
        }
      } catch (err) {
        alert('Gagal menambahkan tugas: ' + err.message);
      }
    }

    async function toggleTask(id) {
      try {
        await fetch('/api/todo/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        fetchLatestData();
      } catch (_) {}
    }

    async function updateFeedback(ticketId, status) {
      let rejectReason = '';
      if (status === 'rejected') {
        rejectReason = prompt('Masukkan alasan penolakan untuk tiket ini:', 'Belum sesuai dengan roadmap saat ini') || 'Ditolak';
      }
      try {
        await fetch('/api/feedback/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId, status, rejectReason })
        });
        fetchLatestData();
      } catch (_) {}
    }

    async function deleteTask(id) {
      if (!confirm('Hapus item ini secara permanen dari server?')) return;
      try {
        await fetch('/api/todo/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        fetchLatestData();
      } catch (_) {}
    }

    async function deleteFeedback(ticketId) {
      if (!confirm('Hapus tiket feedback ini secara permanen dari server?')) return;
      try {
        await fetch('/api/feedback/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticketId })
        });
        fetchLatestData();
      } catch (_) {}
    }

    function renderItems() {
      const container = document.getElementById('cardsContainer');
      const search = (document.getElementById('searchInput').value || '').toLowerCase();
      const statusFilter = document.getElementById('statusFilter').value;

      // Transform both datasets into unified structure
      const unifiedItems = [];

      // 1. To-Dos
      globalTodos.forEach(t => {
        unifiedItems.push({
          id: t.id,
          type: 'todo',
          title: t.title,
          content: t.notes,
          category: t.category,
          priority: t.priority,
          status: t.status, // 'pending', 'in_progress', 'completed'
          creator: t.creatorName || 'Owner/System',
          createdAt: t.createdAt,
          raw: t
        });
      });

      // 2. Feedbacks & Bug Reports
      globalFeedbacks.forEach(f => {
        unifiedItems.push({
          id: f.ticketId,
          type: f.type, // 'advice' or 'report'
          title: f.type === 'advice' ? '💡 Saran Member: ' + (f.content || '').slice(0, 60) : '🐛 Laporan Bug: ' + (f.content || '').slice(0, 60),
          content: f.content,
          category: f.type === 'advice' ? 'Advice' : 'Bug Report',
          priority: f.type === 'report' ? 'High' : 'Medium',
          status: f.status, // 'pending', 'accepted', 'done', 'rejected'
          creator: f.userName || f.userTag || 'Member',
          guildName: f.guildName,
          rejectReason: f.rejectReason,
          imageUrl: f.imageUrl,
          createdAt: f.createdAt,
          raw: f
        });
      });

      // Update counters
      const activeTodos = globalTodos.filter(t => t.status !== 'completed').length;
      const adviceCount = globalFeedbacks.filter(f => f.type === 'advice' && f.status !== 'done' && f.status !== 'rejected').length;
      const bugCount = globalFeedbacks.filter(f => f.type === 'report' && f.status !== 'done' && f.status !== 'rejected').length;
      const doneCount = globalTodos.filter(t => t.status === 'completed').length + globalFeedbacks.filter(f => f.status === 'done').length;

      document.getElementById('stat-todos').innerText = activeTodos;
      document.getElementById('stat-advices').innerText = adviceCount;
      document.getElementById('stat-bugs').innerText = bugCount;
      document.getElementById('stat-done').innerText = doneCount;

      document.getElementById('badge-all').innerText = unifiedItems.length;
      document.getElementById('badge-todos').innerText = globalTodos.length;
      document.getElementById('badge-advices').innerText = globalFeedbacks.filter(f => f.type === 'advice').length;
      document.getElementById('badge-bugs').innerText = globalFeedbacks.filter(f => f.type === 'report').length;
      document.getElementById('badge-completed').innerText = doneCount;

      // Filter by tab
      let filtered = unifiedItems.filter(item => {
        if (currentTab === 'todos') return item.type === 'todo';
        if (currentTab === 'advices') return item.type === 'advice';
        if (currentTab === 'bugs') return item.type === 'report';
        if (currentTab === 'completed') return item.status === 'completed' || item.status === 'done';
        return true;
      });

      // Filter by status dropdown
      if (statusFilter !== 'all') {
        filtered = filtered.filter(item => {
          if (statusFilter === 'pending') return item.status === 'pending';
          if (statusFilter === 'in_progress') return item.status === 'in_progress' || item.status === 'accepted';
          if (statusFilter === 'completed') return item.status === 'completed' || item.status === 'done';
          if (statusFilter === 'rejected') return item.status === 'rejected';
          return true;
        });
      }

      // Filter by search query
      if (search) {
        filtered = filtered.filter(item => {
          return (item.title || '').toLowerCase().includes(search) ||
            (item.content || '').toLowerCase().includes(search) ||
            (item.creator || '').toLowerCase().includes(search) ||
            (item.id || '').toLowerCase().includes(search);
        });
      }

      if (filtered.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <div class="empty-icon">📭</div>
            <p>Tidak ada agenda atau laporan yang cocok dengan filter saat ini.</p>
          </div>
        \`;
        return;
      }

      container.innerHTML = filtered.map(item => {
        const isDone = item.status === 'completed' || item.status === 'done';
        const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
        
        let badgeType = '<span class="badge badge-todo">📋 To-Do</span>';
        if (item.type === 'advice') badgeType = '<span class="badge badge-adv">💡 Advice</span>';
        if (item.type === 'report') badgeType = '<span class="badge badge-rep">🐛 Bug Report</span>';

        let badgeStatus = \`<span class="badge badge-status-\${item.status}">\${item.status.toUpperCase()}</span>\`;

        let actionBtns = '';
        if (item.type === 'todo') {
          actionBtns = \`
            <button class="btn-circle btn-done" title="\${isDone ? 'Batal Selesai' : 'Tandai Selesai'}" onclick="toggleTask('\${item.id}')">\${isDone ? '↩️' : '✅'}</button>
            <button class="btn-circle btn-delete" title="Hapus Tugas" onclick="deleteTask('\${item.id}')">🗑️</button>
          \`;
        } else {
          // Feedback
          if (item.status === 'pending') {
            actionBtns = \`
              <button class="btn-circle btn-done" title="Terima & Masukkan To-Do" onclick="updateFeedback('\${item.id}', 'accepted')">👍</button>
              <button class="btn-circle btn-delete" title="Tolak Saran" onclick="updateFeedback('\${item.id}', 'rejected')">❌</button>
            \`;
          } else if (item.status === 'accepted') {
            actionBtns = \`
              <button class="btn-circle btn-done" title="Tandai Sudah Selesai Diterapkan" onclick="updateFeedback('\${item.id}', 'done')">✅</button>
              <button class="btn-circle btn-delete" title="Hapus Tiket" onclick="deleteFeedback('\${item.id}')">🗑️</button>
            \`;
          } else {
            actionBtns = \`
              <button class="btn-circle btn-delete" title="Hapus Tiket" onclick="deleteFeedback('\${item.id}')">🗑️</button>
            \`;
          }
        }

        const reasonBox = item.rejectReason ? \`<div class="reject-reason-box"><strong>Alasan Penolakan:</strong> \${item.rejectReason}</div>\` : '';
        const imageBox = item.imageUrl ? \`<div style="margin-top: 8px;"><a href="\${item.imageUrl}" target="_blank" style="color: var(--neon-blue); font-size: 12px;">📎 Lihat Screenshot Lampiran</a></div>\` : '';

        return \`
          <div class="item-card \${isDone ? 'completed' : ''}">
            <div class="item-main">
              <div class="item-header">
                <span class="item-id">#\${item.id}</span>
                \${badgeType}
                \${badgeStatus}
              </div>
              <div class="item-title">\${item.title}</div>
              \${item.content ? \`<div class="item-notes">\${item.content}</div>\` : ''}
              \${reasonBox}
              \${imageBox}
              <div class="item-footer">
                <span>👤 \${item.creator} \${item.guildName ? \`(\${item.guildName})\` : ''}</span>
                <span>📅 \${dateStr}</span>
                <span>🏷️ \${item.category}</span>
              </div>
            </div>
            <div class="item-actions">
              \${actionBtns}
            </div>
          </div>
        \`;
      }).join('');
    }

    async function fetchLatestData() {
      try {
        const [todosRes, feedbacksRes] = await Promise.all([
          fetch('/api/todo/list').then(r => r.json()),
          fetch('/api/feedback/list').then(r => r.json())
        ]);
        if (todosRes.success && Array.isArray(todosRes.tasks)) {
          globalTodos = todosRes.tasks;
        }
        if (feedbacksRes.success && Array.isArray(feedbacksRes.tickets)) {
          globalFeedbacks = feedbacksRes.tickets;
        }
        renderItems();
      } catch (_) {}
    }

    // Initial render & 2.5s real-time auto-polling
    renderItems();
    setInterval(fetchLatestData, 2500);
  </script>
</body>
</html>`;
}

module.exports = {
  generateMasterDashboardHtml
};
