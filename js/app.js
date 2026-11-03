// Starts the app, draws the screen and responds to clicks and typing.
import { currentUser, signIn, signOut, AuthError, NetworkError, onOutboxChange, pendingChanges, clearOutbox } from './api.js';
import {
  state, onChange, refresh, loadSnapshot, clearSnapshot, create, update, remove, toggleDone, setProjectStatus,
  getTask, getProject, areas, exportAll, byOrder, planImport, runImport, setProgressValue, finishTask,
} from './store.js';
import * as V from './views.js';
import { projectsView, projectView } from './project.js';
import { planView, setupDrag, fillDay, dragging, dayView, blockPanel, toggleItem, addProjectTime, itemByKey } from './plan.js';
import { calendarView, projectsTimelineView, setupCalendarDrag, calDragging } from './calendar.js';
import { setWorkday, resetWorkday, saveSettings, usualWeek } from './store.js';
import { writingView, updateWritingInputs, setDraft, saveCounts, deleteDay, addChapter, saveWritingSettings, earnedBadges } from './writing.js';
import { today, addDays } from './util.js';

const $ = (sel) => document.querySelector(sel);
const ui = { panel: null, confirmDelete: false, showDone: {}, showDoneToday: false };
const root = $('#app');

// ---- Routing (#/today, #/inbox, #/projects, #/project/<id>, #/settings)

function route() {
  const [, name = 'today', id, tab] = (location.hash || '#/today').split('/');
  return { name, id, tab };
}
addEventListener('hashchange', () => { render(); $('#main')?.scrollTo?.(0, 0); });

// ---- Drawing

function mainHTML(r) {
  if (!state.loaded) return '<p class="empty">Loading…</p>';
  switch (r.name) {
    case 'inbox': return V.inboxView();
    case 'projects': return projectsView();
    case 'project': return projectView(r.id, r.tab, ui);
    case 'writing': return writingView(ui);
    case 'settings': return V.settingsView(currentUser()?.email, pendingChanges(), ui.importPlan, ui.importError, ui);
    case 'plan': return planView(ui);
    case 'calendar': return calendarView(ui);
    case 'timeline': return projectsTimelineView(ui);
    case 'day': return r.id ? dayView(r.id) : V.todayView(ui);
    default: return V.todayView(ui);
  }
}

function render() {
  if (dragging() || calDragging()) { setTimeout(render, 250); return; }
  if (!currentUser()) {
    root.innerHTML = V.loginView(ui.loginError || '');
    document.title = 'Sign in';
    return;
  }
  if (!$('#main')) {
    root.innerHTML = `<div class="layout">
      <div id="sidebar"></div>
      <main id="main" tabindex="-1"></main>
    </div>
    <div id="tabbar"></div>
    <div class="scrim" data-act="close-panel" hidden></div>
    <aside id="panel" class="panel" hidden aria-label="Details"></aside>
    <div id="status" class="status" role="status"></div>
    <div id="toast" class="toast" role="status" hidden></div>`;
  }
  const r = route();
  // Keep the cursor where it was when the screen redraws.
  const active = document.activeElement;
  const keepId = active && $('#main')?.contains(active) ? active.id : null;
  $('#sidebar').innerHTML = V.sidebar(r);
  $('#tabbar').innerHTML = V.tabbar(r);
  $('#main').innerHTML = `<div class="page">${mainHTML(r)}</div>`;
  if (keepId) document.getElementById(keepId)?.focus();
  if (r.name === 'writing') { updateWritingInputs(); checkBadges(); }
  const titles = { today: 'Today', inbox: 'Inbox', projects: 'Projects', settings: 'Settings', writing: 'Word counter', plan: 'Plan your day', calendar: 'Calendar', timeline: 'Timeline', day: 'Day' };
  document.title = r.name === 'project' ? (getProject(r.id)?.name || 'Project') : titles[r.name] || 'Today';
  if (ui.panel && !panelTargetExists()) closePanel();
  renderStatus();
}

function panelTargetExists() {
  if (ui.panel.type === 'task') return !!getTask(ui.panel.id);
  if (ui.panel.type === 'project') return !!getProject(ui.panel.id);
  if (ui.panel.type === 'block') return state.time_blocks.some((b) => b.id === ui.panel.id);
  return true;
}

function renderPanel() {
  const panel = $('#panel');
  if (!panel) return;
  if (!ui.panel) { panel.hidden = true; $('.scrim').hidden = true; document.body.classList.remove('panel-open'); return; }
  const keep = document.activeElement && panel.contains(document.activeElement) ? document.activeElement.id : null;
  panel.innerHTML = ui.panel.type === 'task' ? V.taskPanel(ui.panel.id)
    : ui.panel.type === 'block' ? blockPanel(ui.panel.id)
    : ui.panel.type === 'project' ? V.projectPanel(ui.panel.id, ui.confirmDelete)
      : V.quickAddPanel();
  panel.hidden = false;
  $('.scrim').hidden = false;
  document.body.classList.add('panel-open');
  if (keep) document.getElementById(keep)?.focus();
  autosize(panel.querySelector('.title-input'));
}

function openPanel(type, id, focusId) {
  ui.panel = { type, id };
  ui.confirmDelete = false;
  renderPanel();
  const el = focusId && document.getElementById(focusId);
  if (el) { el.focus(); el.select?.(); }
}

function closePanel() {
  ui.panel = null;
  ui.confirmDelete = false;
  renderPanel();
}

function renderStatus() {
  const el = $('#status');
  if (!el) return;
  const n = pendingChanges();
  if (state.offline || n) {
    el.textContent = state.offline ? `Offline${n ? ` · ${n} change${n === 1 ? '' : 's'} waiting` : ''}` : 'Saving…';
    el.hidden = false;
  } else el.hidden = true;
}

// A small celebration when a word counter milestone is reached.
let knownBadges = null;
function checkBadges() {
  const now = earnedBadges();
  if (knownBadges && state.loaded) {
    const fresh = now.filter((b) => !knownBadges.includes(b));
    if (fresh.length) toast(`🎉 Milestone reached: ${fresh.join(', ')}`);
  }
  if (state.loaded) knownBadges = now;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function autosize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

onChange(render);
onOutboxChange((n, err) => {
  if (err instanceof NetworkError) state.offline = true;
  else if (err instanceof AuthError) { render(); return; }
  else if (err) toast('One change could not be saved and was skipped.');
  else if (n === 0) state.offline = false;
  renderStatus();
  if (route().name === 'settings') render();
});

// ---- Loading data

async function sync() {
  if (!currentUser()) return;
  try {
    await refresh();
  } catch (e) {
    if (e instanceof NetworkError) { state.offline = true; renderStatus(); } else if (e instanceof AuthError) { render(); } else toast(e.message);
  }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60000);

// ---- Clicks

const actions = {
  'toggle-done': (id) => { toggleDone(id); if (ui.panel?.id === id) renderPanel(); },
  'open-task': (id) => openPanel('task', id),
  'open-item': (key) => openItem(key),
  'toggle-item': (key, btn) => {
    toggleItem(key, btn.dataset.day || today(), toggleDone);
    if (ui.panel && key.endsWith(ui.panel.id)) renderPanel();
  },
  'finish-task': (id) => { finishTask(id); renderPanel(); toast('Finished. Well done!'); },
  'cal-mode': (mode) => { ui.calMode = mode; render(); },
  'cal-go': (day) => { ui.calAnchor = day; render(); },
  'block-delete': (id) => { closePanel(); remove('time_blocks', id); toast('Project time removed'); },
  'block-again': (id) => {
    const b = state.time_blocks.find((x) => x.id === id);
    if (!b) return;
    addProjectTime(addDays(b.day, 1), b.project_id, b.block_minutes);
    toast('Added to the next day');
  },
  'block-again-today': (id) => {
    const b = state.time_blocks.find((x) => x.id === id);
    if (b) addProjectTime(today(), b.project_id, b.block_minutes);
  },
  'close-panel': () => closePanel(),
  'quick-add': () => openPanel('quick', null, 'qa-title'),
  'move-earlier': () => {
    state.tasks.filter((t) => !t.done && t.planned_date && t.planned_date < today()).forEach((t) => update('tasks', t.id, { planned_date: today() }));
  },
  'new-project': () => {
    const p = create('projects', { name: 'New project', area_id: areas()[0]?.id ?? null });
    location.hash = `#/project/${p.id}`;
    openPanel('project', p.id, 'proj-name');
  },
  'new-subgoal': (id) => {
    const p = create('projects', { name: 'New subgoal', parent_id: id });
    openPanel('project', p.id, 'proj-name');
  },
  'edit-project': (id) => openPanel('project', id, null),
  'hide-plan-banner': () => { ui.hidePlanBanner = today(); render(); },
  'plan-done': () => { saveSettings({ lastPlanned: today() }); location.hash = '#/today'; },
  'fill-day': () => { const n = fillDay(today()); toast(n ? `Placed ${n} task${n === 1 ? '' : 's'} in your working hours` : 'No free time left in your working hours'); },
  'wd-select': (day) => { ui.wdSel = ui.wdSel === day ? null : day; render(); },
  'wd-month': (month) => { ui.wdMonth = month; ui.wdSel = null; render(); },
  'wd-reset': (day) => { resetWorkday(day); toast('Back to your usual hours'); },
  'pick-emoji': (id, btn) => { update('projects', id, { emoji: btn.dataset.emoji }); renderPanel(); },
  'pick-color': (id, btn) => { update('projects', id, { color: btn.dataset.color }); renderPanel(); },
  'wc-delete': (day) => {
    if (ui.wcConfirm !== day) { ui.wcConfirm = day; render(); return; }
    ui.wcConfirm = null; deleteDay(day); toast('Day removed from the log');
  },
  'toggle-show-done': (id) => { ui.showDone[id] = !ui.showDone[id]; render(); },
  plan: (id, btn) => {
    const when = btn.dataset.when;
    update('tasks', id, { planned_date: when === 'today' ? today() : when === 'tomorrow' ? addDays(today(), 1) : null, start_time: null });
    renderPanel();
  },
  'task-delete': (id) => { closePanel(); remove('tasks', id); toast('Task deleted'); },
  'sub-delete': (id) => { remove('subtasks', id); renderPanel(); },
  'project-delete': () => { ui.confirmDelete = true; renderPanel(); },
  'project-delete-cancel': () => { ui.confirmDelete = false; renderPanel(); },
  'project-delete-confirm': (id) => {
    const p = getProject(id);
    closePanel();
    if (route().name === 'project' && route().id === id) location.hash = p?.parent_id ? `#/project/${p.parent_id}` : '#/projects';
    remove('projects', id);
    toast(p?.parent_id ? 'Subgoal deleted' : 'Project deleted');
  },
  'area-up': (id) => moveArea(id, -1),
  'area-down': (id) => moveArea(id, 1),
  'area-delete': (id) => { remove('areas', id); toast('Area deleted. Its projects are kept, without an area.'); },
  export: () => {
    const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `planner-backup-${today()}.json`;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  'import-run': () => {
    const plan = ui.importPlan;
    ui.importPlan = null;
    runImport(plan);
    toast(`Imported ${plan.projects.length} projects and ${plan.tasks.length} tasks. Saving in the background…`);
  },
  'import-cancel': () => { ui.importPlan = null; render(); },
  'sign-out': () => {
    if (pendingChanges() && !ui.confirmSignOut) { ui.confirmSignOut = true; toast('Some changes are not saved yet. Press Sign out again to sign out anyway.'); return; }
    ui.confirmSignOut = false;
    signOut(); clearOutbox(); clearSnapshot();
    ['areas', 'projects', 'tasks', 'subtasks'].forEach((t) => { state[t] = []; });
    state.loaded = false;
    closePanel();
    root.innerHTML = '';
    render();
  },
};

function openItem(key) {
  const [kind, id] = key.split(':');
  openPanel(kind === 'block' ? 'block' : 'task', id);
}

function moveArea(id, dir) {
  const list = areas();
  const i = list.findIndex((a) => a.id === id), j = i + dir;
  if (j < 0 || j >= list.length) return;
  const a = list[i], b = list[j];
  const ao = a.sort_order, bo = b.sort_order === ao ? ao + dir : b.sort_order;
  update('areas', a.id, { sort_order: bo });
  update('areas', b.id, { sort_order: ao });
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const fn = actions[btn.dataset.act];
  if (!fn) return;
  if (btn.closest('summary')) e.preventDefault();
  fn(btn.dataset.id, btn);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.panel) closePanel();
  if (e.key === 'Enter' && e.target.classList?.contains('title-input')) { e.preventDefault(); e.target.blur(); }
});

// ---- Forms

const forms = {
  login: async (form) => {
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await signIn($('#login-email').value.trim(), $('#login-password').value);
      ui.loginError = '';
      root.innerHTML = '';
      render();
      await sync();
    } catch (e) {
      ui.loginError = e instanceof NetworkError ? 'No connection. Check your internet and try again.' : 'Wrong email or password.';
      render();
    }
  },
  'add-task': (form) => {
    const input = form.querySelector('input');
    const title = input.value.trim();
    if (!title) return;
    create('tasks', { title, project_id: form.dataset.project || null, planned_date: form.dataset.planned || null });
    input.value = '';
  },
  'add-subtask': (form) => {
    const input = form.querySelector('input');
    const title = input.value.trim();
    if (!title) return;
    create('subtasks', { task_id: form.dataset.task, title });
    renderPanel();
    $('#add-subtask')?.focus();
  },
  'add-area': (form) => {
    const input = form.querySelector('input');
    const name = input.value.trim();
    if (!name) return;
    create('areas', { name });
    input.value = '';
  },
  progress: (form) => {
    const v = Number(form.querySelector('input').value);
    if (!Number.isFinite(v)) return;
    setProgressValue(form.dataset.id, v);
    toast('Progress updated');
  },
  'project-time': (form) => {
    const day = form.dataset.day;
    const p = document.getElementById(`pt-project-${day}`).value;
    const len = Number(document.getElementById(`pt-length-${day}`).value) || 120;
    if (p) { addProjectTime(day, p, len); toast('Project time added. Drag it onto the timeline.'); }
  },
  'today-hours': () => {
    const on = $('#th-work').checked;
    setWorkday(today(), on ? { start: $('#th-start').value, end: $('#th-end').value } : null);
    toast(on ? `Working ${$('#th-start').value}–${$('#th-end').value} today` : 'Today is a day off');
  },
  'day-hours': (form) => {
    const on = $('#dh-work').checked;
    setWorkday(form.dataset.day, on ? { start: $('#dh-start').value, end: $('#dh-end').value } : null);
    toast('Day saved');
  },
  'usual-week': () => {
    const week = {};
    [0, 1, 2, 3, 4, 5, 6].forEach((d) => {
      const on = document.querySelector(`.wk-on[data-day="${d}"]`).checked;
      week[d] = on ? { start: document.querySelector(`.wk-start[data-day="${d}"]`).value, end: document.querySelector(`.wk-end[data-day="${d}"]`).value } : null;
    });
    saveSettings({ week });
    toast('Usual week saved');
  },
  'wc-save': () => {
    ui.wcDate = $('#wc-date').value || today();
    const msg = saveCounts(ui.wcDate, $('#wc-note').value.trim());
    if (msg) { ui.wcMsg = msg; render(); }
  },
  'wc-settings': () => {
    const base = Math.max(0, Math.round(Number($('#wc-base').value) || 0));
    const goal = Math.max(1000, Math.round(Number($('#wc-goal').value) || 90000));
    const off = [...document.querySelectorAll('.wc-off:checked')].map((x) => Number(x.value));
    saveWritingSettings(base, goal, off);
    toast('Counter settings saved. Monthly targets rescaled.');
  },
  'wc-add-chapter': (form) => {
    const input = form.querySelector('input');
    const name = input.value.trim();
    if (!name) return;
    addChapter(name);
    input.value = '';
  },
  'quick-add': () => {
    const title = $('#qa-title').value.trim();
    if (!title) return;
    const project = $('#qa-project').value || null;
    const planToday = $('#qa-today').checked;
    create('tasks', { title, project_id: project, planned_date: planToday ? today() : null });
    closePanel();
    toast(planToday ? 'Added to today' : project ? 'Task added' : 'Added to the Inbox');
  },
};

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  forms[form.dataset.form]?.(form);
});

// ---- Edits in panels and settings

const numberOrNull = (v) => (v === '' || v == null ? null : Number(v));

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'import-file' && el.files?.[0]) {
    try {
      ui.importPlan = planImport(JSON.parse(await el.files[0].text()));
      ui.importError = '';
    } catch (err) {
      ui.importPlan = null;
      ui.importError = err instanceof SyntaxError ? 'This file could not be read. Choose a .json file made by Planner.' : err.message;
    }
    render();
    return;
  }
  if (el.dataset.field) {
    const { field, kind, id } = el.dataset;
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (['estimate_minutes', 'progress_target', 'block_minutes'].includes(field)) value = numberOrNull(value);
    else if (field === 'start_time') value = value || null;
    if (kind === 'time_blocks' && field === 'day' && !value) return;
    else if (['planned_date', 'deadline', 'start_date', 'project_id', 'area_id', 'repeat_rule', 'parent_id'].includes(field)) value = value || null;
    else if (['title', 'name'].includes(field)) {
      value = value.trim();
      if (!value) { el.value = (kind === 'tasks' ? getTask(id)?.title : getProject(id)?.name) || ''; return; }
    }
    if (kind === 'projects' && field === 'status') setProjectStatus(id, value);
    else if (kind === 'tasks' && field === 'planned_date') { update(kind, id, { planned_date: value, start_time: null }); renderPanel(); }
    else update(kind, id, { [field]: value });
    if (['progress_type', 'emoji', 'ongoing'].includes(field)) renderPanel();
    return;
  }
  if (el.id === 'tl-subs') { ui.tlSubs = el.checked; render(); return; }
  if (el.id === 'th-work') { $('#th-start').disabled = !el.checked; $('#th-end').disabled = !el.checked; return; }
  if (el.dataset.subDone) { update('subtasks', el.dataset.subDone, { done: el.checked }); renderPanel(); return; }
  if (el.dataset.subTitle) {
    const v = el.value.trim();
    if (v) update('subtasks', el.dataset.subTitle, { title: v });
    else { remove('subtasks', el.dataset.subTitle); renderPanel(); }
    return;
  }
  if (el.dataset.areaName) {
    const v = el.value.trim();
    if (v) update('areas', el.dataset.areaName, { name: v });
  }
});

document.addEventListener('input', (e) => {
  if (e.target.classList?.contains('title-input')) autosize(e.target);
  if (e.target.dataset?.wcChapter) setDraft(e.target.dataset.wcChapter, e.target.value);
});

// Remember which subgoals are folded, and other open/closed sections.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.dataset?.collapse) {
    const p = getProject(d.dataset.collapse);
    if (p && p.collapsed === d.open) update('projects', p.id, { collapsed: !d.open });
  } else if (d.dataset?.remember) ui[d.dataset.remember] = d.open;
  else if (d.dataset?.rememberPlan) { ui.planOpen = { ...(ui.planOpen || {}), [d.dataset.rememberPlan]: d.open }; }
}, true);

// ---- Start

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

setupDrag((key) => openItem(key));
setupCalendarDrag((key) => openItem(key));
if (currentUser()) loadSnapshot();
render();
sync();

// Exposed for checks in the browser console.
window.planner = { state, byOrder };
