// Talks to Supabase directly over HTTPS: sign-in (Auth API) and data (REST API).
// No libraries, so nothing here can go out of date.
import { SUPABASE_URL as URL, SUPABASE_KEY as KEY } from '../config.js';

const SESSION_KEY = 'planner.session';
export class AuthError extends Error {}
export class NetworkError extends Error {}

let session = read(SESSION_KEY);

function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function write(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
function saveSession(s) { session = s; write(SESSION_KEY, s); }

export const currentUser = () => session?.user ?? null;

async function call(url, opts) {
  try { return await fetch(url, opts); } catch { throw new NetworkError('No connection'); }
}

async function tokenRequest(grant, body) {
  const r = await call(`${URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new AuthError(j.error_description || j.msg || j.message || 'Sign-in failed');
  saveSession({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: { id: j.user?.id, email: j.user?.email },
  });
  return session;
}

export const signIn = (email, password) => tokenRequest('password', { email, password });

export function signOut() {
  const token = session?.access_token;
  saveSession(null);
  if (token) call(`${URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${token}` } }).catch(() => {});
}

let refreshing = null;
async function accessToken(force) {
  if (!session) throw new AuthError('Signed out');
  if (!force && session.expires_at - Date.now() / 1000 > 60) return session.access_token;
  refreshing ||= tokenRequest('refresh_token', { refresh_token: session.refresh_token })
    .catch((e) => { if (e instanceof AuthError) saveSession(null); throw e; })
    .finally(() => { refreshing = null; });
  await refreshing;
  return session.access_token;
}

async function rest(method, path, body, prefer) {
  const send = async (force) => call(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${await accessToken(force)}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let r = await send(false);
  if (r.status === 401) r = await send(true);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.message || `Request failed (${r.status})`);
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

const enc = encodeURIComponent;
export const db = {
  all: (table, order) => rest('GET', `${table}?select=*${order ? `&order=${order}` : ''}`),
  insert: (table, row) => rest('POST', table, row, 'return=minimal'),
  update: (table, id, patch) => rest('PATCH', `${table}?id=eq.${enc(id)}`, patch, 'return=minimal'),
  remove: (table, id) => rest('DELETE', `${table}?id=eq.${enc(id)}`),
};

// ---- Outbox: every change is saved on the device first, then sent in order.
// Offline changes wait here and are sent when the connection comes back.
const OUTBOX_KEY = 'planner.outbox';
let outbox = read(OUTBOX_KEY) || [];
let flushing = false;
const outboxListeners = new Set();
export const onOutboxChange = (fn) => outboxListeners.add(fn);
export const pendingChanges = () => outbox.length;
const notifyOutbox = (err) => outboxListeners.forEach((fn) => fn(outbox.length, err));

export function enqueue(op) {
  outbox.push(op);
  write(OUTBOX_KEY, outbox);
  notifyOutbox();
  flush();
}

export async function flush() {
  if (flushing || !outbox.length || !session) return;
  flushing = true;
  try {
    while (outbox.length) {
      const op = outbox[0];
      try {
        if (op.type === 'insert') await db.insert(op.table, op.row);
        else if (op.type === 'update') await db.update(op.table, op.id, op.patch);
        else if (op.type === 'delete') await db.remove(op.table, op.id);
      } catch (e) {
        if (e instanceof NetworkError || e instanceof AuthError) { notifyOutbox(e); return; }
        // The server refused this change (for example, the item was already deleted). Skip it.
        console.warn('Change refused', op, e);
        outbox.shift();
        write(OUTBOX_KEY, outbox);
        notifyOutbox(e);
        continue;
      }
      outbox.shift();
      write(OUTBOX_KEY, outbox);
      notifyOutbox();
    }
  } finally {
    flushing = false;
  }
}

export function clearOutbox() { outbox = []; write(OUTBOX_KEY, outbox); notifyOutbox(); }

addEventListener('online', () => flush());
setInterval(() => flush(), 20000);
