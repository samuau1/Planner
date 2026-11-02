// Progress graphs and the roadmap timeline, drawn as SVG.
import { state, children, descendants, wcTotal } from './store.js';
import { esc, today, parseISO, iso, addDays } from './util.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const t = (s) => parseISO(s).getTime();

// The history of a project's progress: points of {day, value}, the target, and where it started.
export function progressSeries(p) {
  const start = p.start_date || (p.created_at || '').slice(0, 10) || today();
  const type = p.progress_type;
  let points = [], target = null, unit = '';
  const cumulative = (days) => {
    const sorted = days.filter(Boolean).sort();
    let n = 0;
    return sorted.map((d) => ({ day: d, value: ++n }));
  };
  if (type === 'subgoals') {
    const subs = descendants(p.id).map((id) => state.projects.find((x) => x.id === id));
    target = subs.length;
    points = cumulative(subs.filter((s) => s.status === 'done').map((s) => (s.completed_at || '').slice(0, 10) || today()));
    unit = 'subgoals';
  } else if (type === 'number' || type === 'percent') {
    points = state.progress_log.filter((l) => l.project_id === p.id).sort((a, b) => a.day.localeCompare(b.day)).map((l) => ({ day: l.day, value: Number(l.value) }));
    const now = Number(p.progress_value) || 0;
    if (!points.length || points[points.length - 1].value !== now) points.push({ day: today(), value: now });
    target = type === 'percent' ? 100 : Number(p.progress_target) || null;
    unit = type === 'percent' ? '%' : p.progress_unit;
  } else if (type === 'words') {
    const entries = [...state.wc.entries].sort((a, b) => a.day.localeCompare(b.day));
    let run = wcTotal() - entries.reduce((a, e) => a + (Number(e.words) || 0), 0);
    points = [{ day: state.wc.settings?.start_date || entries[0]?.day || start, value: run }];
    entries.forEach((e) => { run += Number(e.words) || 0; points.push({ day: e.day, value: run }); });
    target = state.wc.settings?.goal || null;
    unit = 'words';
  } else {
    const ids = new Set([p.id, ...descendants(p.id)]);
    const tasks = state.tasks.filter((x) => ids.has(x.project_id));
    target = tasks.length;
    points = cumulative(tasks.filter((x) => x.done).map((x) => (x.done_at || '').slice(0, 10) || today()));
    unit = 'tasks';
  }
  const first = points[0];
  const startValue = type === 'words' || (type === 'number' && first && first.day <= start) ? first?.value ?? 0 : 0;
  return { start: first && first.day < start ? first.day : start, startValue, points, target, unit, deadline: p.deadline };
}

function monthTicks(x0, x1) {
  const ticks = [];
  const d = new Date(x0); d.setDate(1); d.setMonth(d.getMonth() + 1);
  const span = (x1 - x0) / 864e5;
  const step = span > 900 ? 6 : span > 420 ? 4 : span > 200 ? 2 : 1;
  while (d.getTime() <= x1) {
    if (d.getMonth() % step === 0) ticks.push(new Date(d));
    d.setMonth(d.getMonth() + 1);
  }
  return ticks;
}

const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : String(Math.round(n * 10) / 10));

// A line graph of progress over time, with the even pace to the deadline as a dashed line.
export function progressChart(p, color = 'sage') {
  const s = progressSeries(p);
  const W = 440, H = 200, L = 38, R = 12, T = 12, B = 26;
  const now = today();
  const x0 = t(s.start), x1 = Math.max(t(s.deadline || now), t(now), x0 + 30 * 864e5);
  const maxV = Math.max(s.target || 0, ...s.points.map((q) => q.value), 1);
  const X = (d) => L + (t(d) - x0) / (x1 - x0) * (W - L - R);
  const Y = (v) => T + (1 - v / maxV) * (H - T - B);
  let g = '';
  [0, 0.5, 1].forEach((f) => {
    const v = maxV * f;
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" class="axis">${fmt(v)}</text>`;
  });
  monthTicks(x0, x1).forEach((d) => {
    const x = L + (d.getTime() - x0) / (x1 - x0) * (W - L - R);
    g += `<text x="${x}" y="${H - 6}" text-anchor="middle" class="axis">${MONTHS[d.getMonth()]} ’${String(d.getFullYear()).slice(2)}</text>`;
  });
  if (s.target && s.deadline) g += `<line x1="${X(s.start)}" y1="${Y(s.startValue)}" x2="${X(s.deadline)}" y2="${Y(s.target)}" class="pace"/>`;
  // Actual progress as steps: flat until the day something was done.
  let v = s.startValue, d = `M${X(s.start)},${Y(v)}`;
  s.points.forEach((q) => { if (q.day < s.start) return; d += `H${X(q.day).toFixed(1)}V${Y(q.value).toFixed(1)}`; v = q.value; });
  d += `H${X(now).toFixed(1)}`;
  g += `<path d="${d}V${Y(0)}H${X(s.start)}Z" class="area"/><path d="${d}" class="line"/>`;
  g += `<line x1="${X(now)}" x2="${X(now)}" y1="${T}" y2="${H - B}" class="today"/><circle cx="${X(now)}" cy="${Y(v)}" r="5" class="dot"/>`;
  return `<svg class="chart tint-${color}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress over time">${g}</svg>`;
}

// A timeline of a project's subgoals by month: a bar from start date to deadline.
export function roadmapTimeline(p, colorOf, emojiOf) {
  const rows = [];
  const walk = (id, depth) => children(id).forEach((c) => { rows.push({ p: c, depth }); if (depth < 1) walk(c.id, depth + 1); });
  walk(p.id, 0);
  if (!rows.length) return '<p class="empty">Add subgoals with start dates and deadlines to see them on the roadmap.</p>';
  const days = [p.start_date, p.deadline, today(), ...rows.flatMap((r) => [r.p.start_date, r.p.deadline])].filter(Boolean).sort();
  const x0d = new Date(t(days[0])); x0d.setDate(1);
  const x1d = new Date(t(days[days.length - 1])); x1d.setMonth(x1d.getMonth() + 1, 1);
  const x0 = x0d.getTime(), x1 = x1d.getTime();
  const NAME = 210, W = 760, RH = 34, TOP = 30;
  const X = (d) => NAME + (t(d) - x0) / (x1 - x0) * (W - NAME - 12);
  const H = TOP + rows.length * RH + 10;
  let g = '';
  const months = [];
  for (let d = new Date(x0); d.getTime() < x1; d.setMonth(d.getMonth() + 1)) months.push(new Date(d));
  const every = months.length > 18 ? 3 : months.length > 9 ? 2 : 1;
  months.forEach((m, i) => {
    const x = X(iso(m));
    g += `<line x1="${x}" x2="${x}" y1="${TOP - 6}" y2="${H - 6}" class="grid"/>`;
    if (i % every === 0) g += `<text x="${x + 4}" y="${TOP - 12}" class="axis">${MONTHS[m.getMonth()]}${m.getMonth() === 0 || i === 0 ? ` ’${String(m.getFullYear()).slice(2)}` : ''}</text>`;
  });
  rows.forEach((r, i) => {
    const y = TOP + i * RH + RH / 2;
    const c = colorOf(r.p);
    const name = `${emojiOf(r.p) ? `${emojiOf(r.p)} ` : ''}${r.p.name}`;
    const short = name.length > 30 - r.depth * 3 ? `${name.slice(0, 28 - r.depth * 3)}…` : name;
    g += `<a href="#/project/${r.p.id}"><text x="${8 + r.depth * 14}" y="${y + 4}" class="row-name${r.p.status === 'done' ? ' done' : ''}${r.depth ? ' sub' : ''}">${esc(short)}</text></a>`;
    const s = r.p.start_date, e = r.p.deadline;
    if (s && e) g += `<rect x="${X(s)}" y="${y - 8}" width="${Math.max(6, X(addDays(e, 1)) - X(s))}" height="16" rx="8" class="bar tint-${c}${r.p.status === 'done' ? ' done' : ''}"><title>${esc(r.p.name)}</title></rect>`;
    else if (s) g += `<rect x="${X(s)}" y="${y - 8}" width="${Math.max(6, X(today()) - X(s))}" height="16" rx="8" class="bar open tint-${c}"><title>${esc(r.p.name)}: no deadline</title></rect>`;
    else if (e) g += `<path d="M${X(e)} ${y - 7}l7 7-7 7-7-7z" class="milestone tint-${c}"><title>${esc(r.p.name)}</title></path>`;
  });
  g += `<line x1="${X(today())}" x2="${X(today())}" y1="${TOP - 6}" y2="${H - 6}" class="today"/>`;
  return `<div class="chart-scroll"><svg class="timeline" viewBox="0 0 ${W} ${H}" role="img" aria-label="Roadmap of subgoals by month">${g}</svg></div>`;
}
