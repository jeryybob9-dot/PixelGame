import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { audio, SFX_NAMES, MUSIC_THEMES, _compileTheme, renderSfx, renderMusic } from '../src/core/audio.js';

// Pull the audio contract out of docs/ARCHITECTURE.md so the test tracks the binding spec.
const doc = readFileSync(new URL('../docs/ARCHITECTURE.md', import.meta.url), 'utf8');
const section = doc.slice(doc.indexOf('## Audio contract'), doc.indexOf('## ', doc.indexOf('## Audio contract') + 5));
const listAfter = (label) => {
  const start = section.indexOf(label);
  assert.ok(start >= 0, `contract has "${label}"`);
  const end = section.indexOf('.\n', start);
  return section
    .slice(start + label.length, end)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};
const CONTRACT_SFX = listAfter('SFX names:');
const CONTRACT_THEMES = listAfter('Music themes:');

test('contract parsing sanity', () => {
  assert.ok(CONTRACT_SFX.length >= 50, `parsed ${CONTRACT_SFX.length} SFX names`);
  assert.ok(CONTRACT_SFX.includes('ui_click') && CONTRACT_SFX.includes('nuke'));
  assert.deepEqual(CONTRACT_THEMES.length, 11);
});

test('module implements every contract SFX name and music theme', () => {
  for (const name of CONTRACT_SFX) assert.ok(SFX_NAMES.includes(name), `missing SFX "${name}"`);
  for (const name of CONTRACT_THEMES) assert.ok(MUSIC_THEMES.includes(name), `missing theme "${name}"`);
  assert.deepEqual(audio.sfxNames, SFX_NAMES);
  assert.deepEqual(audio.themes, MUSIC_THEMES);
});

test('exposes the contract API', () => {
  for (const fn of ['unlock', 'sfx', 'music', 'setMusicVolume', 'setSfxVolume', 'setMuted', 'setIntensity']) {
    assert.equal(typeof audio[fn], 'function', fn);
  }
});

test('Node has no Web Audio: module imports and reports unavailable', () => {
  assert.equal(globalThis.AudioContext, undefined);
  assert.equal(audio.info().state, 'unavailable');
  assert.equal(audio.unlocked, false);
});

test('all calls are safe no-ops without Web Audio', () => {
  assert.doesNotThrow(() => {
    audio.unlock();
    audio.unlock();
    for (const name of SFX_NAMES) {
      audio.sfx(name);
      audio.sfx(name, { volume: 0.5, pitch: 1.5, pan: -1 });
    }
    audio.sfx('not_a_sound');
    audio.sfx();
    audio.sfx(null, null);
    audio.sfx('coin', { volume: NaN, pitch: Infinity, pan: 'left' });
    for (const t of MUSIC_THEMES) audio.music(t);
    audio.music('no_such_theme');
    audio.music(null);
    audio.music(undefined);
    audio.setIntensity(0.7);
    audio.setIntensity('x');
    audio.setMusicVolume(0.3);
    audio.setSfxVolume(0.4);
    audio.setMuted(true);
    audio.setMuted(false);
    audio.analyser();
  });
  assert.equal(audio.info().errors, 0);
});

test('music(): same theme is a no-op, null stops, unknown ignored', () => {
  audio.music('meadow');
  assert.equal(audio.theme, 'meadow');
  audio.music('meadow');
  assert.equal(audio.theme, 'meadow');
  audio.music('bogus');
  assert.equal(audio.theme, 'meadow');
  audio.music(null);
  assert.equal(audio.theme, null);
});

test('volume/mute setters clamp and getters reflect them', () => {
  audio.setMusicVolume(0.25);
  assert.equal(audio.musicVolume, 0.25);
  audio.setMusicVolume(5);
  assert.equal(audio.musicVolume, 1);
  audio.setMusicVolume(-1);
  assert.equal(audio.musicVolume, 0);
  audio.setMusicVolume(NaN);
  assert.equal(audio.musicVolume, 0);
  audio.setSfxVolume(0.8);
  assert.equal(audio.sfxVolume, 0.8);
  audio.setSfxVolume(2);
  assert.equal(audio.sfxVolume, 1);
  audio.setMuted(1);
  assert.equal(audio.muted, true);
  audio.setMuted(0);
  assert.equal(audio.muted, false);
  audio.setIntensity(3);
  assert.equal(audio.intensity, 1);
  audio.setIntensity(0);
  assert.equal(audio.intensity, 0);
});

test('every theme compiles: >= 2 distinct sections, notes in a sane range', () => {
  for (const name of MUSIC_THEMES) {
    const th = _compileTheme(name);
    assert.ok(th, name);
    assert.ok(Object.keys(th.sections).length >= 2, `${name} has A/B sections`);
    assert.ok(new Set(th.form).size >= 2, `${name} form uses >= 2 sections`);
    const bars = th.form.reduce((n, s) => n + s.bars, 0);
    assert.ok(bars >= 16 && bars <= 32, `${name} loop is ${bars} bars`);
    assert.ok(th.bpm >= 60 && th.bpm <= 180, `${name} bpm`);
    let notes = 0;
    for (const sec of Object.values(th.sections)) {
      assert.equal(sec.lead.length, sec.bars);
      for (const bar of sec.lead) {
        for (const ev of bar) {
          if (!ev) continue;
          notes++;
          const midi = th.root + ev.semi;
          assert.ok(midi >= 48 && midi <= 96, `${name} lead note ${midi}`);
        }
      }
      for (const ch of sec.chords) assert.ok(th.bassRoot + ch.tones[0] + ch.bass >= 28, `${name} bass range`);
    }
    assert.ok(notes > 30, `${name} has a melody`);
  }
  // Themes differ in key / scale / tempo.
  const sig = new Set(MUSIC_THEMES.map((n) => { const t = _compileTheme(n); return `${t.root}/${t.scale}/${t.bpm}`; }));
  assert.equal(sig.size, MUSIC_THEMES.length);
});

test('offline render helpers resolve to null without Web Audio', async () => {
  assert.equal(await renderSfx('coin'), null);
  assert.equal(await renderMusic('menu'), null);
  assert.equal(await renderSfx('nope'), null);
});
