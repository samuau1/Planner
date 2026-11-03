// The day as a timeline of 30-minute blocks, the daily planning screen, and drag and drop.
// A day holds two kinds of items: tasks, and project blocks (time for a whole project).
import {
  state, update, create, remove, getTask, getProject, rootOf, workHours, byOrder, topProjects, descendants, children, doneOn,
} from './store.js';
import { esc, today, addDays, longDate, fmtMinutes, niceDate, parseISO } from './util.js';
import { emojiOf, badge, PALETTE } from './look.js';
import { addTaskForm, taskList } from './views.js';

export const DAY_START = 6, DAY_END = 23, SLOT = 30, PX = 36; // times you can pick: 06:00–23:00; 36 px per hour on the timeline
const VIEW_START = 7, VIEW_END = 22; // the timeline shows 07:00–22:00, and grows if something falls outside
const toMin = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m; };
export const toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

export const TIME_OPTIONS = (() => { const out = []; for (let m = DAY_START * 60; m < DAY_END * 60; m += SLOT) out.push(toTime(m)); return out; })();
export const LENGTH_OPTIONS = [30, 60, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480];

// ---- Items on a day

function taskItem(t, day) {
  const p = t.project_id ? rootOf(getProject(t.project_id)) : null;
  return {
    kind: 'task', id: t.id, key: `task:${t.id}`, title: t.title, emoji: emojiOf(p), start: t.start_time,
    len: t.block_minutes || Math.max(SLOT, Math.ceil((t.estimate_minutes || 60) / SLOT) * SLOT),
    estimate: t.estimate_minutes, done: doneOn(t, day), ongoing: t.ongoing, priority: t.priority, order: t.sort_order, raw: t,
  };
}
function blockItem(b) {
  const p = getProject(b.project_id);
  return {
    kind: 'block', id: b.id, key: `block:${b.id}`, title: p ? p.name : 'Project', emoji: emojiOf(rootOf(p)) || emojiOf(p), start: b.start_time,
    len: b.block_minutes || 60, estimate: b.block_minutes || 60, done: b.done, priority: false, order: b.sort_order, raw: b, project: p,
  };
}
const TABLE = { task: 'tasks', block: 'time_blocks' };
export const itemByKey = (key) => {
  const [kind, id] = key.split(':');
  if (kind === 'task') { const t = getTask(id); return t ? taskItem(t, t.planned_date || today()) : null; }
  const b = state.time_blocks.find((x) => x.id === id);
  return b ? blockItem(b) : null;
};
export const updateItem = (item, patch) => update(TABLE[item.kind], item.id, patch);

export function dayItems(day) {
  return [
    ...state.tasks.filter((t) => t.planned_date === day).map((t) => taskItem(t, day)),
    ...state.time_blocks.filter((b) => b.day === day).map(blockItem),
  ];
}
export const scheduled = (day) => dayItems(day).filter((i) => i.start).sort((a, b) => toMin(a.start) - toMin(b.start));
export const unscheduled = (day) => dayItems(day).filter((i) => !i.start && !i.done).sort((a, b) => (b.priority - a.priority) || (a.order - b.order));

// Each item on a day gets its own pastel colour, taking turns through the palette.
function dayColors(day) {
  const map = {};
  [...scheduled(day), ...unscheduled(day)].forEach((it, i) => { map[it.key] = PALETTE[(i + 1) % PALETTE.length]; });
  return map;
}

// Hours the timeline shows for a day.
function viewRange(day) {
  let a = VIEW_START * 60, b = VIEW_END * 60;
  const w = workHours(day);
  if (w) { a = Math.min(a, toMin(w.start)); b = Math.max(b, toMin(w.end)); }
  scheduled(day).forEach((it) => { a = Math.min(a, toMin(it.start)); b = Math.max(b, toMin(it.start) + it.len); });
  return [Math.floor(a / 60), Math.min(DAY_END, Math.ceil(b / 60))];
}

// How full the day is: work time against your hours, and time planned outside them.
export function load(day) {
  const w = workHours(day);
  const ws = w ? toMin(w.start) : 0, we = w ? toMin(w.end) : 0;
  let work = 0, outside = 0;
  dayItems(day).forEach((it) => {
    if (it.start) {
      const s = toMin(it.start), e = s + it.len;
      const inside = w ? Math.max(0, Math.min(e, we) - Math.max(s, ws)) : 0;
      work += inside; outside += e - s - inside;
    } else if (!it.done) {
      const m = it.kind === 'block' ? it.len : it.estimate || 0;
      if (w) work += m; else outside += m;
    }
  });
  return { hours: w, cap: w ? we - ws : 0, work, outside };
}

export function loadLine(day) {
  const l = load(day);
  const over = l.hours && l.work > l.cap ? `<span class="chip-s warn">${fmtMinutes(l.work - l.cap)} over</span>` : '';
  const work = l.hours
    ? `<span><b>Work ${l.hours.start}–${l.hours.end}:</b> ${fmtMinutes(l.work) || '0 min'} planned of ${fmtMinutes(l.cap)}</span>${over}`
    : '<span><b>Day off</b></span>';
  return `<div class="load-line">${work}${l.outside ? `<span class="muted">Outside work hours: ${fmtMinutes(l.outside)}</span>` : ''}</div>`;
}

// Side-by-side columns for blocks that overlap.
function layout(items) {
  const rows = items.map((it) => ({ it, s: toMin(it.start), e: toMin(it.start) + it.len, col: 0, cols: 1 }));
  let cluster = [], end = -1;
  const close = () => { const n = Math.max(1, ...cluster.map((i) => i.col + 1)); cluster.forEach((i) => { i.cols = n; }); cluster = []; };
  rows.forEach((r) => {
    if (r.s >= end) { close(); end = -1; }
    const used = new Set(cluster.filter((c) => c.e > r.s).map((c) => c.col));
    let c = 0; while (used.has(c)) c++;
    r.col = c; cluster.push(r); end = Math.max(end, r.e);
  });
  close();
  return rows;
}

const checkSvg = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 10.5l3 3 6-7"/></svg>';
const label = (it) => `${it.emoji ? `${esc(it.emoji)} ` : ''}${it.kind === 'block' ? `<span class="pb-tag">Project time</span> ` : ''}${esc(it.title)}${it.ongoing ? ' <span class="ongoing-tag" title="Ongoing">↻</span>' : ''}`;

export function timeline(day) {
  const w = workHours(day);
  const [v0, v1] = viewRange(day);
  const colors = dayColors(day);
  const y = (min) => ((min - v0 * 60) / 60) * PX;
  let hours = '';
  for (let h = v0; h < v1; h++) hours += `<div class="tl-hour" style="top:${(h - v0) * PX}px"><span>${String(h).padStart(2, '0')}:00</span></div>`;
  const band = w ? `<div class="tl-work" style="top:${y(toMin(w.start))}px;height:${y(toMin(w.end)) - y(toMin(w.start))}px"><span>Work ${w.start}–${w.end}</span></div>` : '';
  const now = day === today() && nowMin() > v0 * 60 && nowMin() < v1 * 60 ? `<div class="tl-now" style="top:${y(nowMin())}px"></div>` : '';
  const blocks = layout(scheduled(day)).map(({ it, s, e, col, cols }) => `<div class="tl-block tint-${colors[it.key]}${it.done ? ' done' : ''}${e - s <= 30 ? ' short' : ''}${it.kind === 'block' ? ' pblock' : ''}" data-block="${it.key}"
        style="top:${y(s)}px;height:${y(e) - y(s) - 2}px;left:calc(${(col / cols) * 100}% + 2px);width:calc(${100 / cols}% - 4px)">
      <button type="button" class="check small-check" data-act="toggle-item" data-id="${it.key}" data-day="${day}" aria-label="${it.done ? 'Mark not done' : it.ongoing ? 'Done for today' : 'Mark done'}: ${esc(it.title)}">${checkSvg}</button>
      <span class="tl-text"><span class="tl-title">${label(it)}</span><span class="tl-time">${toTime(s)}–${toTime(e)}</span></span>
      ${it.done ? '' : `<button type="button" class="tl-focus" data-act="focus-start" data-id="${it.key}" aria-label="Focus on ${esc(it.title)}" title="Focus">◐</button>`}
      <span class="tl-resize" data-resize="${it.key}" aria-hidden="true"></span>
    </div>`).join('');
  return `<div class="tl" data-day="${day}" data-start="${v0}" data-end="${v1}" style="height:${(v1 - v0) * PX}px">${hours}${band}${now}<div class="tl-lane">${blocks}</div></div>`;
}

export function tray(day) {
  const list = unscheduled(day);
  if (!list.length) return '';
  const colors = dayColors(day);
  return `<div class="tray">
    <div class="tray-head"><h2>No time yet</h2><span class="muted small">Drag onto the timeline, or open one to pick a time</span></div>
    <ul class="tray-list">${list.map((it) => `<li class="tray-item tint-${colors[it.key]}">
        <span class="grip" data-tray="${it.key}" aria-label="Drag to the timeline" title="Drag to the timeline">⋮⋮</span>
        <button type="button" class="tray-title" data-act="open-item" data-id="${it.key}">${label(it)}</button>
        <span class="muted small">${fmtMinutes(it.len)}</span>
      </li>`).join('')}</ul>
  </div>`;
}

// Put items without a time into the free half hours of your working day, in order.
export function fillDay(day) {
  const w = workHours(day);
  if (!w) return 0;
  let from = toMin(w.start);
  if (day === today()) from = Math.max(from, Math.ceil(nowMin() / SLOT) * SLOT);
  const end = toMin(w.end);
  const busy = scheduled(day).map((it) => [toMin(it.start), toMin(it.start) + it.len]);
  let placed = 0;
  unscheduled(day).forEach((it) => {
    for (let s = from; s + it.len <= end; s += SLOT) {
      if (busy.every(([a, b]) => s + it.len <= a || s >= b)) {
        updateItem(it, it.kind === 'task' ? { start_time: toTime(s), block_minutes: it.len } : { start_time: toTime(s) });
        busy.push([s, s + it.len]);
        placed++;
        return;
      }
    }
  });
  return placed;
}

// Tick an item on a day. Ongoing tasks are "done for today" and stay open.
export function toggleItem(key, day, toggleTask) {
  const it = itemByKey(key);
  if (!it) return;
  if (it.kind === 'task') toggleTask(it.id, day);
  else update('time_blocks', it.id, { done: !it.done });
}

// ---- Project time

function projectOptions() {
  const rows = [];
  const walk = (list, depth) => list.filter((p) => p.status === 'active').forEach((p) => {
    rows.push(`<option value="${p.id}">${' '.repeat(depth)}${esc(emojiOf(p) ? `${emojiOf(p)} ` : '')}${esc(p.name)}</option>`);
    if (depth < 1) walk(children(p.id), depth + 1);
  });
  walk(topProjects(), 0);
  return rows.join('');
}

export function projectTimeForm(day) {
  if (!state.projects.some((p) => p.status === 'active')) return '';
  return `<form class="pt-form" data-form="project-time" data-day="${day}">
    <span class="muted small">Time for a project</span>
    <select id="pt-project-${day}" aria-label="Project">${projectOptions()}</select>
    <select id="pt-length-${day}" aria-label="Length">${LENGTH_OPTIONS.slice(0, 10).map((m) => `<option value="${m}"${m === 120 ? ' selected' : ''}>${fmtMinutes(m)}</option>`).join('')}</select>
    <button class="btn small" type="submit">Add</button>
  </form>`;
}

export function addProjectTime(day, projectId, minutes) {
  return create('time_blocks', { project_id: projectId, day, block_minutes: minutes, start_time: null });
}

export function blockPanel(id) {
  const b = state.time_blocks.find((x) => x.id === id);
  if (!b) return '';
  const p = getProject(b.project_id);
  return `<div class="panel-head">
      <button type="button" class="check big${b.done ? ' on' : ''}" data-act="toggle-item" data-id="block:${b.id}" data-day="${b.day}" aria-label="${b.done ? 'Mark not done' : 'Mark done'}">${checkSvg}</button>
      <h2 class="panel-title">Project time</h2>
      <button type="button" class="icon-btn" data-act="close-panel" aria-label="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg></button>
    </div>
    <div class="fields">
      <p class="pb-project">${p ? `${badge(p)} <a href="#/project/${p.id}">${esc(p.name)}</a>` : 'Project deleted'}</p>
      <div class="field-row">
        <label>Day<input type="date" value="${b.day}" data-field="day" data-kind="time_blocks" data-id="${b.id}" id="pb-day"></label>
        <label>Time<select data-field="start_time" data-kind="time_blocks" data-id="${b.id}" id="pb-time"><option value="">No time yet</option>${TIME_OPTIONS.map((v) => `<option value="${v}"${String(b.start_time || '').slice(0, 5) === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <label>Length<select data-field="block_minutes" data-kind="time_blocks" data-id="${b.id}" id="pb-length">${LENGTH_OPTIONS.map((m) => `<option value="${m}"${b.block_minutes === m ? ' selected' : ''}>${fmtMinutes(m)}</option>`).join('')}</select></label>
      <label>Note<textarea rows="3" data-field="note" data-kind="time_blocks" data-id="${b.id}" id="pb-note" placeholder="What you want to get done">${esc(b.note)}</textarea></label>
    </div>
    <div class="panel-foot">
      <button type="button" class="btn focus-btn" data-act="focus-start" data-id="block:${b.id}">◐ Focus</button>
      <button type="button" class="btn ghost" data-act="block-again" data-id="${b.id}">Again tomorrow</button>
      <button type="button" class="btn ghost danger" data-act="block-delete" data-id="${b.id}">Remove from the day</button>
    </div>`;
}

// ---- A day (Today, or any other day from the calendar)

export function dayCore(day) {
  return `${loadLine(day)}
    <div class="add-row">${addTaskForm(`day-${day}`, { planned: day, placeholder: day === today() ? 'Add a task for today' : `Add a task for ${niceDate(day).toLowerCase()}` })}${projectTimeForm(day)}</div>
    <div class="day-grid">${tray(day)}${timeline(day)}</div>`;
}

export function dayView(day) {
  const due = state.tasks.filter((t) => !t.done && t.deadline === day);
  const projDue = state.projects.filter((p) => p.status !== 'done' && p.deadline === day);
  return `<header class="page-head">
      <p class="eyebrow"><a href="#/calendar">Calendar</a></p>
      <div class="day-nav">
        <a class="btn small ghost" href="#/day/${addDays(day, -1)}" aria-label="Previous day">‹</a>
        <h1>${esc(longDate(day))}</h1>
        <a class="btn small ghost" href="#/day/${addDays(day, 1)}" aria-label="Next day">›</a>
      </div>
      ${day !== today() ? '<p><a class="link small" href="#/today">Back to today</a></p>' : ''}
    </header>
    ${due.length || projDue.length ? `<section class="block"><div class="block-head"><h2>Deadlines this day</h2></div>
      ${projDue.map((p) => `<p class="deadline-line">${badge(p, 'tiny')} <a href="#/project/${p.id}">${esc(p.name)}</a> is due</p>`).join('')}
      ${taskList(due)}</section>` : ''}
    <section class="block">${dayCore(day)}</section>`;
}

// ---- Planning screen

export function planView(ui) {
  const t = today();
  const w = workHours(t);
  const earlier = state.tasks.filter((x) => !x.done && x.planned_date && x.planned_date < t)
    .sort((a, b) => (b.ongoing - a.ongoing) || a.planned_date.localeCompare(b.planned_date));
  const lastBlocks = (() => {
    const past = state.time_blocks.filter((b) => b.day < t).map((b) => b.day).sort();
    const last = past[past.length - 1];
    return last ? state.time_blocks.filter((b) => b.day === last && getProject(b.project_id)?.status === 'active'
      && !state.time_blocks.some((x) => x.day === t && x.project_id === b.project_id)) : [];
  })();
  const notPlanned = (x) => !x.done && (!x.planned_date || x.planned_date > t);
  const dueSoon = state.tasks.filter((x) => notPlanned(x) && x.deadline && x.deadline <= addDays(t, 7)).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const inbox = state.tasks.filter((x) => notPlanned(x) && !x.project_id && !dueSoon.includes(x)).sort(byOrder);
  const projects = topProjects().filter((p) => p.status === 'active').map((p) => {
    const ids = new Set([p.id, ...descendants(p.id).filter((id) => getProject(id)?.status !== 'done')]);
    return { p, tasks: state.tasks.filter((x) => ids.has(x.project_id) && notPlanned(x) && !dueSoon.includes(x)).sort((a, b) => (b.ongoing - a.ongoing) || byOrder(a, b)) };
  }).filter((g) => g.tasks.length);
  const pickRow = (x) => {
    const p = x.project_id ? rootOf(getProject(x.project_id)) : null;
    return `<li class="pick-row">
      <button type="button" class="pick-add" data-act="plan" data-id="${x.id}" data-when="today" aria-label="Add to today">+</button>
      <button type="button" class="pick-title" data-act="open-task" data-id="${x.id}">${x.priority ? '<span class="flag-dot" aria-label="Priority"></span>' : ''}${esc(x.title)}${x.ongoing ? ' <span class="ongoing-tag" title="Ongoing">↻</span>' : ''}
        <span class="muted small">${[p ? `${emojiOf(p) ? `${emojiOf(p)} ` : ''}${p.name}` : '', x.deadline ? `Due ${niceDate(x.deadline)}` : '', x.planned_date ? `Planned ${niceDate(x.planned_date)}` : '', x.estimate_minutes ? fmtMinutes(x.estimate_minutes) : ''].filter(Boolean).map(esc).join(' · ')}</span></button>
    </li>`;
  };
  const hoursOpts = (sel) => Array.from({ length: (DAY_END - DAY_START) * 2 + 1 }, (_, i) => toTime(DAY_START * 60 + i * 30)).map((v) => `<option${v === sel ? ' selected' : ''}>${v}</option>`).join('');
  const n = (k) => String(k);
  let step = 0;
  const continueCount = earlier.length + lastBlocks.length;
  return `<header class="page-head">
      <p class="eyebrow">${esc(longDate(t))}</p>
      <h1>Plan your day</h1>
    </header>

    <section class="card">
      <div class="card-head"><h2>Your hours today</h2></div>
      <form class="hours-form" data-form="today-hours">
        <label class="toggle"><input type="checkbox" id="th-work"${w ? ' checked' : ''}> I'm working today</label>
        <label>From<select id="th-start"${w ? '' : ' disabled'}>${hoursOpts(w?.start || '08:00')}</select></label>
        <label>To<select id="th-end"${w ? '' : ' disabled'}>${hoursOpts(w?.end || '16:00')}</select></label>
        <button class="btn small" type="submit">Save</button>
      </form>
      <p class="muted small">This changes today only. Your usual week is in Settings.</p>
    </section>

    ${continueCount ? `<section class="card">
      <div class="card-head"><h2>${n(++step)} · Continue from earlier</h2><span class="muted small">${continueCount} item${continueCount === 1 ? '' : 's'}</span></div>
      ${lastBlocks.length ? `<ul class="tasks">${lastBlocks.map((b) => { const p = getProject(b.project_id); return `<li class="task review-row">
        <div class="task-main"><span class="task-title">${badge(p, 'tiny')} ${esc(p.name)} <span class="pb-tag">Project time</span></span><span class="task-meta"><span>${fmtMinutes(b.block_minutes)} on ${esc(niceDate(b.day))}</span></span></div>
        <div class="review-acts"><button type="button" class="chip" data-act="block-again-today" data-id="${b.id}">Again today</button></div></li>`; }).join('')}</ul>` : ''}
      ${earlier.length ? `<ul class="tasks">${earlier.map((x) => `<li class="task review-row">
        <div class="task-main"><span class="task-title">${esc(x.title)}${x.ongoing ? ' <span class="ongoing-tag">↻ ongoing</span>' : ''}</span><span class="task-meta"><span class="${x.ongoing ? '' : 'late'}">${x.ongoing ? 'Last planned' : 'Planned'} ${esc(niceDate(x.planned_date))}</span></span></div>
        <div class="review-acts">
          <button type="button" class="chip" data-act="plan" data-id="${x.id}" data-when="today">Today</button>
          <button type="button" class="chip" data-act="plan" data-id="${x.id}" data-when="tomorrow">Tomorrow</button>
          <button type="button" class="chip" data-act="plan" data-id="${x.id}" data-when="none">No day</button>
        </div></li>`).join('')}</ul>` : ''}
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>${n(++step)} · Choose what today holds</h2></div>
      ${addTaskForm('plan', { planned: t, placeholder: 'Add a new task for today' })}
      ${projectTimeForm(t)}
      ${dueSoon.length ? `<div class="pick-group"><h3>Deadlines in the next 7 days</h3><ul class="pick-list">${dueSoon.map(pickRow).join('')}</ul></div>` : ''}
      ${inbox.length ? `<details class="pick-group"${ui.planOpen?.inbox ? ' open' : ''} data-remember-plan="inbox"><summary><h3>Inbox</h3><span class="muted small">${inbox.length}</span></summary><ul class="pick-list">${inbox.map(pickRow).join('')}</ul></details>` : ''}
      ${projects.map((g) => `<details class="pick-group"${ui.planOpen?.[g.p.id] ? ' open' : ''} data-remember-plan="${g.p.id}"><summary><h3>${badge(g.p, 'tiny')} ${esc(g.p.name)}</h3><span class="muted small">${g.tasks.length}</span></summary><ul class="pick-list">${g.tasks.map(pickRow).join('')}</ul></details>`).join('')}
    </section>

    <section class="card">
      <div class="card-head"><h2>${n(++step)} · Place it on the day</h2>${unscheduled(t).length && w ? '<button type="button" class="btn small" data-act="fill-day">Fill my working hours</button>' : ''}</div>
      ${loadLine(t)}
      <div class="day-grid">${tray(t)}${timeline(t)}</div>
    </section>

    <div class="plan-done"><button type="button" class="btn primary" data-act="plan-done">Done, show me today</button></div>`;
}

// ---- Drag and drop on the timeline (mouse, trackpad and touch)

let drag = null;
export const dragging = () => !!drag;

function slotAt(tl, clientY, grabOffset = 0) {
  const r = tl.getBoundingClientRect();
  const v0 = Number(tl.dataset.start) || DAY_START, v1 = Number(tl.dataset.end) || DAY_END;
  const min = v0 * 60 + ((clientY - r.top - grabOffset) / PX) * 60;
  return Math.max(v0 * 60, Math.min(v1 * 60 - SLOT, Math.round(min / SLOT) * SLOT));
}

function isOver(el, e) {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

export function setupDrag(onOpen) {
  document.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    const resize = e.target.closest('[data-resize]');
    const block = e.target.closest('[data-block]');
    const grip = e.target.closest('[data-tray]');
    if (!resize && !grip && (!block || e.target.closest('button'))) return;
    const el = resize ? resize.closest('[data-block]') : block || grip.closest('.tray-item');
    const key = resize?.dataset.resize || block?.dataset.block || grip.dataset.tray;
    const r = el.getBoundingClientRect();
    drag = { mode: resize ? 'resize' : grip ? 'place' : 'move', key, el, x: e.clientX, y: e.clientY, grab: e.clientY - r.top, top: el.offsetTop, height: el.offsetHeight, moved: false, ghost: null };
    el.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) + Math.abs(e.clientX - drag.x) < 5) return;
    drag.moved = true;
    const step = PX / 2;
    if (drag.mode === 'move') { drag.el.style.top = `${drag.top + Math.round(dy / step) * step}px`; drag.el.classList.add('dragging'); }
    if (drag.mode === 'resize') drag.el.style.height = `${Math.max(step - 2, drag.height + Math.round(dy / step) * step)}px`;
    if (drag.mode === 'place') {
      if (!drag.ghost) {
        drag.ghost = drag.el.cloneNode(true);
        drag.ghost.classList.add('ghost');
        drag.ghost.style.width = `${drag.el.offsetWidth}px`;
        document.body.append(drag.ghost);
      }
      drag.ghost.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 18}px)`;
      const tl = document.querySelector('.tl');
      tl?.classList.toggle('drop-target', !!tl && isOver(tl, e));
    }
  });

  document.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    d.ghost?.remove();
    document.querySelector('.tl')?.classList.remove('drop-target');
    const it = itemByKey(d.key);
    if (!it) return;
    if (!d.moved) { if (d.mode === 'move') onOpen(d.key); return; }
    const tl = d.el.closest('.tl') || document.querySelector('.tl');
    if (!tl) return;
    if (d.mode === 'move') updateItem(it, { start_time: toTime(slotAt(tl, e.clientY, d.grab)) });
    if (d.mode === 'resize') updateItem(it, { block_minutes: Math.max(SLOT, Math.round((((d.el.offsetHeight + 2) / PX) * 60) / SLOT) * SLOT) });
    if (d.mode === 'place' && isOver(tl, e)) {
      const day = tl.dataset.day;
      updateItem(it, it.kind === 'task' ? { start_time: toTime(slotAt(tl, e.clientY, 10)), block_minutes: it.len, planned_date: day } : { start_time: toTime(slotAt(tl, e.clientY, 10)), day });
    }
  });
  document.addEventListener('pointercancel', () => { if (drag) { drag.ghost?.remove(); drag = null; } });
}

export { remove, parseISO };
