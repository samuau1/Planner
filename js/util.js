// Small helpers shared by the whole app.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);

export function niceDate(s) {
  if (!s) return '';
  const t = today();
  if (s === t) return 'Today';
  if (s === addDays(t, 1)) return 'Tomorrow';
  if (s === addDays(t, -1)) return 'Yesterday';
  const d = parseISO(s);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-GB', opts);
}

export const longDate = (s) => parseISO(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export function fmtMinutes(m) {
  if (!m) return '';
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export const fmtNum = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
}));

// Next date for a repeating task.
export function nextRepeat(from, rule) {
  if (rule === 'daily') return addDays(from, 1);
  if (rule === 'weekly') return addDays(from, 7);
  if (rule === 'weekdays') {
    let d = addDays(from, 1);
    while ([0, 6].includes(parseISO(d).getDay())) d = addDays(d, 1);
    return d;
  }
  if (rule === 'monthly') {
    const d = parseISO(from), day = d.getDate();
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, last));
    return iso(next);
  }
  return null;
}

export const REPEAT_LABELS = { daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', monthly: 'Every month' };
export const ESTIMATES = [15, 30, 45, 60, 90, 120, 180, 240];

// "31 Mar" this year, "31 Mar 2027" otherwise.
export function shortDate(s) {
  if (!s) return '';
  const d = parseISO(s);
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-GB', opts);
}
