// 3D brick-world model contract: every model builds in node (no DOM), fits its footprint, stays in budget.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from '../src/vendor/three.js';
import {
  structureModel, scaffoldModel, depositModel, cardBuildingModel, treeGeometry, rockGeometry, crystalGeometry,
  MODEL_MATERIALS, MODEL_BIOMES, CARD_MODEL_IDS, STRUCTURE_FOOTPRINTS, triangleCount,
} from '../src/realm3d/models.js';

const TEAMS = [0, 1, null];
const SLACK = 0.25;
const STRUCTURES = ['keep', 'house', 'barracks', 'tower', 'temple', 'outpost', 'wall', 'shrine', 'nest'];
const CARDS = ['tesla', 'cannon', 'crypt', 'bricktower', 'mine', 'turret', 'wall'];
const BIOMES = ['meadow', 'desert', 'frost', 'swamp', 'crystal', 'lava', 'candy', 'void'];

function bounds(obj) {
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj);
}

function geoBounds(geo) {
  geo.computeBoundingBox();
  return geo.boundingBox;
}

function assertFits(box, w, h, label, slack = SLACK) {
  assert.ok(box.min.x >= -w / 2 - slack && box.max.x <= w / 2 + slack, `${label}: x [${box.min.x.toFixed(2)}, ${box.max.x.toFixed(2)}] exceeds ${w}/2`);
  assert.ok(box.min.z >= -h / 2 - slack && box.max.z <= h / 2 + slack, `${label}: z [${box.min.z.toFixed(2)}, ${box.max.z.toFixed(2)}] exceeds ${h}/2`);
  assert.ok(box.min.y >= -0.02, `${label}: dips below the ground (${box.min.y})`);
  assert.ok(box.max.y > 0.2, `${label}: too flat`);
}

function assertMeshes(obj, label) {
  let meshes = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    assert.ok(o.geometry.getAttribute('color'), `${label}: mesh without vertex colours`);
    assert.ok(o.geometry.index, `${label}: geometry should be indexed`);
    assert.ok(Object.values(MODEL_MATERIALS).includes(o.material), `${label}: uses a non-shared material`);
  });
  assert.ok(meshes >= 1 && meshes <= 4, `${label}: ${meshes} meshes (merge more)`);
}

test('the structure list matches the realm constants footprints', () => {
  assert.deepEqual(Object.keys(STRUCTURE_FOOTPRINTS).sort(), [...STRUCTURES].sort());
  assert.deepEqual([...CARD_MODEL_IDS].sort(), [...CARDS].sort());
  assert.deepEqual([...MODEL_BIOMES].sort(), [...BIOMES].sort());
});

test('every structure builds for teams 0/1/null, fits its footprint and holds its budget', () => {
  for (const id of STRUCTURES) {
    const [w, h] = STRUCTURE_FOOTPRINTS[id];
    for (const team of TEAMS) {
      const label = `${id}/${team}`;
      const m = structureModel(id, team);
      assert.ok(m instanceof THREE.Group, `${label}: not a Group`);
      assertMeshes(m, label);
      assertFits(bounds(m), w, h, label);
      const tris = triangleCount(m);
      const budget = id === 'keep' ? 5000 : 2000;
      assert.ok(tris > 20 && tris <= budget, `${label}: ${tris} triangles (budget ${budget})`);
    }
  }
});

test('footprints agree with src/realm/constants.js STRUCTURES', async () => {
  const { STRUCTURES: S } = await import('../src/realm/constants.js');
  for (const [id, s] of Object.entries(S)) assert.deepEqual(STRUCTURE_FOOTPRINTS[id], [s.w, s.h], id);
});

test('models are cached templates: clones share geometry, teams differ', () => {
  const a = structureModel('house', 0);
  const b = structureModel('house', 0);
  assert.notEqual(a, b);
  assert.equal(a.children[0].geometry, b.children[0].geometry);
  const red = structureModel('house', 1);
  assert.notEqual(a.children[0].geometry, red.children[0].geometry);
  assert.equal(structureModel('nope', 0), null);
  assert.equal(cardBuildingModel('knight', 0), null);
});

test('animatable children are named', () => {
  const named = (obj, name) => !!obj.getObjectByName(name);
  for (const t of TEAMS) {
    assert.ok(named(structureModel('keep', t), 'flag'), 'keep flag');
    assert.ok(named(structureModel('outpost', t), 'flag'), 'outpost flag');
    assert.ok(named(structureModel('tower', t), 'top'), 'tower top');
    assert.ok(named(structureModel('temple', t), 'glow'), 'temple glow');
    assert.ok(named(structureModel('shrine', t), 'glow'), 'shrine glow');
    assert.ok(named(cardBuildingModel('mine', t), 'glow'), 'faith well glow');
  }
  assert.ok(named(structureModel('nest', null), 'eyes'), 'nest eyes');
  // the flag pivots on its pole: the hinge (local origin) is at the flag's inner edge
  const flag = structureModel('keep', 0).getObjectByName('flag');
  assert.ok(geoBounds(flag.geometry).min.x > -0.05);
});

test('card buildings build for both teams within ~1 tile and 2k triangles', () => {
  for (const id of CARDS) {
    for (const team of TEAMS) {
      const label = `card ${id}/${team}`;
      const m = cardBuildingModel(id, team);
      assert.ok(m instanceof THREE.Group, label);
      assertMeshes(m, label);
      assertFits(bounds(m), 1, 1, label);
      const tris = triangleCount(m);
      assert.ok(tris <= 2000, `${label}: ${tris} triangles`);
    }
  }
});

test('scaffold fills in with progress and stays cheap', () => {
  for (const [w, h] of [[1, 1], [2, 2], [3, 2], [3, 3]]) {
    let prev = -1;
    for (const p of [0, 0.34, 0.67, 1]) {
      const m = scaffoldModel(w, h, p);
      const label = `scaffold ${w}x${h}@${p}`;
      assertMeshes(m, label);
      assertFits(bounds(m), w, h, label);
      const tris = triangleCount(m);
      assert.ok(tris <= 2000, `${label}: ${tris} triangles`);
      assert.ok(m.userData.courses > prev || p === 0, `${label}: brick courses should grow`);
      prev = m.userData.courses;
    }
  }
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) scaffoldModel(2, 2, 0.34);
  assert.ok(performance.now() - t0 < 50, 'cached scaffold rebuild is cheap');
});

test('deposits are LEGO piles within budget; rich is bigger', () => {
  const n = depositModel(false);
  const r = depositModel(true);
  for (const [m, label] of [[n, 'deposit'], [r, 'rich deposit']]) {
    assertMeshes(m, label);
    assertFits(bounds(m), 1, 1, label);
    assert.ok(triangleCount(m) <= 800, `${label}: ${triangleCount(m)} triangles`);
  }
  const bn = bounds(n);
  const br = bounds(r);
  assert.ok(br.max.y > bn.max.y && br.max.x - br.min.x > bn.max.x - bn.min.x, 'rich pile should be bigger');
  const sn = bn.getSize(new THREE.Vector3());
  assert.ok(sn.x > 0.6 && sn.x < 1.0, `deposit is ~0.8 tiles across (${sn.x.toFixed(2)})`);
});

test('scenery geometries exist for every biome and variant within 300 triangles', () => {
  const check = (geo, label) => {
    assert.ok(geo instanceof THREE.BufferGeometry, label);
    assert.ok(geo.getAttribute('color') && geo.getAttribute('normal') && geo.index, `${label}: attributes`);
    const tris = triangleCount(geo);
    assert.ok(tris >= 8 && tris <= 300, `${label}: ${tris} triangles`);
    const box = geoBounds(geo);
    assert.ok(box.min.y >= -0.02, `${label}: origin should be at the base`);
    assert.ok(Math.abs(box.min.x) <= 0.65 && Math.abs(box.max.x) <= 0.65 && Math.abs(box.min.z) <= 0.65 && Math.abs(box.max.z) <= 0.65, `${label}: ~1 tile footprint`);
    return box;
  };
  for (const b of BIOMES) {
    for (let v = 0; v < 3; v++) {
      check(treeGeometry(b, v), `tree ${b}/${v}`);
      const rb = check(rockGeometry(b, v), `rock ${b}/${v}`);
      assert.ok(rb.max.y >= 1.15 && rb.max.y <= 2.6, `rock ${b}/${v}: height ${rb.max.y.toFixed(2)}`);
    }
  }
  for (let v = 0; v < 3; v++) check(crystalGeometry(v), `crystal ${v}`);
  assert.equal(treeGeometry('meadow', 1), treeGeometry('meadow', 1), 'geometry is cached');
  assert.ok(treeGeometry('unknown-biome', 7) instanceof THREE.BufferGeometry, 'unknown biome falls back');
});
