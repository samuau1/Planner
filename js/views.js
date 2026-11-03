// Each function returns the HTML for one part of the screen.
import {
  state, areas, topProjects, children, subtasksOf, getProject, getTask, projectPath, byOrder, rootOf, wcTotal,
  workHours, usualWeek, isCustomDay, doneOn,
} from './store.js';
import { esc, today, niceDate, longDate, fmtMinutes, addDays, parseISO, iso, REPEAT_LABELS, ESTIMATES } from './util.js';
import { APP_NAME } from '../config.js';
import { colorOf, emojiOf, badge, EMOJIS, PALETTE, COLOR_NAMES } from './look.js';
import { dayCore, dayItems, TIME_OPTIONS, LENGTH_OPTIONS } from './plan.js';

const icon = {
  today: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/></svg>',
  inbox: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 11.5V15a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 17 15v-3.5M3 11.5 5 4h10l2 7.5M3 11.5h4l1 2h4l1-2h4"/></svg>',
  projects: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M3 8h14M7.5 8v8.5"/></svg>',
  settings: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M4 10h12M4 14h12"/><circle cx="7.5" cy="6" r="1.6"/><circle cx="12.5" cy="10" r="1.6"/><circle cx="8.5" cy="14" r="1.6"/></svg>',
  calendar: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M3 8.5h14M7 3v3M13 3v3"/></svg>',
  timeline: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h8M6 10h10M4 15h7"/></svg>',
  pen: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 16l1-4 8.5-8.5a2.1 2.1 0 0 1 3 3L8 15l-4 1zM12 5l3 3"/></svg>',
  plus: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>',
  flag: '<svg viewBox="0 0 20 20" class="flag" aria-label="Priority"><path d="M5 17V3.5M5 4h9l-2 3.5 2 3.5H5"/></svg>',
  repeat: '<svg viewBox="0 0 20 20" aria-label="Repeats"><path d="M4 8a5 5 0 0 1 9-2.5L15 7M16 12a5 5 0 0 1-9 2.5L5 13M15 3.5V7h-3.5M5 16.5V13h3.5"/></svg>',
  close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg>',
};

const dueDate = (d) => niceDate(d).replace(/^(Today|Tomorrow|Yesterday)$/, (w) => w.toLowerCase());
const STATUS = { active: 'Active', on_hold: 'On hold', done: 'Done' };
const openTasks = (list) => list.filter((t) => !t.done);
const totalMinutes = (list) => list.reduce((a, t) => a + (t.estimate_minutes || 0), 0);

// ---- Login

export function loginView(error = '') {
  return `<main class="login">
    <form class="login-card" data-form="login">
      <h1>${esc(APP_NAME)}</h1>
      <p class="muted">Sign in to your planner.</p>
      <label>Email<input type="email" id="login-email" autocomplete="username" required></label>
      <label>Password<input type="password" id="login-password" autocomplete="current-password" required></label>
      <button class="btn primary" type="submit">Sign in</button>
      <p class="form-error" role="alert">${esc(error)}</p>
    </form>
  </main>`;
}

// ---- Navigation

export function sidebar(route) {
  const active = (r) => (route.name === r ? ' aria-current="page"' : '');
  const inboxCount = openTasks(state.tasks.filter((t) => !t.project_id)).length;
  const todayCount = openTasks(state.tasks.filter((t) => t.planned_date && t.planned_date <= today())).length;
  const groups = groupByArea(topProjects().filter((p) => p.status === 'active'));
  const currentRoot = route.name === 'project' ? rootOf(getProject(route.id))?.id : null;
  return `<nav class="sidebar" aria-label="Main">
    <div class="brand">${esc(APP_NAME)}</div>
    <a href="#/today" class="nav-item"${active('today')}>${icon.today}<span>Today</span>${todayCount ? `<span class="count">${todayCount}</span>` : ''}</a>
    <a href="#/inbox" class="nav-item"${active('inbox')}>${icon.inbox}<span>Inbox</span>${inboxCount ? `<span class="count">${inboxCount}</span>` : ''}</a>
    <a href="#/calendar" class="nav-item"${active('calendar') || active('day')}>${icon.calendar}<span>Calendar</span></a>
    <a href="#/timeline" class="nav-item"${active('timeline')}>${icon.timeline}<span>Timeline</span></a>
    <a href="#/projects" class="nav-item"${active('projects')}>${icon.projects}<span>Projects</span></a>
    <a href="#/writing" class="nav-item"${active('writing')}>${icon.pen}<span>Word counter</span>${state.wc.chapters.length ? `<span class="count">${wcTotal().toLocaleString('en-US')}</span>` : ''}</a>
    <div class="nav-projects">
      ${groups.map((g) => `<div class="nav-area">
        <div class="nav-area-name">${esc(g.name)}</div>
        ${g.projects.map((p) => `<a href="#/project/${p.id}" class="nav-project"${p.id === currentRoot ? ' aria-current="page"' : ''}>${badge(p, 'tiny')}<span>${esc(p.name)}</span></a>`).join('')}
      </div>`).join('') || '<p class="muted small nav-empty">Active projects appear here.</p>'}
    </div>
    <a href="#/settings" class="nav-item nav-bottom"${active('settings')}>${icon.settings}<span>Settings</span></a>
  </nav>`;
}

export function tabbar(route) {
  const active = (r) => (route.name === r ? ' aria-current="page"' : '');
  return `<nav class="tabbar" aria-label="Main">
    <a href="#/today"${active('today')}>${icon.today}<span>Today</span></a>
    <a href="#/inbox"${active('inbox')}>${icon.inbox}<span>Inbox</span></a>
    <button type="button" class="tab-add" data-act="quick-add" aria-label="Add a task">${icon.plus}</button>
    <a href="#/projects"${active('projects') || active('project')}>${icon.projects}<span>Projects</span></a>
    <a href="#/writing"${active('writing')}>${icon.pen}<span>Writing</span></a>
  </nav>`;
}

export function groupByArea(projects) {
  const groups = areas().map((a) => ({ id: a.id, name: a.name, projects: projects.filter((p) => p.area_id === a.id) }));
  const loose = projects.filter((p) => !p.area_id || !state.areas.some((a) => a.id === p.area_id));
  if (loose.length) groups.push({ id: null, name: 'No area', projects: loose });
  return groups.filter((g) => g.projects.length);
}

// ---- Tasks

export function taskRow(t, { showProject = true, showPlanned = true } = {}) {
  const subs = subtasksOf(t.id);
  const isDone = doneOn(t, today());
  const meta = [];
  if (showProject && t.project_id) {
    const root = rootOf(getProject(t.project_id));
    meta.push(`<span class="task-project tint-${colorOf(root)}">${emojiOf(root) ? `${esc(emojiOf(root))} ` : ''}${esc(projectPath(t.project_id))}</span>`);
  }
  if (showPlanned && t.planned_date) meta.push(`<span class="${!t.done && t.planned_date < today() ? 'late' : ''}">${esc(niceDate(t.planned_date))}</span>`);
  if (t.deadline) {
    const cls = t.done ? '' : t.deadline < today() ? 'late' : t.deadline <= addDays(today(), 2) ? 'soon' : '';
    meta.push(`<span class="${cls}">Due ${esc(dueDate(t.deadline))}</span>`);
  }
  if (t.estimate_minutes) meta.push(`<span>${fmtMinutes(t.estimate_minutes)}</span>`);
  if (subs.length) meta.push(`<span>${subs.filter((s) => s.done).length}/${subs.length}</span>`);
  if (t.ongoing && !t.done) meta.unshift('<span class="ongoing-tag">↻ ongoing</span>');
  return `<li class="task${isDone ? ' done' : ''}">
    <button type="button" class="check" data-act="toggle-done" data-id="${t.id}" aria-label="${isDone ? 'Mark not done' : t.ongoing ? 'Done for today' : 'Mark done'}: ${esc(t.title)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 10.5l3 3 6-7"/></svg></button>
    <button type="button" class="task-main" data-act="open-task" data-id="${t.id}">
      <span class="task-title">${t.priority ? icon.flag : ''}${esc(t.title)}${t.repeat_rule ? `<span class="repeat">${icon.repeat}</span>` : ''}</span>
      ${meta.length ? `<span class="task-meta">${meta.join('<span class="dot">·</span>')}</span>` : ''}
    </button>
  </li>`;
}

export const taskList = (list, opts) => (list.length ? `<ul class="tasks">${list.map((t) => taskRow(t, opts)).join('')}</ul>` : '');

export function addTaskForm(key, { project = '', planned = '', placeholder = 'Add a task' } = {}) {
  return `<form class="add-task" data-form="add-task" data-project="${project}" data-planned="${planned}">
    <span class="add-icon">${icon.plus}</span>
    <input type="text" id="add-${key}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off" enterkeyhint="done">
  </form>`;
}

// ---- Today

export function todayView(ui) {
  const t = today();
  const all = state.tasks;
  const earlier = all.filter((x) => !x.done && x.planned_date && x.planned_date < t).sort((a, b) => (b.ongoing - a.ongoing) || a.planned_date.localeCompare(b.planned_date) || byOrder(a, b));
  const planned = all.filter((x) => !doneOn(x, t) && x.planned_date === t).sort(byOrder);
  const doneToday = all.filter((x) => (x.done && x.done_at && x.done_at.slice(0, 10) === t) || (x.planned_date === t && doneOn(x, t))).sort((a, b) => String(a.done_at).localeCompare(String(b.done_at)));
  const dueSoon = all.filter((x) => !x.done && x.deadline && x.deadline <= addDays(t, 3) && x.planned_date !== t && !(x.planned_date && x.planned_date < t)).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const mins = totalMinutes(planned);
  const uniqueDone = [...new Map(doneToday.map((x) => [x.id, x])).values()];
  return `<header class="page-head">
      <p class="eyebrow">${esc(longDate(t))}</p>
      <h1>Today</h1>
      <p class="muted">${(() => { const its = dayItems(t); const open = its.filter((i) => !i.done).length, done = its.length - open; return its.length ? `${open} to do${done ? ` · ${done} done` : ''}` : 'Nothing planned yet.'; })()}</p>
    </header>
    ${state.settings.lastPlanned !== t && ui.hidePlanBanner !== t ? `<section class="plan-banner">
      <div><strong>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}.</strong> Take a few minutes to plan your day.</div>
      <div class="chip-row"><a class="btn primary" href="#/plan">Plan my day</a><button type="button" class="btn ghost" data-act="hide-plan-banner">Not today</button></div>
    </section>` : ''}
    ${earlier.length ? `<section class="block">
      <div class="block-head"><h2>From earlier</h2><button type="button" class="btn small" data-act="move-earlier">Move all to today</button></div>
      <p class="muted small">Unfinished tasks and ongoing work from past days.</p>
      ${taskList(earlier)}
    </section>` : ''}
    <section class="block">
      <div class="block-head"><h2>Your day</h2><span class="head-links"><a class="link small" href="#/calendar">Calendar</a><a class="link small" href="#/plan">Plan or change the day</a></span></div>
      ${dayCore(t)}
    </section>
    ${dueSoon.length ? `<section class="block">
      <div class="block-head"><h2>Due soon</h2></div>
      ${taskList(dueSoon)}
    </section>` : ''}
    ${uniqueDone.length ? `<details class="block done-block"${ui.showDoneToday ? ' open' : ''} data-remember="showDoneToday">
      <summary><h2>Done today</h2><span class="muted">${uniqueDone.length}</span></summary>
      ${taskList(uniqueDone, { showPlanned: false })}
    </details>` : ''}`;
}

// ---- Inbox

export function inboxView() {
  const list = openTasks(state.tasks.filter((t) => !t.project_id)).sort(byOrder);
  return `<header class="page-head">
      <h1>Inbox</h1>
      <p class="muted">Tasks without a project. Open one to give it a project or a day.</p>
    </header>
    <section class="block">
      ${addTaskForm('inbox', { placeholder: 'Capture a task' })}
      ${list.length ? taskList(list, { showProject: false }) : '<p class="empty">Your inbox is empty.</p>'}
    </section>`;
}

// ---- Projects overview

// ---- Settings

function importSummary(pl) {
  const n = (x, one, many) => `<strong>${x} ${x === 1 ? one : many}</strong>`;
  const parts = [];
  if (pl.areas.length) parts.push(n(pl.areas.length, 'area', 'areas'));
  if (pl.projects.length) parts.push(n(pl.projects.length, 'project or subgoal', 'projects and subgoals'));
  if (pl.tasks.length) parts.push(`${n(pl.tasks.length, 'task', 'tasks')} (${pl.openTasks} open, ${pl.tasks.length - pl.openTasks} finished)`);
  if (pl.wcChapters.length || pl.wcEntries.length) parts.push(`your word counter with ${n(pl.wcChapters.length, 'chapter', 'chapters')} and ${n(pl.wcEntries.length, 'day', 'days')} of writing`);
  if (pl.looks.length) parts.push(`emojis and colours for ${n(pl.looks.length, 'project', 'projects')}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `This file adds ${list}.${pl.skipped ? ` ${pl.skipped} items you already have are skipped.` : ''}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const timeOpts = (sel) => TIME_OPTIONS.concat(['23:00']).map((v) => `<option${v === sel ? ' selected' : ''}>${v}</option>`).join('');

function workingHoursHTML(ui) {
  const week = usualWeek();
  const month = ui.wdMonth || today().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="wd-cell empty"></span>');
  for (let d = 1; d <= days; d++) {
    const day = iso(new Date(y, m - 1, d)), h = workHours(day);
    cells.push(`<button type="button" class="wd-cell${h ? ' on' : ' off'}${isCustomDay(day) ? ' custom' : ''}${day === today() ? ' is-today' : ''}${ui.wdSel === day ? ' sel' : ''}" data-act="wd-select" data-id="${day}">
      <span class="wd-num">${d}</span><span class="wd-h">${h ? `${h.start.replace(':00', '')}–${h.end.replace(':00', '')}` : 'off'}</span></button>`);
  }
  const sel = ui.wdSel && ui.wdSel.startsWith(month) ? ui.wdSel : null;
  const sh = sel ? workHours(sel) : null;
  const prev = iso(new Date(y, m - 2, 1)).slice(0, 7), next = iso(new Date(y, m, 1)).slice(0, 7);
  return `<section class="block">
      <div class="block-head"><h2>Working hours</h2></div>
      <p class="muted small">Your usual week. The day planner shades these hours and checks how full they are. You can still plan personal tasks outside them.</p>
      <form class="week-form" data-form="usual-week">
        ${[1, 2, 3, 4, 5, 6, 0].map((d) => `<div class="week-row">
          <label class="toggle"><input type="checkbox" class="wk-on" data-day="${d}"${week[d] ? ' checked' : ''}> ${DAY_NAMES[d]}</label>
          <select class="wk-start" data-day="${d}" aria-label="${DAY_NAMES[d]} from">${timeOpts(week[d]?.start || '08:00')}</select>
          <span class="muted">to</span>
          <select class="wk-end" data-day="${d}" aria-label="${DAY_NAMES[d]} to">${timeOpts(week[d]?.end || '16:00')}</select>
        </div>`).join('')}
        <button class="btn" type="submit">Save usual week</button>
      </form>
      <div class="wd-month">
        <div class="block-head"><button type="button" class="btn small ghost" data-act="wd-month" data-id="${prev}" aria-label="Previous month">‹</button>
          <h3>${first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
          <button type="button" class="btn small ghost" data-act="wd-month" data-id="${next}" aria-label="Next month">›</button></div>
        <p class="muted small">Tap a day to change it, for example a morning-only day or a day off. Changed days are marked with a dot.</p>
        <div class="wd-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => `<span class="wd-dow">${n}</span>`).join('')}${cells.join('')}</div>
        ${sel ? `<form class="hours-form" data-form="day-hours" data-day="${sel}">
          <strong>${esc(longDate(sel))}</strong>
          <label class="toggle"><input type="checkbox" id="dh-work"${sh ? ' checked' : ''}> Working</label>
          <label>From<select id="dh-start">${timeOpts(sh?.start || '08:00')}</select></label>
          <label>To<select id="dh-end">${timeOpts(sh?.end || '16:00')}</select></label>
          <button class="btn small primary" type="submit">Save day</button>
          ${isCustomDay(sel) ? `<button type="button" class="btn small ghost" data-act="wd-reset" data-id="${sel}">Use usual hours</button>` : ''}
        </form>` : ''}
      </div>
    </section>`;
}

export function settingsView(email, pending, importPlan, importError, ui = {}) {
  const list = areas();
  return `<header class="page-head"><h1>Settings</h1></header>
    ${state.needsUpdate ? `<section class="notice"><strong>Database update needed.</strong> Run the newest scripts from the <code>supabase</code> folder (<code>002_colours_progress_writing.sql</code> and <code>003_settings.sql</code>) in Supabase's SQL Editor, then reload. Until then, some changes can't be saved.</section>` : ''}
    ${workingHoursHTML(ui)}
    <section class="block">
      <div class="block-head"><h2>Areas</h2></div>
      <p class="muted small">Areas group your projects, such as Research, Teaching or Personal.</p>
      <ul class="area-list">
        ${list.map((a, i) => `<li>
          <input type="text" value="${esc(a.name)}" data-area-name="${a.id}" aria-label="Area name" id="area-${a.id}">
          <button type="button" class="btn small ghost" data-act="area-up" data-id="${a.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button type="button" class="btn small ghost" data-act="area-down" data-id="${a.id}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          <button type="button" class="btn small ghost danger" data-act="area-delete" data-id="${a.id}">Delete</button>
        </li>`).join('')}
      </ul>
      <form class="add-task" data-form="add-area">
        <span class="add-icon">${icon.plus}</span>
        <input type="text" id="add-area" placeholder="Add an area" aria-label="Add an area" autocomplete="off">
      </form>
    </section>
    <section class="block">
      <div class="block-head"><h2>Your data</h2></div>
      <p class="muted small">Download everything as a JSON file, as a backup or to take elsewhere.</p>
      <button type="button" class="btn" data-act="export">Download my data</button>
      ${pending ? `<p class="muted small">${pending} change${pending === 1 ? '' : 's'} waiting to be saved. They're sent as soon as there's a connection.</p>` : '<p class="muted small">All changes are saved.</p>'}
    </section>
    <section class="block">
      <div class="block-head"><h2>Import</h2></div>
      <p class="muted small">Add the contents of a Planner backup or import file. Items you already have are skipped, so importing the same file twice is safe.</p>
      ${importPlan && !importPlan.projects.length && !importPlan.tasks.length && !importPlan.areas.length && !importPlan.wcChapters.length && !importPlan.wcEntries.length && !importPlan.wcSettings && !importPlan.looks.length ? `<div class="import-summary">
          <p>Everything in this file is already here, so there's nothing new to import.</p>
          <div class="chip-row"><button type="button" class="btn" data-act="import-cancel">OK</button></div>
        </div>` : importPlan ? `<div class="import-summary">
          <p>${importSummary(importPlan)}</p>
          <div class="chip-row"><button type="button" class="btn primary" data-act="import-run">Import</button><button type="button" class="btn ghost" data-act="import-cancel">Cancel</button></div>
        </div>`
    : `<label class="file-pick"><span class="btn">Choose a file…</span><input type="file" accept=".json,application/json" id="import-file" class="sr-only"></label>`}
      ${importError ? `<p class="form-error">${esc(importError)}</p>` : ''}
    </section>
    <section class="block">
      <div class="block-head"><h2>Account</h2></div>
      <p class="muted small">Signed in as ${esc(email || '')}</p>
      <button type="button" class="btn" data-act="sign-out">Sign out</button>
    </section>`;
}

// ---- Side panels

function projectOptions(selected, excludeId) {
  const exclude = new Set();
  if (excludeId) { exclude.add(excludeId); }
  const rows = [];
  const walk = (list, depth) => list.forEach((p) => {
    if (exclude.has(p.id) || p.status === 'done' && p.id !== selected) return;
    rows.push(`<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${' '.repeat(depth)}${esc(p.name)}</option>`);
    walk(children(p.id), depth + 1);
  });
  walk(topProjects(), 0);
  return rows.join('');
}

export function taskPanel(id) {
  const t = getTask(id);
  if (!t) return '';
  const subs = subtasksOf(id);
  const est = t.estimate_minutes;
  const estOptions = [...new Set([...ESTIMATES, ...(est ? [est] : [])])].sort((a, b) => a - b);
  return `<div class="panel-head">
      <button type="button" class="check big${t.done ? ' on' : ''}" data-act="toggle-done" data-id="${t.id}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 10.5l3 3 6-7"/></svg></button>
      <textarea class="title-input" rows="1" data-field="title" data-kind="tasks" data-id="${t.id}" id="task-title" aria-label="Task title">${esc(t.title)}</textarea>
      <button type="button" class="icon-btn" data-act="close-panel" aria-label="Close">${icon.close}</button>
    </div>
    <div class="fields">
      <label>Project<select data-field="project_id" data-kind="tasks" data-id="${t.id}" id="task-project"><option value="">Inbox (no project)</option>${projectOptions(t.project_id)}</select></label>
      <div class="field-row">
        <label>Planned day<input type="date" value="${t.planned_date || ''}" data-field="planned_date" data-kind="tasks" data-id="${t.id}" id="task-planned"></label>
        <label>Deadline<input type="date" value="${t.deadline || ''}" data-field="deadline" data-kind="tasks" data-id="${t.id}" id="task-deadline"></label>
      </div>
      ${t.planned_date ? `<div class="field-row">
        <label>Time<select data-field="start_time" data-kind="tasks" data-id="${t.id}" id="task-time"><option value="">No time yet</option>${TIME_OPTIONS.map((v) => `<option value="${v}"${String(t.start_time || '').slice(0, 5) === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Length on the day<select data-field="block_minutes" data-kind="tasks" data-id="${t.id}" id="task-length"><option value="">Same as estimate</option>${LENGTH_OPTIONS.map((m) => `<option value="${m}"${t.block_minutes === m ? ' selected' : ''}>${fmtMinutes(m)}</option>`).join('')}</select></label>
      </div>` : ''}
      <div class="chip-row">
        <button type="button" class="chip" data-act="plan" data-id="${t.id}" data-when="today">Today</button>
        <button type="button" class="chip" data-act="plan" data-id="${t.id}" data-when="tomorrow">Tomorrow</button>
        <button type="button" class="chip" data-act="plan" data-id="${t.id}" data-when="none">No day</button>
      </div>
      <div class="field-row">
        <label>Time estimate<select data-field="estimate_minutes" data-kind="tasks" data-id="${t.id}" id="task-estimate"><option value="">None</option>${estOptions.map((m) => `<option value="${m}"${m === est ? ' selected' : ''}>${fmtMinutes(m)}</option>`).join('')}</select></label>
        <label>Repeat<select data-field="repeat_rule" data-kind="tasks" data-id="${t.id}" id="task-repeat"><option value="">Doesn't repeat</option>${Object.entries(REPEAT_LABELS).map(([k, v]) => `<option value="${k}"${t.repeat_rule === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <div class="toggle-row">
        <label class="toggle"><input type="checkbox" data-field="priority" data-kind="tasks" data-id="${t.id}" id="task-priority"${t.priority ? ' checked' : ''}> Priority</label>
        <label class="toggle" title="Ticking an ongoing task means done for today. It stays open for the next day."><input type="checkbox" data-field="ongoing" data-kind="tasks" data-id="${t.id}" id="task-ongoing"${t.ongoing ? ' checked' : ''}> Ongoing work</label>
      </div>
      ${t.ongoing ? `<p class="muted small">Ticking it means done for today; it stays open and comes back when you plan the next day.${state.task_sessions.filter((x) => x.task_id === t.id).length ? ` Worked on ${state.task_sessions.filter((x) => x.task_id === t.id).length} day${state.task_sessions.filter((x) => x.task_id === t.id).length === 1 ? '' : 's'} so far.` : ''}</p>` : ''}
      <div class="subtasks">
        <div class="field-label">Subtasks</div>
        <ul>${subs.map((s) => `<li class="${s.done ? 'done' : ''}">
          <input type="checkbox" data-sub-done="${s.id}" id="sub-${s.id}"${s.done ? ' checked' : ''} aria-label="Done">
          <input type="text" value="${esc(s.title)}" data-sub-title="${s.id}" aria-label="Subtask">
          <button type="button" class="icon-btn small" data-act="sub-delete" data-id="${s.id}" aria-label="Delete subtask">${icon.close}</button>
        </li>`).join('')}</ul>
        <form class="add-task small" data-form="add-subtask" data-task="${t.id}"><span class="add-icon">${icon.plus}</span><input type="text" id="add-subtask" placeholder="Add a step" aria-label="Add a subtask" autocomplete="off"></form>
      </div>
      <label>Notes<textarea rows="5" data-field="notes" data-kind="tasks" data-id="${t.id}" id="task-notes">${esc(t.notes)}</textarea></label>
    </div>
    <div class="panel-foot">
      ${t.ongoing && !t.done ? `<button type="button" class="btn" data-act="finish-task" data-id="${t.id}">Finished for good</button>` : ''}
      <button type="button" class="btn ghost danger" data-act="task-delete" data-id="${t.id}">Delete task</button>
    </div>`;
}

export function projectPanel(id, confirmDelete) {
  const p = getProject(id);
  if (!p) return '';
  const isSub = !!p.parent_id;
  return `<div class="panel-head">
      <h2 class="panel-title">${isSub ? 'Subgoal' : 'Project'}</h2>
      <button type="button" class="icon-btn" data-act="close-panel" aria-label="Close">${icon.close}</button>
    </div>
    <div class="fields">
      <label>Name<input type="text" value="${esc(p.name)}" data-field="name" data-kind="projects" data-id="${p.id}" id="proj-name"></label>
      <div class="look-pick">
        <div class="field-label">Emoji and colour</div>
        <div class="look-row">
          ${badge(p, 'big')}
          <input type="text" class="emoji-input" value="${esc(p.emoji || '')}" maxlength="8" data-field="emoji" data-kind="projects" data-id="${p.id}" id="proj-emoji" aria-label="Emoji" placeholder="🙂">
          <div class="swatches" role="group" aria-label="Colour">${PALETTE.map((c) => `<button type="button" class="swatch tint-${c}${colorOf(p) === c ? ' on' : ''}" data-act="pick-color" data-id="${p.id}" data-color="${c}" aria-label="${COLOR_NAMES[c]}" title="${COLOR_NAMES[c]}"></button>`).join('')}</div>
        </div>
        <div class="emoji-grid">${EMOJIS.map((e) => `<button type="button" data-act="pick-emoji" data-id="${p.id}" data-emoji="${e}" aria-label="${e}">${e}</button>`).join('')}<button type="button" class="clear" data-act="pick-emoji" data-id="${p.id}" data-emoji="" aria-label="No emoji">✕</button></div>
      </div>
      ${isSub
    ? `<label>Inside<select data-field="parent_id" data-kind="projects" data-id="${p.id}" id="proj-parent">${projectOptions(p.parent_id, p.id)}</select></label>`
    : `<label>Area<select data-field="area_id" data-kind="projects" data-id="${p.id}" id="proj-area"><option value="">No area</option>${areas().map((a) => `<option value="${a.id}"${a.id === p.area_id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>`}
      <label>Status<select data-field="status" data-kind="projects" data-id="${p.id}" id="proj-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${p.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="field-row">
        <label>Start date<input type="date" value="${p.start_date || ''}" data-field="start_date" data-kind="projects" data-id="${p.id}" id="proj-start"></label>
        <label>Deadline<input type="date" value="${p.deadline || ''}" data-field="deadline" data-kind="projects" data-id="${p.id}" id="proj-deadline"></label>
      </div>
      <label>Description<input type="text" value="${esc(p.description)}" data-field="description" data-kind="projects" data-id="${p.id}" id="proj-desc" placeholder="One line on what this is"></label>
      <label>Measure progress by<select data-field="progress_type" data-kind="projects" data-id="${p.id}" id="proj-ptype">
        <option value="tasks"${p.progress_type === 'tasks' ? ' selected' : ''}>Tasks done</option>
        <option value="subgoals"${p.progress_type === 'subgoals' ? ' selected' : ''}>Subgoals completed</option>
        <option value="number"${p.progress_type === 'number' ? ' selected' : ''}>A number reached</option>
        <option value="percent"${p.progress_type === 'percent' ? ' selected' : ''}>A percentage</option>
        <option value="words"${p.progress_type === 'words' ? ' selected' : ''}>The word counter</option>
      </select></label>
      ${p.progress_type === 'number' ? `<div class="field-row">
        <label>Target<input type="number" value="${p.progress_target ?? ''}" step="any" data-field="progress_target" data-kind="projects" data-id="${p.id}" id="proj-target"></label>
        <label>Unit<input type="text" value="${esc(p.progress_unit)}" placeholder="words, pages…" data-field="progress_unit" data-kind="projects" data-id="${p.id}" id="proj-unit"></label>
      </div>` : ''}
      <label>Notes<textarea rows="6" data-field="notes" data-kind="projects" data-id="${p.id}" id="proj-notes">${esc(p.notes)}</textarea></label>
    </div>
    <div class="panel-foot">
      ${confirmDelete
    ? `<p class="small">Delete “${esc(p.name)}” with all its subgoals and tasks?</p>
         <button type="button" class="btn danger" data-act="project-delete-confirm" data-id="${p.id}">Delete for good</button>
         <button type="button" class="btn ghost" data-act="project-delete-cancel">Keep it</button>`
    : `${isSub ? `<button type="button" class="btn ghost" data-act="new-subgoal" data-id="${p.id}">Add a subgoal inside</button>` : ''}
         <button type="button" class="btn ghost danger" data-act="project-delete" data-id="${p.id}">Delete ${isSub ? 'subgoal' : 'project'}</button>`}
    </div>`;
}

export function quickAddPanel() {
  return `<div class="panel-head">
      <h2 class="panel-title">New task</h2>
      <button type="button" class="icon-btn" data-act="close-panel" aria-label="Close">${icon.close}</button>
    </div>
    <form class="fields" data-form="quick-add">
      <label>Task<input type="text" id="qa-title" required autocomplete="off" enterkeyhint="done"></label>
      <label>Project<select id="qa-project"><option value="">Inbox (no project)</option>${projectOptions('')}</select></label>
      <label class="toggle"><input type="checkbox" id="qa-today"> Plan for today</label>
      <button class="btn primary" type="submit">Add task</button>
    </form>`;
}
