// Focus mode: one task, a calm timer, and a background of your choice.
// The timer counts down to a fixed end time, so it stays right even if the screen sleeps or the page reloads.
import { state, saveSettings, getTask, getProject, rootOf, subtasksOf, update, doneOn } from './store.js';
import { esc, today } from './util.js';
import { emojiOf } from './look.js';
import { itemByKey, scheduled, dayItems } from './plan.js';

const KEY = 'planner.focus';
export const BACKGROUNDS = [
  { id: 'dawn', name: 'Dawn', tone: 'light', css: 'linear-gradient(160deg, #f8dccd 0%, #ead7ef 48%, #cfe0f3 100%)' },
  { id: 'lavender', name: 'Lavender', tone: 'light', css: 'radial-gradient(circle at 75% 15%, #f4effb 0%, transparent 45%), linear-gradient(150deg, #e9e2f6 0%, #c8bce8 55%, #a395d2 100%)' },
  { id: 'sea', name: 'Sea', tone: 'light', css: 'radial-gradient(circle at 20% 15%, #e6f4f3 0%, transparent 50%), linear-gradient(180deg, #c3dfe9 0%, #8fb7cf 100%)' },
  { id: 'meadow', name: 'Meadow', tone: 'light', css: 'radial-gradient(circle at 80% 85%, #f3ecc8 0%, transparent 45%), linear-gradient(165deg, #e2eedb 0%, #a8c9ad 60%, #7aa58a 100%)' },
  { id: 'paper', name: 'Paper', tone: 'light', css: 'radial-gradient(circle at 50% 0%, #fbf8f2 0%, #efe9df 70%)' },
  { id: 'dusk', name: 'Dusk', tone: 'dark', css: 'linear-gradient(170deg, #2b3050 0%, #57497a 52%, #c58b98 100%)' },
  { id: 'night', name: 'Night', tone: 'dark', css: 'radial-gradient(circle at 70% 18%, #3d4e72 0%, #1b2133 55%, #10131c 100%)' },
];

const MODES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const settings = () => ({ focus: 25, short: 5, long: 15, every: 4, bg: 'dawn', ...(state.settings.focus || {}) });

// ---- Timer state, kept on this device

let f = load();
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
function save() { try { f ? localStorage.setItem(KEY, JSON.stringify(f)) : localStorage.removeItem(KEY); } catch { /* ignore */ } }
function fresh(key) { const s = settings(); return { key, mode: 'focus', running: false, endAt: null, left: s.focus * 60000, count: 0 }; }

export function openFocus(key) {
  if (key == null) { if (!f) f = fresh(''); } else if (!f || f.key !== key) f = fresh(key);
  save();
}

const remaining = () => (f.running ? Math.max(0, f.endAt - Date.now()) : f.left);
const total = () => settings()[f.mode] * 60000;

function setMode(mode) {
  f.mode = mode; f.running = false; f.endAt = null; f.left = settings()[mode] * 60000;
  save();
}

export function focusAction(act, arg) {
  if (!f) return;
  if (act === 'play') {
    if (f.running) { f.left = remaining(); f.running = false; f.endAt = null; releaseWake(); } else { f.endAt = Date.now() + f.left; f.running = true; keepAwake(); unlockAudio(); }
  } else if (act === 'reset') setMode(f.mode);
  else if (act === 'skip') finishPhase(false);
  else if (act === 'mode') setMode(arg);
  save();
  paint();
}

function finishPhase(chime) {
  if (chime) playChime();
  const s = settings();
  if (f.mode === 'focus') {
    f.count += 1;
    setMode(f.count % s.every === 0 ? 'long' : 'short');
  } else setMode('focus');
  releaseWake();
}

export const focusActive = () => !!f;
export function closeFocus() { if (f && !f.running) { f = null; save(); } releaseWake(); }

// ---- Screen awake and a soft chime

let wake = null;
async function keepAwake() { try { wake = await navigator.wakeLock?.request('screen'); } catch { wake = null; } }
function releaseWake() { try { wake?.release(); } catch { /* ignore */ } wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && f?.running) keepAwake(); });

let audio = null;
function unlockAudio() { try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { audio = null; } }
function playChime() {
  if (!audio) return;
  const notes = [659.25, 880, 1318.5];
  notes.forEach((freq, i) => {
    const o = audio.createOscillator(), g = audio.createGain();
    const t0 = audio.currentTime + i * 0.22;
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.18, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
    o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 1.7);
  });
}

// ---- Your own background, kept on this device in its browser storage

const DB = 'planner-focus';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('bg');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('bg', mode); const req = fn(tx.objectStore('bg')); tx.oncomplete = () => res(req?.result); tx.onerror = () => rej(tx.error); });
}
let customUrl = null;
async function loadCustom() {
  try {
    const blob = await idbDo('readonly', (s) => s.get('custom'));
    if (customUrl) URL.revokeObjectURL(customUrl);
    customUrl = blob ? URL.createObjectURL(blob) : null;
  } catch { customUrl = null; }
  return customUrl;
}
loadCustom();

// Shrinks big photos so they load fast, then keeps them on this device.
export async function setCustomBackground(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
  await idbDo('readwrite', (s) => s.put(blob, 'custom'));
  await loadCustom();
  saveSettings({ focus: { ...settings(), bg: 'custom' } });
}
export async function removeCustomBackground() {
  try { await idbDo('readwrite', (s) => s.delete('custom')); } catch { /* ignore */ }
  await loadCustom();
  saveSettings({ focus: { ...settings(), bg: 'dawn' } });
}
export const hasCustom = () => !!customUrl;

// ---- Drawing

const fmt = (ms) => { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const icon = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM13 5h3v14h-3z"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.1-5M5 4v4h4"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l8 6-8 6zM17 6v12"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/></svg>',
  full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};

function bgStyle() {
  const s = settings();
  if (s.bg === 'custom' && customUrl) return { style: `background-image:linear-gradient(rgba(10,12,18,.28), rgba(10,12,18,.42)), url('${customUrl}')`, tone: 'dark' };
  const b = BACKGROUNDS.find((x) => x.id === s.bg) || BACKGROUNDS[0];
  return { style: `background:${b.css}`, tone: b.tone };
}

function chooser() {
  const day = today();
  const items = dayItems(day).filter((i) => !i.done);
  return `<div class="fx-choose">
    <p class="fx-eyebrow">What will you focus on?</p>
    ${items.length ? `<ul>${items.map((i) => `<li><button type="button" data-act="focus-pick" data-id="${i.key}">${i.emoji ? `${esc(i.emoji)} ` : ''}${esc(i.title)}${i.start ? `<span>${String(i.start).slice(0, 5)}</span>` : ''}</button></li>`).join('')}</ul>` : '<p class="fx-note">Nothing planned for today. You can still focus without a task.</p>'}
    <button type="button" class="fx-plain" data-act="focus-pick" data-id="none">Just focus, no task</button>
  </div>`;
}

export function focusHTML(ui) {
  const s = settings();
  const { style, tone } = bgStyle();
  if (!f || !f.key) {
    return `<div class="fx tone-${tone}" style="${style}">
      <div class="fx-bar"><span></span><button type="button" class="fx-icon" data-act="focus-close" aria-label="Close focus mode">${icon.close}</button></div>
      <div class="fx-center">${chooser()}</div></div>`;
  }
  const it = f.key !== 'none' ? itemByKey(f.key) : null;
  const t = it?.kind === 'task' ? getTask(it.id) : null;
  const p = t?.project_id ? rootOf(getProject(t.project_id)) : it?.project ? rootOf(it.project) : null;
  const subs = t ? subtasksOf(t.id) : [];
  const done = t ? doneOn(t, today()) : it?.done;
  const r = 132, c = 2 * Math.PI * r, ratio = 1 - remaining() / total();
  return `<div class="fx tone-${tone}${f.running ? ' running' : ''}" style="${style}">
    <div class="fx-bar">
      <div class="fx-modes" role="group" aria-label="Timer">${Object.entries(MODES).map(([k, v]) => `<button type="button" class="${f.mode === k ? 'on' : ''}" data-act="focus-mode" data-id="${k}">${v}</button>`).join('')}</div>
      <div class="fx-tools">
        <button type="button" class="fx-icon" data-act="focus-bg" aria-label="Background and timer settings">${icon.image}</button>
        <button type="button" class="fx-icon only-wide" data-act="focus-full" aria-label="Full screen">${icon.full}</button>
        <button type="button" class="fx-icon" data-act="focus-close" aria-label="Close focus mode">${icon.close}</button>
      </div>
    </div>
    <div class="fx-center">
      <p class="fx-eyebrow">${f.mode === 'focus' ? (it ? 'Focusing on' : 'Focus') : 'Take a breather'}</p>
      ${it ? `<h1 class="fx-task">${p && emojiOf(p) ? `<span class="fx-emoji">${esc(emojiOf(p))}</span>` : ''}${esc(it.title)}</h1>` : ''}
      ${p ? `<p class="fx-project">${esc(p.name)}</p>` : ''}
      <div class="fx-clock">
        <svg class="fx-ring" viewBox="0 0 300 300" aria-hidden="true"><circle cx="150" cy="150" r="${r}" class="fx-ring-bg"/><circle cx="150" cy="150" r="${r}" class="fx-ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - ratio)}" transform="rotate(-90 150 150)"/></svg>
        <div class="fx-time" id="fx-time" role="timer" aria-live="off">${fmt(remaining())}</div>
        <div class="fx-mode-name">${MODES[f.mode]}</div>
      </div>
      <div class="fx-controls">
        <button type="button" class="fx-icon" data-act="focus-reset" aria-label="Start this ${MODES[f.mode].toLowerCase()} again">${icon.reset}</button>
        <button type="button" class="fx-play" data-act="focus-play" aria-label="${f.running ? 'Pause' : 'Start'}">${f.running ? icon.pause : icon.play}</button>
        <button type="button" class="fx-icon" data-act="focus-skip" aria-label="Skip to the ${f.mode === 'focus' ? 'break' : 'next focus'}">${icon.skip}</button>
      </div>
      <div class="fx-dots" aria-label="${f.count} focus sessions done">${Array.from({ length: s.every }, (_, i) => `<span class="${i < f.count % s.every || (f.count && f.count % s.every === 0 && f.mode === 'long') ? 'on' : ''}"></span>`).join('')}<em>${f.count ? `${f.count} done` : ''}</em></div>
      ${subs.length ? `<ul class="fx-steps">${subs.map((x) => `<li><label><input type="checkbox" data-sub-done="${x.id}"${x.done ? ' checked' : ''}> <span>${esc(x.title)}</span></label></li>`).join('')}</ul>` : ''}
      ${it ? `<button type="button" class="fx-done${done ? ' is-done' : ''}" data-act="toggle-item" data-id="${it.key}" data-day="${today()}">${done ? '✓ Done' : t?.ongoing ? 'Done for today' : 'Mark as done'}</button>` : ''}
    </div>
    ${ui.focusSheet ? sheet(s) : ''}
  </div>`;
}

function sheet(s) {
  return `<div class="fx-sheet" role="dialog" aria-label="Background and timer">
    <div class="fx-sheet-head"><h2>Background</h2><button type="button" class="fx-icon small" data-act="focus-bg" aria-label="Close">${icon.close}</button></div>
    <div class="fx-swatches">
      ${BACKGROUNDS.map((b) => `<button type="button" class="fx-swatch${s.bg === b.id ? ' on' : ''}" style="background:${b.css}" data-act="focus-set-bg" data-id="${b.id}"><span>${b.name}</span></button>`).join('')}
      ${customUrl ? `<button type="button" class="fx-swatch${s.bg === 'custom' ? ' on' : ''}" style="background-image:url('${customUrl}')" data-act="focus-set-bg" data-id="custom"><span>Your picture</span></button>` : ''}
    </div>
    <div class="fx-upload">
      <label class="fx-upload-btn">${customUrl ? 'Replace your picture' : 'Use your own picture'}<input type="file" accept="image/*" id="fx-file" class="sr-only"></label>
      ${customUrl ? '<button type="button" class="fx-link" data-act="focus-remove-bg">Remove picture</button>' : ''}
      <p>Your picture stays on this device only.</p>
    </div>
    <h2>Timer</h2>
    <form class="fx-times" data-form="focus-times">
      <label>Focus<input type="number" id="fx-t-focus" min="5" max="120" value="${s.focus}"> min</label>
      <label>Short break<input type="number" id="fx-t-short" min="1" max="30" value="${s.short}"> min</label>
      <label>Long break<input type="number" id="fx-t-long" min="5" max="60" value="${s.long}"> min</label>
      <label>Long break after<input type="number" id="fx-t-every" min="2" max="8" value="${s.every}"> sessions</label>
      <button type="submit">Save</button>
    </form>
  </div>`;
}

// Only the clock and ring change every second; the rest of the screen stays still.
export function paint() {
  if (!f) return;
  const left = remaining();
  if (f.running && left <= 0) { finishPhase(true); save(); document.dispatchEvent(new Event('focus-repaint')); return; }
  const el = document.getElementById('fx-time');
  if (el) el.textContent = fmt(left);
  const ring = document.querySelector('.fx-ring-fg');
  if (ring) { const c = 2 * Math.PI * 132; ring.setAttribute('stroke-dashoffset', String(c * (left / total()))); }
  if (document.querySelector('.fx')) document.title = `${fmt(left)} · ${MODES[f.mode]}`;
}
setInterval(paint, 250);

export function saveFocusTimes(v) { saveSettings({ focus: { ...settings(), ...v } }); if (f && !f.running) setMode(f.mode); }
export function setBackground(id) { saveSettings({ focus: { ...settings(), bg: id } }); }
export function pickFocus(key) { f = fresh(key); save(); }

// Suggests what to focus on now: the item on the timeline right now, if any.
export function currentItemKey() {
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
  const hit = scheduled(today()).find((i) => { const [h, mm] = String(i.start).split(':').map(Number); const s = h * 60 + mm; return !i.done && m >= s && m < s + i.len; });
  return hit ? hit.key : null;
}

export { update };
