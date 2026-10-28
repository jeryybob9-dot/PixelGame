// Safe wrapper around localStorage. Storage can be missing or throw (private mode,
// sandboxed iframes, blocked site data), so every access is guarded and the game
// keeps working in memory when persistence is unavailable.

const PREFIX = 'bbr:';
const memory = new Map();

function backend() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = PREFIX + '__probe';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

let ls;
function store() {
  if (ls === undefined) ls = backend();
  return ls;
}

/**
 * Read a JSON value.
 * @template T
 * @param {string} key
 * @param {T} fallback returned when the key is missing or unreadable
 * @returns {T}
 */
export function load(key, fallback) {
  const k = PREFIX + key;
  try {
    const s = store();
    const raw = s ? s.getItem(k) : memory.get(k);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Write a JSON value. Returns false when it could only be kept in memory.
 * @param {string} key
 * @param {unknown} value
 */
export function save(key, value) {
  const k = PREFIX + key;
  const raw = JSON.stringify(value);
  memory.set(k, raw);
  try {
    const s = store();
    if (!s) return false;
    s.setItem(k, raw);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} key */
export function remove(key) {
  const k = PREFIX + key;
  memory.delete(k);
  try {
    store()?.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** True when values survive a reload. */
export function isPersistent() {
  return !!store();
}

export const storage = { load, save, remove, isPersistent };
