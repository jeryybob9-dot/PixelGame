// Procedural low-poly 3D models for the brick world (Realm Clash in 3D).
//
// Conventions: 1 tile = 1 world unit, y is up, the origin of every model is the centre of its footprint at
// ground level (y = 0), and the front / door faces +z. A footprint of w x h tiles spans x in [-w/2, w/2] and
// z in [-h/2, h/2]. Everything is built from vertex-coloured boxes, cylinders, cones and spheres and merged
// into as few meshes as possible. Models are cached per (id, team); callers get a .clone() whose geometry and
// materials are SHARED (do not dispose them per instance).
//
// Named children the renderer may animate:
//   flag  keep / outpost banner, pivot on the pole (sway with rotation.y)
//   eyes  nest eyes (blink with scale.y / visible)
//   glow  temple orb, shrine crystal, Faith Well liquid, tesla orb (pulse with scale)
//   top   watchtower deck (origin = deck floor centre, where the archer stands), card turret heads
import * as THREE from '../vendor/three.js';
import { teamColors } from '../art/palette.js';

// =============================================================================================
// Materials and colours
// =============================================================================================

/** Shared materials: `solid` (lit, vertex colours) and `glow` (unlit, vertex colours, for emissive bits). */
export const MODEL_MATERIALS = Object.freeze({
  solid: new THREE.MeshLambertMaterial({ vertexColors: true }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
});

const C = {
  brick: '#e8743b', brickHi: '#f0873c', brickLo: '#d4652f', brickDark: '#b5532f',
  gold: '#ffcf4a', goldHi: '#fff5bf', goldLo: '#d8901f',
  stone: '#a3a2bd', stoneHi: '#c8c9dc', stoneLo: '#8f8eab', stoneDark: '#5d5a7c',
  white: '#fbf7ef', marble: '#ece6f2', bone: '#f0e6c8', boneLo: '#b9a888',
  wood: '#94603a', woodHi: '#d49b5a', woodLo: '#5c3a2a',
  dark: '#3f2f55', deep: '#2a1b33', glass: '#66dcff', glassHi: '#e2f8ff',
  iron: '#5d5a7c', ironLo: '#3f2f55', steel: '#c8c9dc',
  leaf: '#43a047', leafHi: '#8de05e', leafLo: '#24603f',
  red: '#ee4a3d', redLo: '#a32e3b', pink: '#ff86cf', magenta: '#e04adf',
  purple: '#a65ef0', purpleLo: '#62309a', teal: '#3be8d0', cyan: '#66dcff', blue: '#2f86d6', navy: '#283a80',
};

const NEUTRAL_GOLD = { main: '#ffcf4a', dark: '#d8901f', light: '#fff5bf' };

/** Team colour set: 0 blue, 1 red, anything else neutral grey. */
function tc(team) {
  return teamColors(team === 0 || team === 1 ? team : null);
}

const rgbCache = new Map();
/** '#rrggbb' -> linear [r, g, b] (three.js working colour space). */
function rgb(hex) {
  if (Array.isArray(hex)) return hex;
  let v = rgbCache.get(hex);
  if (!v) {
    const c = new THREE.Color(hex);
    v = [c.r, c.g, c.b];
    rgbCache.set(hex, v);
  }
  return v;
}

/** Blend two hex colours in sRGB (t = 0 -> a). */
function mixHex(a, b, t) {
  const A = new THREE.Color(a);
  const B = new THREE.Color(b);
  return '#' + A.lerp(B, t).getHexString();
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// =============================================================================================
// Geometry builder: accumulates vertex-coloured primitives into one indexed BufferGeometry
// =============================================================================================

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

// Box faces: key, normal, corners as [sx, y01, sz].
const BOX_FACES = [
  ['px', [1, 0, 0], [[1, 0, 1], [1, 0, -1], [1, 1, -1], [1, 1, 1]]],
  ['nx', [-1, 0, 0], [[-1, 0, -1], [-1, 0, 1], [-1, 1, 1], [-1, 1, -1]]],
  ['py', [0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
  ['ny', [0, -1, 0], [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]]],
  ['pz', [0, 0, 1], [[-1, 0, 1], [1, 0, 1], [1, 1, 1], [-1, 1, 1]]],
  ['nz', [0, 0, -1], [[1, 0, -1], [-1, 0, -1], [-1, 1, -1], [1, 1, -1]]],
];

class Geo {
  constructor(seed = 1) {
    this.P = [];
    this.N = [];
    this.C = [];
    this.I = [];
    this.nv = 0;
    this.frames = [];
    this.rng = mulberry32(seed);
  }

  /** Random float in [a, b). */
  r(a = 0, b = 1) {
    return a + (b - a) * this.rng();
  }

  /** Local placement matrix from o.{x,y,z,rx,ry,rz} (Euler order YXZ), combined with the frame stack. */
  matrix(o) {
    const rot = o.rx || o.ry || o.rz;
    let m = null;
    if (rot || this.frames.length) {
      m = new THREE.Matrix4();
      _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(o.x || 0, o.y || 0, o.z || 0);
      m.compose(_p, _q, _one);
      if (this.frames.length) m.premultiply(this.frames[this.frames.length - 1]);
    }
    return m;
  }

  /** Push a placement frame: later primitives are expressed relative to it. */
  push(o) {
    const m = new THREE.Matrix4();
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(o.x || 0, o.y || 0, o.z || 0);
    m.compose(_p, _q, _one);
    if (this.frames.length) m.premultiply(this.frames[this.frames.length - 1]);
    this.frames.push(m);
  }

  pop() {
    this.frames.pop();
  }

  /** Jittered base colour for one primitive. */
  tint(hex, jit) {
    const c = rgb(hex);
    const f = 1 + (this.rng() * 2 - 1) * jit;
    const h = jit * 0.35;
    return [
      c[0] * f * (1 + (this.rng() * 2 - 1) * h),
      c[1] * f * (1 + (this.rng() * 2 - 1) * h),
      c[2] * f * (1 + (this.rng() * 2 - 1) * h),
    ];
  }

  /**
   * Append raw local vertices. lp/ln: flat xyz arrays, ls: shade per vertex, lc: [r,g,b] per vertex (linear),
   * li: triangle indices (local).
   */
  raw(lp, ln, ls, lc, li, o) {
    const m = this.matrix(o);
    const ox = o.x || 0;
    const oy = o.y || 0;
    const oz = o.z || 0;
    const nv = lp.length / 3;
    for (let k = 0; k < nv; k++) {
      _v.set(lp[k * 3], lp[k * 3 + 1], lp[k * 3 + 2]);
      _n.set(ln[k * 3], ln[k * 3 + 1], ln[k * 3 + 2]);
      if (m) {
        _v.applyMatrix4(m);
        _n.transformDirection(m);
      } else {
        _v.x += ox;
        _v.y += oy;
        _v.z += oz;
      }
      this.P.push(_v.x, _v.y, _v.z);
      this.N.push(_n.x, _n.y, _n.z);
      const c = lc[k];
      const s = ls[k];
      this.C.push(c[0] * s, c[1] * s, c[2] * s);
    }
    for (let k = 0; k < li.length; k++) this.I.push(li[k] + this.nv);
    this.nv += nv;
  }

  /**
   * Box with its base centred at (x, y, z). o: w, h, d, color, top (top-face colour), skip (face keys, default
   * 'ny'), shade (bottom brightness, default 0.72), hgrad (left-edge brightness for brick seams), jit.
   */
  box(o) {
    const hw = o.w / 2;
    const hd = o.d / 2;
    const h = o.h;
    const skip = o.skip ?? 'ny';
    const sh = o.shade ?? 0.72;
    const hg = o.hgrad ?? 1;
    const jit = o.jit ?? 0.05;
    const base = this.tint(o.color, jit);
    const top = o.top ? this.tint(o.top, jit * 0.6) : base;
    const bot = o.bottomColor ? this.tint(o.bottomColor, jit * 0.6) : null;
    const lp = [];
    const ln = [];
    const ls = [];
    const lc = [];
    const li = [];
    let v = 0;
    for (const [key, n, corners] of BOX_FACES) {
      if (skip.includes(key)) continue;
      for (const c of corners) {
        lp.push(c[0] * hw, c[1] * h, c[2] * hd);
        ln.push(n[0], n[1], n[2]);
        const u = key === 'px' || key === 'nx' ? (c[2] + 1) / 2 : (c[0] + 1) / 2;
        let s = sh + (1 - sh) * c[1];
        s *= hg + (1 - hg) * u;
        ls.push(s);
        if (key === 'py') lc.push(top);
        else if (bot && c[1] === 0) lc.push(bot);
        else if (o.top && o.topBand && c[1] === 1) lc.push(top);
        else lc.push(base);
      }
      li.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
    this.raw(lp, ln, ls, lc, li, o);
    return this;
  }

  /** Box given by min/max corners (axis aligned, no rotation). */
  boxMM(x0, y0, z0, x1, y1, z1, o) {
    return this.box({ ...o, x: (x0 + x1) / 2, y: y0, z: (z0 + z1) / 2, w: x1 - x0, h: y1 - y0, d: z1 - z0 });
  }

  /**
   * Cylinder / frustum / cone with its base centred at (x, y, z). o: r (or rb, rt), h, segs, a0, top (cap,
   * default true), bottom (cap, default false), flat (faceted sides), color, topColor, shade, jit.
   */
  cyl(o) {
    const segs = o.segs ?? 8;
    const rb = o.rb ?? o.r;
    const rt = o.rt ?? o.r;
    const h = o.h;
    const a0 = o.a0 ?? 0;
    const sh = o.shade ?? 0.72;
    const jit = o.jit ?? 0.05;
    const base = this.tint(o.color, jit);
    const topc = o.topColor ? this.tint(o.topColor, jit * 0.6) : base;
    const lp = [];
    const ln = [];
    const ls = [];
    const lc = [];
    const li = [];
    const slope = (rb - rt) / h;
    const ang = (k) => a0 + (k / segs) * Math.PI * 2;
    let v = 0;
    const side = (a, y, r, s, na) => {
      lp.push(Math.cos(a) * r, y, Math.sin(a) * r);
      const nl = Math.hypot(1, slope);
      ln.push(Math.cos(na) / nl, slope / nl, Math.sin(na) / nl);
      ls.push(s);
      lc.push(o.topBand && y === h ? topc : base);
    };
    if (rt <= 1e-6) {
      for (let k = 0; k < segs; k++) {
        const a = ang(k);
        const b = ang(k + 1);
        const mid = (a + b) / 2;
        side(b, 0, rb, sh, o.flat ? mid : b);
        side(a, 0, rb, sh, o.flat ? mid : a);
        side(mid, h, 0, 1, mid);
        lc[lc.length - 1] = topc;
        li.push(v, v + 1, v + 2);
        v += 3;
      }
    } else if (o.flat) {
      for (let k = 0; k < segs; k++) {
        const a = ang(k);
        const b = ang(k + 1);
        const mid = (a + b) / 2;
        side(b, 0, rb, sh, mid);
        side(a, 0, rb, sh, mid);
        side(a, h, rt, 1, mid);
        side(b, h, rt, 1, mid);
        li.push(v, v + 1, v + 2, v, v + 2, v + 3);
        v += 4;
      }
    } else {
      for (let k = 0; k <= segs; k++) {
        const a = ang(k);
        side(a, 0, rb, sh, a);
        side(a, h, rt, 1, a);
      }
      for (let k = 0; k < segs; k++) {
        const b0 = k * 2;
        const t0 = b0 + 1;
        const b1 = b0 + 2;
        const t1 = b0 + 3;
        li.push(b1, b0, t0, b1, t0, t1);
      }
      v = (segs + 1) * 2;
    }
    if (rt > 1e-6 && o.top !== false) {
      const start = v;
      for (let k = 0; k < segs; k++) {
        const a = ang(k);
        lp.push(Math.cos(a) * rt, h, Math.sin(a) * rt);
        ln.push(0, 1, 0);
        ls.push(1);
        lc.push(topc);
        v++;
      }
      for (let k = 1; k < segs - 1; k++) li.push(start, start + k + 1, start + k);
    }
    if (o.bottom) {
      const start = v;
      for (let k = 0; k < segs; k++) {
        const a = ang(k);
        lp.push(Math.cos(a) * rb, 0, Math.sin(a) * rb);
        ln.push(0, -1, 0);
        ls.push(sh);
        lc.push(base);
        v++;
      }
      for (let k = 1; k < segs - 1; k++) li.push(start, start + k, start + k + 1);
    }
    this.raw(lp, ln, ls, lc, li, o);
    return this;
  }

  /**
   * Sphere (or dome when o.dome) centred at (x, y, z). o: r, ws, hs, sy (vertical scale), color, topColor,
   * shade (brightness at the bottom), jit.
   */
  sphere(o) {
    const ws = o.ws ?? 8;
    const hs = o.hs ?? 4;
    const r = o.r;
    const sy = o.sy ?? 1;
    const sh = o.shade ?? 0.75;
    const jit = o.jit ?? 0.05;
    const base = this.tint(o.color, jit);
    const topc = o.topColor ? this.tint(o.topColor, jit * 0.6) : base;
    const tMax = o.dome ? Math.PI / 2 : Math.PI;
    const lp = [];
    const ln = [];
    const ls = [];
    const lc = [];
    const li = [];
    for (let i = 0; i <= hs; i++) {
      const th = (i / hs) * tMax;
      for (let k = 0; k <= ws; k++) {
        const a = (o.a0 ?? 0) + (k / ws) * Math.PI * 2;
        const nx = Math.cos(a) * Math.sin(th);
        const ny = Math.cos(th);
        const nz = Math.sin(a) * Math.sin(th);
        lp.push(nx * r, ny * r * sy, nz * r);
        const nl = Math.hypot(nx, ny / sy, nz);
        ln.push(nx / nl, ny / sy / nl, nz / nl);
        const t = o.dome ? ny : (ny + 1) / 2;
        ls.push(sh + (1 - sh) * t);
        lc.push(o.topColor && i <= hs * (o.capRows ?? 0.35) ? topc : base);
      }
    }
    const row = ws + 1;
    for (let i = 0; i < hs; i++) {
      for (let k = 0; k < ws; k++) {
        const t0 = i * row + k;
        const t1 = t0 + 1;
        const b0 = t0 + row;
        const b1 = b0 + 1;
        if (i > 0) li.push(b1, t0, t1);
        if (i < hs - 1 || o.dome) li.push(b1, b0, t0);
      }
    }
    this.raw(lp, ln, ls, lc, li, o);
    return this;
  }

  /** Flat polygon (convex, CCW seen from outside) in local coords, placed by o. Shade by local y in [y0, y1]. */
  poly(pts, o, y0 = 0, y1 = 1) {
    const jit = o.jit ?? 0.05;
    const base = o.rgb ?? this.tint(o.color, jit);
    const sh = o.shade ?? 0.72;
    const a = pts[0];
    const b = pts[1];
    const c = pts[2];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const lp = [];
    const ln = [];
    const ls = [];
    const lc = [];
    const li = [];
    for (const p of pts) {
      lp.push(p[0], p[1], p[2]);
      ln.push(nx, ny, nz);
      const t = y1 > y0 ? Math.min(1, Math.max(0, (p[1] - y0) / (y1 - y0))) : 1;
      ls.push(sh + (1 - sh) * t);
      lc.push(base);
    }
    for (let k = 1; k < pts.length - 1; k++) li.push(0, k, k + 1);
    this.raw(lp, ln, ls, lc, li, o);
    return this;
  }

  /** Triangular prism (gable): length l along x, base depth d along z, height h, apex over z = 0. */
  prism(o) {
    const hl = o.l / 2;
    const hd = o.d / 2;
    const h = o.h;
    const col = this.tint(o.color, o.jit ?? 0.04);
    const q = { ...o, rgb: col };
    this.poly([[-hl, 0, hd], [hl, 0, hd], [hl, h, 0], [-hl, h, 0]], q, 0, h);
    this.poly([[hl, 0, -hd], [-hl, 0, -hd], [-hl, h, 0], [hl, h, 0]], q, 0, h);
    if (!o.skipEnds) {
      const qe = o.endColor ? { ...o, rgb: this.tint(o.endColor, 0.03) } : q;
      this.poly([[hl, 0, hd], [hl, 0, -hd], [hl, h, 0]], qe, 0, h);
      this.poly([[-hl, 0, -hd], [-hl, 0, hd], [-hl, h, 0]], qe, 0, h);
    }
    return this;
  }

  /** LEGO stud at (x, y, z). */
  stud(x, y, z, color, r = 0.12, h = 0.08, segs = 8) {
    return this.cyl({ x, y, z, r, h, segs, color, shade: 0.7, jit: 0.03 });
  }

  /** Grid of studs (nx x nz) centred at (x, z) with the given pitch. */
  studs(x, y, z, nx, nz, pitch, color, r = 0.12, h = 0.08, segs = 8) {
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        this.stud(x + (i - (nx - 1) / 2) * pitch, y, z + (j - (nz - 1) / 2) * pitch, color, r, h, segs);
      }
    }
    return this;
  }

  /**
   * Brick block filling [x0,x1] x [y0,y1] x [z0,z1]: courses of bricks along x (spanning the full depth),
   * staggered by half a brick. o: course (height), len (brick length), color(k, i) or color, top (last course
   * top colour), skipTop (no top faces), jit.
   */
  bricks(x0, x1, y0, y1, z0, z1, o = {}) {
    const n = Math.max(1, Math.round((y1 - y0) / (o.course ?? 0.18)));
    const ch = (y1 - y0) / n;
    const w = x1 - x0;
    const nb = Math.max(1, Math.round(w / (o.len ?? 0.5)));
    const len = w / nb;
    const colorOf = typeof o.color === 'function' ? o.color : () => o.color ?? C.brick;
    for (let k = 0; k < n; k++) {
      const y = y0 + k * ch;
      const cuts = [x0];
      const stagger = nb > 1 && k % 2 === 1;
      for (let c = 1; c < nb + (stagger ? 1 : 0); c++) cuts.push(x0 + (stagger ? (c - 0.5) * len : c * len));
      cuts.push(x1);
      const last = k === n - 1;
      for (let i = 0; i < cuts.length - 1; i++) {
        const a = cuts[i];
        const b = cuts[i + 1];
        let skip = 'ny';
        if (!last || o.skipTop) skip += 'py';
        if (i > 0) skip += 'nx';
        if (i < cuts.length - 2) skip += 'px';
        if (o.skip) skip += o.skip;
        this.box({
          x: (a + b) / 2, y, z: (z0 + z1) / 2, w: b - a, h: ch, d: z1 - z0,
          color: colorOf(k, i, this), top: last ? o.top : undefined, skip,
          shade: o.shade ?? 0.74, hgrad: o.hgrad ?? 0.86, jit: o.jit ?? 0.06,
        });
      }
    }
    return this;
  }

  /** Build the BufferGeometry. */
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setIndex(this.nv > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  get empty() {
    return this.nv === 0;
  }
}

/** Mesh from a builder (or null when empty). */
function mesh(geo, mat = MODEL_MATERIALS.solid, name = '') {
  if (geo.empty) return null;
  const m = new THREE.Mesh(geo.build(), mat);
  if (name) m.name = name;
  m.castShadow = mat === MODEL_MATERIALS.solid;
  m.receiveShadow = mat === MODEL_MATERIALS.solid;
  return m;
}

/** Group from parts: [geo, material, name?, position?]. */
function assemble(parts, userData = {}) {
  const grp = new THREE.Group();
  for (const [geo, mat, name, pos] of parts) {
    const m = mesh(geo, mat, name);
    if (!m) continue;
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    grp.add(m);
  }
  grp.userData = userData;
  return grp;
}

// Reusable picks
const brickPick = (g) => {
  const r = g.rng();
  return r < 0.18 ? C.brickHi : r < 0.3 ? C.brickLo : C.brick;
};
const stonePick = (g) => {
  const r = g.rng();
  return r < 0.25 ? C.stoneHi : r < 0.4 ? C.stoneLo : C.stone;
};

/** Merlon (battlement block) with a stud on top. */
function merlon(g, x, y, z, s, h, color = C.stoneHi, studColor = color) {
  g.box({ x, y, z, w: s, h, d: s, color, shade: 0.78 });
  g.stud(x, y + h, z, studColor, s * 0.32, 0.06, 6);
}

/** A flag hanging from a pole hinge at local (0, 0, 0), extending along +x and down. */
function flagGeo(T, w = 0.56, h = 0.34, seed = 7) {
  const f = new Geo(seed);
  const t = 0.03;
  // three vertical strips for a waving look (each slightly offset in z)
  const strips = 3;
  for (let i = 0; i < strips; i++) {
    const x0 = 0.03 + (i / strips) * w;
    const x1 = 0.03 + ((i + 1) / strips) * w;
    const dz = [0, 0.035, -0.01][i];
    f.box({ x: (x0 + x1) / 2, y: -h, z: dz, w: x1 - x0 + 0.002, h, d: t, color: i === 1 ? T.main : mixHex(T.main, T.light, i === 0 ? 0.12 : 0), top: T.light, shade: 0.7, skip: '', jit: 0.02 });
  }
  // dark hem along the bottom and a gold emblem
  f.box({ x: 0.03 + w / 2, y: -h - 0.05, z: 0.012, w, h: 0.05, d: t + 0.004, color: T.dark, skip: '', jit: 0.02 });
  f.box({ x: 0.03 + w * 0.5, y: -h * 0.72, z: 0.035, w: 0.14, h: 0.14, d: t + 0.03, color: C.gold, rz: Math.PI / 4, skip: '', shade: 0.85, jit: 0.02 });
  return f;
}

// =============================================================================================
// Structures
// =============================================================================================

function buildKeep(team) {
  const T = tc(team);
  const g = new Geo(11);
  // stone plinth (two courses of stone blocks)
  g.bricks(-1.44, 1.44, 0, 0.2, -1.44, 1.44, { color: (k, i, gg) => stonePick(gg), len: 0.72, course: 0.1, shade: 0.7 });
  // front steps
  g.box({ x: 0, y: 0.2, z: 1.2, w: 0.7, h: 0.05, d: 0.36, color: C.stoneHi });
  // main hall
  g.bricks(-1.02, 1.02, 0.2, 1.3, -0.96, 0.96, { color: (k, i, gg) => brickPick(gg), course: 0.18, len: 0.5 });
  // walkway
  g.box({ x: 0, y: 1.3, z: 0, w: 2.14, h: 0.08, d: 2.02, color: C.stone, top: C.stoneHi });
  // gate: stone frame, dark arch, wooden doors, gold keystone
  g.box({ x: 0, y: 0.2, z: 0.98, w: 0.8, h: 0.74, d: 0.08, color: C.stoneHi, shade: 0.8 });
  g.box({ x: 0, y: 0.2, z: 1.02, w: 0.56, h: 0.56, d: 0.02, color: C.deep, shade: 1 });
  g.cyl({ x: 0, y: 0.76, z: 0.94, r: 0.28, h: 0.1, segs: 8, a0: 0, color: C.deep, rx: Math.PI / 2, top: true, shade: 1, jit: 0 });
  for (const dx of [-0.135, 0.135]) g.box({ x: dx, y: 0.2, z: 1.035, w: 0.24, h: 0.5, d: 0.02, color: C.wood, shade: 0.75, hgrad: 0.8 });
  g.box({ x: 0, y: 0.2, z: 1.05, w: 0.03, h: 0.5, d: 0.02, color: C.woodLo });
  g.box({ x: 0, y: 0.36, z: 1.05, w: 0.5, h: 0.04, d: 0.02, color: C.iron });
  g.box({ x: 0, y: 0.84, z: 1.03, w: 0.14, h: 0.14, d: 0.06, color: C.gold, rz: Math.PI / 4, skip: '' });
  // team banners either side of the gate
  for (const bx of [-0.62, 0.62]) {
    g.box({ x: bx, y: 1.22, z: 0.99, w: 0.34, h: 0.05, d: 0.05, color: C.woodLo, skip: '' });
    g.box({ x: bx, y: 0.72, z: 0.985, w: 0.28, h: 0.5, d: 0.03, color: T.main, top: T.light, shade: 0.8, hgrad: 0.9 });
    g.poly([[-0.14, 0, 0], [0, -0.12, 0], [0.14, 0, 0]], { x: bx, y: 0.72, z: 1.0, color: T.main, shade: 0.8 }, -0.12, 0);
    g.box({ x: bx, y: 0.94, z: 1.0, w: 0.1, h: 0.1, d: 0.02, color: C.gold, rz: Math.PI / 4, skip: '' });
  }
  // corner towers with team bands, windows and team roofs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * 1.04;
      const cz = sz * 1.0;
      const s = 0.82;
      g.bricks(cx - s / 2, cx + s / 2, 0.2, 1.64, cz - s / 2, cz + s / 2, {
        color: (k, i, gg) => (k === 6 ? (gg.rng() < 0.3 ? T.light : T.main) : brickPick(gg)),
        course: 0.18, len: 0.41,
      });
      // window slit on the outward-facing front
      if (sz > 0) g.box({ x: cx, y: 0.82, z: cz + s / 2, w: 0.14, h: 0.24, d: 0.02, color: C.deep, shade: 1 });
      g.box({ x: cx + sx * (s / 2), y: 0.9, z: cz, w: 0.02, h: 0.2, d: 0.12, color: C.deep, shade: 1 });
      // cap and pointy team roof with a gold tip
      g.box({ x: cx, y: 1.64, z: cz, w: s + 0.1, h: 0.08, d: s + 0.1, color: C.stoneHi, shade: 0.8 });
      g.cyl({ x: cx, y: 1.72, z: cz, rb: (s / 2 + 0.06) * Math.SQRT2, rt: 0, h: 0.62, segs: 4, a0: Math.PI / 4, color: T.main, topColor: T.light, flat: true, shade: 0.62 });
      g.sphere({ x: cx, y: 2.38, z: cz, r: 0.06, ws: 6, hs: 3, color: C.gold });
    }
  }
  // merlons on the hall edges between the towers
  for (const x of [-0.42, 0, 0.42]) {
    merlon(g, x, 1.38, 0.9, 0.2, 0.16);
    merlon(g, x, 1.38, -0.9, 0.2, 0.16);
  }
  for (const z of [-0.3, 0.3]) {
    merlon(g, -0.97, 1.38, z, 0.2, 0.16);
    merlon(g, 0.97, 1.38, z, 0.2, 0.16);
  }
  // central donjon
  const dz = -0.12;
  g.bricks(-0.46, 0.46, 1.38, 1.94, dz - 0.46, dz + 0.46, { color: (k, i, gg) => brickPick(gg), course: 0.185, len: 0.46 });
  g.box({ x: 0, y: 1.6, z: dz + 0.46, w: 0.2, h: 0.2, d: 0.02, color: C.stoneHi, shade: 0.9 });
  g.box({ x: 0, y: 1.62, z: dz + 0.47, w: 0.12, h: 0.14, d: 0.02, color: T.main, top: T.light, shade: 0.9 });
  g.box({ x: 0, y: 1.94, z: dz, w: 1.02, h: 0.07, d: 1.02, color: C.stone, top: C.stoneHi });
  for (const [mx, mz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4], [0, 0.4], [0, -0.4], [-0.4, 0], [0.4, 0]]) {
    merlon(g, mx, 2.01, dz + mz, 0.18, 0.14);
  }
  // studs on the exposed walkway
  for (const x of [-0.42, 0.42]) g.stud(x, 1.38, 0.55, C.stoneHi, 0.1, 0.06);
  // flag pole
  g.cyl({ x: 0, y: 2.01, z: dz, r: 0.035, h: 0.75, segs: 6, color: C.woodLo, shade: 0.9 });
  g.sphere({ x: 0, y: 2.8, z: dz, r: 0.06, ws: 6, hs: 3, color: C.gold });
  const flag = flagGeo(T, 0.6, 0.36, 3);
  return assemble([[g, MODEL_MATERIALS.solid], [flag, MODEL_MATERIALS.solid, 'flag', [0, 2.74, dz]]], { height: 2.84 });
}

/** Two-sided shingled gable roof along x. */
function gableRoof(g, o) {
  const { x0, x1, zFront, zBack = -zFront, yEave, yRidge, color, colorAlt, rows = 3, ridge, ridgeStuds = 0, studColor } = o;
  const hz = (zFront - zBack) / 2;
  const zc = (zFront + zBack) / 2;
  const rise = yRidge - yEave;
  const slope = Math.hypot(hz, rise);
  const ang = Math.atan2(rise, hz);
  const t = 0.07;
  for (const side of [1, -1]) {
    for (let r = 0; r < rows; r++) {
      // row r from the eave upward; centre along the slope
      const f0 = r / rows;
      const f1 = (r + 1) / rows;
      const fm = (f0 + f1) / 2;
      const zz = zc + side * hz * (1 - fm);
      const yy = yEave + rise * fm;
      const wSlope = slope / rows + 0.05;
      g.box({
        x: (x0 + x1) / 2, y: yy - t / 2, z: zz + side * 0.012, w: x1 - x0, h: t, d: wSlope,
        rx: side * ang, color: r % 2 ? colorAlt : color, skip: '', shade: 0.85, jit: 0.035,
      });
    }
  }
  if (ridge) {
    g.box({ x: (x0 + x1) / 2, y: yRidge - 0.02, z: zc, w: x1 - x0 + 0.02, h: 0.1, d: 0.16, color: ridge, shade: 0.85 });
    if (ridgeStuds) {
      const len = x1 - x0 - 0.2;
      for (let i = 0; i < ridgeStuds; i++) {
        const x = x0 + 0.1 + (ridgeStuds === 1 ? len / 2 : (i / (ridgeStuds - 1)) * len);
        g.stud(x, yRidge + 0.08, zc, studColor ?? ridge, 0.06, 0.05, 6);
      }
    }
  }
}

function windowFront(g, x, y, z, w = 0.26, h = 0.24, frame = C.white) {
  g.box({ x, y: y - 0.03, z, w: w + 0.08, h: h + 0.06, d: 0.03, color: frame, shade: 0.85 });
  g.box({ x, y, z: z + 0.01, w, h, d: 0.03, color: C.glass, top: C.glassHi, shade: 0.7 });
  g.box({ x, y, z: z + 0.025, w: 0.025, h, d: 0.02, color: frame });
  g.box({ x, y: y + h / 2 - 0.0125, z: z + 0.025, w, h: 0.025, d: 0.02, color: frame });
}

function windowSide(g, x, y, z, sx, w = 0.24, h = 0.22) {
  g.box({ x, y: y - 0.03, z, w: 0.03, h: h + 0.06, d: w + 0.08, color: C.white, shade: 0.85 });
  g.box({ x: x + sx * 0.01, y, z, w: 0.03, h, d: w, color: C.glass, top: C.glassHi, shade: 0.7 });
  g.box({ x: x + sx * 0.02, y, z, w: 0.02, h, d: 0.025, color: C.white });
}

function flowerBox(g, x, y, z, w = 0.3) {
  g.box({ x, y, z, w, h: 0.07, d: 0.08, color: C.wood, shade: 0.8 });
  g.box({ x, y: y + 0.07, z, w: w - 0.04, h: 0.04, d: 0.06, color: C.leaf, top: C.leafHi });
  for (const fx of [-w / 3.2, 0, w / 3.2]) g.box({ x: x + fx, y: y + 0.1, z: z + 0.01, w: 0.045, h: 0.045, d: 0.045, color: g.rng() < 0.5 ? C.red : C.pink, skip: 'ny', shade: 0.9 });
}

function buildHouse(team) {
  const T = tc(team);
  const g = new Geo(21);
  g.bricks(-0.84, 0.84, 0, 0.12, -0.8, 0.8, { color: (k, i, gg) => stonePick(gg), len: 0.56, course: 0.12, shade: 0.7 });
  // walls
  const wx = 0.68;
  const wz = 0.58;
  g.bricks(-wx, wx, 0.12, 0.86, -wz, wz, { color: (k, i, gg) => brickPick(gg), course: 0.185, len: 0.45, skipTop: true });
  // corner posts (timber)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box({ x: sx * (wx - 0.02), y: 0.12, z: sz * (wz - 0.02), w: 0.09, h: 0.74, d: 0.09, color: C.woodHi, shade: 0.75 });
  // door + step + knob
  g.box({ x: 0.08, y: 0.12, z: wz, w: 0.36, h: 0.56, d: 0.04, color: C.woodLo, shade: 0.85 });
  g.box({ x: 0.08, y: 0.12, z: wz + 0.02, w: 0.28, h: 0.5, d: 0.03, color: C.wood, hgrad: 0.82, shade: 0.75 });
  g.box({ x: 0.17, y: 0.36, z: wz + 0.05, w: 0.04, h: 0.04, d: 0.03, color: C.gold, skip: '' });
  g.box({ x: 0.08, y: 0.0, z: wz + 0.12, w: 0.4, h: 0.13, d: 0.16, color: C.stoneHi });
  // windows with flower boxes
  windowFront(g, -0.38, 0.42, wz, 0.26, 0.22);
  flowerBox(g, -0.38, 0.33, wz + 0.05, 0.32);
  windowFront(g, 0.47, 0.44, wz, 0.18, 0.18);
  for (const sx of [-1, 1]) windowSide(g, sx * wx, 0.42, 0, sx);
  // gable volume + roof
  g.prism({ x: 0, y: 0.86, z: 0, l: wx * 2 - 0.02, d: wz * 2, h: 0.5, color: C.woodHi, endColor: C.woodHi });
  for (const sx of [-1, 1]) g.box({ x: sx * (wx - 0.005), y: 0.98, z: 0, w: 0.03, h: 0.16, d: 0.16, color: C.deep, shade: 1, skip: 'ny' });
  // chimney behind the ridge
  g.bricks(0.28, 0.5, 0.9, 1.62, -0.42, -0.2, { color: (k, i, gg) => brickPick(gg), course: 0.18, len: 0.22 });
  g.box({ x: 0.39, y: 1.62, z: -0.31, w: 0.28, h: 0.06, d: 0.28, color: C.stoneDark, top: C.dark });
  gableRoof(g, {
    x0: -wx - 0.14, x1: wx + 0.14, zFront: wz + 0.2, yEave: 0.76, yRidge: 1.42,
    color: T.main, colorAlt: mixHex(T.main, T.dark, 0.38), rows: 3, ridge: T.dark, ridgeStuds: 3, studColor: T.light,
  });
  return assemble([[g, MODEL_MATERIALS.solid]], { height: 1.7 });
}

function crossedSwords(g, x, y, z) {
  for (const s of [-1, 1]) {
    g.push({ x, y, z, rz: s * 0.72 });
    g.box({ x: 0, y: -0.02, z: 0, w: 0.05, h: 0.36, d: 0.03, color: C.steel, top: C.white, skip: '', shade: 0.85 });
    g.box({ x: 0, y: -0.06, z: 0, w: 0.14, h: 0.04, d: 0.04, color: C.gold, skip: '' });
    g.box({ x: 0, y: -0.16, z: 0, w: 0.04, h: 0.1, d: 0.035, color: C.woodLo, skip: '' });
    g.pop();
  }
}

function buildBarracks(team) {
  const T = tc(team);
  const g = new Geo(31);
  g.bricks(-1.4, 1.4, 0, 0.12, -0.9, 0.9, { color: (k, i, gg) => stonePick(gg), len: 0.7, course: 0.12, shade: 0.7 });
  const wx = 1.22;
  const wz = 0.66;
  g.bricks(-wx, wx, 0.12, 0.98, -wz, wz, {
    color: (k, i, gg) => (k === 4 ? (gg.rng() < 0.3 ? T.light : T.main) : brickPick(gg)), course: 0.172, len: 0.5, skipTop: true,
  });
  // stone corner pillars
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box({ x: sx * wx, y: 0.12, z: sz * wz, w: 0.2, h: 0.9, d: 0.2, color: C.stoneHi, shade: 0.72, top: C.white });
  // double door with iron bands
  g.box({ x: 0, y: 0.12, z: wz, w: 0.62, h: 0.6, d: 0.05, color: C.stoneHi, shade: 0.85 });
  for (const dx of [-0.13, 0.13]) g.box({ x: dx, y: 0.12, z: wz + 0.03, w: 0.25, h: 0.52, d: 0.03, color: C.wood, hgrad: 0.8, shade: 0.72 });
  for (const yy of [0.24, 0.48]) g.box({ x: 0, y: yy, z: wz + 0.05, w: 0.52, h: 0.04, d: 0.02, color: C.iron });
  g.box({ x: 0, y: 0, z: wz + 0.14, w: 0.7, h: 0.12, d: 0.2, color: C.stoneHi });
  // barred windows
  for (const sx of [-1, 1]) {
    const x = sx * 0.72;
    g.box({ x, y: 0.42, z: wz, w: 0.34, h: 0.28, d: 0.03, color: C.stoneHi, shade: 0.85 });
    g.box({ x, y: 0.45, z: wz + 0.01, w: 0.26, h: 0.22, d: 0.03, color: C.deep, shade: 1 });
    for (const bx of [-0.07, 0, 0.07]) g.box({ x: x + bx, y: 0.45, z: wz + 0.03, w: 0.025, h: 0.22, d: 0.02, color: C.iron });
  }
  // gable roof
  g.prism({ x: 0, y: 0.98, z: 0, l: wx * 2 + 0.1, d: wz * 2, h: 0.58, color: C.woodHi, endColor: C.woodHi });
  gableRoof(g, {
    x0: -wx - 0.18, x1: wx + 0.18, zFront: wz + 0.2, yEave: 0.9, yRidge: 1.62,
    color: T.main, colorAlt: mixHex(T.main, T.dark, 0.38), rows: 3, ridge: T.dark, ridgeStuds: 5, studColor: T.light,
  });
  // crossed-swords shield sign over the door
  g.box({ x: 0, y: 0.72, z: wz + 0.17, w: 0.5, h: 0.44, d: 0.05, color: C.goldLo, shade: 0.85, skip: '' });
  g.box({ x: 0, y: 0.74, z: wz + 0.19, w: 0.44, h: 0.4, d: 0.04, color: T.main, top: T.light, shade: 0.8, skip: '' });
  g.cyl({ x: 0, y: 1.14, z: wz + 0.18, r: 0.22, h: 0.06, segs: 8, color: T.main, rx: Math.PI / 2, a0: 0, shade: 1, jit: 0 });
  crossedSwords(g, 0, 0.98, wz + 0.23);
  // a straw target and a barrel by the side
  g.cyl({ x: -1.18, y: 0.12, z: wz + 0.18, r: 0.11, h: 0.24, segs: 8, color: C.woodHi, topColor: C.wood, shade: 0.7 });
  g.box({ x: -1.18, y: 0.2, z: wz + 0.18, w: 0.24, h: 0.03, d: 0.24, color: C.iron, skip: 'nypy', jit: 0 });
  g.cyl({ x: 1.16, y: 0.12, z: wz + 0.2, r: 0.12, h: 0.04, segs: 8, color: C.woodLo });
  g.cyl({ x: 1.16, y: 0.16, z: wz + 0.2, r: 0.025, h: 0.3, segs: 5, color: C.woodLo });
  g.cyl({ x: 1.16, y: 0.42, z: wz + 0.22, r: 0.12, h: 0.04, segs: 10, color: C.white, rx: Math.PI / 2, shade: 1 });
  g.cyl({ x: 1.16, y: 0.42, z: wz + 0.225, r: 0.075, h: 0.04, segs: 10, color: C.red, rx: Math.PI / 2, shade: 1 });
  g.cyl({ x: 1.16, y: 0.42, z: wz + 0.23, r: 0.03, h: 0.04, segs: 8, color: C.white, rx: Math.PI / 2, shade: 1 });
  return assemble([[g, MODEL_MATERIALS.solid]], { height: 1.75 });
}

function buildTower(team) {
  const T = tc(team);
  const g = new Geo(41);
  g.bricks(-0.86, 0.86, 0, 0.22, -0.86, 0.86, { color: (k, i, gg) => stonePick(gg), len: 0.58, course: 0.11, shade: 0.7 });
  g.box({ x: 0, y: 0.22, z: 0, w: 1.3, h: 0.06, d: 1.3, color: C.stone, top: C.stoneHi });
  const s = 0.56;
  g.bricks(-s, s, 0.28, 1.72, -s, s, {
    color: (k, i, gg) => (k === 6 ? (gg.rng() < 0.3 ? T.light : T.main) : brickPick(gg)), course: 0.18, len: 0.4,
  });
  // stone quoins at the corners
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box({ x: sx * s, y: 0.28, z: sz * s, w: 0.14, h: 1.44, d: 0.14, color: C.stoneHi, shade: 0.7 });
  // door
  g.box({ x: 0, y: 0.28, z: s, w: 0.36, h: 0.44, d: 0.04, color: C.stoneHi, shade: 0.85 });
  g.box({ x: 0, y: 0.28, z: s + 0.02, w: 0.26, h: 0.36, d: 0.03, color: C.wood, hgrad: 0.8, shade: 0.75 });
  g.cyl({ x: 0, y: 0.64, z: s + 0.005, r: 0.13, h: 0.04, segs: 8, color: C.wood, rx: Math.PI / 2, shade: 1, jit: 0 });
  // team shield with a gold emblem
  g.box({ x: 0, y: 0.9, z: s, w: 0.38, h: 0.36, d: 0.04, color: C.gold, shade: 0.85, skip: '' });
  g.box({ x: 0, y: 0.92, z: s + 0.02, w: 0.32, h: 0.32, d: 0.03, color: T.main, top: T.light, shade: 0.8, skip: '' });
  g.cyl({ x: 0, y: 0.92, z: s + 0.035, rb: 0.16 * Math.SQRT2 / 1.42, rt: 0, h: 0.1, segs: 4, a0: Math.PI / 4, color: T.main, rx: Math.PI, flat: true, shade: 1 });
  g.box({ x: 0, y: 1.02, z: s + 0.04, w: 0.11, h: 0.11, d: 0.02, color: C.gold, rz: Math.PI / 4, skip: '' });
  // side window slits
  for (const sx of [-1, 1]) g.box({ x: sx * s, y: 1.0, z: 0, w: 0.02, h: 0.26, d: 0.12, color: C.deep, shade: 1 });
  // corbel ring
  g.box({ x: 0, y: 1.72, z: 0, w: 1.3, h: 0.12, d: 1.3, color: C.stone, shade: 0.6, top: C.stoneHi });

  // deck (`top`): origin at the deck floor centre
  const top = new Geo(42);
  const dk = 0.76;
  top.box({ x: 0, y: -0.06, z: 0, w: dk * 2, h: 0.14, d: dk * 2, color: C.stoneHi, shade: 0.7, top: C.stoneHi });
  top.box({ x: 0, y: 0.08, z: 0, w: dk * 2 - 0.36, h: 0.01, d: dk * 2 - 0.36, color: C.woodHi, skip: 'ny', jit: 0.02 });
  const posts = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]];
  for (const [px, pz] of posts) merlon(top, px * (dk - 0.12), 0.08, pz * (dk - 0.12), 0.24, 0.26, C.stoneHi);
  // front gap gets a low parapet so the archer stands proud
  top.box({ x: 0, y: 0.08, z: dk - 0.12, w: 0.24, h: 0.1, d: 0.24, color: C.stoneHi });
  // team pennants on the back corners
  for (const sx of [-1, 1]) {
    const px = sx * (dk - 0.12);
    const pz = -(dk - 0.12);
    top.cyl({ x: px, y: 0.4, z: pz, r: 0.022, h: 0.42, segs: 5, color: C.woodLo });
    top.poly([[0, 0, 0], [0, -0.2, 0], [0.3 * -sx * -1, -0.1, 0]], { x: px, y: 0.8, z: pz, color: T.main, shade: 0.8 }, -0.2, 0);
    top.poly([[0, 0, 0], [0.3 * -sx * -1, -0.1, 0], [0, -0.2, 0]], { x: px, y: 0.8, z: pz - 0.001, color: T.dark, shade: 0.8 }, -0.2, 0);
  }
  return assemble([[g, MODEL_MATERIALS.solid], [top, MODEL_MATERIALS.solid, 'top', [0, 1.9, 0]]], { height: 2.6, top: 1.98 });
}

function buildTemple(team) {
  const T = tc(team);
  const g = new Geo(51);
  // three marble steps
  g.bricks(-0.92, 0.92, 0, 0.1, -0.92, 0.92, { color: (k, i, gg) => (gg.rng() < 0.4 ? C.marble : C.stoneHi), len: 0.62, course: 0.1, shade: 0.75 });
  g.bricks(-0.8, 0.8, 0.1, 0.2, -0.8, 0.8, { color: (k, i, gg) => (gg.rng() < 0.4 ? C.marble : C.white), len: 0.55, course: 0.1, shade: 0.75 });
  g.bricks(-0.68, 0.68, 0.2, 0.3, -0.68, 0.68, { color: (k, i, gg) => (gg.rng() < 0.4 ? C.marble : C.white), len: 0.46, course: 0.1, shade: 0.75 });
  // cella with a glowing doorway
  g.bricks(-0.36, 0.36, 0.3, 1.06, -0.36, 0.36, { color: (k, i, gg) => (gg.rng() < 0.5 ? C.stoneHi : C.stone), course: 0.19, len: 0.36, skipTop: true });
  // columns
  const cr = 0.56;
  for (const [cx, cz] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]) {
    const x = cx * cr;
    const z = cz * cr;
    g.box({ x, y: 0.3, z, w: 0.2, h: 0.06, d: 0.2, color: C.white, shade: 0.8 });
    g.cyl({ x, y: 0.36, z, r: 0.075, h: 0.66, segs: 8, color: C.white, shade: 0.7, jit: 0.02 });
    g.box({ x, y: 1.0, z, w: 0.2, h: 0.06, d: 0.2, color: C.goldHi, shade: 0.85 });
  }
  // entablature with team band and gold cornice
  g.box({ x: 0, y: 1.06, z: 0, w: 1.36, h: 0.1, d: 1.36, color: C.white, shade: 0.8 });
  g.box({ x: 0, y: 1.16, z: 0, w: 1.38, h: 0.09, d: 1.38, color: T.main, top: T.light, shade: 0.8 });
  g.box({ x: 0, y: 1.25, z: 0, w: 1.3, h: 0.06, d: 1.3, color: C.gold, top: C.goldHi, shade: 0.85 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.stud(sx * 0.5, 1.31, sz * 0.5, C.goldHi, 0.08, 0.05, 6);
  // drum + golden dome + spire
  g.cyl({ x: 0, y: 1.31, z: 0, r: 0.44, h: 0.1, segs: 12, color: C.white, shade: 0.8 });
  g.cyl({ x: 0, y: 1.41, z: 0, r: 0.46, h: 0.04, segs: 12, color: T.main, shade: 0.9 });
  g.sphere({ x: 0, y: 1.45, z: 0, r: 0.42, ws: 12, hs: 4, dome: true, color: C.gold, topColor: C.goldHi, capRows: 0.3, shade: 0.72 });
  g.cyl({ x: 0, y: 1.84, z: 0, r: 0.07, h: 0.08, segs: 6, color: C.goldLo });
  g.cyl({ x: 0, y: 1.92, z: 0, rb: 0.07, rt: 0, h: 0.34, segs: 6, color: C.gold, topColor: C.goldHi, flat: true, shade: 0.75 });
  // glowing doorway (static glow) and the floating orb (animatable glow)
  const lit = new Geo(52);
  lit.box({ x: 0, y: 0.3, z: 0.365, w: 0.26, h: 0.44, d: 0.02, color: C.goldHi, shade: 0.7, jit: 0 });
  lit.cyl({ x: 0, y: 0.74, z: 0.355, r: 0.13, h: 0.02, segs: 8, color: C.goldHi, rx: Math.PI / 2, jit: 0, shade: 1 });
  const orb = new Geo(53);
  orb.sphere({ x: 0, y: 0, z: 0, r: 0.09, ws: 8, hs: 5, color: C.goldHi, topColor: C.white, shade: 0.8, jit: 0 });
  return assemble([[g, MODEL_MATERIALS.solid], [lit, MODEL_MATERIALS.glow], [orb, MODEL_MATERIALS.glow, 'glow', [0, 2.36, 0]]], { height: 2.45 });
}

function buildOutpost(team) {
  const T = tc(team);
  const g = new Geo(61);
  g.box({ x: 0, y: 0, z: 0, w: 0.86, h: 0.08, d: 0.86, color: C.stone, top: C.stoneHi });
  g.bricks(-0.37, 0.37, 0.08, 0.42, -0.37, 0.37, {
    color: (k, i, gg) => (k === 0 ? T.main : brickPick(gg)), course: 0.17, len: 0.37,
  });
  g.studs(0, 0.42, 0, 2, 2, 0.37, C.brick, 0.1, 0.07);
  g.box({ x: 0, y: 0.42, z: 0, w: 0.2, h: 0.08, d: 0.2, color: C.stoneHi });
  g.cyl({ x: 0, y: 0.5, z: 0, r: 0.04, h: 1.18, segs: 6, color: C.woodLo, shade: 0.8 });
  g.sphere({ x: 0, y: 1.72, z: 0, r: 0.065, ws: 6, hs: 3, color: C.gold });
  // little brick stash for drop-offs
  g.box({ x: 0.3, y: 0.08, z: 0.39, w: 0.18, h: 0.09, d: 0.1, color: C.brick, ry: 0.3 });
  g.box({ x: 0.26, y: 0.17, z: 0.38, w: 0.16, h: 0.08, d: 0.09, color: C.brickHi, ry: -0.2 });
  const flag = flagGeo(T, 0.5, 0.32, 5);
  return assemble([[g, MODEL_MATERIALS.solid], [flag, MODEL_MATERIALS.solid, 'flag', [0, 1.64, 0]]], { height: 1.8 });
}

function buildWall(team) {
  const T = tc(team);
  const g = new Geo(71 + (team === 1 ? 1 : 0));
  g.bricks(-0.49, 0.49, 0, 0.12, -0.49, 0.49, { color: (k, i, gg) => (gg.rng() < 0.3 ? T.light : T.main), course: 0.12, len: 0.49 });
  g.bricks(-0.49, 0.49, 0.12, 0.68, -0.49, 0.49, { color: (k, i, gg) => brickPick(gg), course: 0.185, len: 0.49 });
  g.studs(0, 0.68, 0, 2, 2, 0.49, C.brick, 0.14, 0.08);
  return assemble([[g, MODEL_MATERIALS.solid]], { height: 0.76 });
}

function buildShrine(team) {
  const T = team === 0 || team === 1 ? tc(team) : NEUTRAL_GOLD;
  const g = new Geo(81);
  // octagonal marble platform
  g.cyl({ x: 0, y: 0, z: 0, r: 0.98, h: 0.12, segs: 8, a0: Math.PI / 8, flat: true, color: C.stoneHi, topColor: C.marble, shade: 0.7 });
  g.cyl({ x: 0, y: 0.12, z: 0, r: 0.86, h: 0.05, segs: 8, a0: Math.PI / 8, flat: true, color: T.main, topColor: T.light, shade: 0.85 });
  g.cyl({ x: 0, y: 0.17, z: 0, r: 0.8, h: 0.1, segs: 8, a0: Math.PI / 8, flat: true, color: C.white, topColor: C.white, shade: 0.75 });
  // gold inlay star on the floor
  g.cyl({ x: 0, y: 0.27, z: 0, r: 0.42, h: 0.012, segs: 4, a0: 0, flat: true, color: C.gold, topColor: C.gold, jit: 0 });
  g.cyl({ x: 0, y: 0.27, z: 0, r: 0.42, h: 0.014, segs: 4, a0: Math.PI / 4, flat: true, color: C.gold, topColor: C.goldHi, jit: 0 });
  // four pillars with gold capitals
  const pr = 0.56;
  const pts = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [a * pr * Math.SQRT1_2 * 1.0, b * pr * Math.SQRT1_2 * 1.0]);
  for (const [x, z] of pts) {
    g.box({ x, y: 0.27, z, w: 0.2, h: 0.08, d: 0.2, color: C.gold, shade: 0.8 });
    g.cyl({ x, y: 0.35, z, r: 0.07, h: 0.72, segs: 8, color: C.white, shade: 0.7, jit: 0.02 });
    g.box({ x, y: 1.07, z, w: 0.2, h: 0.08, d: 0.2, color: C.gold, top: C.goldHi, shade: 0.8 });
  }
  // lintels in the team / neutral colour with gold studs
  const L = pts[0][0];
  for (const s of [-1, 1]) {
    g.box({ x: 0, y: 1.15, z: s * Math.abs(L), w: Math.abs(L) * 2 + 0.2, h: 0.1, d: 0.14, color: T.main, top: T.light, shade: 0.8 });
    g.box({ x: s * Math.abs(L), y: 1.15, z: 0, w: 0.14, h: 0.1, d: Math.abs(L) * 2 - 0.06, color: T.main, top: T.light, shade: 0.8 });
  }
  for (const [x, z] of pts) g.stud(x, 1.25, z, C.gold, 0.07, 0.05, 6);
  // gold cross beams carrying the crown spire
  for (const s of [-1, 1]) g.box({ x: 0, y: 1.25, z: 0, w: Math.abs(L) * 2 * Math.SQRT2, h: 0.06, d: 0.08, ry: s * Math.PI / 4, color: C.gold, top: C.goldHi, shade: 0.85 });
  g.cyl({ x: 0, y: 1.25, z: 0, rb: 0.2, rt: 0.06, h: 0.18, segs: 8, color: C.gold, topColor: C.goldHi, shade: 0.8 });
  g.sphere({ x: 0, y: 1.48, z: 0, r: 0.06, ws: 6, hs: 3, color: C.goldHi });
  // altar pedestal
  g.cyl({ x: 0, y: 0.27, z: 0, r: 0.2, h: 0.08, segs: 8, flat: true, color: C.white });
  g.cyl({ x: 0, y: 0.35, z: 0, rb: 0.12, rt: 0.1, h: 0.26, segs: 8, flat: true, color: C.marble, shade: 0.75 });
  g.cyl({ x: 0, y: 0.61, z: 0, r: 0.17, h: 0.06, segs: 8, flat: true, color: T.main, topColor: T.light });
  // floating crystal (glow), tinted by owner
  const glowCol = team === 0 || team === 1 ? T.light : C.goldHi;
  const cr = new Geo(82);
  cr.cyl({ x: 0, y: 0, z: 0, rb: 0.14, rt: 0, h: 0.2, segs: 4, flat: true, color: glowCol, topColor: C.white, shade: 0.75, jit: 0 });
  cr.cyl({ x: 0, y: 0, z: 0, rb: 0.14, rt: 0, h: 0.16, segs: 4, flat: true, color: glowCol, rx: Math.PI, shade: 0.75, jit: 0 });
  return assemble([[g, MODEL_MATERIALS.solid], [cr, MODEL_MATERIALS.glow, 'glow', [0, 0.86, 0]]], { height: 1.55 });
}

function buildNest() {
  const g = new Geo(91);
  const rock = (x, y, z, w, h, d, ry = 0, color) => g.box({ x, y, z, w, h, d, ry, color: color ?? (g.rng() < 0.5 ? C.stoneLo : C.stone), top: C.stoneHi, shade: 0.62, jit: 0.06 });
  // back mass
  rock(0, 0, -0.2, 1.7, 0.42, 0.56, 0.02);
  rock(-0.15, 0.42, -0.2, 1.2, 0.3, 0.44, -0.05);
  rock(0.1, 0.72, -0.18, 0.62, 0.2, 0.34, 0.12, C.stoneLo);
  // cave sides and lintel
  rock(-0.62, 0, 0.12, 0.48, 0.5, 0.42, 0.15);
  rock(0.62, 0, 0.14, 0.46, 0.44, 0.4, -0.2);
  rock(0.02, 0.44, 0.12, 0.98, 0.18, 0.4, 0.03, C.stoneLo);
  // dark cave mouth
  g.box({ x: 0, y: 0, z: 0.16, w: 0.78, h: 0.45, d: 0.4, color: C.deep, shade: 1, jit: 0 });
  // moss
  g.box({ x: -0.3, y: 0.72, z: -0.15, w: 0.4, h: 0.03, d: 0.3, color: C.leafLo, top: C.leaf, jit: 0.04 });
  g.box({ x: 0.55, y: 0.44, z: -0.1, w: 0.3, h: 0.03, d: 0.26, color: C.leafLo, top: C.leaf, jit: 0.04 });
  // skull on top
  g.box({ x: 0.1, y: 0.92, z: -0.1, w: 0.2, h: 0.16, d: 0.18, color: C.bone, shade: 0.8, ry: 0.15 });
  g.box({ x: 0.1, y: 0.88, z: -0.02, w: 0.13, h: 0.06, d: 0.1, color: C.boneLo, ry: 0.15 });
  for (const ex of [-0.045, 0.045]) g.box({ x: 0.1 + ex, y: 0.97, z: 0.0, w: 0.05, h: 0.05, d: 0.02, color: C.deep, shade: 1, ry: 0.15 });
  // horns
  for (const s of [-1, 1]) g.cyl({ x: 0.1 + s * 0.11, y: 1.02, z: -0.1, rb: 0.035, rt: 0, h: 0.16, segs: 5, color: C.bone, rz: -s * 0.6, flat: true });
  // bones scattered in front
  const bone = (x, z, ry, len = 0.26) => {
    g.box({ x, y: 0, z, w: len, h: 0.04, d: 0.04, ry, color: C.bone, shade: 0.8 });
    for (const e of [-1, 1]) {
      const ex = x + Math.cos(ry) * e * len / 2;
      const ez = z - Math.sin(ry) * e * len / 2;
      g.box({ x: ex, y: 0, z: ez, w: 0.07, h: 0.06, d: 0.08, ry, color: C.bone, shade: 0.8 });
    }
  };
  bone(-0.58, 0.42, 0.4);
  bone(0.5, 0.42, -0.5, 0.22);
  bone(-0.85, -0.05, 1.3, 0.2);
  bone(0.86, 0.02, 2.0, 0.24);
  // sticks
  g.box({ x: -0.2, y: 0, z: 0.42, w: 0.3, h: 0.03, d: 0.03, ry: -0.3, color: C.woodLo });
  g.box({ x: 0.2, y: 0, z: 0.44, w: 0.26, h: 0.03, d: 0.03, ry: 0.5, color: C.wood });
  // glowing eyes inside the mouth
  const eyes = new Geo(92);
  for (const ex of [-0.1, 0.1]) eyes.box({ x: ex, y: -0.03, z: 0, w: 0.08, h: 0.06, d: 0.02, color: '#ff6a4a', top: '#ffd84d', skip: 'ny', shade: 1, jit: 0 });
  return assemble([[g, MODEL_MATERIALS.solid], [eyes, MODEL_MATERIALS.glow, 'eyes', [0, 0.26, 0.37]]], { height: 1.12 });
}

const STRUCTURE_BUILDERS = {
  keep: buildKeep, house: buildHouse, barracks: buildBarracks, tower: buildTower, temple: buildTemple,
  outpost: buildOutpost, wall: buildWall, shrine: buildShrine, nest: buildNest,
};
/** Structure ids with 3D models, and their footprints (w along x, h along z). */
export const STRUCTURE_FOOTPRINTS = Object.freeze({
  keep: [3, 3], house: [2, 2], barracks: [3, 2], tower: [2, 2], temple: [2, 2], outpost: [1, 1], wall: [1, 1], shrine: [2, 2], nest: [2, 1],
});

const cache = new Map();
function cached(key, make) {
  let tpl = cache.get(key);
  if (tpl === undefined) {
    tpl = make();
    cache.set(key, tpl);
  }
  return tpl ? tpl.clone() : null;
}

const teamKey = (team) => (team === 0 || team === 1 ? team : 'n');

/**
 * 3D model for a realm structure.
 * @param {string} id keep | house | barracks | tower | temple | outpost | wall | shrine | nest
 * @param {0|1|null} team
 * @returns {THREE.Group|null}
 */
export function structureModel(id, team = null) {
  const make = STRUCTURE_BUILDERS[id];
  if (!make) return null;
  return cached(`s:${id}:${id === 'nest' ? 'n' : teamKey(team)}`, () => make(team));
}

// =============================================================================================
// Scaffold and deposits
// =============================================================================================

/**
 * Construction scaffold over a w x h footprint; brick courses fill in with progress (0..1).
 * @returns {THREE.Group}
 */
export function scaffoldModel(w = 2, h = 2, progress = 0) {
  const p = Math.max(0, Math.min(1, progress));
  const courses = Math.floor(p * 6 + 1e-3);
  return cached(`sc:${w}x${h}:${courses}`, () => {
    const g = new Geo(101 + w * 7 + h * 13 + courses);
    const hw = w / 2 - 0.1;
    const hh = h / 2 - 0.1;
    // foundation slab
    g.bricks(-hw, hw, 0, 0.08, -hh, hh, { color: (k, i, gg) => stonePick(gg), len: 0.6, course: 0.08, shade: 0.7 });
    // brick core rising with progress
    const bx = hw - 0.18;
    const bz = hh - 0.18;
    const ch = 0.17;
    for (let k = 0; k < courses; k++) {
      const y = 0.08 + k * ch;
      const top = k === courses - 1;
      const nb = Math.max(1, Math.round((bx * 2) / 0.45));
      const len = (bx * 2) / nb;
      const off = k % 2 ? len / 2 : 0;
      const cuts = [-bx];
      for (let c = 1; c < nb + (off ? 1 : 0); c++) cuts.push(-bx + c * len - off);
      cuts.push(bx);
      for (let i = 0; i < cuts.length - 1; i++) {
        if (top && courses < 6 && g.rng() < 0.3) continue;
        g.box({ x: (cuts[i] + cuts[i + 1]) / 2, y, z: 0, w: cuts[i + 1] - cuts[i] - 0.01, h: ch, d: bz * 2, color: brickPick(g), shade: 0.74, hgrad: 0.86, jit: 0.06, skip: top ? 'ny' : 'nypy' });
      }
    }
    if (courses >= 6) g.studs(0, 0.08 + 6 * ch, 0, Math.max(1, Math.round(bx * 2 / 0.5)), Math.max(1, Math.round(bz * 2 / 0.5)), 0.5, C.brick, 0.11, 0.07, 6);
    // timber poles
    const H = 1.3;
    const nxp = Math.max(1, Math.round(w)) + 1;
    const nzp = Math.max(1, Math.round(h)) + 1;
    const poleAt = (x, z) => g.box({ x, y: 0, z, w: 0.07, h: H, d: 0.07, color: C.woodHi, shade: 0.65, jit: 0.08 });
    for (let i = 0; i < nxp; i++) {
      const x = -hw + (i / (nxp - 1)) * hw * 2;
      poleAt(x, hh);
      poleAt(x, -hh);
    }
    for (let j = 1; j < nzp - 1; j++) {
      const z = -hh + (j / (nzp - 1)) * hh * 2;
      poleAt(-hw, z);
      poleAt(hw, z);
    }
    // planks (front + back walkways) and side rails
    for (const y of [0.55, 1.1]) {
      for (const sz of [1, -1]) g.box({ x: 0, y, z: sz * hh, w: hw * 2 + 0.16, h: 0.05, d: 0.16, color: g.rng() < 0.5 ? C.woodHi : '#c68c4c', shade: 0.8, jit: 0.06 });
      for (const sx of [1, -1]) g.box({ x: sx * hw, y: y + 0.01, z: 0, w: 0.06, h: 0.04, d: hh * 2, color: C.wood, shade: 0.8 });
    }
    // diagonal braces on the front
    const bl = Math.hypot(hw * 2 / (nxp - 1), 0.55);
    const ba = Math.atan2(0.55, hw * 2 / (nxp - 1));
    for (let i = 0; i < nxp - 1; i++) {
      const x0 = -hw + (i / (nxp - 1)) * hw * 2;
      const x1 = -hw + ((i + 1) / (nxp - 1)) * hw * 2;
      const dir = i % 2 ? 1 : -1;
      g.box({ x: (x0 + x1) / 2, y: 0.55 - 0.02, z: hh + 0.05, w: bl, h: 0.04, d: 0.03, rz: dir * ba, color: C.wood, skip: '', shade: 0.85 });
    }
    // brick stash + mallet by the front corner
    g.box({ x: hw - 0.12, y: 0.08, z: hh + 0.02, w: 0.2, h: 0.09, d: 0.11, color: C.brick, ry: 0.2 });
    g.box({ x: hw - 0.16, y: 0.17, z: hh + 0.01, w: 0.18, h: 0.08, d: 0.1, color: C.brickHi, ry: -0.3 });
    return assemble([[g, MODEL_MATERIALS.solid]], { height: H, courses });
  });
}

/** A LEGO brick (nx x nz studs) at (x, y, z) with yaw ry; pitch p. */
function legoBrick(g, x, y, z, nx, nz, ry, color, p = 0.13, studs = true) {
  const bh = p * 1.2;
  g.push({ x, y, z, ry });
  g.box({ x: 0, y: 0, z: 0, w: nx * p - 0.006, h: bh, d: nz * p - 0.006, color, shade: 0.68, jit: 0.05 });
  if (studs) g.studs(0, bh, 0, nx, nz, p, color, p * 0.3, p * 0.32, 6);
  g.pop();
  return bh;
}

/**
 * Brick deposit: a pile of orange LEGO bricks (~0.8 tiles across); rich = bigger, with gold bricks.
 * @returns {THREE.Group}
 */
export function depositModel(rich = false) {
  return cached(`d:${rich ? 1 : 0}`, () => {
    const g = new Geo(rich ? 121 : 111);
    const s = rich ? 1.18 : 1;
    const p = 0.13 * s;
    const bh = p * 1.2;
    const o = (k) => (k === 'g' ? C.gold : k === 'h' ? C.brickHi : k === 'l' ? C.brickLo : C.brick);
    const pile = rich
      ? [
          [-0.17, 0, 0.04, 2, 4, 0.12, 'b', false], [0.2, 0, -0.06, 2, 3, -0.3, 'l', false], [0.03, 0, 0.27, 3, 2, 0.4, 'h', true],
          [-0.12, 0, -0.27, 3, 2, -0.1, 'b', true], [0.33, 0, 0.22, 1, 2, 0.9, 'g', true],
          [-0.05, 1, 0.0, 2, 3, 0.55, 'h', false], [0.16, 1, -0.06, 2, 2, -0.2, 'g', true], [-0.24, 1, 0.12, 1, 2, 0.1, 'b', true],
          [0.03, 2, 0.02, 2, 2, 0.25, 'b', true], [-0.18, 0, -0.42 + 0.12, 1, 1, 0, 'g', true],
        ]
      : [
          [-0.13, 0, 0.04, 2, 4, 0.12, 'b', false], [0.18, 0, -0.06, 2, 3, -0.3, 'l', false], [0.03, 0, 0.25, 3, 2, 0.4, 'h', true],
          [-0.05, 1, 0.0, 2, 3, 0.55, 'h', true], [0.17, 1, 0.08, 1, 2, -0.2, 'b', true],
          [-0.24, 0, -0.24, 2, 2, -0.5, 'b', true],
        ];
    for (const [x, lvl, z, nx, nz, ry, k, st] of pile) legoBrick(g, x * s, lvl * bh, z * s, nx, nz, ry, o(k), p, st);
    // a loose brick tipped on its side
    g.push({ x: 0.3 * s, y: 0.0, z: -0.28 * s, ry: 0.8 });
    g.box({ x: 0, y: 0, z: 0, w: 2 * p, h: p, d: bh, color: C.brickLo, shade: 0.7 });
    g.pop();
    return assemble([[g, MODEL_MATERIALS.solid]], { height: rich ? 3 * bh + 0.05 : 2 * bh + 0.05 });
  });
}

// =============================================================================================
// Card buildings
// =============================================================================================

function cardBase(g, T, r = 0.42, h = 0.12) {
  g.box({ x: 0, y: 0, z: 0, w: r * 2, h, d: r * 2, color: C.stone, top: C.stoneHi, shade: 0.68 });
  g.box({ x: 0, y: h, z: 0, w: r * 2 - 0.08, h: 0.06, d: r * 2 - 0.08, color: T.main, top: T.light, shade: 0.8 });
  return h + 0.06;
}

function buildTesla(team) {
  const T = tc(team);
  const g = new Geo(131);
  const y0 = cardBase(g, T);
  g.cyl({ x: 0, y: y0, z: 0, rb: 0.26, rt: 0.2, h: 0.3, segs: 8, flat: true, color: C.stone, topColor: C.stoneHi, shade: 0.65 });
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) g.box({ x: Math.cos(a) * 0.24, y: y0, z: Math.sin(a) * 0.24, w: 0.1, h: 0.2, d: 0.1, ry: -a, color: T.main, top: T.light, shade: 0.75 });
  g.cyl({ x: 0, y: y0 + 0.3, z: 0, r: 0.06, h: 0.5, segs: 6, color: C.iron, shade: 0.8 });
  for (let i = 0; i < 3; i++) {
    const y = y0 + 0.36 + i * 0.13;
    g.cyl({ x: 0, y, z: 0, r: 0.17 - i * 0.025, h: 0.06, segs: 8, color: '#d8901f', topColor: '#ffd84d', shade: 0.75 });
  }
  g.cyl({ x: 0, y: y0 + 0.78, z: 0, rb: 0.08, rt: 0.12, h: 0.06, segs: 8, color: C.stoneHi });
  const orb = new Geo(132);
  orb.sphere({ x: 0, y: 0, z: 0, r: 0.12, ws: 8, hs: 5, color: C.cyan, topColor: C.glassHi, shade: 0.8, jit: 0 });
  return assemble([[g, MODEL_MATERIALS.solid], [orb, MODEL_MATERIALS.glow, 'glow', [0, y0 + 0.96, 0]]], { height: y0 + 1.1 });
}

function buildCannon(team) {
  const T = tc(team);
  const g = new Geo(141);
  g.bricks(-0.4, 0.4, 0, 0.32, -0.4, 0.4, { color: (k, i, gg) => (k === 1 ? T.main : brickPick(gg)), course: 0.16, len: 0.4 });
  g.cyl({ x: 0, y: 0.32, z: 0, r: 0.34, h: 0.05, segs: 10, color: C.stoneDark, topColor: C.stone });
  const top = new Geo(142);
  // wooden carriage
  for (const sx of [-1, 1]) top.box({ x: sx * 0.15, y: 0, z: 0, w: 0.07, h: 0.2, d: 0.42, color: C.wood, shade: 0.75 });
  top.box({ x: 0, y: 0, z: -0.12, w: 0.3, h: 0.08, d: 0.14, color: C.woodLo });
  // barrel tilted up slightly, pointing +z
  top.push({ x: 0, y: 0.2, z: -0.04, rx: Math.PI / 2 - 0.22 });
  top.cyl({ x: 0, y: -0.14, z: 0, rb: 0.15, rt: 0.12, h: 0.58, segs: 10, color: C.ironLo, topColor: C.deep, shade: 0.9, bottom: true });
  top.cyl({ x: 0, y: 0.36, z: 0, r: 0.14, h: 0.08, segs: 10, color: C.iron, topColor: C.deep });
  top.cyl({ x: 0, y: 0.06, z: 0, r: 0.16, h: 0.05, segs: 10, color: T.main, top: false });
  top.pop();
  top.sphere({ x: 0, y: 0.2, z: -0.2, r: 0.09, ws: 8, hs: 4, color: C.ironLo });
  // a cannonball pyramid at the back
  return assemble([[g, MODEL_MATERIALS.solid], [top, MODEL_MATERIALS.solid, 'top', [0, 0.37, 0]]], { height: 0.85 });
}

function buildCrypt(team) {
  const T = tc(team);
  const g = new Geo(151);
  g.box({ x: 0, y: 0, z: 0, w: 0.9, h: 0.08, d: 0.86, color: T.main, top: T.light, shade: 0.8 });
  g.bricks(-0.38, 0.38, 0.08, 0.6, -0.36, 0.3, { color: (k, i, gg) => stonePick(gg), course: 0.13, len: 0.38, skipTop: true });
  g.prism({ x: 0, y: 0.6, z: -0.03, l: 0.9, d: 0.84, h: 0.32, color: C.stoneDark, endColor: C.stone });
  g.box({ x: 0, y: 0.88, z: -0.03, w: 0.92, h: 0.06, d: 0.1, color: C.stoneDark, shade: 0.9 });
  // doorway arch
  g.box({ x: 0, y: 0.08, z: 0.3, w: 0.38, h: 0.44, d: 0.04, color: C.stoneHi, shade: 0.8 });
  g.cyl({ x: 0, y: 0.52, z: 0.3, r: 0.19, h: 0.04, segs: 8, color: C.stoneHi, rx: Math.PI / 2, shade: 1, jit: 0 });
  // skull ornament
  g.box({ x: 0, y: 0.94, z: 0.02, w: 0.16, h: 0.13, d: 0.14, color: C.bone, shade: 0.8 });
  for (const ex of [-0.035, 0.035]) g.box({ x: ex, y: 0.99, z: 0.09, w: 0.04, h: 0.04, d: 0.02, color: C.deep, shade: 1 });
  // tombstone + bones
  g.box({ x: -0.34, y: 0, z: 0.38, w: 0.14, h: 0.2, d: 0.06, color: C.stone, ry: 0.2, top: C.stoneHi });
  g.box({ x: 0.33, y: 0, z: 0.4, w: 0.2, h: 0.035, d: 0.035, ry: -0.6, color: C.bone });
  const lit = new Geo(152);
  lit.box({ x: 0, y: 0.08, z: 0.325, w: 0.26, h: 0.38, d: 0.02, color: C.purple, top: C.pink, shade: 0.45, jit: 0 });
  lit.cyl({ x: 0, y: 0.46, z: 0.31, r: 0.13, h: 0.03, segs: 8, color: C.purple, rx: Math.PI / 2, shade: 1, jit: 0 });
  return assemble([[g, MODEL_MATERIALS.solid], [lit, MODEL_MATERIALS.glow, 'glow']], { height: 1.08 });
}

function buildBrickTower(team) {
  const T = tc(team);
  const g = new Geo(161);
  g.box({ x: 0, y: 0, z: 0, w: 0.86, h: 0.08, d: 0.86, color: C.stone, top: C.stoneHi });
  g.bricks(-0.34, 0.34, 0.08, 0.98, -0.34, 0.34, { color: (k, i, gg) => (k === 3 ? T.main : brickPick(gg)), course: 0.18, len: 0.34, skipTop: true });
  g.box({ x: 0, y: 0.32, z: 0.34, w: 0.12, h: 0.18, d: 0.02, color: C.deep, shade: 1 });
  const top = new Geo(162);
  top.bricks(-0.42, 0.42, 0, 0.1, -0.42, 0.42, { color: (k, i, gg) => brickPick(gg), course: 0.1, len: 0.42 });
  for (const [mx, mz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    top.box({ x: mx * 0.31, y: 0.1, z: mz * 0.31, w: 0.2, h: 0.16, d: 0.2, color: C.brickHi });
    top.stud(mx * 0.31, 0.26, mz * 0.31, C.brickHi, 0.07, 0.05, 6);
  }
  top.box({ x: 0, y: 0.1, z: 0, w: 0.3, h: 0.02, d: 0.3, color: T.dark, top: T.main });
  return assemble([[g, MODEL_MATERIALS.solid], [top, MODEL_MATERIALS.solid, 'top', [0, 0.98, 0]]], { height: 1.3, top: 1.1 });
}

function buildFaithWell(team) {
  const T = tc(team);
  const g = new Geo(171);
  g.cyl({ x: 0, y: 0, z: 0, r: 0.46, h: 0.06, segs: 8, a0: Math.PI / 8, flat: true, color: C.stone, topColor: C.stoneHi });
  // round brick ring: two staggered courses + a team course
  const ring = (y, h, r, n, off, pick) => {
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      const len = 2 * r * Math.tan(Math.PI / n) + 0.004;
      g.box({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, w: 0.12, h, d: len, ry: -a, color: pick(i), shade: 0.72, hgrad: 0.86, jit: 0.06, skip: 'ny' });
    }
  };
  ring(0.06, 0.13, 0.32, 8, 0, () => brickPick(g));
  ring(0.19, 0.13, 0.32, 8, Math.PI / 8, () => brickPick(g));
  ring(0.32, 0.07, 0.33, 8, 0, () => (g.rng() < 0.3 ? T.light : T.main));
  g.cyl({ x: 0, y: 0.06, z: 0, r: 0.27, h: 0.28, segs: 8, color: C.deep, top: false, shade: 1, jit: 0 });
  // timber frame with a bucket and a little gold roof ridge
  for (const sx of [-1, 1]) g.box({ x: sx * 0.38, y: 0.06, z: 0, w: 0.06, h: 0.72, d: 0.06, color: C.wood, shade: 0.75 });
  g.box({ x: 0, y: 0.72, z: 0, w: 0.86, h: 0.05, d: 0.05, color: C.woodLo, skip: '' });
  g.box({ x: 0.0, y: 0.5, z: 0, w: 0.012, h: 0.22, d: 0.012, color: C.boneLo });
  g.cyl({ x: 0, y: 0.4, z: 0, rb: 0.06, rt: 0.075, h: 0.1, segs: 6, color: C.wood, topColor: C.goldHi });
  for (const s of [-1, 1]) g.box({ x: 0, y: 0.74, z: s * 0.11, w: 0.96, h: 0.04, d: 0.26, rx: s * 0.6, color: s > 0 ? T.main : T.dark, skip: '', shade: 0.85 });
  // glowing golden faith
  const glow = new Geo(172);
  glow.cyl({ x: 0, y: 0, z: 0, r: 0.27, h: 0.02, segs: 8, color: C.gold, topColor: C.goldHi, shade: 1, jit: 0 });
  for (const [x, z, y] of [[0.08, 0.05, 0.1], [-0.1, -0.04, 0.18], [0.02, -0.12, 0.26]]) glow.box({ x, y, z, w: 0.045, h: 0.045, d: 0.045, color: C.goldHi, skip: '', shade: 1, jit: 0 });
  return assemble([[g, MODEL_MATERIALS.solid], [glow, MODEL_MATERIALS.glow, 'glow', [0, 0.3, 0]]], { height: 0.95 });
}

function buildTurret(team) {
  const T = tc(team);
  const g = new Geo(181);
  g.cyl({ x: 0, y: 0, z: 0, r: 0.3, h: 0.06, segs: 8, flat: true, color: C.stoneDark, topColor: C.stone });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    g.box({ x: Math.cos(a) * 0.14, y: 0.04, z: Math.sin(a) * 0.14, w: 0.05, h: 0.32, d: 0.05, ry: -a, rz: 0, rx: 0, color: C.iron });
  }
  g.cyl({ x: 0, y: 0.06, z: 0, r: 0.06, h: 0.28, segs: 6, color: C.iron });
  const top = new Geo(182);
  top.box({ x: 0, y: 0, z: 0, w: 0.34, h: 0.22, d: 0.34, color: T.main, top: T.light, shade: 0.7 });
  top.box({ x: 0, y: 0.22, z: 0, w: 0.24, h: 0.04, d: 0.24, color: C.stoneHi });
  top.stud(0, 0.26, 0, C.stoneHi, 0.06, 0.04, 6);
  top.box({ x: 0, y: 0.08, z: 0.18, w: 0.18, h: 0.08, d: 0.02, color: C.deep, shade: 1 });
  top.cyl({ x: 0, y: 0.1, z: 0.16, r: 0.045, h: 0.28, segs: 6, rx: Math.PI / 2, color: C.ironLo, topColor: C.deep });
  return assemble([[g, MODEL_MATERIALS.solid], [top, MODEL_MATERIALS.solid, 'top', [0, 0.34, 0]]], { height: 0.65 });
}

const CARD_BUILDERS = {
  tesla: buildTesla, cannon: buildCannon, crypt: buildCrypt, bricktower: buildBrickTower, mine: buildFaithWell, turret: buildTurret,
  wall: buildWall,
};
/** Card ids with 3D building models. */
export const CARD_MODEL_IDS = Object.freeze(Object.keys(CARD_BUILDERS));

/**
 * 3D model for a card building (~1 tile).
 * @param {string} cardId tesla | cannon | crypt | bricktower | mine | turret | wall
 * @param {0|1|null} team
 * @returns {THREE.Group|null}
 */
export function cardBuildingModel(cardId, team = null) {
  const make = CARD_BUILDERS[cardId];
  if (!make) return null;
  return cached(`c:${cardId}:${teamKey(team)}`, () => make(team));
}

// =============================================================================================
// Instanced scenery: trees, rocks, crystals (single BufferGeometry each, origin at base centre)
// =============================================================================================

/** Biomes with scenery geometry. */
export const MODEL_BIOMES = Object.freeze(['meadow', 'desert', 'frost', 'swamp', 'crystal', 'lava', 'candy', 'void']);
const biomeOf = (b) => (MODEL_BIOMES.includes(b) ? b : 'meadow');
const geoCache = new Map();
function cachedGeo(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

function trunk(g, h, w = 0.14, color = C.wood, top = C.woodHi) {
  g.box({ x: 0, y: 0, z: 0, w, h, d: w, color, top, shade: 0.6 });
}

/** Stacked leafy cubes (meadow / candy / void style). */
function cubeCanopy(g, y, s, colors, studColor) {
  const [main, hi, lo] = colors;
  g.box({ x: 0, y, z: 0, w: s, h: s * 0.62, d: s, color: main, top: hi, shade: 0.62, jit: 0.05 });
  g.box({ x: s * 0.08, y: y + s * 0.62, z: -s * 0.04, w: s * 0.66, h: s * 0.38, d: s * 0.66, color: main, top: hi, shade: 0.7, jit: 0.05 });
  g.box({ x: -s * 0.36, y: y + s * 0.12, z: s * 0.14, w: s * 0.34, h: s * 0.36, d: s * 0.4, color: lo, top: main, shade: 0.7 });
  if (studColor) g.stud(s * 0.08, y + s, -s * 0.04, studColor, s * 0.14, s * 0.1, 6);
}

function pineTiers(g, y0, tiers, r0, h0, colors, snow) {
  const [main, hi] = colors;
  let y = y0;
  for (let i = 0; i < tiers; i++) {
    const f = 1 - i / (tiers + 0.6);
    const r = r0 * f;
    const h = h0 * (0.75 + 0.25 * f);
    g.cyl({ x: 0, y, z: 0, rb: r, rt: 0, h, segs: 4, a0: i * 0.35, flat: true, color: main, topColor: hi, shade: 0.55, jit: 0.05 });
    if (snow) g.cyl({ x: 0, y: y + h * 0.42, z: 0, rb: r * 0.6, rt: 0, h: h * 0.6, segs: 4, a0: i * 0.35, flat: true, color: snow, topColor: '#ffffff', shade: 0.85, jit: 0.02 });
    y += h * 0.55;
  }
  return y;
}

function palm(g, v) {
  const segs = 5;
  let x = 0;
  let y = 0;
  const lean = v === 0 ? 0.05 : -0.05;
  for (let i = 0; i < segs; i++) {
    g.box({ x, y, z: 0, w: 0.13 - i * 0.008, h: 0.2, d: 0.13 - i * 0.008, rz: -lean * i * 0.6, color: i % 2 ? C.wood : C.woodHi, shade: 0.75 });
    x += lean * 0.2 * i;
    y += 0.19;
  }
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + v * 0.4;
    g.box({ x: x + Math.cos(a) * 0.2, y: y - 0.02 - 0.06, z: Math.sin(a) * 0.2, w: 0.42, h: 0.04, d: 0.14, ry: -a, rz: -0.4, color: i % 2 ? C.leaf : '#5dbb4a', top: i % 2 ? '#6fcf55' : C.leafHi, skip: '', shade: 0.7 });
  }
  g.box({ x, y: y - 0.02, z: 0, w: 0.16, h: 0.08, d: 0.16, color: C.leaf, top: C.leafHi });
  for (const [cx, cz] of [[0.06, 0.07], [-0.07, 0.04]]) g.box({ x: x + cx, y: y - 0.1, z: cz, w: 0.07, h: 0.07, d: 0.07, color: C.woodLo, skip: '' });
}

function cactus(g) {
  const col = '#4caf50';
  const hi = '#7ed36a';
  g.box({ x: 0, y: 0, z: 0, w: 0.22, h: 0.86, d: 0.22, color: col, top: hi, shade: 0.6 });
  g.box({ x: 0.17, y: 0.3, z: 0, w: 0.14, h: 0.1, d: 0.14, color: col });
  g.box({ x: 0.22, y: 0.4, z: 0, w: 0.12, h: 0.26, d: 0.12, color: col, top: hi });
  g.box({ x: -0.16, y: 0.42, z: 0, w: 0.12, h: 0.09, d: 0.12, color: col });
  g.box({ x: -0.2, y: 0.51, z: 0, w: 0.11, h: 0.2, d: 0.11, color: col, top: hi });
  g.box({ x: 0, y: 0.86, z: 0, w: 0.09, h: 0.07, d: 0.09, color: C.pink, top: '#ffd1ec', skip: 'ny' });
  g.cyl({ x: 0, y: 0, z: 0, r: 0.22, h: 0.04, segs: 6, color: '#d9b276', shade: 0.9 });
}

function willow(g, v) {
  trunk(g, 0.5, 0.15, C.woodLo, C.wood);
  const dark = '#2f5c3a';
  const mid = '#3f7a45';
  g.box({ x: 0, y: 0.5, z: 0, w: 0.86, h: 0.26, d: 0.8, color: dark, top: mid, shade: 0.7 });
  g.box({ x: 0.05, y: 0.76, z: -0.04, w: 0.5, h: 0.14, d: 0.48, color: mid, top: '#5a9a50', shade: 0.75 });
  const strands = v === 0 ? 8 : 7;
  for (let i = 0; i < strands; i++) {
    const a = (i / strands) * Math.PI * 2 + 0.3 * v;
    const len = 0.28 + ((i * 37) % 5) * 0.04;
    g.box({ x: Math.cos(a) * 0.38, y: 0.52 - len, z: Math.sin(a) * 0.36, w: 0.07, h: len, d: 0.07, color: '#264d30', top: dark, shade: 0.6, skip: 'py' });
  }
}

function deadTree(g, col, colHi, tipColor, v) {
  g.box({ x: 0, y: 0, z: 0, w: 0.16, h: 0.72, d: 0.16, color: col, top: colHi, shade: 0.65 });
  const br = [[0.42, 0.55, 0.2, 0.3], [-0.5, 0.42, -0.6, 0.26], [0.2, 0.7, 2.4, 0.22]];
  for (const [rz, y, ry, len] of br) {
    g.push({ x: 0, y, z: 0, ry: ry + v * 0.5 });
    g.box({ x: 0, y: 0, z: 0, w: 0.07, h: len, d: 0.07, rz, color: col, top: colHi, shade: 0.75 });
    if (tipColor) g.box({ x: -Math.sin(rz) * len, y: Math.cos(rz) * len - 0.02, z: 0, w: 0.08, h: 0.08, d: 0.08, color: tipColor, skip: '', shade: 0.95, jit: 0.03 });
    g.pop();
  }
}

function crystalShard(g, x, z, r, h, tiltX, tiltZ, color, hi, segs = 6) {
  g.push({ x, y: 0, z, rx: tiltX, rz: tiltZ });
  g.cyl({ x: 0, y: 0, z: 0, r, h, segs, flat: true, color, topColor: color, shade: 0.6, jit: 0.04 });
  g.cyl({ x: 0, y: h, z: 0, rb: r, rt: 0, h: r * 1.8, segs, flat: true, color: hi, topColor: '#ffffff', shade: 0.85, jit: 0.03 });
  g.pop();
}

const TREE_MAKERS = {
  meadow(g, v) {
    if (v === 2) {
      trunk(g, 0.3, 0.13, C.woodLo, C.wood);
      pineTiers(g, 0.22, 3, 0.48, 0.55, [C.leafLo, '#3a8a50']);
      return;
    }
    trunk(g, v === 1 ? 0.42 : 0.34, 0.15);
    if (v === 0) {
      cubeCanopy(g, 0.32, 0.74, [C.leaf, C.leafHi, '#378a3c'], C.leafHi);
      for (const [x, y, z] of [[0.2, 0.55, 0.38], [-0.3, 0.72, 0.2]]) g.box({ x, y, z, w: 0.07, h: 0.07, d: 0.07, color: C.red, skip: '', shade: 0.95 });
    } else {
      g.box({ x: 0, y: 0.4, z: 0, w: 0.6, h: 0.36, d: 0.6, color: C.leaf, top: C.leafHi, shade: 0.62 });
      g.box({ x: 0.04, y: 0.76, z: 0.02, w: 0.48, h: 0.32, d: 0.48, ry: 0.4, color: '#4fb04f', top: C.leafHi, shade: 0.7 });
      g.box({ x: 0, y: 1.08, z: 0, w: 0.3, h: 0.22, d: 0.3, ry: 0.8, color: '#5dbb4a', top: '#a8ec7a', shade: 0.75 });
      g.stud(0, 1.3, 0, '#a8ec7a', 0.07, 0.05, 6);
    }
  },
  desert(g, v) {
    if (v === 2) cactus(g);
    else palm(g, v);
  },
  frost(g, v) {
    const tiers = [3, 4, 2][v];
    trunk(g, 0.26, 0.13, C.woodLo, C.wood);
    pineTiers(g, 0.18, tiers, [0.5, 0.46, 0.4][v], [0.6, 0.55, 0.5][v], ['#2e6b4a', '#3d8a5a'], '#f4fbff');
  },
  swamp(g, v) {
    if (v === 2) {
      deadTree(g, '#5a4a3a', '#7a6650', null, 1);
      g.box({ x: 0, y: 0.3, z: 0.085, w: 0.12, h: 0.14, d: 0.02, color: '#4a7a3a', skip: '' });
      g.cyl({ x: 0, y: 0, z: 0, r: 0.2, h: 0.04, segs: 6, color: '#3f5a36' });
    } else willow(g, v);
  },
  crystal(g, v) {
    if (v === 2) {
      trunk(g, 0.26, 0.12, C.boneLo, C.bone);
      pineTiers(g, 0.2, 3, 0.44, 0.55, [C.blue, C.cyan]);
      g.box({ x: 0, y: 1.1, z: 0, w: 0.08, h: 0.08, d: 0.08, color: C.glassHi, skip: '', ry: 0.7, rx: 0.6 });
      return;
    }
    trunk(g, 0.46, 0.13, C.boneLo, C.bone);
    const cols = v === 0 ? [C.teal, '#b6fff4'] : [C.cyan, C.glassHi];
    crystalShard(g, 0, 0, 0.13, 0.42, 0, 0, cols[0], cols[1]);
    g.push({ x: 0, y: 0.42, z: 0 });
    crystalShard(g, 0, 0, 0.16, 0.36, 0, 0, cols[0], cols[1]);
    crystalShard(g, 0.12, 0.02, 0.1, 0.3, 0.1, -0.6, cols[0], cols[1]);
    crystalShard(g, -0.1, 0.06, 0.1, 0.26, 0.4, 0.6, C.purple, '#e2c4ff');
    crystalShard(g, 0.0, -0.12, 0.09, 0.24, -0.6, 0.1, cols[0], cols[1]);
    g.pop();
  },
  lava(g, v) {
    if (v === 2) {
      trunk(g, 0.28, 0.12, C.deep, C.dark);
      pineTiers(g, 0.2, 3, 0.4, 0.5, ['#3a2c30', '#57444a']);
      g.box({ x: 0, y: 0.9, z: 0, w: 0.09, h: 0.09, d: 0.09, color: '#ff8f2e', top: '#ffe066', skip: 'ny' });
      return;
    }
    deadTree(g, C.deep, C.dark, v === 0 ? '#ff8f2e' : '#ffe066', v);
    g.box({ x: 0, y: 0.12, z: 0.082, w: 0.05, h: 0.22, d: 0.02, color: '#ff8f2e', skip: '', shade: 1 });
    g.cyl({ x: 0, y: 0, z: 0, r: 0.2, h: 0.04, segs: 6, color: '#2a1b33', topColor: '#4a3a3f' });
  },
  candy(g, v) {
    if (v === 1) {
      g.cyl({ x: 0, y: 0, z: 0, r: 0.04, h: 0.78, segs: 6, color: C.white, shade: 0.8 });
      g.push({ x: 0, y: 0.95, z: 0, rx: Math.PI / 2 - 0.35 });
      g.cyl({ x: 0, y: -0.06, z: 0, r: 0.32, h: 0.12, segs: 10, color: C.pink, topColor: C.pink, shade: 0.85, bottom: true });
      g.cyl({ x: 0, y: 0.06, z: 0, r: 0.23, h: 0.01, segs: 10, color: C.white, shade: 1 });
      g.cyl({ x: 0, y: 0.07, z: 0, r: 0.15, h: 0.01, segs: 10, color: C.magenta, shade: 1 });
      g.cyl({ x: 0, y: 0.08, z: 0, r: 0.07, h: 0.01, segs: 8, color: C.white, shade: 1 });
      g.pop();
      g.box({ x: 0, y: 0.6, z: 0, w: 0.16, h: 0.06, d: 0.06, color: C.magenta, skip: '' });
      return;
    }
    if (v === 2) {
      const cols = ['#7dff8a', C.pink, '#ffd84d'];
      let y = 0;
      for (let i = 0; i < 3; i++) {
        const r = 0.36 - i * 0.09;
        g.cyl({ x: 0, y, z: 0, rb: r, rt: r * 0.55, h: 0.3, segs: 8, color: cols[i], topColor: mixHex(cols[i], '#ffffff', 0.35), shade: 0.7 });
        y += 0.28;
      }
      g.sphere({ x: 0, y: y + 0.04, z: 0, r: 0.08, ws: 6, hs: 3, color: C.red });
      return;
    }
    g.cyl({ x: 0, y: 0, z: 0, r: 0.06, h: 0.42, segs: 6, color: C.white, topColor: C.white, shade: 0.8 });
    g.sphere({ x: 0, y: 0.72, z: 0, r: 0.4, ws: 8, hs: 5, sy: 0.85, color: C.pink, topColor: '#ffc4e6', capRows: 0.4, shade: 0.7 });
    for (const [x, y, z, c] of [[0.3, 0.8, 0.18, '#7dff8a'], [-0.2, 0.92, 0.26, '#ffd84d'], [0.05, 0.62, 0.38, C.cyan], [-0.33, 0.66, -0.06, C.white]]) g.box({ x, y, z, w: 0.08, h: 0.035, d: 0.035, ry: x * 4, color: c, skip: '', shade: 1 });
  },
  void(g, v) {
    if (v === 0) {
      deadTree(g, C.dark, C.purpleLo, C.pink, 2);
      return;
    }
    if (v === 2) {
      let y = 0;
      for (let i = 0; i < 5; i++) {
        const s = 0.3 - i * 0.045;
        const h = 0.26 - i * 0.02;
        g.box({ x: 0, y, z: 0, w: s, h, d: s, ry: i * 0.5, color: i < 2 ? C.dark : i < 4 ? C.purpleLo : C.purple, top: i === 4 ? C.pink : C.purple, shade: 0.65 });
        y += h;
      }
      g.box({ x: 0, y, z: 0, w: 0.08, h: 0.08, d: 0.08, ry: 0.8, rx: 0.6, color: C.pink, skip: '' });
      return;
    }
    trunk(g, 0.36, 0.14, C.dark, C.purpleLo);
    cubeCanopy(g, 0.34, 0.7, [C.purpleLo, C.purple, '#4a2580'], C.pink);
    for (const [x, y, z] of [[0.2, 0.5, 0.36], [-0.3, 0.74, 0.22], [0.36, 0.76, -0.1]]) g.box({ x, y, z, w: 0.06, h: 0.06, d: 0.06, color: C.pink, skip: '', shade: 1 });
  },
};

/**
 * Tree geometry for instancing (vertex colours, origin at base centre, ~1 tile footprint).
 * @param {string} biome @param {number} variant 0..2
 * @returns {THREE.BufferGeometry}
 */
export function treeGeometry(biome = 'meadow', variant = 0) {
  const b = biomeOf(biome);
  const v = ((variant | 0) % 3 + 3) % 3;
  return cachedGeo(`t:${b}:${v}`, () => {
    const g = new Geo(hashStr(`tree:${b}:${v}`));
    TREE_MAKERS[b](g, v);
    return g.build();
  });
}

const ROCK_COLORS = {
  meadow: { hi: '#c8c9dc', main: '#8f8eab', lo: '#6e6c8c', cap: null },
  desert: { hi: '#e8b878', main: '#d49b5a', lo: '#b5532f', cap: null, bands: true },
  frost: { hi: '#e2f8ff', main: '#9fb8d0', lo: '#6f8aa8', cap: '#ffffff' },
  swamp: { hi: '#8f8eab', main: '#6a6880', lo: '#4a4860', cap: null, moss: '#43a047' },
  crystal: { hi: '#a98ae0', main: '#7a5cb8', lo: '#4e3a80', cap: null, shards: true },
  lava: { hi: '#6a5458', main: '#4a3a3f', lo: '#2a2026', cap: null, lava: true },
  candy: { hi: '#e8b88a', main: '#c68c5c', lo: '#8f5a3a', cap: '#ffffff' },
  void: { hi: '#6a5a96', main: '#3f2f55', lo: '#2a1b33', cap: null, glint: '#ff86cf' },
};

/**
 * Mountain rock stack geometry (1.2-2.4 tall) for instancing.
 * @param {string} biome @param {number} variant 0..2
 * @returns {THREE.BufferGeometry}
 */
export function rockGeometry(biome = 'meadow', variant = 0) {
  const b = biomeOf(biome);
  const v = ((variant | 0) % 3 + 3) % 3;
  return cachedGeo(`r:${b}:${v}`, () => {
    const R = ROCK_COLORS[b];
    const g = new Geo(hashStr(`rock:${b}:${v}`));
    const H = [1.25, 1.75, 2.35][v];
    // blocks: [x, z, w, d, h, ry]
    const layers = [
      [0, 0, 0.98, 0.98, H * 0.36, 0],
      [0.06 * (v - 1), -0.04, 0.78, 0.74, H * 0.3, 0.12 * (v - 1)],
      [-0.05, 0.03, 0.52, 0.5, H * 0.22, -0.2],
      [0.04, -0.02, 0.28, 0.3, H * 0.12, 0.35],
    ];
    let y = 0;
    layers.forEach(([x, z, w, d, h, ry], i) => {
      const col = i % 2 ? R.main : R.lo;
      const isTop = i === layers.length - 1;
      const top = R.cap && (isTop || i === layers.length - 2) ? R.cap : R.hi;
      g.box({ x, y, z, w, h, d, ry, color: i === 0 ? R.lo : col, top, shade: 0.6, jit: 0.05, topBand: false });
      if (R.bands && i < 3) g.box({ x, y: y + h * 0.45, z, w: w + 0.02, h: h * 0.14, d: d + 0.02, ry, color: R.hi, skip: 'nypy', jit: 0.03 });
      if (R.cap && i >= 1) g.box({ x, y: y + h - 0.06, z, w: w + 0.03, h: 0.07, d: d + 0.03, ry, color: R.cap, top: R.cap, skip: 'ny', shade: 0.92, jit: 0.02 });
      if (R.moss && i === 1) g.box({ x: x - w * 0.2, y: y + h, z: z + d * 0.1, w: w * 0.5, h: 0.03, d: d * 0.5, color: R.moss, top: '#5dbb4a', jit: 0.03 });
      y += h;
    });
    // side boulders and a ledge stud
    g.box({ x: 0.3, y: 0, z: 0.36, w: 0.34, h: H * 0.22, d: 0.26, ry: 0.4, color: R.main, top: R.hi, shade: 0.6 });
    g.box({ x: -0.34, y: H * 0.36, z: 0.24, w: 0.26, h: H * 0.14, d: 0.24, ry: -0.3, color: R.main, top: R.cap ?? R.hi, shade: 0.65 });
    g.stud(-0.3, H * 0.36, -0.3, R.cap ?? R.hi, 0.09, 0.06, 6);
    if (R.lava) {
      g.box({ x: 0, y: 0.06, z: 0.495, w: 0.5, h: 0.05, d: 0.02, color: '#ff8f2e', skip: 'ny', shade: 1, jit: 0 });
      g.box({ x: 0.15, y: 0.06, z: 0.495, w: 0.05, h: H * 0.28, d: 0.02, color: '#ff8f2e', skip: 'ny', shade: 1, jit: 0 });
      g.box({ x: 0.495, y: 0.08, z: -0.1, w: 0.02, h: H * 0.2, d: 0.05, color: '#ffe066', skip: 'ny', shade: 1, jit: 0 });
    }
    if (R.shards) {
      crystalShard(g, 0.32, -0.3, 0.08, 0.3, -0.3, -0.4, C.teal, '#b6fff4');
      g.push({ x: 0, y: H * 0.66, z: 0 });
      crystalShard(g, -0.12, 0.16, 0.07, 0.24, 0.4, 0.3, C.teal, '#b6fff4');
      g.pop();
    }
    if (R.glint) for (const [x, yy, z] of [[0.2, H * 0.5, 0.38], [-0.25, H * 0.75, 0.25]]) g.box({ x, y: yy, z, w: 0.05, h: 0.05, d: 0.05, color: R.glint, skip: '', shade: 1, jit: 0 });
    return g.build();
  });
}

/**
 * Crystal cluster geometry (CRYSTAL tiles) for instancing.
 * @param {number} variant 0..2 (teal, cyan, violet)
 * @returns {THREE.BufferGeometry}
 */
export function crystalGeometry(variant = 0) {
  const v = ((variant | 0) % 3 + 3) % 3;
  return cachedGeo(`x:${v}`, () => {
    const g = new Geo(hashStr(`crystal:${v}`));
    const [col, hi] = [[C.teal, '#b6fff4'], [C.cyan, C.glassHi], [C.purple, '#e2c4ff']][v];
    g.box({ x: 0, y: 0, z: 0, w: 0.9, h: 0.16, d: 0.86, color: '#4e3a80', top: '#6a5a96', shade: 0.6 });
    g.box({ x: 0.1, y: 0.16, z: -0.05, w: 0.58, h: 0.1, d: 0.5, ry: 0.3, color: '#4e3a80', top: '#7a6aa6', shade: 0.7 });
    const H = [1.1, 1.3, 1.0][v];
    crystalShard(g, 0, 0, 0.17, H, 0, 0, col, hi);
    crystalShard(g, 0.22, 0.12, 0.12, H * 0.62, 0.25, -0.35, col, hi);
    crystalShard(g, -0.24, 0.08, 0.13, H * 0.7, 0.2, 0.4, col, hi);
    crystalShard(g, 0.04, -0.24, 0.11, H * 0.55, -0.45, 0.05, mixHex(col, '#ffffff', 0.2), hi);
    crystalShard(g, -0.12, 0.3, 0.08, H * 0.36, 0.6, 0.2, col, hi);
    crystalShard(g, 0.3, -0.22, 0.07, H * 0.3, -0.3, -0.5, C.pink, '#ffe0f2', 5);
    return g.build();
  });
}

// =============================================================================================
// Helpers
// =============================================================================================

/** Triangle count of a BufferGeometry or of every mesh under an Object3D. */
export function triangleCount(obj) {
  if (obj.isBufferGeometry) return obj.index ? obj.index.count / 3 : obj.attributes.position.count / 3;
  let n = 0;
  obj.traverse((o) => {
    if (o.isMesh) n += triangleCount(o.geometry);
  });
  return n;
}
