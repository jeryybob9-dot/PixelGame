import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internal, getProfile, autosave, profileSnapshot, replaceProfile, isFreshProfile, events, commit } from '../src/core/profile.js';
import { startCloudSave, cloudStatus } from '../src/core/cloud.js';
import { storage } from '../src/core/storage.js';

/** A stand-in for the artifact runtime: one private document per player. */
function fakeClaude(initial) {
  const docs = new Map();
  if (initial) docs.set('data/users/u_1/save', initial);
  const writes = [];
  const db = {
    doc: (path) => ({
      get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: async (body) => {
        writes.push(body);
        docs.set(path, body);
      },
    }),
  };
  const user = { id: async () => 'u_1' };
  return { claude: { use: async (name) => (name === 'db' ? db : name === 'user' ? user : null) }, docs, writes };
}

const hooks = () => ({ snapshot: profileSnapshot, isFresh: isFreshProfile, events, restore: (p) => replaceProfile(p) });

test('a change made without a commit is still saved by the autosave safety net', () => {
  _internal.setProfile(_internal.defaultProfile());
  commit();
  autosave();
  getProfile().gold = 1234; // a direct change, no commit
  assert.equal(autosave(), true);
  assert.equal(storage.load('profile', null).gold, 1234);
  assert.equal(autosave(), false, 'nothing new to save');
});

test('the cloud copy restores progress on a new device, and a fresh profile never overwrites it', async () => {
  _internal.setProfile(_internal.defaultProfile());
  const theirs = _internal.defaultProfile();
  Object.assign(theirs, { tutorialDone: true, trophies: 420, gold: 999, savedAt: 1 });
  const fake = fakeClaude({ profile: JSON.stringify(theirs), savedAt: 1, v: 1 });
  globalThis.claude = fake.claude;
  try {
    getProfile().savedAt = Date.now(); // newer clock, but nothing played
    const cloud = await startCloudSave(hooks());
    assert.ok(cloud);
    assert.equal(getProfile().trophies, 420);
    assert.equal(cloudStatus(), 'saved');
    await cloud.flush();
    assert.equal(fake.writes.length, 0, 'nothing changed, nothing written');
    getProfile().gold += 5;
    commit();
    await cloud.flush();
    assert.equal(fake.writes.length, 1);
    assert.equal(JSON.parse(fake.writes[0].profile).gold, 1004);
  } finally {
    delete globalThis.claude;
  }
});

test('newer progress on this device is pushed to the cloud', async () => {
  _internal.setProfile(_internal.defaultProfile());
  const old = _internal.defaultProfile();
  Object.assign(old, { tutorialDone: true, trophies: 100, savedAt: 1000 });
  const fake = fakeClaude({ profile: JSON.stringify(old), savedAt: 1000, v: 1 });
  globalThis.claude = fake.claude;
  try {
    Object.assign(getProfile(), { tutorialDone: true, trophies: 300 });
    commit();
    const cloud = await startCloudSave(hooks());
    await cloud.flush();
    assert.equal(getProfile().trophies, 300);
    assert.equal(JSON.parse(fake.docs.get('data/users/u_1/save').profile).trophies, 300);
  } finally {
    delete globalThis.claude;
  }
});

test('outside claude.ai there is no cloud and nothing breaks', async () => {
  assert.equal(await startCloudSave(hooks()), null);
});
