// The Projects overview and each project's own page (Overview, Tasks, Roadmap).
import { state, areas, topProjects, children, descendants, tasksIn, getProject, progress, rootOf, byOrder } from './store.js';
import { esc, niceDate, shortDate } from './util.js';
import { colorOf, emojiOf, badge, timeLeft } from './look.js';
import { progressChart, roadmapTimeline, progressSeries } from './charts.js';
import { taskList, addTaskForm, groupByArea } from './views.js';

const STATUS = { active: 'Active', on_hold: 'On hold', done: 'Done' };
const MEASURE = { tasks: 'Tasks done', subgoals: 'Subgoals completed', number: 'A number reached', percent: 'A percentage', words: 'Word counter' };

function bar(p) {
  const pr = progress(p);
  return `<span class="progress tint-${colorOf(p)}" title="${esc(pr.label)}"><span style="width:${Math.round(pr.ratio * 100)}%"></span></span>`;
}

// ---- Projects overview

function projectCard(p) {
  const pr = progress(p);
  const dates = [p.deadline && `Due ${shortDate(p.deadline)}`, p.deadline && p.status === 'active' && timeLeft(p.deadline)].filter(Boolean).join(' · ');
  const open = [p.id, ...descendants(p.id)].reduce((a, id) => a + state.tasks.filter((t) => t.project_id === id && !t.done).length, 0);
  return `<a class="project-card tint-${colorOf(p)}" href="#/project/${p.id}">
    <span class="card-top">${badge(p)}<span class="project-name">${esc(p.name)}</span></span>
    ${p.description ? `<span class="project-desc">${esc(p.description)}</span>` : ''}
    ${bar(p)}
    <span class="project-meta"><span>${esc(pr.label)}</span>${open ? `<span>${open} open task${open === 1 ? '' : 's'}</span>` : ''}${dates ? `<span>${esc(dates)}</span>` : ''}</span>
  </a>`;
}

export function projectsView() {
  const tops = topProjects();
  const active = groupByArea(tops.filter((p) => p.status === 'active'));
  const onHold = tops.filter((p) => p.status === 'on_hold');
  const done = tops.filter((p) => p.status === 'done');
  return `<header class="page-head">
      <h1>Projects</h1>
      <div class="head-actions"><a class="btn ghost only-phone" href="#/settings">Settings</a><button type="button" class="btn primary" data-act="new-project">New project</button></div>
    </header>
    ${active.length ? active.map((g) => `<section class="block">
      <div class="block-head"><h2>${esc(g.name)}</h2></div>
      <div class="project-grid">${g.projects.map(projectCard).join('')}</div>
    </section>`).join('') : `<section class="block"><p class="empty">No active projects yet. ${state.areas.length ? '' : 'Start by adding areas such as Research or Personal in Settings, then '}create your first project.</p></section>`}
    ${onHold.length ? `<details class="block"><summary><h2>On hold</h2><span class="muted">${onHold.length}</span></summary><div class="project-grid">${onHold.map(projectCard).join('')}</div></details>` : ''}
    ${done.length ? `<details class="block"><summary><h2>Done</h2><span class="muted">${done.length}</span></summary><div class="project-grid">${done.map(projectCard).join('')}</div></details>` : ''}`;
}

// ---- One project

function header(p, tab) {
  const crumbs = [];
  let parent = p.parent_id ? getProject(p.parent_id) : null;
  while (parent) { crumbs.unshift(`<a href="#/project/${parent.id}">${esc(emojiOf(parent) ? `${emojiOf(parent)} ` : '')}${esc(parent.name)}</a>`); parent = parent.parent_id ? getProject(parent.parent_id) : null; }
  const area = state.areas.find((a) => a.id === rootOf(p)?.area_id);
  const tabs = [['overview', 'Overview'], ['tasks', 'Tasks'], ['roadmap', 'Roadmap']];
  return `<header class="proj-head">
    <p class="crumbs"><a href="#/projects">${area ? esc(area.name) : 'Projects'}</a>${crumbs.map((c) => ` <span>/</span> ${c}`).join('')}</p>
    <div class="proj-title">${badge(p, 'big')}<div><h1>${esc(p.name)}</h1>${p.description ? `<p class="muted">${esc(p.description)}</p>` : ''}</div>
      <button type="button" class="btn ghost edit-btn" data-act="edit-project" data-id="${p.id}">Edit</button></div>
    <nav class="tabs tint-${colorOf(p)}" aria-label="Project sections">
      ${tabs.map(([k, label]) => `<a href="#/project/${p.id}/${k}"${tab === k ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      ${p.progress_type === 'words' ? '<a href="#/writing">Word counter ↗</a>' : ''}
    </nav>
  </header>`;
}

function detailsCard(p) {
  const row = (label, value) => `<div class="detail"><span class="muted">${label}</span><span>${value}</span></div>`;
  const parentName = p.parent_id ? getProject(p.parent_id)?.name : null;
  let control = '';
  if (p.progress_type === 'number' || p.progress_type === 'percent') {
    control = `<form class="inline-form" data-form="progress" data-id="${p.id}">
      <label class="sr-only" for="pv-${p.id}">New value</label>
      <input type="number" id="pv-${p.id}" value="${Number(p.progress_value) || 0}" step="any" inputmode="decimal"${p.progress_type === 'percent' ? ' min="0" max="100"' : ''}>
      <span class="muted small">${p.progress_type === 'percent' ? '%' : esc(p.progress_unit)}</span>
      <button class="btn small" type="submit">Update</button>
    </form>`;
  }
  return `<section class="card details-card">
    ${row('Status', STATUS[p.status])}
    ${row('Progress by', MEASURE[p.progress_type] || 'Tasks done')}
    ${parentName ? row('Part of', esc(parentName)) : ''}
    ${row('Start date', p.start_date ? esc(shortDate(p.start_date)) : '<span class="muted">Not set</span>')}
    ${row('Deadline', p.deadline ? `${esc(shortDate(p.deadline))} <span class="muted">${timeLeft(p.deadline)}</span>` : '<span class="muted">Not set</span>')}
    ${control}
  </section>`;
}

function progressCard(p) {
  const pr = progress(p);
  const s = progressSeries(p);
  const big = p.progress_type === 'percent' ? `${Math.round(pr.ratio * 100)}%`
    : `${Number(s.points.length ? s.points[s.points.length - 1].value : 0).toLocaleString('en-US')}${s.target ? `<span class="of"> / ${Number(s.target).toLocaleString('en-US')} ${esc(s.unit)}</span>` : ` <span class="of">${esc(s.unit)}</span>`}`;
  return `<section class="card progress-card">
    <div class="card-head"><h2>Progress</h2><span class="pct">${Math.round(pr.ratio * 100)}%</span></div>
    <p class="big-number">${big}</p>
    ${progressChart(p, colorOf(p))}
    ${p.deadline && s.target ? '<p class="muted small chart-key"><span class="key-line"></span>Your progress <span class="key-pace"></span>Even pace to the deadline</p>' : ''}
  </section>`;
}

function roadmapRows(list) {
  return list.map((sg) => {
    const pr = progress(sg);
    const open = [sg.id, ...descendants(sg.id)].reduce((a, id) => a + state.tasks.filter((t) => t.project_id === id && !t.done).length, 0);
    const subs = children(sg.id).length;
    return `<a class="rm-row${sg.status === 'done' ? ' done' : ''}" href="#/project/${sg.id}">
      <span class="rm-name">${badge(sg, 'small')}<span>${esc(sg.name)}${subs ? `<span class="muted small"> · ${subs} subgoal${subs === 1 ? '' : 's'}</span>` : ''}</span></span>
      <span class="rm-progress">${bar(sg)}<span class="muted small">${Math.round(pr.ratio * 100)}%</span></span>
      <span class="rm-date">${sg.start_date ? esc(shortDate(sg.start_date)) : '<span class="muted">–</span>'}</span>
      <span class="rm-date">${sg.deadline ? esc(shortDate(sg.deadline)) : '<span class="muted">–</span>'}</span>
      <span class="rm-tasks">${open || '<span class="muted">0</span>'}</span>
    </a>`;
  }).join('');
}

function roadmapTable(p) {
  const subs = children(p.id);
  const active = subs.filter((s) => s.status !== 'done');
  const done = subs.filter((s) => s.status === 'done');
  return `<section class="card">
    <div class="card-head"><h2>Subgoals</h2><button type="button" class="btn small" data-act="new-subgoal" data-id="${p.id}">Add subgoal</button></div>
    ${subs.length ? `<div class="rm-table">
      <div class="rm-row rm-headrow"><span>Name</span><span>Progress</span><span class="rm-date">Start</span><span class="rm-date">Deadline</span><span class="rm-tasks">Open tasks</span></div>
      ${roadmapRows(active)}
      ${done.length ? `<details class="rm-done"><summary>Completed <span class="muted">${done.length}</span></summary>${roadmapRows(done)}</details>` : ''}
    </div>` : '<p class="empty">No subgoals. Break the project into parts, such as chapters.</p>'}
  </section>`;
}

function ownTasks(p, ui) {
  const tasks = tasksIn(p.id);
  const open = tasks.filter((t) => !t.done), done = tasks.filter((t) => t.done);
  return `<section class="card">
    <div class="card-head"><h2>Tasks</h2>${done.length ? `<button type="button" class="link small" data-act="toggle-show-done" data-id="${p.id}">${ui.showDone?.[p.id] ? 'Hide' : 'Show'} ${done.length} done</button>` : ''}</div>
    ${taskList(open, { showProject: false })}
    ${ui.showDone?.[p.id] ? taskList(done, { showProject: false }) : ''}
    ${addTaskForm(`p-${p.id}`, { project: p.id })}
  </section>`;
}

function overview(p, ui) {
  return `<div class="ov-grid">${detailsCard(p)}${progressCard(p)}</div>
    ${roadmapTable(p)}
    ${ownTasks(p, ui)}
    ${p.notes ? `<section class="card"><div class="card-head"><h2>Notes</h2></div><p class="notes">${esc(p.notes)}</p></section>` : ''}`;
}

// Every open task in the project, one flat section per subgoal, no nesting.
function tasksTab(p, ui) {
  const sections = [{ p, path: '' }];
  const walk = (id, path) => children(id).filter((c) => c.status !== 'done').forEach((c) => { sections.push({ p: c, path }); walk(c.id, path ? `${path} / ${c.name}` : c.name); });
  walk(p.id, '');
  const showDone = ui.showDone?.[`all-${p.id}`];
  const anyDone = sections.some((s) => tasksIn(s.p.id).some((t) => t.done));
  return `<div class="block-head"><span class="muted small">${sections.length - 1} active subgoal${sections.length === 2 ? '' : 's'}</span>${anyDone ? `<button type="button" class="link small" data-act="toggle-show-done" data-id="all-${p.id}">${showDone ? 'Hide' : 'Show'} done tasks</button>` : ''}</div>
    ${sections.map((s) => {
    const tasks = tasksIn(s.p.id).filter((t) => showDone || !t.done);
    return `<section class="card task-section tint-${colorOf(s.p)}">
        <div class="card-head"><h3>${s.p === p ? 'This project' : `<a href="#/project/${s.p.id}">${badge(s.p, 'small')}${esc(s.p.name)}</a>`}</h3>${s.path ? `<span class="muted small">${esc(s.path)}</span>` : ''}</div>
        ${taskList(tasks, { showProject: false })}
        ${addTaskForm(`t-${s.p.id}`, { project: s.p.id })}
      </section>`;
  }).join('')}`;
}

function roadmapTab(p) {
  return `<section class="card">
      <div class="card-head"><h2>Timeline</h2><span class="muted small">Subgoals from start date to deadline. Click one to open it.</span></div>
      ${roadmapTimeline(p, colorOf, emojiOf)}
    </section>
    ${roadmapTable(p)}`;
}

export function projectView(id, tab, ui) {
  const p = getProject(id);
  if (!p) return '<header class="page-head"><h1>Project not found</h1><p><a href="#/projects">Back to projects</a></p></header>';
  const body = tab === 'tasks' ? tasksTab(p, ui) : tab === 'roadmap' ? roadmapTab(p) : overview(p, ui);
  return `${header(p, tab || 'overview')}${body}`;
}

export const projectTitle = (id) => getProject(id)?.name || 'Project';
export { byOrder, areas };
