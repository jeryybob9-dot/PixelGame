// The 3D "brick world" view of a Realm: a blocky textured island, water and lava, instanced trees and rocks,
// LEGO-style buildings on baseplates, pixel-sprite units standing in the world (HD-2D style), particles, a
// ground-effects overlay, real day/night lighting with torch lights, and a screen-space layer for bars and numbers.
// Same interface as the 2D RealmRenderer so the realm screen can use either.

import * as THREE from '../vendor/three.js';
import { BattleRenderer, hexA } from '../battle/render.js';
import { RealmRenderer } from '../realm/realm-render.js';
import { TILE } from '../battle/constants.js';
import { drawSprite, drawHero, spriteSize, frameCount } from '../art/sprite-cache.js';
import { SPRITES } from '../art/sprites.js';
import { renderRealmMap, renderRealmTile } from '../art/realm-tiles.js';
import { T, STRUCTURES } from '../realm/constants.js';
import { Minimap, tileColor } from '../realm/minimap.js';
import * as Models from './models.js';

const FONT = '"Press Start 2P", ui-monospace, monospace';
const PITCH = (56 * Math.PI) / 180;
const FOV = 36;
const UNIT_SCALE = 1.25;
const OVERLAY_PPT = 8; // overlay pixels per tile

/** Ground height per terrain type (tiles). */
const HEIGHT = {
  [T.DEEP]: -0.8, [T.WATER]: -0.42, [T.SAND]: 0.02, [T.GRASS]: 0.12, [T.FOREST]: 0.12, [T.HILL]: 0.55,
  [T.MOUNTAIN]: 0.62, [T.ASH]: 0.12, [T.SNOW]: 0.12, [T.LAVA]: -0.32, [T.MUD]: 0.06, [T.CRYSTAL]: 0.4, [T.PATH]: 0.1,
};
const WATER_Y = -0.15;
const LAVA_Y = -0.12;
/** Terrain drawn under scenery: forests show grass, mountains show hill, crystals show grass. */
const flatTile = (t) => (t === T.FOREST || t === T.CRYSTAL ? T.GRASS : t === T.MOUNTAIN ? T.HILL : t);
const PROJ_SPRITE = { arrow: 'arrow', bullet: 'bullet', brick: 'brick', rocket: 'rocket', fireball: 'fireball', iceshard: 'iceshard', bone: 'bone', sheep: 'sheep', bomb: 'brick' };

/** Can this browser draw the 3D view? */
export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export class Realm3DRenderer {
  /**
   * @param {import('../realm/realm.js').Realm} realm
   * @param {HTMLCanvasElement} canvas WebGL canvas
   * @param {HTMLCanvasElement} hud 2D canvas layered on top for bars, numbers and lines
   */
  constructor(realm, canvas, hud) {
    const R = realm;
    this.B = R;
    this.canvas = canvas;
    this.hud = hud;
    this.hctx = hud.getContext('2d');
    this.t = 0;
    this.frame = 0;
    this.biome = R.arena?.biome || 'meadow';
    this.seed = R.map.seed || 1;
    this.layout = { cssW: 300, cssH: 400, dpr: 1, scale: 1 };
    const k = R.players[0]?.keep || R.players[1]?.keep;
    this.cam = { x: k ? k.x : R.W / 2, y: k ? k.y - 3 : R.H / 2, zoom: 1, tiles: 13 };
    this.minimap = new Minimap(R, this.biome);
    this.views = new Map(); // entity id → view
    this.depositViews = new Map();
    this.texCache = new Map();
    this.matCache = new Map();
    this.heroCanvases = new Map();

    const gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl = gl;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 200);
    this.raycaster = new THREE.Raycaster();
    this.buildLights();
    this.buildTerrain();
    this.buildWater();
    this.buildScenery();
    this.buildSprites();
    this.buildParticles();
    this.buildOverlay();
  }

  // ───────────────────────── setup ─────────────────────────

  buildLights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xdff0ff, 0x5a4a3a, 1.15);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.5);
    this.sun.position.set(-12, 30, 18);
    s.add(this.sun);
    s.add(this.sun.target);
    this.torches = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffb366, 0, 7, 1.6);
      s.add(l);
      this.torches.push(l);
    }
    this.fog = new THREE.Fog(0xa8d0e8, 20, 60);
    s.fog = this.fog;
    s.background = new THREE.Color(0xa8d0e8);
  }

  /** Height of the ground under a point (tiles). */
  groundH(x, y) {
    const R = this.B;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= R.W || ty >= R.H) return WATER_Y;
    const h = this.heights[ty * R.W + tx];
    return h < WATER_Y ? WATER_Y : h;
  }

  buildTerrain() {
    const R = this.B;
    const W = R.W;
    const H = R.H;
    this.heights = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) this.heights[i] = HEIGHT[R.tiles[i]] ?? 0.1;
    // texture atlas: the island's pixel map (scenery tiles flattened) plus one row of side textures
    this.texTiles = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) this.texTiles[i] = flatTile(R.tiles[i]);
    const atlas = document.createElement('canvas');
    atlas.width = W * TILE;
    atlas.height = H * TILE + TILE;
    const ac = atlas.getContext('2d');
    ac.imageSmoothingEnabled = false;
    try {
      ac.drawImage(renderRealmMap(this.texTiles, W, H, this.biome, this.seed), 0, 0);
    } catch {
      for (let i = 0; i < W * H; i++) {
        ac.fillStyle = tileColor(this.texTiles[i], this.biome);
        ac.fillRect((i % W) * TILE, Math.floor(i / W) * TILE, TILE, TILE);
      }
    }
    this.drawSideStrip(ac, H * TILE);
    this.atlas = atlas;
    this.atlasCtx = ac;
    const tex = new THREE.CanvasTexture(atlas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 4;
    this.atlasTex = tex;

    // geometry: one textured top per tile, plus sides where the neighbour is lower
    const pos = [];
    const nrm = [];
    const uv = [];
    const col = [];
    const top = [];
    const idx = [];
    const AW = atlas.width;
    const AH = atlas.height;
    const quad = (p, n, u, c, isTop) => {
      const b = pos.length / 3;
      for (let k = 0; k < 4; k++) {
        pos.push(p[k][0], p[k][1], p[k][2]);
        nrm.push(n[0], n[1], n[2]);
        uv.push(u[k][0], u[k][1]);
        col.push(c[k], c[k], c[k]);
        top.push(isTop ? 1 : 0);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const inset = 0.02; // pixels of inset to stop atlas bleeding
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const h = this.heights[i];
        const u0 = (x * TILE + inset) / AW;
        const u1 = ((x + 1) * TILE - inset) / AW;
        const v0 = 1 - (y * TILE + inset) / AH;
        const v1 = 1 - ((y + 1) * TILE - inset) / AH;
        quad([[x, h, y], [x, h, y + 1], [x + 1, h, y + 1], [x + 1, h, y]], [0, 1, 0], [[u0, v0], [u0, v1], [u1, v1], [u1, v0]], [1, 1, 1, 1], true);
        // sides toward lower neighbours
        const t = R.tiles[i];
        const su0 = (flatTile(t) * TILE + inset) / AW;
        const su1 = ((flatTile(t) + 1) * TILE - inset) / AW;
        const sv0 = 1 - (H * TILE + inset) / AH;
        const sides = [
          [0, -1, [[x + 1, y], [x, y]], [0, 0, -1], 0.62],
          [0, 1, [[x, y + 1], [x + 1, y + 1]], [0, 0, 1], 0.86],
          [-1, 0, [[x, y], [x, y + 1]], [-1, 0, 0], 0.72],
          [1, 0, [[x + 1, y + 1], [x + 1, y]], [1, 0, 0], 0.78],
        ];
        for (const [dx, dy, e, n, shade] of sides) {
          const nx = x + dx;
          const ny = y + dy;
          const nh = nx < 0 || ny < 0 || nx >= W || ny >= H ? -1.4 : this.heights[ny * W + nx];
          if (nh >= h - 0.001) continue;
          const drop = h - nh;
          const sv1 = 1 - (H * TILE + Math.min(TILE, drop * TILE * 1.4) - inset) / AH;
          quad(
            [[e[0][0], h, e[0][1]], [e[0][0], nh, e[0][1]], [e[1][0], nh, e[1][1]], [e[1][0], h, e[1][1]]],
            n,
            [[su0, sv0], [su0, sv1], [su1, sv1], [su1, sv0]],
            [shade, shade * 0.72, shade * 0.72, shade],
            false,
          );
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();

    // ownership texture (r = team 0, g = team 1) for tints and dashed borders
    this.ownerData = new Uint8Array(W * H * 4);
    this.ownerTex = new THREE.DataTexture(this.ownerData, W, H, THREE.RGBAFormat);
    this.ownerTex.magFilter = THREE.NearestFilter;
    this.ownerTex.minFilter = THREE.NearestFilter;
    this.ownerTex.needsUpdate = true;
    this.ownerVersion = -1;
    // ground effects overlay (fire, spells, ghosts, markers) drawn in 2D and projected onto tile tops
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.width = 64;
    this.overlayCanvas.height = 64;
    this.overlayTex = new THREE.CanvasTexture(this.overlayCanvas);
    this.overlayTex.colorSpace = THREE.SRGBColorSpace;
    this.overlayTex.magFilter = THREE.LinearFilter;
    this.overlayTex.minFilter = THREE.LinearFilter;
    this.overlayTex.generateMipmaps = false;

    const u = {
      uOwner: { value: this.ownerTex },
      uMapSize: { value: new THREE.Vector2(W, H) },
      uOverlay: { value: this.overlayTex },
      uOverlayRect: { value: new THREE.Vector4(-10, -10, 0.001, 0.001) },
      uTeam0: { value: new THREE.Color(0x5aa2ff) },
      uTeam1: { value: new THREE.Color(0xff5a4d) },
      uNight: { value: 0 },
      uTime: { value: 0 },
    };
    this.groundUniforms = u;
    const mat = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aTop;\nvarying float vTop;\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTop = aTop;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying float vTop;
varying vec3 vWPos;
uniform sampler2D uOwner;
uniform vec2 uMapSize;
uniform sampler2D uOverlay;
uniform vec4 uOverlayRect;
uniform vec3 uTeam0;
uniform vec3 uTeam1;
uniform float uNight;
uniform float uTime;
vec3 ovGlow = vec3(0.0);`)
        .replace('#include <map_fragment>', `#include <map_fragment>
if (vTop > 0.5) {
  vec2 tc = vWPos.xz;
  vec2 cell = floor(tc);
  vec2 f = tc - cell;
  vec4 o = texture2D(uOwner, (cell + 0.5) / uMapSize);
  float owned = max(o.r, o.g);
  vec3 tint = o.r > 0.5 ? uTeam0 : uTeam1;
  diffuseColor.rgb = mix(diffuseColor.rgb, tint, 0.16 * owned);
  if (owned > 0.5) {
    float w = 0.085;
    float edge = 0.0;
    vec4 oL = texture2D(uOwner, (cell + vec2(-0.5, 0.5)) / uMapSize);
    vec4 oR = texture2D(uOwner, (cell + vec2(1.5, 0.5)) / uMapSize);
    vec4 oU = texture2D(uOwner, (cell + vec2(0.5, -0.5)) / uMapSize);
    vec4 oD = texture2D(uOwner, (cell + vec2(0.5, 1.5)) / uMapSize);
    if (f.x < w && distance(oL.rg, o.rg) > 0.5) edge = 1.0;
    if (f.x > 1.0 - w && distance(oR.rg, o.rg) > 0.5) edge = 1.0;
    if (f.y < w && distance(oU.rg, o.rg) > 0.5) edge = 1.0;
    if (f.y > 1.0 - w && distance(oD.rg, o.rg) > 0.5) edge = 1.0;
    float dash = step(0.4, fract((tc.x + tc.y) * 1.5 - uTime * 0.4));
    diffuseColor.rgb = mix(diffuseColor.rgb, tint * 1.2 + 0.2, edge * dash * 0.9);
    ovGlow += tint * edge * dash * 0.35 * uNight;
  }
  vec2 ouv = (tc - uOverlayRect.xy) / uOverlayRect.zw;
  if (ouv.x >= 0.0 && ouv.y >= 0.0 && ouv.x <= 1.0 && ouv.y <= 1.0) {
    vec4 ov = texture2D(uOverlay, vec2(ouv.x, 1.0 - ouv.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, ov.rgb, ov.a);
    ovGlow += ov.rgb * ov.a * step(ov.b + 0.12, ov.r) * (0.25 + uNight * 0.9);
  }
}`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += ovGlow;');
    };
    this.terrain = new THREE.Mesh(g, mat);
    this.scene.add(this.terrain);
  }

  /** One 16x16 side texture per terrain type, drawn below the map in the atlas. */
  drawSideStrip(ac, y0) {
    const rnd = (n) => {
      const s = Math.sin(n * 12.9898) * 43758.5453;
      return s - Math.floor(s);
    };
    for (let t = 0; t <= 12; t++) {
      const x0 = t * TILE;
      const topC = tileColor(t, this.biome);
      const stone = t === T.HILL || t === T.MOUNTAIN || t === T.CRYSTAL;
      const sandy = t === T.SAND || t === T.WATER || t === T.DEEP;
      const base = stone ? '#6e6672' : sandy ? '#c9b07a' : t === T.LAVA ? '#4a2a22' : t === T.SNOW ? '#9aa6b8' : t === T.ASH ? '#3e3434' : '#7a5638';
      ac.fillStyle = base;
      ac.fillRect(x0, y0, TILE, TILE);
      for (let k = 0; k < 40; k++) {
        const px = Math.floor(rnd(t * 100 + k) * TILE);
        const py = Math.floor(rnd(t * 300 + k * 7) * TILE);
        ac.fillStyle = rnd(k * 3 + t) < 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.12)';
        ac.fillRect(x0 + px, y0 + py, stone ? 2 : 1, 1);
      }
      if (stone) {
        ac.fillStyle = 'rgba(0,0,0,0.22)';
        ac.fillRect(x0, y0 + 7, TILE, 1);
        ac.fillRect(x0 + 5, y0, 1, 7);
        ac.fillRect(x0 + 11, y0 + 8, 1, 8);
      }
      // grassy lip
      if (!stone && !sandy && t !== T.LAVA && t !== T.PATH) {
        ac.fillStyle = topC;
        ac.fillRect(x0, y0, TILE, 3);
        for (let k = 0; k < TILE; k += 2) if (rnd(t * 50 + k) < 0.6) ac.fillRect(x0 + k, y0 + 3, 1, 1 + Math.floor(rnd(k + t) * 2));
      }
    }
  }

  buildWater() {
    const R = this.B;
    // pixel water texture, scrolled each frame
    const wc = document.createElement('canvas');
    wc.width = wc.height = 32;
    const w = wc.getContext('2d');
    const deep = tileColor(T.WATER, this.biome);
    w.fillStyle = deep;
    w.fillRect(0, 0, 32, 32);
    w.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 9; i++) w.fillRect((i * 11) % 32, (i * 7) % 32, 4, 1);
    w.fillStyle = 'rgba(0,0,40,0.12)';
    for (let i = 0; i < 7; i++) w.fillRect((i * 13 + 5) % 32, (i * 9 + 3) % 32, 6, 1);
    const wt = new THREE.CanvasTexture(wc);
    wt.colorSpace = THREE.SRGBColorSpace;
    wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
    wt.magFilter = THREE.NearestFilter;
    wt.minFilter = THREE.LinearMipmapLinearFilter;
    const size = 220;
    wt.repeat.set(size / 2, size / 2);
    this.waterTex = wt;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: wt, transparent: true, opacity: 0.8, depthWrite: false }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(R.W / 2, WATER_Y, R.H / 2);
    water.renderOrder = 1;
    this.scene.add(water);
    this.water = water;
    // lava pools glow on their own
    const lavaIdx = [];
    for (let i = 0; i < R.tiles.length; i++) if (R.tiles[i] === T.LAVA) lavaIdx.push(i);
    this.lavaTiles = lavaIdx;
    if (lavaIdx.length) {
      const lc = document.createElement('canvas');
      lc.width = lc.height = 16;
      const l = lc.getContext('2d');
      l.fillStyle = '#ff6a1e';
      l.fillRect(0, 0, 16, 16);
      l.fillStyle = '#ffd166';
      for (let i = 0; i < 10; i++) l.fillRect((i * 5) % 16, (i * 7) % 16, 3, 1);
      l.fillStyle = '#b8320f';
      for (let i = 0; i < 8; i++) l.fillRect((i * 9 + 3) % 16, (i * 5 + 2) % 16, 2, 2);
      const lt = new THREE.CanvasTexture(lc);
      lt.colorSpace = THREE.SRGBColorSpace;
      lt.wrapS = lt.wrapT = THREE.RepeatWrapping;
      lt.magFilter = THREE.NearestFilter;
      this.lavaTex = lt;
      const geos = [];
      for (const i of lavaIdx) {
        const p = new THREE.PlaneGeometry(1, 1);
        p.rotateX(-Math.PI / 2);
        p.translate((i % R.W) + 0.5, LAVA_Y, Math.floor(i / R.W) + 0.5);
        geos.push(p);
      }
      const merged = mergeSimple(geos);
      this.lava = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ map: lt }));
      this.scene.add(this.lava);
    }
  }

  buildScenery() {
    const R = this.B;
    this.treeOf = new Map(); // tile → [mesh, index]
    const forest = [];
    const rocks = [];
    const crystals = [];
    for (let i = 0; i < R.tiles.length; i++) {
      const t = R.tiles[i];
      if (t === T.FOREST || R.origForest[i]) forest.push(i);
      else if (t === T.MOUNTAIN) rocks.push(i);
      else if (t === T.CRYSTAL) crystals.push(i);
    }
    const rnd = (n) => {
      const s = Math.sin(n * 78.233 + this.seed * 0.17) * 43758.5453;
      return s - Math.floor(s);
    };
    const mat = sceneryMaterial();
    const make = (geoFn, list, perTile, scale0) => {
      const meshes = [];
      for (let v = 0; v < 3; v++) {
        let g = null;
        try {
          g = geoFn(v);
        } catch {
          g = null;
        }
        if (!g) g = fallbackTree(v);
        meshes.push({ g, items: [] });
      }
      for (const i of list) {
        for (let k = 0; k < perTile; k++) {
          if (k > 0 && rnd(i * 7 + k) > 0.45) continue;
          const v = Math.floor(rnd(i * 3 + k) * 3);
          meshes[v].items.push({ i, k });
        }
      }
      const out = [];
      for (const m of meshes) {
        if (!m.items.length) continue;
        const im = new THREE.InstancedMesh(m.g, mat, m.items.length);
        const o = new THREE.Object3D();
        m.items.forEach((it, n) => {
          const x = (it.i % R.W) + 0.5 + (rnd(it.i * 11 + it.k) - 0.5) * (it.k ? 0.7 : 0.35);
          const z = Math.floor(it.i / R.W) + 0.5 + (rnd(it.i * 13 + it.k) - 0.5) * (it.k ? 0.7 : 0.35);
          const s = scale0 * (it.k ? 0.7 : 1) * (0.85 + rnd(it.i * 17 + it.k) * 0.35);
          o.position.set(x, this.heights[it.i], z);
          o.rotation.set(0, rnd(it.i * 19 + it.k) * Math.PI * 2, 0);
          o.scale.set(s, s, s);
          o.updateMatrix();
          im.setMatrixAt(n, o.matrix);
          const key = it.i;
          if (!this.treeOf.has(key) || list === forest) {
            const arr = this.treeOf.get(key) || [];
            arr.push({ im, n, m: o.matrix.clone() });
            this.treeOf.set(key, arr);
          }
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        this.scene.add(im);
        out.push(im);
      }
      return out;
    };
    const biome = this.biome;
    this.treeMeshes = make((v) => Models.treeGeometry?.(biome, v), forest, 2, 1);
    // only trees should react to burning; drop rock/crystal tiles from the lookup afterwards
    const forestSet = new Set(forest);
    make((v) => Models.rockGeometry?.(biome, v), rocks, 1, 1);
    make((v) => Models.crystalGeometry?.(v), crystals, 1, 1);
    for (const key of [...this.treeOf.keys()]) if (!forestSet.has(key)) this.treeOf.delete(key);
    this.hiddenTrees = new Set();
    for (const i of forest) if (R.tiles[i] !== T.FOREST) this.setTrees(i, false);
  }

  setTrees(i, on) {
    const arr = this.treeOf.get(i);
    if (!arr) return;
    if (!on === this.hiddenTrees.has(i)) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const t of arr) {
      t.im.setMatrixAt(t.n, on ? t.m : zero);
      t.im.instanceMatrix.needsUpdate = true;
    }
    if (on) this.hiddenTrees.delete(i);
    else this.hiddenTrees.add(i);
  }

  buildSprites() {
    // blob shadows under everything that walks or flies
    const sg = new THREE.CircleGeometry(0.5, 12);
    sg.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }), 600);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 2;
    this.scene.add(this.shadows);
    this.spritePool = [];
    this.spriteUsed = 0;
    this.tmpObj = new THREE.Object3D();
  }

  buildParticles() {
    const N = 1400;
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 4);
    this.pSize = new Float32Array(N);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.pMax = N;
    const m = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC;
        uniform float uScale;
        void main() { vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(1.0, size * uScale / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: 'varying vec4 vC; void main() { if (vC.a < 0.02) discard; gl_FragColor = vC; }',
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.scene.add(this.points);
  }

  buildOverlay() {
    // a 2D painter that reuses the flat renderer's drawing code (areas, fire, rings, warnings, summon zones)
    const p = Object.create(RealmRenderer.prototype);
    p.B = this.B;
    p.t = 0;
    this.painter = p;
  }

  // ───────────────────────── layout & camera ─────────────────────────

  resize(cssW, cssH, dpr = Math.min(this.maxDpr ?? 2, globalThis.devicePixelRatio || 1)) {
    this.layout = { cssW, cssH, dpr, scale: 1 };
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(cssW, cssH, false);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.hud.width = Math.round(cssW * dpr);
    this.hud.height = Math.round(cssH * dpr);
    this.hud.style.width = `${cssW}px`;
    this.hud.style.height = `${cssH}px`;
    this.camera.aspect = cssW / cssH;
    this.camera.updateProjectionMatrix();
    this.points.material.uniforms.uScale.value = (cssH * dpr) / (2 * Math.tan(((FOV / 2) * Math.PI) / 180)) / TILE;
    return this.layout;
  }

  /** Zoom so that about `tiles` tiles fit across the screen at the camera target. */
  setZoomTiles(tiles) {
    this.cam.tiles = Math.max(6, Math.min(30, tiles));
  }

  camDistance() {
    const aspect = this.layout.cssW / this.layout.cssH;
    const hfov = 2 * Math.atan(Math.tan(((FOV / 2) * Math.PI) / 180) * aspect);
    return this.cam.tiles / (2 * Math.tan(hfov / 2));
  }

  clampCam() {
    const R = this.B;
    this.cam.x = Math.max(2, Math.min(R.W - 2, this.cam.x));
    this.cam.y = Math.max(3, Math.min(R.H - 1, this.cam.y));
  }

  updateCamera() {
    this.clampCam();
    const D = this.camDistance();
    const tx = this.cam.x;
    const tz = this.cam.y;
    const ty = 0.15;
    this.camera.position.set(tx, ty + D * Math.sin(PITCH), tz + D * Math.cos(PITCH));
    this.camera.lookAt(tx, ty, tz);
    this.camera.updateMatrixWorld();
    this.fog.near = D * 1.15;
    this.fog.far = D * 2.9;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx - 10, 28, tz + 14);
  }

  /** Tile offset for a finger drag of (dx, dy) css px. */
  panDelta(dx, dy) {
    const a = this.toWorld(this.layout.cssW / 2, this.layout.cssH / 2);
    const b = this.toWorld(this.layout.cssW / 2 + dx, this.layout.cssH / 2 + dy);
    return { x: a.x - b.x, y: a.y - b.y };
  }

  /** css px (relative to the canvas) → tile coords on the ground. */
  toWorld(px, py) {
    const ndc = new THREE.Vector2((px / this.layout.cssW) * 2 - 1, -(py / this.layout.cssH) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this.raycaster.ray;
    let h = 0.12;
    let hit = { x: this.cam.x, y: this.cam.y };
    for (let k = 0; k < 3; k++) {
      if (Math.abs(ray.direction.y) < 1e-4) break;
      const t = (h - ray.origin.y) / ray.direction.y;
      const x = ray.origin.x + ray.direction.x * t;
      const z = ray.origin.z + ray.direction.z * t;
      hit = { x, y: z };
      const nh = Math.max(WATER_Y, this.heights[Math.floor(z) * this.B.W + Math.floor(x)] ?? 0.12);
      if (Math.abs(nh - h) < 0.01) break;
      h = nh;
    }
    return hit;
  }

  /** Tile coords → css px. */
  toCss(x, y, h = null) {
    const v = new THREE.Vector3(x, h ?? this.groundH(x, y), y).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.layout.cssW, y: (-v.y * 0.5 + 0.5) * this.layout.cssH, z: v.z };
  }

  /** The visible ground as a polygon (tiles), for the minimap and the overlay. */
  viewPolygon() {
    const { cssW, cssH } = this.layout;
    return [this.toWorld(0, 0), this.toWorld(cssW, 0), this.toWorld(cssW, cssH), this.toWorld(0, cssH)];
  }

  // ───────────────────────── frame ─────────────────────────

  /** Lower the render resolution when frames are slow, raise it again when they are smooth. */
  adapt(dt) {
    if (!dt) return;
    this.ema = this.ema == null ? dt : this.ema * 0.95 + dt * 0.05;
    this.adaptT = (this.adaptT || 0) + dt;
    const top = Math.min(2, globalThis.devicePixelRatio || 1);
    if (this.maxDpr == null) this.maxDpr = top;
    if (this.adaptT < 2) return;
    if (this.ema > 0.03 && this.maxDpr > 0.75) {
      this.maxDpr = Math.max(0.75, this.maxDpr - 0.25);
      this.adaptT = 0;
      this.resize(this.layout.cssW, this.layout.cssH);
    } else if (this.ema < 0.0185 && this.maxDpr < top && this.adaptT > 6) {
      this.maxDpr = Math.min(top, this.maxDpr + 0.25);
      this.adaptT = 0;
      this.resize(this.layout.cssW, this.layout.cssH);
    }
  }

  draw(ui = {}, dt = 0) {
    const R = this.B;
    this.t += dt;
    this.frame++;
    this.adapt(dt);
    const t = this.t;
    this.updateCamera();
    this.syncTiles();
    this.flushAtlas();
    this.syncOwner();
    this.updateLights(dt);
    this.groundUniforms.uTime.value = t;
    // animated water and lava
    this.waterTex.offset.set((t * 0.05) % 1, (t * 0.03) % 1);
    if (this.lavaTex) this.lavaTex.offset.set((t * 0.08) % 1, (Math.sin(t * 0.5) * 0.1) % 1);
    const view = this.viewPolygon();
    this.view = view;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of view) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    this.tv = {
      x0: Math.max(0, Math.floor(minX) - 1),
      y0: Math.max(0, Math.floor(minY) - 2),
      x1: Math.min(R.W, Math.ceil(maxX) + 1),
      y1: Math.min(R.H, Math.ceil(maxY) + 2),
    };
    this.syncStructures(t);
    this.syncDeposits();
    this.syncSprites(ui, t);
    this.syncParticles();
    if (this.frame % 2 === 0 || dt === 0) this.drawOverlay(ui, t);
    this.applyShake();
    this.gl.render(this.scene, this.camera);
    this.drawHud(ui, t);
  }

  applyShake() {
    const s = this.B.shakeT;
    if (s > 0) {
      this.camera.position.x += (Math.random() - 0.5) * s * 0.35;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.25;
      this.camera.updateMatrixWorld();
    }
  }

  inView(x, y, m = 2) {
    const tv = this.tv;
    return x >= tv.x0 - m && x <= tv.x1 + m && y >= tv.y0 - m && y <= tv.y1 + m;
  }

  /** Redraw changed terrain tiles in the atlas, and burn or regrow trees. */
  syncTiles() {
    const R = this.B;
    if (!R.tileChanges.length) return;
    const W = R.W;
    for (const i of R.tileChanges) {
      this.texTiles[i] = flatTile(R.tiles[i]);
      try {
        renderRealmTile(this.atlasCtx, this.texTiles, W, R.H, i % W, Math.floor(i / W), this.biome, this.seed);
      } catch {
        this.atlasCtx.fillStyle = tileColor(this.texTiles[i], this.biome);
        this.atlasCtx.fillRect((i % W) * TILE, Math.floor(i / W) * TILE, TILE, TILE);
      }
      if (this.treeOf.has(i)) this.setTrees(i, R.tiles[i] === T.FOREST);
    }
    R.tileChanges.length = 0;
    this.atlasDirty = true;
    this.minimap.dirty = true;
  }

  flushAtlas() {
    if (!this.atlasDirty) return;
    this.atlasFlushT = (this.atlasFlushT || 0) - 1;
    if (this.atlasFlushT > 0) return;
    this.atlasFlushT = 15; // frames
    this.atlasDirty = false;
    this.atlasTex.needsUpdate = true;
  }

  syncOwner() {
    const R = this.B;
    if (this.ownerVersion === R.territoryVersion) return;
    this.ownerVersion = R.territoryVersion;
    const d = this.ownerData;
    for (let i = 0; i < R.owner.length; i++) {
      const o = R.owner[i];
      d[i * 4] = o === 0 ? 255 : 0;
      d[i * 4 + 1] = o === 1 ? 255 : 0;
      d[i * 4 + 2] = 0;
      d[i * 4 + 3] = 255;
    }
    this.ownerTex.needsUpdate = true;
  }

  updateLights(dt) {
    const R = this.B;
    const k = R.nightK;
    const chaos = R.ageIdx >= 3 ? 1 : 0;
    this.groundUniforms.uNight.value = k;
    const day = new THREE.Color(chaos ? 0xd8c8f0 : 0xdff0ff);
    const night = new THREE.Color(0x4a5aa8);
    this.hemi.color.copy(day).lerp(night, k);
    this.hemi.groundColor.set(0x5a4a3a).lerp(new THREE.Color(0x141428), k);
    this.hemi.intensity = 1.15 - k * 0.58;
    this.sun.intensity = 1.5 - k * 1.2;
    this.sun.color.set(chaos ? 0xffd6e8 : 0xfff1d6).lerp(new THREE.Color(0x8aa0ff), k);
    const fogDay = new THREE.Color(chaos ? 0xb8a0d8 : 0xa8d0e8);
    const fogNight = new THREE.Color(0x0c1230);
    this.fog.color.copy(fogDay).lerp(fogNight, k);
    this.scene.background.copy(this.fog.color);
    // torches: the light sources nearest the camera target
    if (k > 0.05) {
      const cands = [];
      for (const s of R.structures) {
        if (!s.alive || s.built < 1 || s.isWall || s.struct === 'nest') continue;
        const pow = s.struct === 'keep' ? 2.2 : s.struct === 'tower' || s.struct === 'shrine' || s.struct === 'temple' ? 1.4 : 1;
        cands.push({ x: s.x, y: s.y, h: (s.struct === 'keep' ? 2.6 : 1.8), pow, col: s.struct === 'temple' || s.struct === 'shrine' ? 0xffe28a : 0xffa860 });
      }
      for (const team of [0, 1]) {
        const h = R.players[team]?.hero;
        if (h?.alive) cands.push({ x: h.x, y: h.y, h: 1.4, pow: 1.1, col: 0xbfd8ff });
      }
      for (const i of this.lavaTiles) if (Math.random() < 0.02) cands.push({ x: (i % R.W) + 0.5, y: Math.floor(i / R.W) + 0.5, h: 0.5, pow: 1, col: 0xff6a1e });
      const cx = this.cam.x;
      const cy = this.cam.y;
      cands.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2));
      this.torches.forEach((l, n) => {
        const c = cands[n];
        if (!c) {
          l.intensity = 0;
          return;
        }
        l.position.set(c.x, this.groundH(c.x, c.y) + c.h, c.y);
        l.color.setHex(c.col);
        l.intensity = k * 2.6 * c.pow * (1 + Math.sin(this.t * 9 + n) * 0.05);
        l.distance = 5.5 * Math.sqrt(c.pow);
      });
    } else this.torches.forEach((l) => (l.intensity = 0));
  }

  // ───────────────────────── structures & deposits ─────────────────────────

  syncStructures(t) {
    const R = this.B;
    const seen = new Set();
    for (const e of R.entities) {
      if (!e.alive) continue;
      const isStruct = !!e.struct;
      const cardModel = !isStruct && e.kind === 'building' && e.cardId;
      if (!isStruct && !cardModel) continue;
      let v = this.views.get(e.id);
      if (cardModel && v === undefined) {
        const g = safeModel(() => Models.cardBuildingModel?.(e.isWall ? 'wall' : e.cardId, e.team === 0 || e.team === 1 ? e.team : null));
        if (!g) {
          this.views.set(e.id, null); // drawn as a sprite instead
          continue;
        }
        v = { obj: g, kind: 'card' };
        this.place(v, e);
        this.views.set(e.id, v);
      }
      if (v === null) continue;
      seen.add(e.id);
      if (isStruct) {
        const stage = e.built >= 1 ? 3 : e.built < 0.34 ? 0 : e.built < 0.67 ? 1 : 2;
        if (!v || v.stage !== stage || v.team !== e.team) {
          if (v) this.dropView(v);
          v = { kind: 'struct', stage, team: e.team, obj: this.structureObject(e, stage) };
          this.place(v, e);
          this.views.set(e.id, v);
        }
      }
      this.animateStructure(v, e, t);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id) && v && (v.kind === 'struct' || v.kind === 'card')) {
        this.dropView(v);
        this.views.delete(id);
      } else if (v === null && !R.entities.some((e) => e.id === id && e.alive)) this.views.delete(id);
    }
  }

  structureObject(e, stage) {
    const fp = e.fp || { w: 1, h: 1 };
    const group = new THREE.Group();
    const team = e.team === 0 || e.team === 1 ? e.team : null;
    if (e.struct !== 'nest' && !e.isWall) group.add(basePlate(fp.w, fp.h, team));
    let model;
    if (stage < 3) model = safeModel(() => Models.scaffoldModel?.(fp.w, fp.h, [0.12, 0.5, 0.85][stage]));
    else model = safeModel(() => Models.structureModel?.(e.struct, team));
    if (!model) model = fallbackBox(fp.w, fp.h, e.struct === 'keep' ? 2.2 : e.struct === 'tower' ? 2.4 : 1.2, team);
    model.position.y = e.struct === 'nest' || e.isWall ? 0 : 0.12;
    group.add(model);
    group.userData.model = model;
    group.userData.flag = model.getObjectByName?.('flag');
    group.userData.glow = model.getObjectByName?.('glow');
    group.userData.eyes = model.getObjectByName?.('eyes');
    return group;
  }

  place(v, e) {
    const fp = e.fp || { x0: Math.floor(e.x), y0: Math.floor(e.y), w: 1, h: 1 };
    let h = -Infinity;
    for (let y = fp.y0; y < fp.y0 + fp.h; y++) for (let x = fp.x0; x < fp.x0 + fp.w; x++) h = Math.max(h, this.heights[y * this.B.W + x] ?? 0.1);
    v.baseY = Math.max(WATER_Y, h);
    v.obj.position.set(fp.x0 + fp.w / 2, v.baseY, fp.y0 + fp.h / 2);
    this.scene.add(v.obj);
  }

  dropView(v) {
    this.scene.remove(v.obj);
  }

  animateStructure(v, e, t) {
    const o = v.obj;
    const flash = e.flash || 0;
    o.position.y = v.baseY + (flash > 0.5 ? (Math.random() - 0.5) * 0.06 : 0);
    const s = 1 - flash * 0.03;
    o.scale.set(s, 1 + flash * 0.02, s);
    const ud = o.userData;
    if (ud.flag) ud.flag.rotation.y = Math.sin(t * 2.4 + e.id) * 0.35;
    if (ud.glow?.material?.emissiveIntensity != null) ud.glow.material.emissiveIntensity = 0.6 + Math.sin(t * 2) * 0.3;
    if (ud.eyes) ud.eyes.visible = Math.sin(t * 1.3 + e.id) > -0.85;
    if (e.kind === 'building' && e.hidden) o.scale.y = 0.35;
    // truce dome over keeps
    if (e.struct === 'keep') {
      const on = e.status?.invuln > 0;
      if (on && !ud.dome) {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.18, depthWrite: false }));
        dome.renderOrder = 6;
        o.add(dome);
        ud.dome = dome;
      }
      if (ud.dome) {
        ud.dome.visible = on;
        ud.dome.material.opacity = 0.14 + Math.sin(t * 3) * 0.05;
      }
    }
    if (e.struct === 'tower' && e.element && !ud.gem) {
      const sp = new THREE.Sprite(this.spriteMaterial(this.spriteTex(`elem_${e.element}`, 'idle', 0, null, false, 0)));
      sp.center.set(0.5, 0);
      sp.scale.set(0.6, 0.6, 1);
      sp.position.set(0, 3.0, 0);
      o.add(sp);
      ud.gem = sp;
    }
    if (ud.gem) ud.gem.position.y = 2.9 + Math.sin(t * 3) * 0.08;
  }

  syncDeposits() {
    const R = this.B;
    for (const d of R.deposits) {
      let v = this.depositViews.get(d.id);
      if (d.amount <= 0) {
        if (v) {
          this.scene.remove(v);
          this.depositViews.delete(d.id);
        }
        continue;
      }
      if (!v) {
        v = safeModel(() => Models.depositModel?.(d.rich)) || fallbackBox(0.7, 0.7, 0.4, null, 0xe8743b);
        v.position.set(d.x, this.groundH(d.x, d.y), d.y);
        this.scene.add(v);
        this.depositViews.set(d.id, v);
      }
      const k = 0.55 + 0.45 * (d.amount / d.max);
      v.scale.set(k, k, k);
    }
  }

  // ───────────────────────── sprites ─────────────────────────

  /** Texture for one sprite frame (cached). */
  spriteTex(key, anim, frame, team, flip, flash) {
    const ck = `${key}|${anim}|${frame}|${team}|${flip ? 1 : 0}|${flash}`;
    let c = this.texCache.get(ck);
    if (c) return c;
    let w = 16;
    let h = 16;
    try {
      const s = spriteSize(key);
      w = s.w;
      h = s.h;
    } catch {
      /* unknown key */
    }
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    try {
      drawSprite(ctx, key, w / 2, h, { anim, frame, team, flip, flash: flash / 2 });
    } catch {
      ctx.fillStyle = team === 1 ? '#d8453b' : team === 0 ? '#3b7dd8' : '#999';
      ctx.fillRect(w / 2 - 3, h - 8, 6, 8);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    c = { tex, w, h };
    this.texCache.set(ck, c);
    return c;
  }

  spriteMaterial(st, opts = {}) {
    const ck = `${st.tex.id}|${opts.alpha ?? 1}|${opts.rot ?? 0}`;
    let m = this.matCache.get(ck);
    if (!m) {
      const a = opts.alpha ?? 1;
      m = new THREE.SpriteMaterial({ map: st.tex, alphaTest: a < 1 ? 0.05 : 0.5, transparent: a < 1, opacity: a, depthWrite: a >= 1, rotation: opts.rot || 0 });
      m.userData.night = true;
      this.matCache.set(ck, m);
    }
    return m;
  }

  nextSprite() {
    let s = this.spritePool[this.spriteUsed];
    if (!s) {
      s = new THREE.Sprite();
      s.center.set(0.5, 0);
      this.scene.add(s);
      this.spritePool.push(s);
    }
    this.spriteUsed++;
    s.visible = true;
    return s;
  }

  frameOf(key, anim, t) {
    const def = SPRITES[key];
    let n = 1;
    try {
      n = frameCount(key, anim);
    } catch {
      n = 1;
    }
    if (n <= 1) return 0;
    return Math.floor(t * (def?.fps || 6)) % n;
  }

  /** Billboards for units, heroes, pets, villagers, critters, pickups, projectiles and card-building fallbacks. */
  syncSprites(ui, t) {
    const R = this.B;
    this.spriteUsed = 0;
    let nShadow = 0;
    const o = this.tmpObj;
    const night = R.nightK;
    const tint = new THREE.Color(1, 1, 1).lerp(new THREE.Color(0.55, 0.6, 0.9), night * 0.8);
    const shadow = (x, y, r, hgt) => {
      if (nShadow >= 600) return;
      o.position.set(x, hgt + 0.02, y);
      o.rotation.set(0, 0, 0);
      o.scale.set(r * 2, 1, r * 1.3);
      o.updateMatrix();
      this.shadows.setMatrixAt(nShadow++, o.matrix);
    };
    for (const e of R.entities) {
      if (!e.alive || e.struct) continue;
      if (e.kind === 'building' && this.views.get(e.id)) continue;
      if (!this.inView(e.x, e.y, 3)) continue;
      const gh = this.groundH(e.x, e.y);
      let key = e.sprite;
      let anim = e.anim || 'idle';
      let alpha = 1;
      let lift = 0;
      let scale = UNIT_SCALE * (e.boss ? 1.25 : 1);
      const st = e.status || {};
      if (e.kind === 'troop' && e.deployT > 0) {
        const k = Math.min(1, e.deployT);
        lift += k * k * 2.5;
      }
      if (st.invisible > 0) alpha = e.team === 0 ? 0.45 : 0.18;
      if (e.flying) lift += 0.9 + Math.sin(t * 4 + e.id) * 0.06;
      if (st.freeze > 0) anim = 'idle';
      if (e.kind === 'building' && e.hidden) anim = 'hidden';
      const flash = (e.flash || 0) > 0.5 ? 2 : (e.flash || 0) > 0.15 ? 1 : 0;
      let tex;
      if (e.kind === 'hero') {
        if (st.invuln > 0 && Math.floor(t * 12) % 2 === 0) alpha = 0.5;
        tex = this.heroTexture(e, t, flash);
        scale = UNIT_SCALE;
      } else if (e.kind === 'pickup') {
        key = e.type === 'faith' ? 'faith_orb' : e.type === 'heart' ? 'heart_orb' : e.type === 'relic' ? 'brick' : 'brick_orb';
        lift += 0.25 + Math.abs(Math.sin(t * 3 + e.id)) * 0.2;
        scale = e.type === 'relic' ? 2.4 : 1.6;
        tex = this.spriteTex(key, 'idle', this.frameOf(key, 'idle', t + e.id), e.type === 'relic' ? 1 : null, false, 0);
      } else {
        const fi = this.frameOf(key, anim, e.age ?? t);
        tex = this.spriteTex(key, anim, fi, e.team === 0 || e.team === 1 ? e.team : null, e.facing < 0, flash);
      }
      const s = this.nextSprite();
      s.material = this.spriteMaterial(tex, { alpha });
      s.material.color.copy(tint);
      if (st.freeze > 0) s.material.color.setRGB(0.7, 0.9, 1.2);
      s.scale.set((tex.w / TILE) * scale, (tex.h / TILE) * scale, 1);
      s.position.set(e.x, gh + lift, e.y);
      s.renderOrder = 3;
      if (e.kind !== 'pickup' || true) shadow(e.x, e.y, Math.max(0.22, (e.r || 0.3) * 0.9) * (e.flying ? 0.7 : 1), gh);
      if (e.kind === 'troop' && e.special?.builder && e.carry) {
        const b = this.nextSprite();
        const bt = this.spriteTex('brick', 'idle', 0, null, false, 0);
        b.material = this.spriteMaterial(bt);
        b.scale.set(0.4, 0.32, 1);
        b.position.set(e.x, gh + lift + 0.95, e.y);
      }
      // status particles the flat renderer also emits
      if (st.burn?.t > 0 && Math.random() < 0.5) R.fx.push({ x: e.x + (Math.random() - 0.5) * e.r, y: e.y - (e.h || 1) * 0.5, vx: 0, vy: -1.6, life: 0.3, max: 0.3, color: Math.random() < 0.5 ? '#ff7a2e' : '#ffd166', size: 1, kind: 'fire' });
      if ((st.poison?.t > 0 || st.plague?.t > 0) && Math.random() < 0.25) R.fx.push({ x: e.x + (Math.random() - 0.5) * e.r, y: e.y - (e.h || 1) * 0.6, vx: 0, vy: -0.8, life: 0.5, max: 0.5, color: st.plague?.t > 0 ? '#9be35a' : '#7dd35a', size: 1 });
    }
    // projectiles
    for (const p of R.projectiles) {
      if (!p.alive || !this.inView(p.x, p.y, 2)) continue;
      const key = PROJ_SPRITE[p.proj];
      if (!key) continue;
      const ang = p.dir ?? Math.atan2((p.ty ?? p.y) - p.sy, (p.tx ?? p.x) - p.sx);
      const rotBucket = Math.round(((-ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 8)) % 16;
      const tex = this.spriteTex(key, 'idle', 0, null, false, 0);
      const s = this.nextSprite();
      s.material = this.spriteMaterial(tex, { rot: (rotBucket * Math.PI) / 8 });
      s.material.color.copy(tint);
      s.scale.set((tex.w / TILE) * 1.3, (tex.h / TILE) * 1.3, 1);
      const gh = this.groundH(p.x, p.y);
      s.position.set(p.x, gh + 0.55 + (p.z || 0), p.y);
      s.renderOrder = 4;
    }
    // card ghost while dragging
    const g = ui.ghost;
    if (g?.sprite && g.pos) {
      const n = Math.min(g.count || 1, 5);
      const tex = this.spriteTex(g.sprite, 'idle', 0, 0, false, 0);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const sp = n === 1 ? 0 : n <= 3 ? 0.55 : 0.8;
        const s = this.nextSprite();
        s.material = this.spriteMaterial(tex, { alpha: g.valid ? 0.7 : 0.35 });
        s.scale.set((tex.w / TILE) * UNIT_SCALE, (tex.h / TILE) * UNIT_SCALE, 1);
        const x = g.pos.x + Math.cos(a) * sp;
        const y = g.pos.y + Math.sin(a) * sp * 0.8;
        s.position.set(x, this.groundH(x, y), y);
      }
    }
    // build ghost model
    this.syncBuildGhost(ui.build);
    for (let i = this.spriteUsed; i < this.spritePool.length; i++) this.spritePool[i].visible = false;
    this.shadows.count = nShadow;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  heroTexture(h, t, flash) {
    let c = this.heroCanvases.get(h.team);
    if (!c) {
      const cv = document.createElement('canvas');
      cv.width = 36;
      cv.height = 30;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      c = { cv, ctx: cv.getContext('2d'), tex, w: 36, h: 30 };
      this.heroCanvases.set(h.team, c);
    }
    const ctx = c.ctx;
    ctx.clearRect(0, 0, c.w, c.h);
    ctx.imageSmoothingEnabled = false;
    if (h.form === 3) {
      ctx.fillStyle = hexA(this.B.elementColor(h.def.element), 0.22 + 0.08 * Math.sin(t * 5));
      ctx.beginPath();
      ctx.ellipse(18, 20, 9, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    try {
      drawHero(ctx, { heroId: h.heroId, form: h.form, skin: h.skin, x: 18, y: 29, anim: h.anim, t: h.age, team: h.team, flip: h.facing < 0, flash: flash / 2, weaponId: h.weapon.id, aim: h.aim });
    } catch {
      ctx.fillStyle = h.team === 0 ? '#3b7dd8' : '#d8453b';
      ctx.fillRect(14, 14, 8, 15);
    }
    c.tex.needsUpdate = true;
    return c;
  }

  syncBuildGhost(b) {
    if (!b || !STRUCTURES[b.id] || b.x0 == null) {
      if (this.ghost) this.ghost.obj.visible = false;
      return;
    }
    if (!this.ghost || this.ghost.id !== b.id) {
      if (this.ghost) this.scene.remove(this.ghost.obj);
      const obj = safeModel(() => Models.structureModel?.(b.id, 0)) || fallbackBox(STRUCTURES[b.id].w, STRUCTURES[b.id].h, 1.5, 0);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false });
      obj.traverse((n) => {
        if (n.isMesh) {
          const hasColors = !!n.geometry.attributes.color;
          n.material = hasColors ? mat : new THREE.MeshLambertMaterial({ color: n.material.color || 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
          n.renderOrder = 7;
        }
      });
      this.scene.add(obj);
      this.ghost = { id: b.id, obj };
    }
    const def = STRUCTURES[b.id];
    const g = this.ghost.obj;
    g.visible = true;
    const cx = b.x0 + def.w / 2;
    const cy = b.y0 + def.h / 2;
    g.position.set(cx, this.groundH(cx, cy) + 0.12 + Math.sin(this.t * 4) * 0.04, cy);
    g.traverse((n) => {
      if (n.isMesh && n.material?.emissive) n.material.emissive.setHex(b.valid ? 0x103010 : 0x501010);
    });
  }

  // ───────────────────────── particles ─────────────────────────

  syncParticles() {
    const R = this.B;
    let n = 0;
    const max = this.pMax;
    const pos = this.pPos;
    const col = this.pCol;
    const size = this.pSize;
    const c = new THREE.Color();
    for (const p of R.fx) {
      if (n >= max) break;
      if (!this.inView(p.x, p.y, 2)) continue;
      if (p.gz === undefined) {
        p.gz = p.y;
        p.gh = this.groundH(p.x, p.y) + 0.35;
      }
      const rising = p.kind === 'fire' || p.kind === 'twinkle' || p.kind === 'smoke' || p.kind === 'brick';
      const dy = p.y - p.gz;
      let z;
      let h;
      if (rising) {
        z = p.gz;
        h = p.gh - dy;
      } else {
        z = p.gz + dy * 0.5;
        h = p.gh + Math.max(0, -dy) * 0.8;
      }
      pos[n * 3] = p.x;
      pos[n * 3 + 1] = h;
      pos[n * 3 + 2] = z;
      const a = Math.max(0, Math.min(1, p.life / (p.max || 1)));
      try {
        c.set(p.kind === 'brick' ? '#e8743b' : p.color || '#ffffff');
      } catch {
        c.set('#ffffff');
      }
      col[n * 4] = c.r;
      col[n * 4 + 1] = c.g;
      col[n * 4 + 2] = c.b;
      col[n * 4 + 3] = p.kind === 'smoke' ? a * 0.5 : p.kind === 'twinkle' ? a * (0.5 + 0.5 * Math.sin(p.life * 30)) : a;
      size[n] = (p.kind === 'smoke' ? p.size + (1 - a) * 4 : p.kind === 'brick' ? 4 : p.size || 2) * 1.2;
      n++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }

  // ───────────────────────── ground overlay ─────────────────────────

  drawOverlay(ui, t) {
    const R = this.B;
    const tv = this.tv;
    const busy = ui.summonZone || ui.build || ui.ghost || ui.selectedStructure || R.decals.length || R.cracks.length || R.areas.length || R.rings.length || R.warnings.length
      || R.players[0]?.hero?.moveTo || R.players[0]?.hero?.focus || (R.shrine && R.shrine.capProg > 0) || this.anyGround();
    const u = this.groundUniforms.uOverlayRect.value;
    if (!busy) {
      u.set(-10, -10, 0.001, 0.001);
      return;
    }
    const w = Math.max(1, tv.x1 - tv.x0);
    const h = Math.max(1, tv.y1 - tv.y0);
    const cv = this.overlayCanvas;
    const pw = Math.min(1024, w * OVERLAY_PPT);
    const ph = Math.min(1024, h * OVERLAY_PPT);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
      this.overlayTex.dispose();
      this.overlayTex = new THREE.CanvasTexture(cv);
      this.overlayTex.colorSpace = THREE.SRGBColorSpace;
      this.overlayTex.generateMipmaps = false;
      this.overlayTex.minFilter = THREE.LinearFilter;
      this.groundUniforms.uOverlay.value = this.overlayTex;
    }
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, pw, ph);
    const k = pw / (w * TILE);
    c.setTransform(k, 0, 0, ph / (h * TILE), -tv.x0 * TILE * k, -tv.y0 * TILE * (ph / (h * TILE)));
    c.imageSmoothingEnabled = false;
    const p = this.painter;
    p.t = t;
    p.tv = tv;
    try {
      if (ui.summonZone) p.drawSummonZone(c, ui.summonZone);
      p.drawRealmGround(c, t);
      p.drawAreas(c, t);
      this.drawGroundRings(c, t);
      p.drawWarnings(c, t);
      this.drawMarkers(c, ui, t);
    } catch (err) {
      if (!this.overlayWarned) {
        this.overlayWarned = true;
        console.warn('overlay', err);
      }
    }
    this.overlayTex.needsUpdate = true;
    u.set(tv.x0, tv.y0, w, h);
  }

  anyGround() {
    const R = this.B;
    const tv = this.tv;
    for (let y = tv.y0; y < tv.y1; y++) for (let x = tv.x0; x < tv.x1; x++) {
      const i = y * R.W + x;
      if (R.fireGrid[i] > 0 || R.wasteGrid[i] > 0) return true;
    }
    return false;
  }

  drawGroundRings(c, t) {
    for (const r of this.B.rings) {
      const kk = 1 - r.t / r.max;
      const rad = r.r * TILE * (r.fill ? 0.5 + kk * 0.6 : 0.4 + kk * 0.6);
      c.globalAlpha = Math.max(0, r.t / r.max);
      if (r.arc) continue;
      c.strokeStyle = r.color;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(r.x * TILE, r.y * TILE, rad, 0, Math.PI * 2);
      if (r.fill) {
        c.fillStyle = hexA(r.color, 0.35 * (1 - kk));
        c.fill();
      }
      c.stroke();
      c.globalAlpha = 1;
    }
    void t;
  }

  drawMarkers(c, ui, t) {
    const R = this.B;
    const hero = R.players[0]?.hero;
    if (hero?.alive && hero.moveTo) {
      const x = hero.moveTo.x * TILE;
      const y = hero.moveTo.y * TILE;
      const s = 4 + Math.sin(t * 8);
      c.strokeStyle = '#9cc8ff';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x - s, y - s);
      c.lineTo(x + s, y + s);
      c.moveTo(x + s, y - s);
      c.lineTo(x - s, y + s);
      c.stroke();
    }
    if (hero?.alive && hero.focus?.alive) {
      const f = hero.focus;
      c.strokeStyle = `rgba(255,225,74,${0.6 + 0.4 * Math.sin(t * 10)})`;
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(f.x * TILE, f.y * TILE, (f.r + 0.3) * TILE, (f.r + 0.3) * TILE * 0.8, 0, 0, Math.PI * 2);
      c.stroke();
    }
    const g = ui.ghost;
    if (g?.pos) {
      const x = g.pos.x * TILE;
      const y = g.pos.y * TILE;
      const r = (g.radius || 0.6) * TILE;
      c.fillStyle = g.valid ? 'rgba(255,255,255,0.18)' : 'rgba(255,80,80,0.22)';
      c.strokeStyle = g.valid ? 'rgba(255,255,255,0.9)' : 'rgba(255,90,90,0.95)';
      c.lineWidth = 2;
      c.setLineDash([5, 3]);
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.setLineDash([]);
      if (g.range) {
        c.strokeStyle = 'rgba(127,184,255,0.5)';
        c.beginPath();
        c.arc(x, y, g.range * TILE, 0, Math.PI * 2);
        c.stroke();
      }
    }
    const b = ui.build;
    if (b && STRUCTURES[b.id] && b.x0 != null) {
      const def = STRUCTURES[b.id];
      c.fillStyle = b.valid ? 'rgba(120,255,140,0.35)' : 'rgba(255,80,80,0.38)';
      c.fillRect(b.x0 * TILE, b.y0 * TILE, def.w * TILE, def.h * TILE);
      c.strokeStyle = b.valid ? '#8dff9a' : '#ff6a6a';
      c.lineWidth = 2;
      c.strokeRect(b.x0 * TILE + 1, b.y0 * TILE + 1, def.w * TILE - 2, def.h * TILE - 2);
      const rr = (b.id === 'tower' ? def.range : def.claim) || 0;
      if (rr) {
        c.strokeStyle = 'rgba(127,184,255,0.6)';
        c.setLineDash([4, 4]);
        c.beginPath();
        c.arc((b.x0 + def.w / 2) * TILE, (b.y0 + def.h / 2) * TILE, rr * TILE, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
      }
    }
    const s = ui.selectedStructure;
    if (s?.alive) {
      c.strokeStyle = '#ffcf4a';
      c.lineWidth = 2;
      c.setLineDash([3, 3]);
      c.strokeRect(s.fp.x0 * TILE - 1, s.fp.y0 * TILE - 1, s.fp.w * TILE + 2, s.fp.h * TILE + 2);
      c.setLineDash([]);
      if (s.range) {
        c.strokeStyle = 'rgba(255,207,74,0.5)';
        c.beginPath();
        c.arc(s.x * TILE, s.y * TILE, s.range * TILE, 0, Math.PI * 2);
        c.stroke();
      }
    }
    const sh = R.shrine;
    if (sh) {
      const col = sh.team === 0 ? '#7fb8ff' : sh.team === 1 ? '#ff8a7f' : '#ffe28a';
      c.strokeStyle = hexA(col, 0.45);
      c.lineWidth = 2;
      c.setLineDash([3, 5]);
      c.beginPath();
      c.arc(sh.x * TILE, sh.y * TILE, 3 * TILE, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
      if (sh.capProg > 0 && sh.capTeam >= 0) {
        c.strokeStyle = sh.capTeam === 0 ? '#7fb8ff' : '#ff8a7f';
        c.lineWidth = 4;
        c.beginPath();
        c.arc(sh.x * TILE, sh.y * TILE, 3 * TILE, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sh.capProg);
        c.stroke();
      }
    }
  }

  // ───────────────────────── screen-space layer ─────────────────────────

  drawHud(ui, t) {
    const R = this.B;
    const c = this.hctx;
    const { dpr, cssW, cssH } = this.layout;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.hud.width, this.hud.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    // pixels per tile at the camera target, for sizing bars and text
    const a = this.toCss(this.cam.x, this.cam.y, 0);
    const b = this.toCss(this.cam.x + 1, this.cam.y, 0);
    const ppt = Math.max(8, Math.abs(b.x - a.x));
    this.ppt = ppt;
    const proj = (x, y, h) => this.toCss(x, y, this.groundH(x, y) + h);
    const onScreen = (p) => p.x > -40 && p.y > -40 && p.x < cssW + 40 && p.y < cssH + 40 && p.z < 1;
    // beams, bolts and trails
    for (const bm of R.beams) {
      const p0 = proj(bm.x0, bm.y0, 0.6);
      const p1 = proj(bm.x1, bm.y1, 0.5);
      c.globalAlpha = Math.max(0, bm.t / bm.max);
      c.strokeStyle = bm.color;
      c.lineWidth = Math.max(1.5, (bm.w || 1) * ppt * 0.08);
      c.beginPath();
      c.moveTo(p0.x, p0.y);
      c.lineTo(p1.x, p1.y);
      c.stroke();
    }
    for (const bo of R.bolts) {
      c.globalAlpha = Math.max(0, bo.t / bo.max);
      c.strokeStyle = bo.color;
      c.lineWidth = Math.max(1.5, bo.w * ppt * 0.06);
      c.beginPath();
      bo.pts.forEach((p, i) => {
        const q = proj(p.x, p.y, 0.5);
        if (i) c.lineTo(q.x, q.y);
        else c.moveTo(q.x, q.y);
      });
      c.stroke();
    }
    for (const tr of R.trails) {
      const p0 = proj(tr.x0, tr.y0, 0.4);
      const p1 = proj(tr.x1, tr.y1, 0.4);
      c.globalAlpha = Math.max(0, tr.t / tr.max) * 0.8;
      c.strokeStyle = tr.color;
      c.lineWidth = Math.max(2, ppt * 0.12);
      c.beginPath();
      c.moveTo(p0.x, p0.y);
      c.lineTo(p1.x, p1.y);
      c.stroke();
    }
    c.globalAlpha = 1;
    // health bars and status
    for (const e of R.entities) {
      if (!e.alive || !this.inView(e.x, e.y, 2)) continue;
      if (e.kind === 'pickup' || e.kind === 'critter') continue;
      const st = e.status || {};
      if (e.struct) {
        this.structBar(c, e, ppt, t);
        continue;
      }
      if (e.kind === 'building' && this.views.get(e.id)) {
        if (e.hp < e.maxHp || e.lifetime) this.bar(c, proj(e.x, e.y, 1.3), e, ppt * 0.9, 3);
        continue;
      }
      const hgt = e.kind === 'hero' ? 1.75 : ((spriteH(e.sprite) / TILE) * UNIT_SCALE) + (e.flying ? 0.9 : 0) + 0.15;
      const p = proj(e.x, e.y, hgt);
      if (!onScreen(p)) continue;
      if (e.kind === 'hero') {
        this.heroBar(c, p, e, ppt);
        if (e.shield > 0) this.ring(c, proj(e.x, e.y, 0.9), ppt * 0.75, '#7fd7ff', t);
        if (e.team === 0) {
          // a soft marker so your hero is easy to find
          const g = proj(e.x, e.y, 0.02);
          c.strokeStyle = 'rgba(127,184,255,0.9)';
          c.lineWidth = 2;
          c.beginPath();
          c.ellipse(g.x, g.y, ppt * 0.5, ppt * 0.28, 0, 0, Math.PI * 2);
          c.stroke();
        }
      } else if (e.hp < e.maxHp && !(st.invisible > 0 && e.team !== 0)) {
        this.bar(c, p, e, Math.max(14, Math.min(30, (e.r || 0.4) * ppt * 2)), 3);
      }
      if (st.stun > 0) {
        for (let i = 0; i < 3; i++) {
          const ang = t * 6 + (i * Math.PI * 2) / 3;
          c.fillStyle = '#ffe14a';
          c.fillRect(Math.round(p.x + Math.cos(ang) * 8) - 2, Math.round(p.y - 6 + Math.sin(ang) * 3) - 2, 4, 4);
        }
      }
      if (e.boss) {
        c.font = `9px ${FONT}`;
        c.textAlign = 'center';
        c.fillStyle = '#ffcf4a';
        c.fillText('BOSS', p.x, p.y - 12);
      }
    }
    // floating numbers
    c.textAlign = 'center';
    for (const tx of R.texts) {
      if (!this.inView(tx.x, tx.y, 1)) continue;
      const p = this.toCss(tx.x, tx.y + 1.2, this.groundH(tx.x, tx.y + 1.2) + 1.2 + (1 - tx.t / tx.max) * 0.6);
      c.globalAlpha = Math.min(1, tx.t / tx.max + 0.2);
      c.font = `${tx.scale > 1.1 ? 12 : 9}px ${FONT}`;
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(0,0,0,0.85)';
      c.strokeText(tx.text, Math.round(p.x), Math.round(p.y));
      c.fillStyle = tx.color;
      c.fillText(tx.text, Math.round(p.x), Math.round(p.y));
    }
    c.globalAlpha = 1;
    // emotes over keeps
    for (const em of R.emotes) {
      const p = proj(em.x, em.y + 3.2, 3.2);
      const kk = 1 - em.t / em.max;
      const pop = kk < 0.15 ? kk / 0.15 : 1;
      c.globalAlpha = em.t < 0.3 ? em.t / 0.3 : 1;
      c.fillStyle = '#ffffff';
      c.fillRect(Math.round(p.x - 22), Math.round(p.y - 44), 44, 40);
      c.strokeStyle = em.team === 0 ? '#3b7dd8' : '#d8453b';
      c.lineWidth = 2;
      c.strokeRect(Math.round(p.x - 22), Math.round(p.y - 44), 44, 40);
      try {
        drawSprite(c, `emote_${em.id}`, p.x, p.y - 8, { scale: 1.5 * pop, t });
      } catch {
        /* missing emote */
      }
      c.globalAlpha = 1;
    }
    if (R.whiteFlash > 0) {
      c.fillStyle = `rgba(255,255,255,${R.whiteFlash * 0.8})`;
      c.fillRect(0, 0, cssW, cssH);
    }
    // fireflies at night
    if (R.nightK > 0.5) {
      for (let i = 0; i < 14; i++) {
        const fx = (i * 97 + t * 9 * ((i % 3) + 1)) % cssW;
        const fy = ((i * 53 + Math.sin(t + i) * 30 + i * 61) % cssH + cssH) % cssH;
        c.fillStyle = `rgba(220,255,140,${0.35 + 0.35 * Math.sin(t * 3 + i)})`;
        c.fillRect(Math.round(fx), Math.round(fy), 2, 2);
      }
    }
    void ui;
  }

  bar(c, p, e, w, hgt) {
    const frac = Math.max(0, e.hp / e.maxHp);
    c.fillStyle = 'rgba(10,8,20,0.85)';
    c.fillRect(Math.round(p.x - w / 2) - 1, Math.round(p.y) - 1, Math.round(w) + 2, hgt + 2);
    c.fillStyle = e.team === 0 ? '#5aa2ff' : e.team === 1 ? '#ff5a4d' : '#c9b79c';
    c.fillRect(Math.round(p.x - w / 2), Math.round(p.y), Math.round(w * frac), hgt);
  }

  heroBar(c, p, h, ppt) {
    const w = Math.max(26, ppt * 1.1);
    this.bar(c, p, h, w, 4);
    if (h.maxArmor) {
      c.fillStyle = '#9ff6ff';
      c.fillRect(Math.round(p.x - w / 2), Math.round(p.y) + 5, Math.round(w * (h.armor / h.maxArmor)), 2);
    }
    for (let i = 0; i < 3; i++) {
      c.fillStyle = i < h.form ? this.B.elementColor(h.def.element) : 'rgba(255,255,255,0.3)';
      c.fillRect(Math.round(p.x - 7 + i * 5), Math.round(p.y) - 6, 3, 3);
    }
  }

  structBar(c, e, ppt, t) {
    if (e.struct === 'shrine') return;
    const scaffold = e.built < 1;
    const keep = e.struct === 'keep';
    if (!scaffold && e.hp >= e.maxHp && !keep) return;
    if (e.isWall && !scaffold && e.hp >= e.maxHp * 0.98) return;
    const hTop = keep ? 3.0 : e.struct === 'tower' ? 3.0 : e.struct === 'nest' ? 1.2 : e.isWall ? 1.0 : scaffold ? 1.4 : 2.0;
    const fp = e.fp;
    const cx = fp.x0 + fp.w / 2;
    const cy = fp.y0 + fp.h / 2;
    const p = this.toCss(cx, cy, this.groundH(cx, cy) + hTop);
    if (p.z >= 1) return;
    const w = Math.max(20, Math.min(90, fp.w * ppt * 0.85));
    const hgt = keep ? 6 : 4;
    c.fillStyle = 'rgba(10,8,20,0.85)';
    c.fillRect(Math.round(p.x - w / 2) - 1, Math.round(p.y) - 1, Math.round(w) + 2, hgt + 2);
    if (scaffold) {
      c.fillStyle = '#ffcf4a';
      c.fillRect(Math.round(p.x - w / 2), Math.round(p.y), Math.round(w * e.built), hgt);
      return;
    }
    c.fillStyle = e.team === 0 ? '#5aa2ff' : e.team === 1 ? '#ff5a4d' : '#c9b79c';
    c.fillRect(Math.round(p.x - w / 2), Math.round(p.y), Math.round(w * Math.max(0, e.hp / e.maxHp)), hgt);
    if (keep) {
      c.font = `10px ${FONT}`;
      c.textAlign = 'center';
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(0,0,0,0.85)';
      c.fillStyle = '#fff';
      const txt = String(Math.ceil(e.hp));
      c.strokeText(txt, Math.round(p.x), Math.round(p.y) - 4);
      c.fillText(txt, Math.round(p.x), Math.round(p.y) - 4);
    }
    void t;
  }

  ring(c, p, r, color, t) {
    c.strokeStyle = hexA(color, 0.6 + 0.2 * Math.sin(t * 6));
    c.lineWidth = 2;
    c.beginPath();
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.stroke();
  }

  // ───────────────────────── minimap ─────────────────────────

  ping(x, y) {
    this.minimap.ping(x, y, this.t);
  }

  drawMinimap(mc, s = 2) {
    this.minimap.draw(mc, s, this.t, this.view || this.viewPolygon());
  }

  dispose() {
    try {
      this.scene.traverse((n) => {
        n.geometry?.dispose?.();
      });
      for (const c of this.texCache.values()) c.tex.dispose();
      for (const m of this.matCache.values()) m.dispose();
      this.atlasTex.dispose();
      this.overlayTex.dispose();
      this.gl.dispose();
      this.gl.forceContextLoss?.();
    } catch {
      /* already gone */
    }
  }
}

// ───────────────────────── helpers ─────────────────────────

function spriteH(key) {
  try {
    return spriteSize(key)?.h || 14;
  } catch {
    return 14;
  }
}

function safeModel(fn) {
  try {
    const m = fn();
    return m || null;
  } catch (err) {
    if (!safeModel.warned) {
      safeModel.warned = true;
      console.warn('model', err);
    }
    return null;
  }
}

let scenMat = null;
function sceneryMaterial() {
  if (!scenMat) scenMat = Models.MODEL_MATERIALS?.solid || new THREE.MeshLambertMaterial({ vertexColors: true });
  return scenMat;
}

const plateCache = new Map();
/** A team-coloured LEGO baseplate with studs under a structure footprint. */
function basePlate(w, h, team) {
  const key = `${w}x${h}|${team}`;
  let g = plateCache.get(key);
  if (!g) {
    const color = new THREE.Color(team === 0 ? 0x2f5d9e : team === 1 ? 0x9e3a32 : 0x8a8a96);
    const studC = new THREE.Color(team === 0 ? 0x5a8fd6 : team === 1 ? 0xd0645a : 0xb8b8c4);
    const geos = [];
    const slab = new THREE.BoxGeometry(w - 0.04, 0.14, h - 0.04);
    slab.translate(0, 0.05, 0);
    paint(slab, color);
    geos.push(slab);
    for (let y = 0; y < h * 2; y++) {
      for (let x = 0; x < w * 2; x++) {
        // only studs around the edge so buildings sit on a clean plate
        if (x > 0 && y > 0 && x < w * 2 - 1 && y < h * 2 - 1) continue;
        const s = new THREE.CylinderGeometry(0.12, 0.12, 0.06, 6);
        s.translate(-w / 2 + 0.25 + x * 0.5, 0.15, -h / 2 + 0.25 + y * 0.5);
        paint(s, studC);
        geos.push(s);
      }
    }
    g = mergeSimple(geos);
    plateCache.set(key, g);
  }
  return new THREE.Mesh(g, sceneryMaterial());
}

function paint(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Merge non-indexed or indexed geometries that share position/normal/color(/uv) attributes. */
function mergeSimple(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color', 'uv']) {
    if (!list.every((g) => g.attributes[name])) continue;
    const size = list[0].attributes[name].itemSize;
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of list) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

function fallbackBox(w, h, height, team, color = null) {
  const g = new THREE.BoxGeometry(w * 0.8, height, h * 0.8);
  g.translate(0, height / 2, 0);
  const c = color ?? (team === 0 ? 0x3b7dd8 : team === 1 ? 0xd8453b : 0xb0a090);
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: c })));
  return grp;
}

function fallbackTree(v) {
  const trunk = new THREE.BoxGeometry(0.16, 0.4, 0.16);
  trunk.translate(0, 0.2, 0);
  paint(trunk, new THREE.Color(0x6b4a2a));
  const crown = new THREE.BoxGeometry(0.6 - v * 0.08, 0.55, 0.6 - v * 0.08);
  crown.translate(0, 0.62, 0);
  paint(crown, new THREE.Color(v === 1 ? 0x3e8a3a : 0x2f7a32));
  return mergeSimple([trunk, crown]);
}
