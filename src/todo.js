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
  const { getAllFeedbackTickets } = require('./feedback');
  const { generateMasterDashboardHtml } = require('./dashboardHtml');
  return generateMasterDashboardHtml(todoCache, getAllFeedbackTickets());
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
