// All data lives here while the app runs. Changes apply on screen at once,
// are kept on the device, and are sent to Supabase through the outbox.
import { db, enqueue, flush, pendingChanges, currentUser } from './api.js';
import { uuid, today, nextRepeat, daysBetween, addDays } from './util.js';

const TABLES = ['areas', 'projects', 'tasks', 'subtasks', 'progress_log'];
const WC = { chapters: 'wc_chapters', entries: 'wc_entries', settings: 'wc_settings' };
const SNAPSHOT_KEY = 'planner.snapshot';

export const state = {
  areas: [], projects: [], tasks: [], subtasks: [], progress_log: [],
  wc: { chapters: [], entries: [], settings: null },
  workdays: [], settings: {},
  loaded: false, offline: false, needsUpdate: false,
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
let emitQueued = false;
function emit() {
  saveSnapshot();
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => { emitQueued = false; listeners.forEach((fn) => fn()); });
}

function saveSnapshot() {
  if (!state.loaded) return;
  try {
    const snap = { user: currentUser()?.id };
    TABLES.forEach((t) => { snap[t] = state[t]; });
    snap.wc = state.wc;
    snap.workdays = state.workdays;
    snap.settings = state.settings;
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch { /* storage full or unavailable */ }
}

export function loadSnapshot() {
  try {
    const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY));
    if (!snap || snap.user !== currentUser()?.id) return false;
    TABLES.forEach((t) => { state[t] = snap[t] || []; });
    if (snap.wc) state.wc = snap.wc;
    if (snap.workdays) state.workdays = snap.workdays;
    if (snap.settings) state.settings = snap.settings;
    state.loaded = true;
    emit();
    return true;
  } catch { return false; }
}

export function clearSnapshot() { try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* ignore */ } }

// Fetch everything from the server. Skipped while local changes are still waiting to be sent,
// so a refresh never overwrites them.
export async function refresh() {
  await flush();
  if (pendingChanges()) return false;
  // A table that doesn't exist yet means the database update hasn't been run.
  let missing = false;
  const get = (t) => db.all(t).catch((e) => { if (/does not exist|schema cache|Could not find/i.test(e.message)) { missing = true; return []; } throw e; });
  const [results, chapters, entries, settings, workdays, userSettings] = await Promise.all([
    Promise.all(TABLES.map(get)), get(WC.chapters), get(WC.entries), get(WC.settings), get('working_days'), get('user_settings'),
  ]);
  if (pendingChanges()) return false;
  TABLES.forEach((t, i) => { state[t] = results[i]; });
  state.wc = { chapters, entries, settings: settings[0] || null };
  state.workdays = workdays;
  state.settings = userSettings[0]?.data || {};
  state.needsUpdate = missing || (settings[0] && !('off_days' in settings[0])) || (results[1][0] && !('emoji' in results[1][0]));
  state.loaded = true;
  state.offline = false;
  emit();
  return true;
}

const DEFAULTS = {
  areas: () => ({ name: '' }),
  projects: () => ({
    area_id: null, parent_id: null, name: '', description: '', notes: '', status: 'active',
    start_date: null, deadline: null, progress_type: 'tasks', progress_value: 0, progress_target: null,
    progress_unit: '', collapsed: false, completed_at: null, emoji: '', color: '',
  }),
  tasks: () => ({
    project_id: null, title: '', notes: '', planned_date: null, deadline: null, estimate_minutes: null,
    priority: false, repeat_rule: null, start_time: null, block_minutes: null, done: false, done_at: null,
  }),
  subtasks: () => ({ title: '', done: false }),
  progress_log: () => ({}),
};

export function create(table, fields) {
  const row = { id: uuid(), sort_order: Date.now(), created_at: new Date().toISOString(), ...DEFAULTS[table](), ...fields };
  state[table].push(row);
  const send = { ...row };
  if (table === 'projects' && state.needsUpdate) { delete send.emoji; delete send.color; }
  enqueue({ type: 'insert', table, row: send });
  emit();
  return row;
}

export function update(table, id, patch) {
  const row = state[table].find((r) => r.id === id);
  if (!row) return;
  const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => row[k] !== v));
  if (!Object.keys(changed).length) return;
  Object.assign(row, changed);
  enqueue({ type: 'update', table, id, patch: changed });
  emit();
}

export function remove(table, id) {
  state[table] = state[table].filter((r) => r.id !== id);
  // Mirror the database's cascades on screen.
  if (table === 'projects') {
    const gone = new Set([id, ...descendants(id)]);
    state.projects = state.projects.filter((p) => !gone.has(p.id));
    const taskIds = new Set(state.tasks.filter((t) => gone.has(t.project_id)).map((t) => t.id));
    state.tasks = state.tasks.filter((t) => !taskIds.has(t.id));
    state.subtasks = state.subtasks.filter((s) => !taskIds.has(s.task_id));
  }
  if (table === 'tasks') state.subtasks = state.subtasks.filter((s) => s.task_id !== id);
  if (table === 'areas') state.projects.forEach((p) => { if (p.area_id === id) p.area_id = null; });
  enqueue({ type: 'delete', table, id });
  emit();
}

// ---- Selectors

export const byOrder = (a, b) => (a.sort_order - b.sort_order) || String(a.created_at).localeCompare(String(b.created_at));
export const getProject = (id) => state.projects.find((p) => p.id === id);
export const getTask = (id) => state.tasks.find((t) => t.id === id);
export const children = (pid) => state.projects.filter((p) => p.parent_id === pid).sort(byOrder);
export const topProjects = () => state.projects.filter((p) => !p.parent_id).sort(byOrder);
export const areas = () => [...state.areas].sort(byOrder);
export const subtasksOf = (tid) => state.subtasks.filter((s) => s.task_id === tid).sort(byOrder);
export const tasksIn = (pid) => state.tasks.filter((t) => t.project_id === pid).sort(byOrder);

export function descendants(pid) {
  const out = [];
  const walk = (id) => children(id).forEach((c) => { out.push(c.id); walk(c.id); });
  walk(pid);
  return out;
}

export function rootOf(project) {
  let p = project;
  while (p?.parent_id) p = getProject(p.parent_id);
  return p;
}

// "Dissertation › Chapter 4" for showing where a task lives.
export function projectPath(pid) {
  const names = [];
  let p = getProject(pid);
  while (p) { names.unshift(p.name); p = p.parent_id ? getProject(p.parent_id) : null; }
  return names.join(' › ');
}

export function progress(p) {
  const type = p.progress_type;
  if (type === 'subgoals') {
    const subs = descendants(p.id).map((id) => getProject(id));
    const done = subs.filter((s) => s.status === 'done').length;
    return { ratio: subs.length ? done / subs.length : 0, label: subs.length ? `${done} of ${subs.length} subgoals` : 'No subgoals yet' };
  }
  if (type === 'number') {
    const target = Number(p.progress_target) || 0, value = Number(p.progress_value) || 0;
    const unit = p.progress_unit ? ` ${p.progress_unit}` : '';
    return { ratio: target ? Math.min(1, value / target) : 0, label: target ? `${value.toLocaleString('en-US')} of ${target.toLocaleString('en-US')}${unit}` : `${value.toLocaleString('en-US')}${unit}` };
  }
  if (type === 'words') {
    const value = wcTotal(), target = state.wc.settings?.goal || 0;
    return { ratio: target ? Math.min(1, value / target) : 0, label: `${value.toLocaleString('en-US')} of ${target.toLocaleString('en-US')} words` };
  }
  if (type === 'percent') {
    const v = Math.max(0, Math.min(100, Number(p.progress_value) || 0));
    return { ratio: v / 100, label: `${v}%` };
  }
  const ids = new Set([p.id, ...descendants(p.id)]);
  const all = state.tasks.filter((t) => ids.has(t.project_id));
  const done = all.filter((t) => t.done).length;
  return { ratio: all.length ? done / all.length : 0, label: all.length ? `${done} of ${all.length} tasks` : 'No tasks yet' };
}

// ---- Task actions

export function toggleDone(id) {
  const t = getTask(id);
  if (!t) return;
  const done = !t.done;
  update('tasks', id, { done, done_at: done ? new Date().toISOString() : null });
  if (done && t.repeat_rule) {
    const base = t.planned_date || today();
    const next = nextRepeat(base, t.repeat_rule);
    const shift = daysBetween(base, next);
    const copy = create('tasks', {
      project_id: t.project_id, title: t.title, notes: t.notes, estimate_minutes: t.estimate_minutes,
      priority: t.priority, repeat_rule: t.repeat_rule, planned_date: next,
      deadline: t.deadline ? addDays(t.deadline, shift) : null, sort_order: t.sort_order,
    });
    subtasksOf(id).forEach((s) => create('subtasks', { task_id: copy.id, title: s.title, sort_order: s.sort_order }));
    // The repeat moves to the new copy, so ticking this one again doesn't create a second copy.
    update('tasks', id, { repeat_rule: null });
  }
}

// A new value for a project measured by a number or percentage, kept in its history for the graph.
export function setProgressValue(id, value) {
  update('projects', id, { progress_value: value });
  const day = today();
  const existing = state.progress_log.find((l) => l.project_id === id && l.day === day);
  if (existing) update('progress_log', existing.id, { value });
  else create('progress_log', { project_id: id, day, value });
}

// ---- Word counter

// A chapter marked for trimming counts as its trim target until the real count drops to that target.
export const wcCounted = (c) => (c.trim_to != null && c.words > c.trim_to ? c.trim_to : c.words);
export const wcChapters = () => [...state.wc.chapters].sort((a, b) => a.ord - b.ord);
export const wcTotal = () => state.wc.chapters.reduce((a, c) => a + wcCounted(c), 0);

export function wcSaveChapter(row) {
  const i = state.wc.chapters.findIndex((c) => c.id === row.id);
  if (i >= 0) state.wc.chapters[i] = row; else state.wc.chapters.push(row);
  enqueue({ type: 'upsert', table: WC.chapters, row, conflict: 'user_id,id' });
  emit();
}

export function wcSaveEntry(row) {
  const i = state.wc.entries.findIndex((e) => e.day === row.day);
  if (i >= 0) state.wc.entries[i] = row; else state.wc.entries.push(row);
  enqueue({ type: 'upsert', table: WC.entries, row, conflict: 'user_id,day' });
  emit();
}

export function wcDeleteEntry(day) {
  state.wc.entries = state.wc.entries.filter((e) => e.day !== day);
  enqueue({ type: 'delete', table: WC.entries, id: day, key: 'day' });
  emit();
}

export function wcSaveSettings(patch) {
  const row = { ...(state.wc.settings || { baseline: 0, goal: 90000 }), ...patch };
  delete row.user_id;
  state.wc.settings = row;
  enqueue({ type: 'upsert', table: WC.settings, row, conflict: 'user_id' });
  emit();
}

// ---- Working hours

// Your usual week. Day numbers as in JavaScript: 0 = Sunday … 6 = Saturday.
export const DEFAULT_WEEK = { 0: null, 1: { start: '08:00', end: '16:00' }, 2: { start: '08:00', end: '16:00' }, 3: { start: '08:00', end: '16:00' }, 4: { start: '08:00', end: '16:00' }, 5: { start: '08:00', end: '16:00' }, 6: null };
export const usualWeek = () => ({ ...DEFAULT_WEEK, ...(state.settings.week || {}) });

export function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  enqueue({ type: 'upsert', table: 'user_settings', row: { data: state.settings, updated_at: new Date().toISOString() }, conflict: 'user_id' });
  emit();
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

// Working hours on one day: { start, end, custom } or null for a day off.
export function workHours(day) {
  const o = state.workdays.find((w) => w.day === day);
  if (o) return o.start_time ? { start: hhmm(o.start_time), end: hhmm(o.end_time), custom: true } : null;
  const [y, m, d] = day.split('-').map(Number);
  const usual = usualWeek()[new Date(y, m - 1, d).getDay()];
  return usual ? { ...usual, custom: false } : null;
}
export const isCustomDay = (day) => state.workdays.some((w) => w.day === day);

// Change one day: hours, or null for a day off.
export function setWorkday(day, hours) {
  const row = { day, start_time: hours ? hours.start : null, end_time: hours ? hours.end : null };
  const i = state.workdays.findIndex((w) => w.day === day);
  if (i >= 0) state.workdays[i] = row; else state.workdays.push(row);
  enqueue({ type: 'upsert', table: 'working_days', row, conflict: 'user_id,day' });
  emit();
}

export function resetWorkday(day) {
  state.workdays = state.workdays.filter((w) => w.day !== day);
  enqueue({ type: 'delete', table: 'working_days', id: day, key: 'day' });
  emit();
}

export function setProjectStatus(id, status) {
  update('projects', id, { status, completed_at: status === 'done' ? new Date().toISOString() : null });
}

// ---- Import (a backup, or data brought over from another app)

const FIELDS = {
  areas: ['id', 'name', 'sort_order', 'created_at'],
  projects: ['id', 'area_id', 'parent_id', 'name', 'description', 'notes', 'status', 'start_date', 'deadline', 'progress_type',
    'progress_value', 'progress_target', 'progress_unit', 'collapsed', 'sort_order', 'created_at', 'completed_at', 'emoji', 'color'],
  tasks: ['id', 'project_id', 'title', 'notes', 'planned_date', 'deadline', 'estimate_minutes', 'priority', 'repeat_rule',
    'start_time', 'block_minutes', 'done', 'done_at', 'sort_order', 'created_at'],
  subtasks: ['id', 'task_id', 'title', 'done', 'sort_order', 'created_at'],
};

// Works out what an import file would add. Items already here (same id) are skipped,
// and areas with a name you already use are merged into yours.
export function planImport(data) {
  if (!data || data.app !== 'Planner') throw new Error('This file is not a Planner backup or import file.');
  const has = (table, id) => state[table].some((r) => r.id === id);
  const areaMap = {};
  const newAreas = [];
  (data.areas || []).forEach((a) => {
    const same = state.areas.find((x) => x.id === a.id || x.name.trim().toLowerCase() === String(a.name).trim().toLowerCase());
    if (same) areaMap[a.id] = same.id; else newAreas.push(a);
  });
  // Parents before their subgoals.
  const pending = (data.projects || []).filter((p) => !has('projects', p.id));
  const ids = new Set(pending.map((p) => p.id));
  const ordered = [];
  const placed = new Set();
  let guard = 0;
  while (ordered.length < pending.length && guard++ < 50) {
    pending.forEach((p) => {
      if (placed.has(p.id)) return;
      if (!p.parent_id || !ids.has(p.parent_id) || placed.has(p.parent_id)) { ordered.push(p); placed.add(p.id); }
    });
  }
  const tasks = (data.tasks || []).filter((t) => !has('tasks', t.id));
  const wcChaptersNew = (data.wc_chapters || []).filter((c) => !state.wc.chapters.some((x) => x.id === c.id));
  const wcEntriesNew = (data.wc_entries || []).filter((e) => !state.wc.entries.some((x) => x.day === e.day));
  const wcSettingsNew = !state.wc.settings && data.wc_settings ? data.wc_settings : null;
  const looks = (data.project_looks || []).filter((l) => { const p = state.projects.find((x) => x.id === l.id); return p && !p.emoji; });
  const subtasks = (data.subtasks || []).filter((s) => !has('subtasks', s.id));
  return {
    areaMap, areas: newAreas, projects: ordered, tasks, subtasks,
    skipped: (data.projects || []).length - ordered.length + (data.tasks || []).length - tasks.length,
    openTasks: tasks.filter((t) => !t.done).length,
    wcChapters: wcChaptersNew, wcEntries: wcEntriesNew, wcSettings: wcSettingsNew, looks,
  };
}

export function runImport(plan) {
  const pick = (table, row) => Object.fromEntries(FIELDS[table].filter((k) => k in row).map((k) => [k, row[k]]));
  // New areas go after the ones you already have, in the file's order.
  plan.areas.forEach((a, i) => create('areas', { ...pick('areas', a), sort_order: Date.now() + i }));
  plan.projects.forEach((p) => {
    const row = pick('projects', p);
    if (row.area_id && plan.areaMap[row.area_id]) row.area_id = plan.areaMap[row.area_id];
    create('projects', row);
  });
  plan.tasks.forEach((t) => create('tasks', pick('tasks', t)));
  plan.subtasks.forEach((s) => create('subtasks', pick('subtasks', s)));
  plan.looks.forEach((l) => update('projects', l.id, { emoji: l.emoji || '', color: l.color || '' }));
  plan.wcChapters.forEach((c) => wcSaveChapter({ id: c.id, name: c.name, ord: c.ord, words: c.words, trim_to: c.trim_to ?? null, trimmed: !!c.trimmed }));
  plan.wcEntries.forEach((e) => wcSaveEntry({ day: e.day, words: e.words, chapters: e.chapters || {}, note: e.note || '' }));
  if (plan.wcSettings) wcSaveSettings(plan.wcSettings);
}

export function exportAll() {
  const out = { exported_at: new Date().toISOString(), app: 'Planner', version: 1 };
  TABLES.forEach((t) => { out[t] = state[t]; });
  out.wc_chapters = state.wc.chapters;
  out.wc_entries = state.wc.entries;
  out.wc_settings = state.wc.settings;
  return out;
}
