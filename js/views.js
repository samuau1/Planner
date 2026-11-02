// Each function returns the HTML for one part of the screen.
import {
  state, areas, topProjects, children, tasksIn, subtasksOf, getProject, getTask, projectPath, progress, byOrder, rootOf,
} from './store.js';
import { esc, today, niceDate, longDate, fmtMinutes, addDays, REPEAT_LABELS, ESTIMATES } from './util.js';
import { APP_NAME } from '../config.js';

const icon = {
  today: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/></svg>',
  inbox: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 11.5V15a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 17 15v-3.5M3 11.5 5 4h10l2 7.5M3 11.5h4l1 2h4l1-2h4"/></svg>',
  projects: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M3 8h14M7.5 8v8.5"/></svg>',
  settings: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M4 10h12M4 14h12"/><circle cx="7.5" cy="6" r="1.6"/><circle cx="12.5" cy="10" r="1.6"/><circle cx="8.5" cy="14" r="1.6"/></svg>',
  plus: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>',
  flag: '<svg viewBox="0 0 20 20" class="flag" aria-label="Priority"><path d="M5 17V3.5M5 4h9l-2 3.5 2 3.5H5"/></svg>',
  repeat: '<svg viewBox="0 0 20 20" aria-label="Repeats"><path d="M4 8a5 5 0 0 1 9-2.5L15 7M16 12a5 5 0 0 1-9 2.5L5 13M15 3.5V7h-3.5M5 16.5V13h3.5"/></svg>',
  close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg>',
};

const dueDate = (d) => niceDate(d).replace(/^(Today|Tomorrow|Yesterday)$/, (w) => w.toLowerCase());
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
    <a href="#/projects" class="nav-item"${active('projects')}>${icon.projects}<span>Projects</span></a>
    <div class="nav-projects">
      ${groups.map((g) => `<div class="nav-area">
        <div class="nav-area-name">${esc(g.name)}</div>
        ${g.projects.map((p) => `<a href="#/project/${p.id}" class="nav-project"${p.id === currentRoot ? ' aria-current="page"' : ''}>${esc(p.name)}</a>`).join('')}
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
    <a href="#/settings"${active('settings')}>${icon.settings}<span>Settings</span></a>
  </nav>`;
}

function groupByArea(projects) {
  const groups = areas().map((a) => ({ id: a.id, name: a.name, projects: projects.filter((p) => p.area_id === a.id) }));
  const loose = projects.filter((p) => !p.area_id || !state.areas.some((a) => a.id === p.area_id));
  if (loose.length) groups.push({ id: null, name: 'No area', projects: loose });
  return groups.filter((g) => g.projects.length);
}

// ---- Tasks

export function taskRow(t, { showProject = true, showPlanned = true } = {}) {
  const subs = subtasksOf(t.id);
  const meta = [];
  if (showProject && t.project_id) meta.push(`<span>${esc(projectPath(t.project_id))}</span>`);
  if (showPlanned && t.planned_date) meta.push(`<span class="${!t.done && t.planned_date < today() ? 'late' : ''}">${esc(niceDate(t.planned_date))}</span>`);
  if (t.deadline) {
    const cls = t.done ? '' : t.deadline < today() ? 'late' : t.deadline <= addDays(today(), 2) ? 'soon' : '';
    meta.push(`<span class="${cls}">Due ${esc(dueDate(t.deadline))}</span>`);
  }
  if (t.estimate_minutes) meta.push(`<span>${fmtMinutes(t.estimate_minutes)}</span>`);
  if (subs.length) meta.push(`<span>${subs.filter((s) => s.done).length}/${subs.length}</span>`);
  return `<li class="task${t.done ? ' done' : ''}">
    <button type="button" class="check" data-act="toggle-done" data-id="${t.id}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 10.5l3 3 6-7"/></svg></button>
    <button type="button" class="task-main" data-act="open-task" data-id="${t.id}">
      <span class="task-title">${t.priority ? icon.flag : ''}${esc(t.title)}${t.repeat_rule ? `<span class="repeat">${icon.repeat}</span>` : ''}</span>
      ${meta.length ? `<span class="task-meta">${meta.join('<span class="dot">·</span>')}</span>` : ''}
    </button>
  </li>`;
}

const taskList = (list, opts) => (list.length ? `<ul class="tasks">${list.map((t) => taskRow(t, opts)).join('')}</ul>` : '');

function addTaskForm(key, { project = '', planned = '', placeholder = 'Add a task' } = {}) {
  return `<form class="add-task" data-form="add-task" data-project="${project}" data-planned="${planned}">
    <span class="add-icon">${icon.plus}</span>
    <input type="text" id="add-${key}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off" enterkeyhint="done">
  </form>`;
}

// ---- Today

export function todayView(ui) {
  const t = today();
  const all = state.tasks;
  const earlier = all.filter((x) => !x.done && x.planned_date && x.planned_date < t).sort((a, b) => a.planned_date.localeCompare(b.planned_date) || byOrder(a, b));
  const planned = all.filter((x) => !x.done && x.planned_date === t).sort(byOrder);
  const doneToday = all.filter((x) => x.done && x.done_at && x.done_at.slice(0, 10) === t || (x.done && x.planned_date === t)).sort((a, b) => String(a.done_at).localeCompare(String(b.done_at)));
  const dueSoon = all.filter((x) => !x.done && x.deadline && x.deadline <= addDays(t, 3) && x.planned_date !== t && !(x.planned_date && x.planned_date < t)).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const mins = totalMinutes(planned);
  const uniqueDone = [...new Map(doneToday.map((x) => [x.id, x])).values()];
  return `<header class="page-head">
      <p class="eyebrow">${esc(longDate(t))}</p>
      <h1>Today</h1>
      <p class="muted">${planned.length ? `${planned.length} task${planned.length === 1 ? '' : 's'} planned${mins ? ` · ${fmtMinutes(mins)} estimated` : ''}` : 'Nothing planned yet.'}${uniqueDone.length ? ` · ${uniqueDone.length} done` : ''}</p>
    </header>
    ${earlier.length ? `<section class="block">
      <div class="block-head"><h2>From earlier</h2><button type="button" class="btn small" data-act="move-earlier">Move all to today</button></div>
      ${taskList(earlier)}
    </section>` : ''}
    <section class="block">
      ${taskList(planned, { showPlanned: false })}
      ${addTaskForm('today', { planned: t, placeholder: 'Add a task for today' })}
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

function progressBar(p) {
  const pr = progress(p);
  return `<span class="progress" title="${esc(pr.label)}"><span style="width:${Math.round(pr.ratio * 100)}%"></span></span>`;
}

function projectCard(p) {
  const pr = progress(p);
  const dates = [p.start_date && `From ${niceDate(p.start_date)}`, p.deadline && `Due ${dueDate(p.deadline)}`].filter(Boolean).join(' · ');
  return `<a class="project-card" href="#/project/${p.id}">
    <span class="project-name">${esc(p.name)}</span>
    ${p.description ? `<span class="project-desc">${esc(p.description)}</span>` : ''}
    ${progressBar(p)}
    <span class="project-meta">${esc(pr.label)}${dates ? ` · ${esc(dates)}` : ''}</span>
  </a>`;
}

export function projectsView() {
  const tops = topProjects();
  const active = groupByArea(tops.filter((p) => p.status === 'active'));
  const onHold = tops.filter((p) => p.status === 'on_hold');
  const done = tops.filter((p) => p.status === 'done');
  return `<header class="page-head">
      <h1>Projects</h1>
      <div class="head-actions"><button type="button" class="btn primary" data-act="new-project">New project</button></div>
    </header>
    ${active.length ? active.map((g) => `<section class="block">
      <div class="block-head"><h2>${esc(g.name)}</h2></div>
      <div class="project-grid">${g.projects.map(projectCard).join('')}</div>
    </section>`).join('') : `<section class="block"><p class="empty">No active projects yet. ${state.areas.length ? '' : 'Start by adding areas such as Research or Personal in Settings, then '}create your first project.</p></section>`}
    ${onHold.length ? `<details class="block"><summary><h2>On hold</h2><span class="muted">${onHold.length}</span></summary><div class="project-grid">${onHold.map(projectCard).join('')}</div></details>` : ''}
    ${done.length ? `<details class="block"><summary><h2>Done</h2><span class="muted">${done.length}</span></summary><div class="project-grid">${done.map(projectCard).join('')}</div></details>` : ''}`;
}

// ---- One project

const STATUS = { active: 'Active', on_hold: 'On hold', done: 'Done' };

function progressBlock(p) {
  const pr = progress(p);
  let control = '';
  if (p.progress_type === 'number') {
    control = `<form class="inline-form" data-form="progress" data-id="${p.id}">
      <label class="sr-only" for="pv-${p.id}">Current value</label>
      <input type="number" id="pv-${p.id}" value="${Number(p.progress_value) || 0}" step="any" inputmode="decimal">
      <button class="btn small" type="submit">Update</button>
    </form>`;
  } else if (p.progress_type === 'percent') {
    control = `<form class="inline-form" data-form="progress" data-id="${p.id}">
      <label class="sr-only" for="pv-${p.id}">Percent done</label>
      <input type="number" id="pv-${p.id}" value="${Number(p.progress_value) || 0}" min="0" max="100" step="1" inputmode="numeric"><span class="muted">%</span>
      <button class="btn small" type="submit">Update</button>
    </form>`;
  }
  return `<div class="progress-block">
    <div class="progress-line">${progressBar(p)}<span class="progress-label">${esc(pr.label)}</span></div>
    ${control}
  </div>`;
}

function doneToggle(pid, ui, count) {
  if (!count) return '';
  const open = ui.showDone?.[pid];
  return `<button type="button" class="link small" data-act="toggle-show-done" data-id="${pid}">${open ? 'Hide' : 'Show'} ${count} done</button>`;
}

function subgoalBlock(sg, ui) {
  const tasks = tasksIn(sg.id);
  const open = tasks.filter((t) => !t.done), done = tasks.filter((t) => t.done);
  const kids = children(sg.id);
  const pr = progress(sg);
  return `<details class="subgoal${sg.status === 'done' ? ' is-done' : ''}" data-collapse="${sg.id}"${sg.collapsed ? '' : ' open'}>
    <summary>
      <span class="subgoal-text"><span class="subgoal-name">${esc(sg.name)}</span>
      <span class="subgoal-meta">${sg.status !== 'active' ? `${STATUS[sg.status]} · ` : ''}${esc(pr.label)}${sg.deadline ? ` · Due ${esc(dueDate(sg.deadline))}` : ''}</span></span>
      <button type="button" class="btn small ghost" data-act="edit-project" data-id="${sg.id}">Edit</button>
    </summary>
    <div class="subgoal-body">
      ${sg.description ? `<p class="muted small">${esc(sg.description)}</p>` : ''}
      ${['number', 'percent'].includes(sg.progress_type) ? progressBlock(sg) : ''}
      ${taskList(open, { showProject: false })}
      ${ui.showDone?.[sg.id] ? taskList(done, { showProject: false }) : ''}
      ${addTaskForm(`sg-${sg.id}`, { project: sg.id })}
      ${doneToggle(sg.id, ui, done.length)}
      ${kids.map((k) => subgoalBlock(k, ui)).join('')}
      <button type="button" class="link small" data-act="new-subgoal" data-id="${sg.id}">Add a subgoal inside</button>
    </div>
  </details>`;
}

export function projectView(id, ui) {
  const p = getProject(id);
  if (!p) return `<header class="page-head"><h1>Project not found</h1><p><a href="#/projects">Back to projects</a></p></header>`;
  const crumbs = [];
  let parent = p.parent_id ? getProject(p.parent_id) : null;
  while (parent) { crumbs.unshift(`<a href="#/project/${parent.id}">${esc(parent.name)}</a>`); parent = parent.parent_id ? getProject(parent.parent_id) : null; }
  const area = state.areas.find((a) => a.id === rootOf(p)?.area_id);
  const tasks = tasksIn(p.id);
  const open = tasks.filter((t) => !t.done), done = tasks.filter((t) => t.done);
  const subs = children(p.id);
  const dates = [p.start_date && `Starts ${niceDate(p.start_date)}`, p.deadline && `Due ${dueDate(p.deadline)}`].filter(Boolean).join(' · ');
  return `<header class="page-head">
      <p class="eyebrow">${area ? esc(area.name) : 'Project'}${crumbs.length ? ` › ${crumbs.join(' › ')}` : ''}</p>
      <h1>${esc(p.name)}</h1>
      <p class="muted">${STATUS[p.status]}${dates ? ` · ${esc(dates)}` : ''}</p>
      <div class="head-actions"><button type="button" class="btn" data-act="edit-project" data-id="${p.id}">Edit project</button></div>
    </header>
    ${p.description ? `<p class="lead">${esc(p.description)}</p>` : ''}
    <section class="block">${progressBlock(p)}</section>
    <section class="block">
      <div class="block-head"><h2>Tasks</h2>${doneToggle(p.id, ui, done.length)}</div>
      ${taskList(open, { showProject: false })}
      ${ui.showDone?.[p.id] ? taskList(done, { showProject: false }) : ''}
      ${addTaskForm(`p-${p.id}`, { project: p.id })}
    </section>
    <section class="block">
      <div class="block-head"><h2>Subgoals</h2><button type="button" class="btn small" data-act="new-subgoal" data-id="${p.id}">Add subgoal</button></div>
      ${subs.length ? subs.map((s) => subgoalBlock(s, ui)).join('') : '<p class="empty">No subgoals. Break the project into parts, such as chapters.</p>'}
    </section>
    ${p.notes ? `<section class="block"><div class="block-head"><h2>Notes</h2></div><p class="notes">${esc(p.notes)}</p></section>` : ''}`;
}

// ---- Settings

export function settingsView(email, pending) {
  const list = areas();
  return `<header class="page-head"><h1>Settings</h1></header>
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
      <div class="chip-row">
        <button type="button" class="chip" data-act="plan" data-id="${t.id}" data-when="today">Today</button>
        <button type="button" class="chip" data-act="plan" data-id="${t.id}" data-when="tomorrow">Tomorrow</button>
        <button type="button" class="chip" data-act="plan" data-id="${t.id}" data-when="none">No day</button>
      </div>
      <div class="field-row">
        <label>Time estimate<select data-field="estimate_minutes" data-kind="tasks" data-id="${t.id}" id="task-estimate"><option value="">None</option>${estOptions.map((m) => `<option value="${m}"${m === est ? ' selected' : ''}>${fmtMinutes(m)}</option>`).join('')}</select></label>
        <label>Repeat<select data-field="repeat_rule" data-kind="tasks" data-id="${t.id}" id="task-repeat"><option value="">Doesn't repeat</option>${Object.entries(REPEAT_LABELS).map(([k, v]) => `<option value="${k}"${t.repeat_rule === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <label class="toggle"><input type="checkbox" data-field="priority" data-kind="tasks" data-id="${t.id}" id="task-priority"${t.priority ? ' checked' : ''}> Priority</label>
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
    : `<button type="button" class="btn ghost danger" data-act="project-delete" data-id="${p.id}">Delete ${isSub ? 'subgoal' : 'project'}</button>`}
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
