// The dissertation word counter: chapter counts, daily log, monthly plan, forecast,
// streak, heatmap and milestones. Brought over from the first tracker with the same rules.
import { state, wcChapters, wcTotal, wcCounted, wcSaveChapter, wcSaveEntry, wcDeleteEntry, wcSaveSettings } from './store.js';
import { esc, today, parseISO, iso, addDays } from './util.js';

const WPP = 375; // words per printed book page in a Swedish monograph
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DEFAULT_START = '2026-10-26';
const DEFAULT_PLAN = [
  ['2026-11', 3000, 'Article + cutting old text'], ['2026-12', 3000, 'Article + holidays'], ['2027-01', 9000, 'Full writing month'],
  ['2027-02', 4500, 'Book editing'], ['2027-03', 2500, 'Several weeks of travel'], ['2027-04', 9000, 'Full writing month'],
  ['2027-05', 7000, 'One week of travel'], ['2027-06', 7000, 'One week of travel, midsummer'], ['2027-07', 2000, 'Vacation'],
  ['2027-08', 9000, 'Full writing month'], ['2027-09', 9500, 'Full writing month'], ['2027-10', 9500, 'Full writing month'],
  ['2027-11', 5000, 'Introduction, conclusion, gaps'],
].map(([key, target, note]) => ({ key, target, note }));

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const sgn = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const dim = (y, m) => new Date(y, m, 0).getDate();

function cfg() {
  const s = state.wc.settings || {};
  const plan = Array.isArray(s.plan) && s.plan.length ? s.plan : DEFAULT_PLAN;
  const [ly, lm] = plan[plan.length - 1].key.split('-').map(Number);
  return {
    baseline: Number(s.baseline) || 0, goal: Number(s.goal) || 90000, plan,
    start: s.start_date || DEFAULT_START, end: iso(new Date(ly, lm - 1, dim(ly, lm))),
    off: Array.isArray(s.off_days) ? s.off_days : [0, 3, 6],
  };
}

const entries = () => state.wc.entries;
const entryOn = (day) => entries().find((e) => e.day === day);
const sumWords = (pred) => entries().reduce((a, e) => a + (!pred || pred(e.day) ? Number(e.words) || 0 : 0), 0);
const isWritingDay = (d, c) => !c.off.includes(d.getDay());

function monthKeyFor(day, c) { return day < `${c.plan[0].key}-01` ? c.plan[0].key : day.slice(0, 7); }

function scaledPlan(c) {
  const need = Math.max(0, c.goal - c.baseline), sum = c.plan.reduce((a, m) => a + m.target, 0) || 1;
  let acc = 0;
  return c.plan.map((m, i) => {
    let t = Math.round((m.target * need) / sum / 100) * 100;
    if (i === c.plan.length - 1) t = need - acc;
    acc += t;
    return { ...m, target: t };
  });
}

function planAt(d, c) {
  let acc = c.baseline;
  for (const m of scaledPlan(c)) {
    const [y, mo] = m.key.split('-').map(Number);
    const first = new Date(y, mo - 1, 1), n = dim(y, mo), last = new Date(y, mo - 1, n);
    if (d < first) return acc;
    if (d >= last) { acc += m.target; continue; }
    return acc + m.target * (d.getDate() / n);
  }
  return acc;
}

function dailyPlan(d, c) {
  const sp = scaledPlan(c), k = iso(d).slice(0, 7), m = sp.find((x) => x.key === k);
  if (m) { const [y, mo] = k.split('-').map(Number); return m.target / dim(y, mo); }
  if (k > sp[sp.length - 1].key) return Math.max(1, (c.goal - c.baseline) / Math.max(1, (parseISO(c.end) - parseISO(`${sp[0].key}-01`)) / 864e5));
  return 0;
}

export function streaks(c = cfg()) {
  const set = new Set(entries().map((e) => e.day));
  const days = [...set].sort();
  let best = 0, run = 0;
  if (days.length) {
    const end = parseISO(today());
    for (let d = parseISO(days[0]); d <= end; d = parseISO(addDays(iso(d), 1))) {
      const k = iso(d);
      if (set.has(k)) run++; else if (isWritingDay(d, c) && k !== iso(end)) run = 0;
      best = Math.max(best, run);
    }
  }
  return { cur: run, best };
}

// Plan-aware forecast: how you write against the plan over the last 8 weeks,
// assumed to continue through the remaining months, light months included.
function forecast(c, tot) {
  const t = parseISO(today()), remaining = c.goal - tot;
  if (remaining <= 0) return { date: 'Done!', chip: '<span class="chip-s good">Goal reached</span>', basis: 'Time for the final seminar.' };
  const planStart = parseISO(`${c.plan[0].key}-01`);
  const from = new Date(Math.max(planStart, parseISO(addDays(today(), -55))));
  let planned = 0;
  for (let d = new Date(from); d <= t; d = parseISO(addDays(iso(d), 1))) planned += dailyPlan(d, c);
  const actual = sumWords((k) => k >= iso(from) && k <= today());
  let r = 1, basis;
  if (planned < 1000) basis = 'Too early to compare your pace with the plan, so this assumes you keep to the plan from here. Words written before the plan started count as a head start.';
  else {
    r = actual / planned;
    const wk = Math.max(1, Math.round((t - from) / 864e5 / 7));
    basis = `Over the last ${wk} week${wk === 1 ? '' : 's'} you wrote ${Math.round(r * 100)}% of what the plan asked for. This assumes you keep that rate, with lighter months for travel and editing.`;
  }
  if (r <= 0.02) return { date: 'Not yet known', chip: '', basis: 'Hardly any net words in recent weeks, so there’s no pace to project yet.' };
  r = Math.min(r, 5);
  let acc = tot, finish = null;
  for (let d = parseISO(addDays(today(), 1)), i = 0; i < 3650; d = parseISO(addDays(iso(d), 1)), i++) { acc += r * dailyPlan(d, c); if (acc >= c.goal) { finish = d; break; } }
  if (!finish) return { date: 'Beyond 2036', chip: '<span class="chip-s warn">Pace too slow to forecast</span>', basis };
  const gap = Math.round((parseISO(c.end) - finish) / 864e5);
  const span = Math.abs(gap) >= 60 ? `${Math.round(Math.abs(gap) / 30.4)} months` : Math.abs(gap) >= 14 ? `${Math.round(Math.abs(gap) / 7)} weeks` : `${Math.abs(gap)} days`;
  return {
    date: finish.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    chip: gap >= 0 ? `<span class="chip-s good">${span} before the deadline</span>` : `<span class="chip-s warn">${span} after the deadline</span>`,
    basis,
  };
}

// ---- Drawing

let drafts = {};

function chaptersHTML() {
  const list = wcChapters(), tot = Math.max(1, wcTotal());
  if (!list.length) return '<p class="empty">No chapters yet. Add your first chapter in the settings below.</p>';
  return list.map((ch) => {
    const v = drafts[ch.id] != null ? drafts[ch.id] : ch.words;
    const trimming = ch.trim_to != null && ch.words > ch.trim_to;
    const share = (wcCounted(ch) / tot) * 100;
    return `<div class="ch">
      <div class="ch-name">${esc(ch.name)}${trimming ? `<span class="trim">trimming to ${fmt(ch.trim_to)}</span>` : ''}
        <small>${trimming ? `counts as ${fmt(ch.trim_to)} until the draft is below that` : `${share.toFixed(0)}% of the draft`}</small></div>
      <div class="ch-count"><span class="delta" id="wcd-${ch.id}"></span><input type="number" inputmode="numeric" min="0" step="1" id="wc-${ch.id}" data-wc-chapter="${ch.id}" value="${v}" aria-label="Word count for ${esc(ch.name)}"></div>
      <div class="ch-bar"><span style="width:${share}%"></span></div>
    </div>`;
  }).join('');
}

function pending() {
  const out = [];
  wcChapters().forEach((c) => {
    const raw = drafts[c.id];
    if (raw == null || raw === '') return;
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 0 || n === c.words) return;
    const next = { ...c, words: n };
    const endsTrim = c.trim_to != null && n <= c.trim_to;
    if (endsTrim) next.trim_to = null;
    out.push({ c, n, delta: wcCounted(next) - wcCounted(c), endsTrim });
  });
  return out;
}

export function updateWritingInputs() {
  const p = pending();
  wcChapters().forEach((c) => {
    const el = document.getElementById(`wcd-${c.id}`);
    if (!el) return;
    const x = p.find((q) => q.c.id === c.id);
    el.textContent = x ? sgn(x.delta) : '';
    el.className = `delta${x ? (x.delta > 0 ? ' pos' : x.delta < 0 ? ' neg' : '') : ''}`;
  });
  const btn = document.getElementById('wc-save');
  if (btn) { btn.disabled = !p.length; btn.textContent = p.length > 1 ? `Save ${p.length} chapters` : 'Save counts'; }
}

export function setDraft(id, value) { drafts[id] = value; updateWritingInputs(); }

export function saveCounts(day, note) {
  const changes = pending();
  if (!changes.length) return null;
  const prev = entryOn(day) || { day, words: 0, chapters: {}, note: '' };
  const byCh = { ...(prev.chapters || {}) };
  let add = 0;
  changes.forEach((p) => {
    wcSaveChapter({ id: p.c.id, name: p.c.name, ord: p.c.ord, words: p.n, trim_to: p.endsTrim ? null : p.c.trim_to ?? null, trimmed: p.c.trimmed || p.endsTrim });
    byCh[p.c.id] = (byCh[p.c.id] || 0) + p.delta;
    add += p.delta;
  });
  wcSaveEntry({ day, words: (Number(prev.words) || 0) + add, chapters: byCh, note: [prev.note, note].filter(Boolean).join(' · ').slice(0, 300) });
  drafts = {};
  const ended = changes.filter((p) => p.endsTrim).map((p) => p.c.name);
  return `Saved. ${sgn(add)} words logged for ${parseISO(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.${ended.length ? ` Trimming finished for ${ended.join(', ')}: new words there now count.` : ''}`;
}

export const deleteDay = (day) => wcDeleteEntry(day);
export function addChapter(name) {
  const ord = Math.max(0, ...state.wc.chapters.map((c) => c.ord || 0)) + 1;
  wcSaveChapter({ id: `ch${Date.now().toString(36)}`, name, ord, words: 0, trim_to: null, trimmed: false });
}
export function saveWritingSettings(baseline, goal, offDays) {
  const s = state.wc.settings || {};
  wcSaveSettings({ baseline, goal, off_days: offDays, plan: s.plan || DEFAULT_PLAN, start_date: s.start_date || DEFAULT_START });
}

function ring(p) {
  const r = 40, c = 2 * Math.PI * r;
  return `<svg class="ring" width="96" height="96" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="${r}" class="ring-bg"/><circle cx="48" cy="48" r="${r}" class="ring-fg" stroke-dasharray="${c * p} ${c}" transform="rotate(-90 48 48)"/><text x="48" y="54" text-anchor="middle">${Math.round(p * 100)}%</text></svg>`;
}

function heat(c) {
  const t = parseISO(today());
  const end = parseISO(addDays(today(), 6 - ((t.getDay() + 6) % 7)));
  const start = parseISO(addDays(iso(end), -16 * 7 + 1));
  let h = '';
  for (let d = new Date(start); d <= end; d = parseISO(addDays(iso(d), 1))) {
    const k = iso(d), e = entryOn(k), w = Number(e?.words) || 0;
    let cls = d > t ? 'future' : !e ? (isWritingDay(d, c) ? '' : 'off') : w < 250 ? 'l1' : w < 600 ? 'l2' : 'l3';
    if (k === today()) cls += ' today';
    h += `<i class="${cls}" title="${k}: ${e ? `${sgn(w)} words` : isWritingDay(d, c) ? 'no update' : 'day off'}"></i>`;
  }
  return h;
}

function chart(c) {
  const W = 760, H = 270, L = 52, R = 16, T = 14, B = 32;
  const x0 = parseISO(c.start), x1 = parseISO(c.end), span = x1 - x0, goal = c.goal, t = parseISO(today());
  const X = (d) => L + ((d - x0) / span) * (W - L - R);
  const Y = (v) => T + (1 - Math.max(0, Math.min(goal, v)) / goal) * (H - T - B);
  let g = '';
  for (let v = 0; v <= goal; v += goal / 3) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" class="axis">${fmt(v / 1000)}k</text>`;
  const months = [];
  for (let d = new Date(x0.getFullYear(), x0.getMonth() + 1, 1); d <= x1; d.setMonth(d.getMonth() + 2)) months.push(new Date(d));
  months.forEach((d) => { g += `<text x="${X(d)}" y="${H - 10}" text-anchor="middle" class="axis">${MONTHS[d.getMonth()].slice(0, 3)} ’${String(d.getFullYear()).slice(2)}</text>`; });
  let pp = '';
  for (let d = new Date(x0); d <= x1; d = parseISO(addDays(iso(d), 3))) pp += `${pp ? 'L' : 'M'}${X(d).toFixed(1)},${Y(planAt(d, c)).toFixed(1)}`;
  g += `<path d="${pp}" class="pace"/>`;
  let run = wcTotal() - sumWords() + sumWords((k) => k < c.start);
  let ap = `M${X(x0)},${Y(run)}`;
  for (let d = new Date(x0); d <= t && d <= x1; d = parseISO(addDays(iso(d), 1))) {
    const e = entryOn(iso(d)); if (e) run += Number(e.words) || 0;
    ap += `L${X(d).toFixed(1)},${Y(run).toFixed(1)}`;
  }
  const tx = X(t <= x1 ? t : x1);
  g += `<path d="${ap}L${tx.toFixed(1)},${H - B}L${X(x0)},${H - B}Z" class="area"/><path d="${ap}" class="line"/>`;
  g += `<line x1="${tx}" x2="${tx}" y1="${T}" y2="${H - B}" class="today"/><circle cx="${tx}" cy="${Y(run)}" r="5" class="dot"/>`;
  const right = tx > W - 140;
  g += `<text x="${right ? tx - 10 : tx + 10}" y="${Math.max(T + 12, Y(run) - 10)}" text-anchor="${right ? 'end' : 'start'}" class="label">${fmt(run)}</text>`;
  return `<svg class="chart tint-sky" viewBox="0 0 ${W} ${H}" role="img" aria-label="Total words against the planned path">${g}</svg>`;
}

const BADGES = [
  { name: 'First entry', desc: 'Log your first update', test: () => entries().length > 0 },
  { name: 'A thousand in a day', desc: '1,000+ net words in one day', test: () => entries().some((e) => (e.words || 0) >= 1000) },
  { name: 'Five-day run', desc: '5 writing days in a row', test: () => streaks().best >= 5 },
  { name: 'Fifteen-day run', desc: '15 writing days in a row', test: () => streaks().best >= 15 },
  { name: 'Trim done', desc: 'Finish trimming a chapter', test: () => state.wc.chapters.some((c) => c.trimmed) },
  { name: 'Month kept', desc: 'Hit a full monthly target', test: (c) => scaledPlan(c).some((m) => m.target > 0 && sumWords((k) => monthKeyFor(k, c) === m.key) >= m.target) },
  { name: 'Hundred pages', desc: '37,500 words in the draft', test: () => wcTotal() >= 37500 },
  { name: 'Halfway', desc: 'Half of the full-draft goal', test: (c) => wcTotal() >= c.goal / 2 },
  { name: 'Two hundred pages', desc: '75,000 words in the draft', test: () => wcTotal() >= 75000 },
  { name: 'Full draft', desc: 'Goal reached. Time for the final seminar', test: (c) => wcTotal() >= c.goal },
];
export const earnedBadges = () => { const c = cfg(); return BADGES.filter((b) => b.test(c)).map((b) => b.name); };
const star = (got) => `<svg viewBox="0 0 34 34" aria-hidden="true"><path d="M17 3l3.6 7.3 8 1.2-5.8 5.6 1.4 8L17 21.3 9.8 25.1l1.4-8-5.8-5.6 8-1.2z" class="${got ? 'got' : ''}"/></svg>`;

export function writingView(ui) {
  const c = cfg(), tot = wcTotal(), t = parseISO(today()), tk = today();
  const plan = planAt(t, c), diff = tot - plan;
  const pct = Math.min(100, (tot / c.goal) * 100), ppct = Math.min(100, (plan / c.goal) * 100);
  const s = streaks(c);
  const mon = addDays(tk, -((t.getDay() + 6) % 7));
  const fc = forecast(c, tot);
  const sp = scaledPlan(c);
  const key = monthKeyFor(tk, c);
  const m = sp.find((x) => x.key === key) || sp[sp.length - 1];
  const [my, mm] = m.key.split('-').map(Number);
  const written = sumWords((k) => monthKeyFor(k, c) === m.key);
  let left = 0;
  const mStart = t > new Date(my, mm - 1, 1) ? t : new Date(my, mm - 1, 1);
  for (let d = new Date(mStart); d <= new Date(my, mm - 1, dim(my, mm)); d = parseISO(addDays(iso(d), 1))) if (isWritingDay(d, c)) left++;
  const todayW = Number(entryOn(tk)?.words) || 0, remaining = Math.max(0, m.target - written);
  const perDay = Math.ceil((remaining + Math.max(0, todayW)) / Math.max(1, left) / 10) * 10;
  const offNames = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const offText = c.off.length ? `${c.off.map((d) => offNames[d]).join(', ').replace(/, ([^,]*)$/, ' and $1')} don't break it` : 'every day counts';
  const earned = new Set(earnedBadges());
  const recent = [...entries()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 30);
  const noData = !state.wc.chapters.length && !entries().length;

  return `<header class="page-head">
      <p class="eyebrow">Dissertation · full draft by ${parseISO(c.end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      <h1>Word counter</h1>
    </header>
    ${noData ? '<section class="notice">Your word counter is empty. Import the file with your counter data in Settings, or add chapters below.</section>' : ''}
    <section class="wc-hero">
      <div class="total-line"><span class="total">${fmt(tot)}</span><span class="total-of">of ${fmt(c.goal)} words · about ${fmt(tot / WPP)} book pages</span></div>
      <div class="wc-bar" aria-hidden="true"><span style="width:${pct}%"></span><i style="left:${ppct}%"></i></div>
      <p class="muted small">${pct.toFixed(1)}% of the full draft. The tick marks where the plan puts you today (${fmt(plan)}).</p>
      <div class="forecast tint-lavender">
        <div class="eyebrow">If you keep this pace, the full draft is done on</div>
        <div class="fc-date">${esc(fc.date)}</div>
        <div class="fc-side">${fc.chip}<small>${esc(fc.basis)}</small></div>
      </div>
      <div class="facts">
        <div class="fact tint-peach"><small>Writing-day streak</small><b>${s.cur} ${s.cur === 1 ? 'day' : 'days'}</b><small>best ${s.best} · ${offText}</small></div>
        <div class="fact tint-sky"><small>This week</small><b>${sgn(sumWords((k) => k >= mon && k <= tk))}</b><small>net words</small></div>
        <div class="fact tint-${diff >= 0 ? 'mint' : 'rose'}"><small>vs. plan today</small><b>${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))}</b><small>${diff >= 0 ? 'words ahead' : 'words behind'}</small></div>
        <div class="fact tint-butter"><small>Days to deadline</small><b>${fmt(Math.max(0, Math.round((parseISO(c.end) - t) / 864e5)))}</b><small>until ${parseISO(c.end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>
      </div>
    </section>

    <div class="wc-two">
      <section class="card">
        <div class="card-head"><h2>Chapters</h2></div>
        <p class="muted small">Type a chapter's new word count from your document. The difference is logged as the day's writing.</p>
        <div class="chapters">${chaptersHTML()}</div>
        <form class="log-foot" data-form="wc-save">
          <label>Log for<input type="date" id="wc-date" value="${esc(ui.wcDate || tk)}"></label>
          <label class="grow">Note (optional)<input type="text" id="wc-note" maxlength="140" placeholder="e.g. section on ritual"></label>
          <button class="btn primary" type="submit" id="wc-save" disabled>Save counts</button>
        </form>
        ${ui.wcMsg ? `<p class="small wc-msg" role="status">${esc(ui.wcMsg)}</p>` : ''}
      </section>
      <section class="card">
        <div class="card-head"><h2>${MONTHS[mm - 1]} ${my}</h2></div>
        <div class="month-head">${ring(Math.max(0, Math.min(1, m.target ? written / m.target : 0)))}
          <div><div><b class="num">${sgn(written)}</b> <span class="muted">of</span> <b class="num">${fmt(m.target)}</b> <span class="muted">words</span></div>
          <div class="muted small">${esc(m.note)}</div><div class="muted small">${left} writing day${left === 1 ? '' : 's'} left</div></div>
        </div>
        <p class="today-need">${remaining === 0 ? '<b>Month target reached.</b> Anything more goes into your buffer for the autumn.' : todayW !== 0 ? `Today: <b>${sgn(todayW)}</b> words logged. To finish the month on target, aim for about <b>${fmt(perDay)}</b> per writing day.` : `To reach this month's target, aim for about <b>${fmt(perDay)}</b> new words per writing day.`}</p>
        <div class="eyebrow">Last 16 weeks</div>
        <div class="heat" aria-label="Writing calendar">${heat(c)}</div>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h2>Progress against the plan</h2><span class="muted small chart-key"><span class="key-line"></span>Your total <span class="key-pace"></span>Planned path</span></div>
      <div class="chart-scroll">${chart(c)}</div>
    </section>

    <section class="block">
      <div class="block-head"><h2>Milestones</h2></div>
      <div class="badges">${BADGES.map((b) => `<div class="badge${earned.has(b.name) ? ' got' : ''}">${star(earned.has(b.name))}<div><strong>${b.name}</strong><small>${b.desc}</small></div></div>`).join('')}</div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Monthly plan</h2></div>
      <p class="muted small">Targets are net new words. Changing the starting point or goal in the settings below rescales them.</p>
      <div class="tbl"><table>
        <thead><tr><th>Month</th><th>What else is going on</th><th class="r">Target</th><th class="r">Written</th><th class="r">Status</th></tr></thead>
        <tbody>${sp.map((x) => {
    const [y, mo] = x.key.split('-').map(Number);
    const w = sumWords((k) => monthKeyFor(k, c) === x.key);
    let chip;
    if (x.key < key) chip = w >= x.target ? '<span class="chip-s good">Target met</span>' : '<span class="chip-s warn">Short</span>';
    else if (x.key === key) { const frac = tk.slice(0, 7) === x.key ? t.getDate() / dim(y, mo) : 0; chip = w >= x.target ? '<span class="chip-s good">Target met</span>' : w >= x.target * frac * 0.9 ? '<span class="chip-s good">On track</span>' : '<span class="chip-s warn">Behind</span>'; }
    else chip = '<span class="chip-s">Upcoming</span>';
    return `<tr class="${x.key === key ? 'current' : ''}"><td>${MONTHS[mo - 1].slice(0, 3)} ${y}</td><td class="muted">${esc(x.note)}</td><td class="r num">${fmt(x.target)}</td><td class="r num">${x.key > key ? '–' : sgn(w)}</td><td class="r">${chip}</td></tr>`;
  }).join('')}</tbody>
      </table></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Daily log</h2></div>
      <p class="muted small">Worked out from your chapter updates. Deleting a day removes it from the history and streak; chapter totals stay as they are.</p>
      <div class="tbl"><table>
        <thead><tr><th>Date</th><th class="r">Net words</th><th>Chapters</th><th class="r"></th></tr></thead>
        <tbody>${recent.length ? recent.map((e) => {
    const parts = Object.entries(e.chapters || {}).map(([id, v]) => `${esc(state.wc.chapters.find((x) => x.id === id)?.name || id)} ${sgn(v)}`);
    return `<tr><td class="num">${parseISO(e.day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</td><td class="r num">${sgn(e.words || 0)}</td><td>${parts.join(', ')}${e.note ? ` <span class="muted">· ${esc(e.note)}</span>` : ''}</td>
      <td class="r"><button type="button" class="btn small ghost danger" data-act="wc-delete" data-id="${e.day}">${ui.wcConfirm === e.day ? 'Confirm' : 'Delete'}</button></td></tr>`;
  }).join('') : '<tr><td colspan="4" class="empty">No updates yet.</td></tr>'}</tbody>
      </table></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Counter settings</h2></div>
      <form class="settings-row" data-form="wc-settings">
        <label>Plan starting point (words on ${parseISO(c.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})<input type="number" id="wc-base" value="${c.baseline}" min="0" step="1"></label>
        <label>Goal for the full draft<input type="number" id="wc-goal" value="${c.goal}" min="1000" step="1000"></label>
        <fieldset class="days"><legend>Days that never break the streak</legend>
          ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n, i) => { const d = (i + 1) % 7; return `<label class="day"><input type="checkbox" value="${d}" class="wc-off"${c.off.includes(d) ? ' checked' : ''}>${n}</label>`; }).join('')}
        </fieldset>
        <button class="btn" type="submit">Save settings</button>
      </form>
      <form class="add-task" data-form="wc-add-chapter"><span class="add-icon">+</span><input type="text" id="wc-new-chapter" placeholder="Add a chapter" aria-label="Add a chapter" autocomplete="off"></form>
    </section>`;
}
