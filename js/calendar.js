// The calendar (month and week) and the timeline of all projects across the year.
import { state, getProject, rootOf, workHours, topProjects, children, areas, doneOn, update } from './store.js';
import { esc, today, addDays, parseISO, iso, fmtMinutes } from './util.js';
import { colorOf, emojiOf, badge } from './look.js';
import { load } from './plan.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const mondayOf = (day) => addDays(day, -((parseISO(day).getDay() + 6) % 7));

function itemsOn(day) {
  const tasks = state.tasks.filter((t) => t.planned_date === day).map((t) => {
    const p = t.project_id ? rootOf(getProject(t.project_id)) : null;
    return { key: `task:${t.id}`, title: t.title, emoji: emojiOf(p), color: p ? colorOf(p) : 'sand', done: doneOn(t, day), time: t.start_time ? String(t.start_time).slice(0, 5) : '' };
  });
  const blocks = state.time_blocks.filter((b) => b.day === day).map((b) => {
    const p = getProject(b.project_id);
    return { key: `block:${b.id}`, title: `${p?.name || 'Project'} · ${fmtMinutes(b.block_minutes)}`, emoji: emojiOf(rootOf(p)) || emojiOf(p), color: p ? colorOf(p) : 'sand', done: b.done, time: b.start_time ? String(b.start_time).slice(0, 5) : '', block: true };
  });
  const list = [...tasks, ...blocks].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  const due = [
    ...state.projects.filter((p) => p.status !== 'done' && p.deadline === day).map((p) => ({ title: p.name, href: `#/project/${p.id}`, color: colorOf(p), emoji: emojiOf(p), project: true })),
    ...state.tasks.filter((t) => !t.done && t.deadline === day).map((t) => ({ title: t.title, key: `task:${t.id}`, color: t.project_id ? colorOf(rootOf(getProject(t.project_id))) : 'sand' })),
  ];
  return { list, due };
}

const chip = (it) => `<div class="cal-chip tint-${it.color}${it.done ? ' done' : ''}${it.block ? ' pchip' : ''}" data-cal-item="${it.key}" title="${esc(it.title)}">${it.time ? `<span class="cal-time">${it.time}</span>` : ''}${it.emoji ? `${esc(it.emoji)} ` : ''}${esc(it.title)}</div>`;
const dueChip = (d) => (d.project
  ? `<a class="cal-due tint-${d.color}" href="${d.href}" title="Project deadline">◆ ${d.emoji ? `${esc(d.emoji)} ` : ''}${esc(d.title)}</a>`
  : `<button type="button" class="cal-due tint-${d.color}" data-act="open-item" data-id="${d.key}" title="Deadline">⚑ ${esc(d.title)}</button>`);

function monthGrid(anchor) {
  const [y, m] = anchor.split('-').map(Number);
  const first = iso(new Date(y, m - 1, 1));
  const start = mondayOf(first);
  const last = new Date(y, m, 0).getDate();
  const weeks = Math.ceil(((parseISO(first).getDay() + 6) % 7 + last) / 7);
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(start, i);
    const inMonth = day.slice(0, 7) === anchor;
    const { list, due } = itemsOn(day);
    const w = workHours(day);
    const shown = list.slice(0, 4);
    cells += `<div class="cal-cell${inMonth ? '' : ' other'}${day === today() ? ' is-today' : ''}${w ? '' : ' off'}" data-cal-day="${day}">
      <div class="cal-top"><a class="cal-date" href="#/day/${day}">${parseISO(day).getDate()}</a>${w ? `<span class="cal-hours">${w.start.replace(':00', '')}–${w.end.replace(':00', '')}</span>` : ''}</div>
      ${due.map(dueChip).join('')}
      ${shown.map(chip).join('')}
      ${list.length > shown.length ? `<a class="cal-more" href="#/day/${day}">+${list.length - shown.length} more</a>` : ''}
    </div>`;
  }
  return `<div class="cal-month"><div class="cal-dows">${DOW.map((d) => `<span>${d}</span>`).join('')}</div><div class="cal-grid">${cells}</div></div>`;
}

function weekGrid(anchor) {
  const start = mondayOf(anchor);
  let cols = '';
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const { list, due } = itemsOn(day);
    const l = load(day);
    cols += `<div class="wk-col${day === today() ? ' is-today' : ''}${l.hours ? '' : ' off'}" data-cal-day="${day}">
      <a class="wk-head" href="#/day/${day}"><span>${DOW[i]}</span><b>${parseISO(day).getDate()}</b></a>
      <div class="wk-load">${l.hours ? (l.work ? `${fmtMinutes(l.work)} of ${fmtMinutes(l.cap)}` : `${fmtMinutes(l.cap)} free`) : 'Day off'}${l.hours && l.work > l.cap ? ' <span class="chip-s warn">over</span>' : ''}</div>
      ${due.map(dueChip).join('')}
      ${list.map(chip).join('')}
      <form class="wk-add" data-form="add-task" data-project="" data-planned="${day}"><input type="text" id="wk-add-${day}" placeholder="+ Add" aria-label="Add a task on ${day}" autocomplete="off"></form>
    </div>`;
  }
  return `<div class="cal-week">${cols}</div>`;
}

export function calendarView(ui) {
  const mode = ui.calMode || 'month';
  const anchor = ui.calAnchor || today();
  let title, prev, next;
  if (mode === 'month') {
    const [y, m] = anchor.slice(0, 7).split('-').map(Number);
    title = `${MONTHS[m - 1]} ${y}`;
    prev = iso(new Date(y, m - 2, 1)); next = iso(new Date(y, m, 1));
  } else {
    const s = mondayOf(anchor), e = addDays(s, 6);
    const a = parseISO(s), b = parseISO(e);
    title = a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}` : `${a.getDate()} ${MONTHS[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MONTHS[b.getMonth()].slice(0, 3)} ${b.getFullYear()}`;
    prev = addDays(s, -7); next = addDays(s, 7);
  }
  return `<header class="page-head">
      <h1>Calendar</h1>
      <div class="head-actions"><div class="seg" role="group" aria-label="View">
        <button type="button" class="${mode === 'month' ? 'on' : ''}" data-act="cal-mode" data-id="month">Month</button>
        <button type="button" class="${mode === 'week' ? 'on' : ''}" data-act="cal-mode" data-id="week">Week</button>
      </div></div>
    </header>
    <div class="cal-nav">
      <button type="button" class="btn small ghost" data-act="cal-go" data-id="${prev}" aria-label="Previous">‹</button>
      <h2 class="cal-title">${esc(title)}</h2>
      <button type="button" class="btn small ghost" data-act="cal-go" data-id="${next}" aria-label="Next">›</button>
      <button type="button" class="btn small" data-act="cal-go" data-id="${today()}">Today</button>
      <span class="muted small cal-hint">Drag a task to another day. Open a day to plan its hours.</span>
    </div>
    ${mode === 'month' ? monthGrid(anchor.slice(0, 7)) : weekGrid(anchor)}`;
}

// ---- Drag tasks and project time between days

let cdrag = null;
export const calDragging = () => !!cdrag;

export function setupCalendarDrag(onOpen) {
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-cal-item]');
    if (!el || (e.button && e.button !== 0)) return;
    cdrag = { el, key: el.dataset.calItem, x: e.clientX, y: e.clientY, moved: false, ghost: null };
    if (e.pointerType === 'mouse') e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => {
    if (!cdrag) return;
    if (!cdrag.moved && Math.abs(e.clientX - cdrag.x) + Math.abs(e.clientY - cdrag.y) < 6) return;
    if (!cdrag.moved && e.pointerType !== 'mouse') { cdrag = null; return; } // on touch, a swipe scrolls the page
    cdrag.moved = true;
    if (!cdrag.ghost) {
      cdrag.ghost = cdrag.el.cloneNode(true);
      cdrag.ghost.classList.add('cal-ghost');
      cdrag.ghost.style.width = `${cdrag.el.offsetWidth}px`;
      document.body.append(cdrag.ghost);
    }
    cdrag.ghost.style.transform = `translate(${e.clientX - 12}px, ${e.clientY - 10}px)`;
    document.querySelectorAll('.drop-day').forEach((c) => c.classList.remove('drop-day'));
    document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-cal-day]')?.classList.add('drop-day');
  });
  document.addEventListener('pointerup', (e) => {
    if (!cdrag) return;
    const d = cdrag; cdrag = null;
    d.ghost?.remove();
    document.querySelectorAll('.drop-day').forEach((c) => c.classList.remove('drop-day'));
    if (!d.moved) { onOpen(d.key); return; }
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-cal-day]');
    if (!cell) return;
    const [kind, id] = d.key.split(':');
    if (kind === 'task') update('tasks', id, { planned_date: cell.dataset.calDay, start_time: null });
    else update('time_blocks', id, { day: cell.dataset.calDay, start_time: null });
  });
}

// ---- Timeline of all projects

function gantt(rows) {
  const dates = [today(), ...rows.flatMap((r) => (r.p ? [r.p.start_date, r.p.deadline] : []))].filter(Boolean).sort();
  const x0d = parseISO(dates[0]); x0d.setDate(1);
  const x1d = parseISO(dates[dates.length - 1]); x1d.setMonth(x1d.getMonth() + 1, 1);
  if ((x1d - x0d) / 864e5 < 180) x1d.setMonth(x0d.getMonth() + 6);
  const x0 = x0d.getTime(), x1 = x1d.getTime();
  const NAME = 240, W = 1000, RH = 30, TOP = 34;
  const X = (d) => NAME + ((parseISO(d).getTime() - x0) / (x1 - x0)) * (W - NAME - 12);
  const H = TOP + rows.length * RH + 8;
  let g = '';
  const months = [];
  for (let d = new Date(x0); d.getTime() < x1; d.setMonth(d.getMonth() + 1)) months.push(new Date(d));
  const every = months.length > 24 ? 3 : months.length > 12 ? 2 : 1;
  months.forEach((m, i) => {
    const x = X(iso(m));
    g += `<line x1="${x}" x2="${x}" y1="${TOP - 8}" y2="${H}" class="grid${m.getMonth() === 0 ? ' year' : ''}"/>`;
    if (i % every === 0) g += `<text x="${x + 4}" y="${TOP - 14}" class="axis">${MONTHS[m.getMonth()].slice(0, 3)}${m.getMonth() === 0 || i === 0 ? ` ’${String(m.getFullYear()).slice(2)}` : ''}</text>`;
  });
  rows.forEach((r, i) => {
    const y = TOP + i * RH + RH / 2;
    if (r.header) { g += `<text x="8" y="${y + 6}" class="row-area">${esc(r.header.toUpperCase())}</text>`; return; }
    const p = r.p, c = colorOf(p);
    const name = `${emojiOf(p) ? `${emojiOf(p)} ` : ''}${p.name}`;
    const max = 34 - r.depth * 4;
    g += `<a href="#/project/${p.id}"><text x="${10 + r.depth * 16}" y="${y + 4}" class="row-name${r.depth ? ' sub' : ''}">${esc(name.length > max ? `${name.slice(0, max - 1)}…` : name)}</text></a>`;
    const s = p.start_date, e = p.deadline;
    if (s && e) g += `<rect x="${X(s)}" y="${y - 8}" width="${Math.max(6, X(addDays(e, 1)) - X(s))}" height="16" rx="8" class="bar tint-${c}"><title>${esc(p.name)}</title></rect>`;
    else if (s) g += `<rect x="${X(s)}" y="${y - 8}" width="${Math.max(6, X(today()) - X(s))}" height="16" rx="8" class="bar open tint-${c}"><title>${esc(p.name)}: no deadline yet</title></rect>`;
    if (e) g += `<path d="M${X(e)} ${y - 7}l7 7-7 7-7-7z" class="milestone tint-${c}"><title>Deadline ${esc(e)}</title></path>`;
  });
  g += `<line x1="${X(today())}" x2="${X(today())}" y1="${TOP - 8}" y2="${H}" class="today"/>`;
  return `<div class="chart-scroll"><svg class="timeline wide" viewBox="0 0 ${W} ${H}" role="img" aria-label="All projects by month">${g}</svg></div>`;
}

export function projectsTimelineView(ui) {
  const showSubs = !!ui.tlSubs;
  const rows = [];
  const tops = topProjects().filter((p) => p.status === 'active');
  const groups = areas().map((a) => ({ name: a.name, list: tops.filter((p) => p.area_id === a.id) }));
  const loose = tops.filter((p) => !p.area_id || !state.areas.some((a) => a.id === p.area_id));
  if (loose.length) groups.push({ name: 'No area', list: loose });
  groups.filter((g) => g.list.length).forEach((g) => {
    rows.push({ header: g.name });
    g.list.forEach((p) => { rows.push({ p, depth: 0 }); if (showSubs) children(p.id).filter((c) => c.status !== 'done').forEach((c) => rows.push({ p: c, depth: 1 })); });
  });
  return `<header class="page-head">
      <h1>Timeline</h1>
      <p class="muted">Your active projects from start date to deadline. A dashed bar has no deadline yet; a diamond marks the deadline.</p>
      <div class="head-actions"><label class="toggle small"><input type="checkbox" id="tl-subs"${showSubs ? ' checked' : ''}> Show subgoals</label></div>
    </header>
    ${rows.length ? `<section class="card">${gantt(rows)}</section>` : '<p class="empty">No active projects yet.</p>'}`;
}

export { badge };
