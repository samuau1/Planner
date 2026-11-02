// Colours and emojis for projects.
import { getProject } from './store.js';
import { esc, today, daysBetween } from './util.js';

export const PALETTE = ['sage', 'sky', 'lavender', 'rose', 'peach', 'butter', 'mint', 'sand'];
export const COLOR_NAMES = { sage: 'Sage', sky: 'Sky', lavender: 'Lavender', rose: 'Rose', peach: 'Peach', butter: 'Butter', mint: 'Mint', sand: 'Sand' };

export const EMOJIS = [
  '📖', '✍️', '📚', '📝', '🎓', '🔬', '📊', '📈', '🗂️', '💡', '🧠', '🗣️',
  '📰', '📮', '💻', '🌐', '🏛️', '⛪', '🕊️', '🌱', '🌿', '🌸', '☀️', '🌙',
  '🏡', '👶', '🧸', '❤️', '👨‍👩‍👧', '🐶', '💳', '🧾', '💰', '✈️', '🧳', '🚗',
  '🏃', '🧘', '🍎', '🎨', '🎵', '🧹', '🛠️', '📦', '🗓️', '⭐', '🎯', '✅',
];

const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// A project's colour: its own, else its parent's, else a steady pick from its id.
export function colorOf(p) {
  if (!p) return 'sage';
  if (p.color && PALETTE.includes(p.color)) return p.color;
  if (p.parent_id) { const parent = getProject(p.parent_id); if (parent) return colorOf(parent); }
  return PALETTE[hash(p.id) % PALETTE.length];
}

export const emojiOf = (p) => p?.emoji || '';

// A small square with the project's emoji (or first letter) on its pastel colour.
export function badge(p, size = '') {
  const e = emojiOf(p);
  return `<span class="emoji-tile ${size} tint-${colorOf(p)}" aria-hidden="true">${e ? esc(e) : esc((p?.name || '?').trim().charAt(0).toUpperCase())}</span>`;
}

// "1.1y left", "4m left", "12d left", "3d late"
export function timeLeft(deadline) {
  if (!deadline) return '';
  const d = daysBetween(today(), deadline);
  if (d < 0) return `${-d}d late`;
  if (d === 0) return 'today';
  if (d < 60) return `${d}d left`;
  if (d < 365) return `${Math.round(d / 30.4)}m left`;
  return `${(d / 365).toFixed(1)}y left`;
}
