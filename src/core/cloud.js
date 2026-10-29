// Cloud save. When the game runs as a claude.ai artifact it also keeps the player's progress in their own private
// slot of the artifact's database (data/users/<id>/), so it survives a cleared browser and follows them to another
// device. Anywhere else (the home-screen app, the native app, a plain browser) this does nothing and the on-device
// save in src/core/profile.js is all there is.

const SAVE_DELAY = 3000; // coalesce bursts of changes into one write
const RETRY_DELAY = 15000;
const STOP_CODES = new Set(['invalid_argument', 'revoked', 'not_granted', 'quota_exceeded', 'capability_disabled', 'capability_removed', 'transform_error']);

let state = 'off'; // off | connecting | saving | saved | local-only

/** 'off' (not in an artifact), 'connecting', 'saving', 'saved' or 'local-only' (the cloud refused writes). */
export function cloudStatus() {
  return state;
}

/**
 * @param {{ snapshot: () => { json: string, savedAt: number }, restore: (p: object) => void, isFresh: (p?: object) => boolean,
 *   events: { on: (name: string, fn: Function) => Function } }} o
 */
export async function startCloudSave({ snapshot, restore, isFresh, events }) {
  const claude = globalThis.claude;
  if (!claude || typeof claude.use !== 'function') return null;
  state = 'connecting';
  let db = null;
  let user = null;
  try {
    [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
  } catch {
    db = null;
  }
  const id = db && user ? await user.id() : null;
  if (!id) {
    state = 'off';
    return null;
  }
  let ref;
  try {
    ref = db.doc(`data/users/${id}/save`);
  } catch {
    state = 'off';
    return null;
  }

  // load: the newer save wins; a brand-new local profile never overwrites real progress
  let remote = null;
  for (let attempt = 0; attempt < 2 && !remote; attempt++) {
    try {
      const snap = await ref.get();
      remote = snap.exists ? snap.data() : {};
    } catch (e) {
      if (e?.code !== 'unavailable') break;
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 800));
    }
  }
  if (remote === null) {
    state = 'local-only';
    return null;
  }
  let lastWritten = typeof remote.profile === 'string' ? remote.profile : null;
  if (lastWritten) {
    try {
      const theirs = JSON.parse(lastWritten);
      const mine = snapshot();
      const mineFresh = isFresh(JSON.parse(mine.json));
      if ((mineFresh && !isFresh(theirs)) || (remote.savedAt || 0) > mine.savedAt) restore(theirs);
    } catch {
      lastWritten = null;
    }
  }

  // save: one write at a time, only when the save really changed
  let timer = 0;
  let writing = false;
  let again = false;
  let stopped = false;
  const write = async () => {
    clearTimeout(timer);
    if (stopped) return;
    if (writing) {
      again = true;
      return;
    }
    const cur = snapshot();
    if (cur.json === lastWritten) {
      state = 'saved';
      return;
    }
    writing = true;
    state = 'saving';
    try {
      await ref.set({ profile: cur.json, savedAt: cur.savedAt, v: 1 });
      lastWritten = cur.json;
      state = 'saved';
    } catch (e) {
      if (STOP_CODES.has(e?.code)) {
        stopped = true;
        state = 'local-only';
      } else {
        timer = setTimeout(write, RETRY_DELAY);
      }
    } finally {
      writing = false;
      if (again && !stopped) {
        again = false;
        schedule();
      }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(write, SAVE_DELAY);
  };
  events.on('change', schedule);
  globalThis.document?.addEventListener('visibilitychange', () => {
    if (globalThis.document.hidden) write();
  });
  globalThis.addEventListener?.('pagehide', () => write());
  state = 'saved';
  schedule();
  return { flush: write };
}
