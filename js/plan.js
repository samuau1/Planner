// The day as a timeline of 30-minute blocks, the daily planning screen, and drag and drop.
import { state, update, getTask, getProject, rootOf, workHours, byOrder, topProjects, descendants, tasksIn } from './store.js';
import { esc, today, addDays, longDate, fmtMinutes, niceDate } from './util.js';
import { colorOf, emojiOf, badge, PALETTE } from './look.js';
import { taskRow, addTaskForm } from './views.js';

export const DAY_START = 6, DAY_END = 23, SLOT = 30, PX = 36; // times you can pick: 06:00–23:00; 36 px per hour on the timeline
const VIEW_START = 7, VIEW_END = 22; // the timeline shows 07:00–22:00, and grows if a task falls outside
const toMin = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m; };
export const toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const lengthOf = (t) => t.block_minutes || Math.max(SLOT, Math.ceil((t.estimate_minutes || 60) / SLOT) * SLOT);
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

export const TIME_OPTIONS = (() => { const out = []; for (let m = DAY_START * 60; m < DAY_END * 60; m += SLOT) out.push(toTime(m)); return out; })();
export const LENGTH_OPTIONS = [30, 60, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480];

const dayTasks = (day) => state.tasks.filter((t) => t.planned_date === day);
export const scheduled = (day) => dayTasks(day).filter((t) => t.start_time).sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
export const unscheduled = (day) => dayTasks(day).filter((t) => !t.start_time && !t.done).sort((a, b) => (b.priority - a.priority) || byOrder(a, b));

// Each task on a day gets its own pastel colour, taking turns through the palette.
function dayColors(day) {
  const order = [...scheduled(day), ...unscheduled(day)];
  const map = {};
  order.forEach((t, i) => { map[t.id] = PALETTE[(i + 1) % PALETTE.length]; });
  return map;
}

// Hours the timeline shows for a day.
function viewRange(day) {
  let a = VIEW_START * 60, b = VIEW_END * 60;
  const w = workHours(day);
  if (w) { a = Math.min(a, toMin(w.start)); b = Math.max(b, toMin(w.end)); }
  scheduled(day).forEach((t) => { a = Math.min(a, toMin(t.start_time)); b = Math.max(b, toMin(t.start_time) + lengthOf(t)); });
  return [Math.floor(a / 60), Math.min(DAY_END, Math.ceil(b / 60))];
}

// How full the day is: work time against your hours, and time planned outside them.
export function load(day) {
  const w = workHours(day);
  const ws = w ? toMin(w.start) : 0, we = w ? toMin(w.end) : 0;
  let work = 0, outside = 0;
  dayTasks(day).forEach((t) => {
    if (t.start_time) {
      const s = toMin(t.start_time), e = s + lengthOf(t);
      const inside = w ? Math.max(0, Math.min(e, we) - Math.max(s, ws)) : 0;
      work += inside; outside += e - s - inside;
    } else if (!t.done) {
      if (w) work += t.estimate_minutes || 0; else outside += t.estimate_minutes || 0;
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
function layout(tasks) {
  const items = tasks.map((t) => ({ t, s: toMin(t.start_time), e: toMin(t.start_time) + lengthOf(t), col: 0, cols: 1 }));
  let cluster = [], end = -1;
  const close = () => { const n = Math.max(1, ...cluster.map((i) => i.col + 1)); cluster.forEach((i) => { i.cols = n; }); cluster = []; };
  items.forEach((it) => {
    if (it.s >= end) { close(); end = -1; }
    const used = new Set(cluster.filter((c) => c.e > it.s).map((c) => c.col));
    let c = 0; while (used.has(c)) c++;
    it.col = c; cluster.push(it); end = Math.max(end, it.e);
  });
  close();
  return items;
}

export function timeline(day) {
  const w = workHours(day);
  const [v0, v1] = viewRange(day);
  const colors = dayColors(day);
  const H = (v1 - v0) * PX;
  const y = (min) => ((min - v0 * 60) / 60) * PX;
  let hours = '';
  for (let h = v0; h < v1; h++) hours += `<div class="tl-hour" style="top:${(h - v0) * PX}px"><span>${String(h).padStart(2, '0')}:00</span></div>`;
  const band = w ? `<div class="tl-work" style="top:${y(toMin(w.start))}px;height:${y(toMin(w.end)) - y(toMin(w.start))}px"><span>Work ${w.start}–${w.end}</span></div>` : '';
  const now = day === today() && nowMin() > v0 * 60 && nowMin() < v1 * 60 ? `<div class="tl-now" style="top:${y(nowMin())}px"></div>` : '';
  const blocks = layout(scheduled(day)).map(({ t, s, e, col, cols }) => {
    const p = t.project_id ? rootOf(getProject(t.project_id)) : null;
    const short = e - s <= 30;
    return `<div class="tl-block tint-${colors[t.id]}${t.done ? ' done' : ''}${short ? ' short' : ''}" data-block="${t.id}"
        style="top:${y(s)}px;height:${y(e) - y(s) - 2}px;left:calc(${(col / cols) * 100}% + 2px);width:calc(${100 / cols}% - 4px)">
      <button type="button" class="check small-check" data-act="toggle-done" data-id="${t.id}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 10.5l3 3 6-7"/></svg></button>
      <span class="tl-text"><span class="tl-title">${p && emojiOf(p) ? `${esc(emojiOf(p))} ` : ''}${esc(t.title)}</span><span class="tl-time">${toTime(s)}–${toTime(e)}</span></span>
      <span class="tl-resize" data-resize="${t.id}" aria-hidden="true"></span>
    </div>`;
  }).join('');
  return `<div class="tl" data-day="${day}" data-start="${v0}" data-end="${v1}" style="height:${H}px">${hours}${band}${now}<div class="tl-lane">${blocks}</div></div>`;
}

export function tray(day) {
  const list = unscheduled(day);
  if (!list.length) return '';
  const colors = dayColors(day);
  return `<div class="tray">
    <div class="tray-head"><h2>No time yet</h2><span class="muted small">Drag onto the timeline, or open a task to pick a time</span></div>
    <ul class="tray-list">${list.map((t) => {
    const p = t.project_id ? rootOf(getProject(t.project_id)) : null;
    return `<li class="tray-item tint-${colors[t.id]}">
        <span class="grip" data-tray="${t.id}" aria-label="Drag to the timeline" title="Drag to the timeline">⋮⋮</span>
        <button type="button" class="tray-title" data-act="open-task" data-id="${t.id}">${p && emojiOf(p) ? `${esc(emojiOf(p))} ` : ''}${esc(t.title)}</button>
        <span class="muted small">${fmtMinutes(lengthOf(t))}</span>
      </li>`;
  }).join('')}</ul>
  </div>`;
}

// Put tasks without a time into the free half hours of your working day, in order.
export function fillDay(day) {
  const w = workHours(day);
  if (!w) return 0;
  let from = toMin(w.start);
  if (day === today()) from = Math.max(from, Math.ceil(nowMin() / SLOT) * SLOT);
  const end = toMin(w.end);
  const busy = scheduled(day).map((t) => [toMin(t.start_time), toMin(t.start_time) + lengthOf(t)]);
  let placed = 0;
  unscheduled(day).forEach((t) => {
    const len = lengthOf(t);
    for (let s = from; s + len <= end; s += SLOT) {
      if (busy.every(([a, b]) => s + len <= a || s >= b)) {
        update('tasks', t.id, { start_time: toTime(s), block_minutes: len });
        busy.push([s, s + len]);
        placed++;
        return;
      }
    }
  });
  return placed;
}

// ---- Planning screen

export function planView(ui) {
  const t = today();
  const w = workHours(t);
  const earlier = state.tasks.filter((x) => !x.done && x.planned_date && x.planned_date < t).sort((a, b) => a.planned_date.localeCompare(b.planned_date));
  const notPlanned = (x) => !x.done && (!x.planned_date || x.planned_date > t);
  const dueSoon = state.tasks.filter((x) => notPlanned(x) && x.deadline && x.deadline <= addDays(t, 7)).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const inbox = state.tasks.filter((x) => notPlanned(x) && !x.project_id && !dueSoon.includes(x)).sort(byOrder);
  const projects = topProjects().filter((p) => p.status === 'active').map((p) => {
    const ids = new Set([p.id, ...descendants(p.id).filter((id) => getProject(id)?.status !== 'done')]);
    return { p, tasks: state.tasks.filter((x) => ids.has(x.project_id) && notPlanned(x) && !dueSoon.includes(x)).sort(byOrder) };
  }).filter((g) => g.tasks.length);
  const pickRow = (x) => {
    const p = x.project_id ? rootOf(getProject(x.project_id)) : null;
    return `<li class="pick-row">
      <button type="button" class="pick-add" data-act="plan" data-id="${x.id}" data-when="today" aria-label="Add to today">+</button>
      <button type="button" class="pick-title" data-act="open-task" data-id="${x.id}">${x.priority ? '<span class="flag-dot" aria-label="Priority"></span>' : ''}${esc(x.title)}
        <span class="muted small">${[p ? `${emojiOf(p) ? `${emojiOf(p)} ` : ''}${p.name}` : '', x.deadline ? `Due ${niceDate(x.deadline)}` : '', x.planned_date ? `Planned ${niceDate(x.planned_date)}` : '', x.estimate_minutes ? fmtMinutes(x.estimate_minutes) : ''].filter(Boolean).map(esc).join(' · ')}</span></button>
    </li>`;
  };
  const hoursOpts = (sel) => Array.from({ length: (DAY_END - DAY_START) * 2 + 1 }, (_, i) => toTime(DAY_START * 60 + i * 30)).map((v) => `<option${v === sel ? ' selected' : ''}>${v}</option>`).join('');
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

    ${earlier.length ? `<section class="card">
      <div class="card-head"><h2>1 · Unfinished from earlier</h2><span class="muted small">${earlier.length} task${earlier.length === 1 ? '' : 's'}</span></div>
      <ul class="tasks">${earlier.map((x) => `<li class="task review-row">
        <div class="task-main"><span class="task-title">${esc(x.title)}</span><span class="task-meta"><span class="late">Planned ${esc(niceDate(x.planned_date))}</span></span></div>
        <div class="review-acts">
          <button type="button" class="chip" data-act="plan" data-id="${x.id}" data-when="today">Today</button>
          <button type="button" class="chip" data-act="plan" data-id="${x.id}" data-when="tomorrow">Tomorrow</button>
          <button type="button" class="chip" data-act="plan" data-id="${x.id}" data-when="none">No day</button>
        </div></li>`).join('')}</ul>
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>${earlier.length ? '2' : '1'} · Choose what today holds</h2></div>
      ${addTaskForm('plan', { planned: t, placeholder: 'Add a new task for today' })}
      ${dueSoon.length ? `<div class="pick-group"><h3>Deadlines in the next 7 days</h3><ul class="pick-list">${dueSoon.map(pickRow).join('')}</ul></div>` : ''}
      ${inbox.length ? `<details class="pick-group"${ui.planOpen?.inbox ? ' open' : ''} data-remember-plan="inbox"><summary><h3>Inbox</h3><span class="muted small">${inbox.length}</span></summary><ul class="pick-list">${inbox.map(pickRow).join('')}</ul></details>` : ''}
      ${projects.map((g) => `<details class="pick-group"${ui.planOpen?.[g.p.id] ? ' open' : ''} data-remember-plan="${g.p.id}"><summary><h3>${badge(g.p, 'tiny')} ${esc(g.p.name)}</h3><span class="muted small">${g.tasks.length}</span></summary><ul class="pick-list">${g.tasks.map(pickRow).join('')}</ul></details>`).join('')}
    </section>

    <section class="card">
      <div class="card-head"><h2>${earlier.length ? '3' : '2'} · Place it on the day</h2>${unscheduled(t).length && w ? '<button type="button" class="btn small" data-act="fill-day">Fill my working hours</button>' : ''}</div>
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

export function setupDrag(onOpenTask) {
  document.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    const resize = e.target.closest('[data-resize]');
    const block = e.target.closest('[data-block]');
    const grip = e.target.closest('[data-tray]');
    if (!resize && !grip && (!block || e.target.closest('button'))) return;
    const el = resize ? resize.closest('[data-block]') : block || grip.closest('.tray-item');
    const id = resize?.dataset.resize || block?.dataset.block || grip.dataset.tray;
    const r = el.getBoundingClientRect();
    drag = { mode: resize ? 'resize' : grip ? 'place' : 'move', id, el, x: e.clientX, y: e.clientY, grab: e.clientY - r.top, top: el.offsetTop, height: el.offsetHeight, moved: false, ghost: null };
    el.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) + Math.abs(e.clientX - drag.x) < 5) return;
    drag.moved = true;
    if (drag.mode === 'move') { drag.el.style.top = `${drag.top + Math.round(dy / (PX / 2)) * (PX / 2)}px`; drag.el.classList.add('dragging'); }
    if (drag.mode === 'resize') drag.el.style.height = `${Math.max(PX / 2 - 2, drag.height + Math.round(dy / (PX / 2)) * (PX / 2))}px`;
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

  const end = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    d.ghost?.remove();
    document.querySelector('.tl')?.classList.remove('drop-target');
    const t = getTask(d.id);
    if (!t) return;
    if (!d.moved) { if (d.mode === 'move') onOpenTask(d.id); return; }
    const tl = d.el.closest('.tl') || document.querySelector('.tl');
    if (!tl) return;
    if (d.mode === 'move') update('tasks', d.id, { start_time: toTime(slotAt(tl, e.clientY, d.grab)) });
    if (d.mode === 'resize') {
      const len = Math.max(SLOT, Math.round(((d.el.offsetHeight + 2) / PX) * 60 / SLOT) * SLOT);
      update('tasks', d.id, { block_minutes: len });
    }
    if (d.mode === 'place' && isOver(tl, e)) update('tasks', d.id, { start_time: toTime(slotAt(tl, e.clientY, 10)), block_minutes: lengthOf(t), planned_date: tl.dataset.day });
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', () => { if (drag) { drag.ghost?.remove(); drag = null; } });
}

function isOver(el, e) {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

export { tasksIn };
