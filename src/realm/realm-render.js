// Draws a Realm: a camera over the pre-rendered island, territory borders, villages on brick baseplates,
// every unit and effect from the shared battle renderer, night lighting and the minimap.

import { BattleRenderer, hexA } from '../battle/render.js';
import { TILE } from '../battle/constants.js';
import { drawSprite, drawHero, spriteSize } from '../art/sprite-cache.js';
import { renderRealmMap, renderRealmTile, drawRealmWater, drawTerritory, realmTileColor } from '../art/realm-tiles.js';
import { T, STRUCTURES, WILD } from './constants.js';

const FONT = '"Press Start 2P", ui-monospace, monospace';
const TEAM_COL = ['#3b7dd8', '#d8453b'];
const TEAM_DARK = ['#23468c', '#8c2a23'];
const TEAM_LIGHT = ['#7fb8ff', '#ff8a7f'];
const STRUCT_SCALE = { house: 1.5, temple: 1.35, barracks: 2, banner: 1, keep: 1, princess_tower: 1, wall: 1, nest: 1.25 };

export class RealmRenderer extends BattleRenderer {
  /**
   * @param {import('./realm.js').Realm} realm
   * @param {HTMLCanvasElement} canvas
   */
  constructor(realm, canvas) {
    super(realm, canvas);
    this.bg = null;
    const R = realm;
    this.biome = R.arena?.biome || 'meadow';
    this.seed = R.map.seed || 1;
    try {
      this.map = renderRealmMap(R.tiles, R.W, R.H, this.biome, this.seed);
    } catch (err) {
      console.warn('realm map failed', err);
      this.map = fallbackMap(R);
    }
    this.mapCtx = this.map.getContext('2d');
    const k = R.players[0]?.keep || R.players[1]?.keep;
    this.cam = { x: k ? k.x : R.W / 2, y: k ? k.y - 3 : R.H / 2, zoom: 2 };
    this.view = { x0: 0, y0: 0, w: 1, h: 1 };
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    this.lavaTiles = [];
    for (let i = 0; i < R.tiles.length; i++) if (R.tiles[i] === T.LAVA) this.lavaTiles.push(i);
    this.minimapBase = null;
  }

  /** Fill the css box with the canvas; the camera decides what is visible. */
  resize(cssW, cssH, dpr = Math.min(3, globalThis.devicePixelRatio || 1)) {
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.layout = { scale: this.cam.zoom, cssW, cssH, dpr };
    this.fitWorld();
    return this.layout;
  }

  fitWorld() {
    const { cssW, cssH } = this.layout;
    const z = this.cam.zoom;
    const w = Math.ceil(cssW / z) + 2;
    const h = Math.ceil(cssH / z) + 2;
    if (this.world.width !== w || this.world.height !== h) {
      this.world.width = w;
      this.world.height = h;
      this.light.width = w;
      this.light.height = h;
      this.w = this.world.getContext('2d');
      this.w.imageSmoothingEnabled = false;
    }
    this.layout.scale = z;
  }

  /** Zoom so that `tiles` tiles fit across the screen. */
  setZoomTiles(tiles) {
    const z = this.layout.cssW / (tiles * TILE);
    this.cam.zoom = Math.max(0.8, Math.min(6, z));
    this.fitWorld();
  }

  clampCam() {
    const R = this.B;
    const vw = this.layout.cssW / this.cam.zoom / TILE;
    const vh = this.layout.cssH / this.cam.zoom / TILE;
    const mx = vw / 2 - 1.5;
    const my = vh / 2 - 1.5;
    this.cam.x = vw >= R.W + 3 ? R.W / 2 : Math.max(mx, Math.min(R.W - mx, this.cam.x));
    this.cam.y = vh >= R.H + 3 ? R.H / 2 : Math.max(my, Math.min(R.H - my, this.cam.y));
  }

  /** css px (relative to the canvas) → tile coords. */
  toWorld(px, py) {
    const z = this.cam.zoom;
    return { x: (this.view.x0 + px / z) / TILE, y: (this.view.y0 + py / z) / TILE };
  }
  toCss(x, y) {
    const z = this.cam.zoom;
    return { x: (x * TILE - this.view.x0) * z, y: (y * TILE - this.view.y0) * z };
  }

  /** Redraw tiles the simulation changed (fire, regrowth). */
  syncTiles() {
    const R = this.B;
    if (!R.tileChanges.length) return;
    for (const i of R.tileChanges) {
      try {
        renderRealmTile(this.mapCtx, R.tiles, R.W, R.H, i % R.W, Math.floor(i / R.W), this.biome, this.seed);
      } catch {
        this.mapCtx.fillStyle = safeColor(R.tiles[i], this.biome);
        this.mapCtx.fillRect((i % R.W) * TILE, Math.floor(i / R.W) * TILE, TILE, TILE);
      }
    }
    R.tileChanges.length = 0;
    this.minimapDirty = true;
  }

  draw(ui = {}, dt = 0) {
    this.t += dt;
    const R = this.B;
    const t = this.t;
    this.syncTiles();
    this.clampCam();
    const z = this.cam.zoom;
    const vw = this.world.width;
    const vh = this.world.height;
    const x0 = Math.round(this.cam.x * TILE - this.layout.cssW / z / 2);
    const y0 = Math.round(this.cam.y * TILE - this.layout.cssH / z / 2);
    this.view = { x0, y0, w: vw, h: vh };
    const tv = {
      x0: Math.max(0, Math.floor(x0 / TILE) - 1),
      y0: Math.max(0, Math.floor(y0 / TILE) - 1),
      x1: Math.min(R.W, Math.ceil((x0 + vw) / TILE) + 1),
      y1: Math.min(R.H, Math.ceil((y0 + vh) / TILE) + 2),
    };
    this.tv = tv;
    const c = this.w;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#10223a';
    c.fillRect(0, 0, vw, vh);
    c.translate(-x0, -y0);
    // ground
    const sx = Math.max(0, x0);
    const sy = Math.max(0, y0);
    const sw = Math.min(this.map.width, x0 + vw) - sx;
    const sh = Math.min(this.map.height, y0 + vh) - sy;
    if (sw > 0 && sh > 0) c.drawImage(this.map, sx, sy, sw, sh, sx, sy, sw, sh);
    try {
      drawRealmWater(c, R.tiles, R.W, R.H, this.biome, t, tv);
    } catch {
      /* optional */
    }
    if (ui.showTerritory !== false) {
      try {
        drawTerritory(c, R.owner, R.W, R.H, tv);
      } catch {
        /* optional */
      }
    }
    if (ui.summonZone) this.drawSummonZone(c, ui.summonZone);
    this.drawRealmGround(c, t);
    for (const d of R.deposits) if (d.amount > 0 && this.inView(d.x, d.y, 2)) this.drawDeposit(c, d, t);
    for (const s of R.structures) if (s.alive && this.inView(s.x, s.y, 3)) this.drawPlate(c, s);
    if (ui.build) this.drawBuildGhost(c, ui.build, t);

    // entities sorted by their feet
    const ents = [];
    for (const e of R.entities) {
      if (!e.alive) continue;
      if (!this.inView(e.x, e.y, 3.5)) continue;
      ents.push(e);
    }
    for (const e of ents) if (!e.struct && e.kind !== 'pickup') this.drawShadow(c, e);
    ents.sort((a, b) => (a.flying ? 1 : 0) - (b.flying ? 1 : 0) || this.feet(a) - this.feet(b));
    for (const e of ents) this.drawEntity(c, e, t);
    this.drawProjectiles(c, t);
    this.drawAreas(c, t);
    this.drawWarnings(c, t);
    this.drawLines(c, t);
    this.drawParticles(c);
    for (const e of ents) this.drawBars(c, e);
    this.drawTexts(c);
    this.drawEmotes(c, t);
    this.drawUi(c, ui, t);
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.drawNight(c, t, x0, y0);
    if (R.whiteFlash > 0) {
      c.fillStyle = `rgba(255,255,255,${R.whiteFlash * 0.8})`;
      c.fillRect(0, 0, vw, vh);
    }

    // blit
    const ctx = this.ctx;
    const { dpr, cssW, cssH } = this.layout;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    let ox = 0;
    let oy = 0;
    if (R.shakeT > 0) {
      const k = R.shakeT * 5 * z;
      ox = (Math.random() - 0.5) * k;
      oy = (Math.random() - 0.5) * k;
    }
    const fx = (this.cam.x * TILE - this.layout.cssW / z / 2) - x0; // sub-pixel camera offset
    const fy = (this.cam.y * TILE - this.layout.cssH / z / 2) - y0;
    ctx.drawImage(this.world, Math.round((ox - fx * z) * dpr), Math.round((oy - fy * z) * dpr), Math.round(vw * z * dpr), Math.round(vh * z * dpr));
    void cssW;
    void cssH;
  }

  inView(x, y, m = 2) {
    const tv = this.tv;
    return x >= tv.x0 - m && x <= tv.x1 + m && y >= tv.y0 - m && y <= tv.y1 + m;
  }

  feet(e) {
    if (e.struct) return e.fp.y0 + e.fp.h - 0.05;
    return e.y;
  }

  // ───────────────────────── ground ─────────────────────────

  drawRealmGround(c, t) {
    const R = this.B;
    const tv = this.tv;
    for (const d of R.decals) {
      if (!this.inView(d.x, d.y, 3)) continue;
      const a = Math.min(1, d.t / 3) * 0.45;
      c.fillStyle = `rgba(30,20,20,${a})`;
      c.beginPath();
      c.ellipse(d.x * TILE, d.y * TILE, d.r * TILE * 0.8, d.r * TILE * 0.55, 0, 0, Math.PI * 2);
      c.fill();
    }
    for (let ty = tv.y0; ty < tv.y1; ty++) {
      for (let tx = tv.x0; tx < tv.x1; tx++) {
        const i = ty * R.W + tx;
        const w = R.wasteGrid[i];
        const f = R.fireGrid[i];
        if (w <= 0 && f <= 0) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        if (w > 0) {
          c.fillStyle = `rgba(110,140,60,${Math.min(0.55, w * 0.2)})`;
          c.fillRect(x, y, TILE, TILE);
          if ((Math.floor(t * 4) + i) % 7 === 0) {
            c.fillStyle = 'rgba(200,255,120,0.5)';
            c.fillRect(x + ((i * 7) % 13), y + ((i * 5) % 11), 1, 1);
          }
        }
        if (f > 0) {
          const flick = 0.35 + 0.15 * Math.sin(t * 20 + i);
          c.fillStyle = `rgba(255,110,30,${Math.min(0.5, f * 0.2) * flick * 2})`;
          c.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
          c.fillStyle = 'rgba(255,220,90,0.7)';
          for (let k = 0; k < 4; k++) {
            const px = x + ((i * 3 + k * 5 + Math.floor(t * 10)) % 14) + 1;
            const py = y + TILE - 3 - ((k * 4 + Math.floor(t * 14)) % 10);
            c.fillRect(px, py, 1, 2);
          }
        }
      }
    }
    for (const cr of R.cracks) {
      const a = Math.min(1, cr.t);
      c.strokeStyle = `rgba(40,25,15,${a})`;
      c.lineWidth = 2;
      c.beginPath();
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const jx = Math.sin((cr.seed * 100 + i) * 12.9) * 4;
        const x = (cr.x0 + (cr.x1 - cr.x0) * k) * TILE + jx;
        const y = (cr.y0 + (cr.y1 - cr.y0) * k) * TILE + jx * 0.5;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
  }

  drawSummonZone(c, zone) {
    // dim everything that is not a legal drop spot for the dragged card
    const R = this.B;
    const tv = this.tv;
    c.fillStyle = 'rgba(10,8,30,0.32)';
    for (let ty = tv.y0; ty < tv.y1; ty++) {
      for (let tx = tv.x0; tx < tv.x1; tx++) {
        const ok = zone.building ? R.owner[ty * R.W + tx] === 0 : R.summonOk(0, tx + 0.5, ty + 0.5, zone.flying);
        if (!ok) c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    const h = R.players[0]?.hero;
    if (h?.alive && !zone.building) {
      c.strokeStyle = `rgba(127,184,255,${0.5 + 0.2 * Math.sin(this.t * 6)})`;
      c.setLineDash([3, 3]);
      c.beginPath();
      c.arc(h.x * TILE, h.y * TILE, 4 * TILE, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
  }

  drawDeposit(c, d, t) {
    const k = d.amount / d.max;
    const x = d.x * TILE;
    const y = d.y * TILE + 6;
    const scale = d.rich ? 1.25 : 1;
    this.sprite(c, 'brickpile', x, y, { t: t + d.id, scale: k < 0.3 ? scale * 0.75 : scale });
    if (d.rich) {
      c.fillStyle = `rgba(255,215,120,${0.35 + 0.25 * Math.sin(t * 3 + d.id)})`;
      c.fillRect(Math.round(x + 6), Math.round(y - 16 - (Math.floor(t * 2 + d.id) % 3)), 1, 1);
    }
  }

  /** LEGO-style baseplate under every structure, tinted by team. */
  drawPlate(c, s) {
    if (s.struct === 'nest' || s.isWall) return;
    const fp = s.fp;
    const x = fp.x0 * TILE;
    const y = fp.y0 * TILE;
    const w = fp.w * TILE;
    const h = fp.h * TILE;
    const team = s.team;
    const base = team === 0 ? '#2f5d9e' : team === 1 ? '#9e3a32' : '#8a8a96';
    const hi = team === 0 ? '#5a8fd6' : team === 1 ? '#d0645a' : '#b8b8c4';
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(x + 1, y + 2, w, h);
    c.fillStyle = base;
    c.fillRect(x + 1, y + 1, w - 2, h - 2);
    c.fillStyle = hi;
    for (let yy = y + 4; yy < y + h - 2; yy += 6) for (let xx = x + 4; xx < x + w - 2; xx += 6) c.fillRect(xx, yy, 2, 2);
    if (s.built < 1) {
      c.strokeStyle = 'rgba(255,230,140,0.8)';
      c.setLineDash([2, 2]);
      c.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      c.setLineDash([]);
    }
  }

  drawBuildGhost(c, b, t) {
    const def = STRUCTURES[b.id];
    if (!def || b.x0 == null) return;
    const x = b.x0 * TILE;
    const y = b.y0 * TILE;
    const w = def.w * TILE;
    const h = def.h * TILE;
    c.fillStyle = b.valid ? 'rgba(120,255,140,0.28)' : 'rgba(255,80,80,0.3)';
    c.fillRect(x, y, w, h);
    c.strokeStyle = b.valid ? '#8dff9a' : '#ff6a6a';
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    c.globalAlpha = 0.65;
    const key = def.sprite;
    this.sprite(c, key, x + w / 2, y + h - 1, { team: 0, t, scale: STRUCT_SCALE[key] || 1 });
    c.globalAlpha = 1;
    if (b.id === 'tower' || def.claim) {
      c.strokeStyle = 'rgba(127,184,255,0.45)';
      c.setLineDash([2, 3]);
      c.beginPath();
      c.arc(x + w / 2, y + h / 2, (b.id === 'tower' ? def.range : def.claim) * TILE, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
  }

  drawWarnings(c, t) {
    for (const w of this.B.warnings) {
      const k = 1 - w.t / w.max;
      c.strokeStyle = `rgba(255,70,50,${0.5 + 0.4 * Math.sin(t * 16)})`;
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(w.x * TILE, w.y * TILE, w.r * TILE, w.r * TILE * 0.7, 0, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = `rgba(255,70,50,${0.12 + k * 0.2})`;
      c.beginPath();
      c.ellipse(w.x * TILE, w.y * TILE, w.r * TILE * k, w.r * TILE * 0.7 * k, 0, 0, Math.PI * 2);
      c.fill();
    }
  }

  // ───────────────────────── entities ─────────────────────────

  drawEntity(c, e, t) {
    if (e.struct) {
      this.drawStructure(c, e, t);
      return;
    }
    if (e.kind === 'pickup') {
      this.drawPickup(c, e, t);
      return;
    }
    if (e.kind === 'villager') {
      const x = e.x * TILE;
      const y = e.y * TILE;
      this.sprite(c, e.sprite, x, y, { anim: e.anim || 'idle', t: e.age, team: e.team, flip: e.facing < 0, flash: e.flash || 0 });
      if (e.job === 'pray' && e.anim === 'pray') {
        c.fillStyle = hexA('#ffe28a', 0.25 + 0.15 * Math.sin(t * 4 + e.id));
        c.fillRect(Math.round(x) - 1, Math.round(y) - 18, 2, 3);
      }
      this.drawStatus(c, e, x, y, t);
      return;
    }
    super.drawEntity(c, e, t);
  }

  drawTower(c, e, x, y, t) {
    this.drawStructure(c, e, t);
  }

  drawStructure(c, s, t) {
    const fp = s.fp;
    const x = (fp.x0 + fp.w / 2) * TILE;
    const bottom = (fp.y0 + fp.h) * TILE - 1;
    const team = s.team === 0 || s.team === 1 ? s.team : null;
    if (s.built < 1) {
      const frame = s.built < 0.34 ? 0 : s.built < 0.67 ? 1 : 2;
      const scale = (fp.w * TILE) / 20;
      this.sprite(c, 'scaffold', x, bottom, { frame, team, scale: Math.min(2, scale), flash: s.flash });
      return;
    }
    let key = s.sprite;
    let anim = 'idle';
    if (s.struct === 'keep') {
      key = hasSprite('keep') ? 'keep' : 'king_tower';
      anim = s.anim === 'attack' && s.attackAnimT > 0 ? 'attack' : 'idle';
    } else if (s.struct === 'tower') anim = s.anim === 'attack' ? 'attack' : 'idle';
    else if (s.struct === 'barracks') anim = s.anim === 'train' ? 'train' : 'idle';
    if (s.attackAnimT > 0) s.attackAnimT -= 1 / 60;
    const scale = STRUCT_SCALE[key] || 1;
    this.sprite(c, key, x, bottom, { anim, t: s.age ?? t, team, flash: s.flash, scale });
    if (s.struct === 'tower' && s.element) this.sprite(c, `elem_${s.element}`, x, bottom - 36 + Math.sin(t * 3), { t });
    if (s.struct === 'shrine') {
      // glow and capture ring
      const col = s.team === 0 ? '#7fb8ff' : s.team === 1 ? '#ff8a7f' : '#ffe28a';
      c.fillStyle = hexA(col, 0.18 + 0.1 * Math.sin(t * 3));
      c.beginPath();
      c.ellipse(x, bottom - 18, 14, 18, 0, 0, Math.PI * 2);
      c.fill();
      if (s.capProg > 0 && s.capTeam >= 0) {
        c.strokeStyle = s.capTeam === 0 ? '#7fb8ff' : '#ff8a7f';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(x, bottom - 40, 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * s.capProg);
        c.stroke();
        c.lineWidth = 1;
      }
      c.strokeStyle = hexA(col, 0.35);
      c.setLineDash([2, 4]);
      c.beginPath();
      c.ellipse(s.x * TILE, s.y * TILE, 3 * TILE, 3 * TILE * 0.75, 0, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
    this.drawStatus(c, s, x, bottom - 6, t);
  }

  drawPickup(c, p, t) {
    const x = p.x * TILE;
    const y = p.y * TILE - 4 - Math.abs(Math.sin(t * 3 + p.id)) * 3;
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.ellipse(x, p.y * TILE + 1, 5, 2, 0, 0, Math.PI * 2);
    c.fill();
    if (p.type === 'relic') {
      // the legendary Red Brick
      c.fillStyle = hexA('#ff4a3a', 0.25 + 0.15 * Math.sin(t * 5));
      c.beginPath();
      c.arc(x, y - 3, 9, 0, Math.PI * 2);
      c.fill();
      const rx = Math.round(x) - 5;
      const ry = Math.round(y) - 6;
      c.fillStyle = '#8c1d14';
      c.fillRect(rx, ry + 2, 10, 6);
      c.fillStyle = '#e8352a';
      c.fillRect(rx, ry + 2, 10, 5);
      c.fillRect(rx + 1, ry, 3, 2);
      c.fillRect(rx + 6, ry, 3, 2);
      c.fillStyle = '#ff8a7a';
      c.fillRect(rx + 1, ry, 1, 1);
      c.fillRect(rx + 6, ry, 1, 1);
      c.fillRect(rx + 1, ry + 3, 7, 1);
      if (Math.floor(t * 6 + p.id) % 9 === 0) {
        c.fillStyle = '#fff';
        c.fillRect(rx + 8, ry + 1, 1, 1);
      }
      return;
    }
    const key = p.type === 'faith' ? 'faith_orb' : p.type === 'heart' ? 'heart_orb' : 'brick_orb';
    this.sprite(c, key, x, y, { t: t + p.id });
  }

  drawBars(c, e) {
    if (e.kind === 'pickup' || e.kind === 'critter') return;
    if (e.struct) {
      if (e.struct === 'shrine') return;
      const scaffold = e.built < 1;
      if (!scaffold && e.hp >= e.maxHp && e.struct !== 'keep') return;
      if (e.isWall && !scaffold && e.hp >= e.maxHp * 0.98) return;
      const fp = e.fp;
      const x = (fp.x0 + fp.w / 2) * TILE;
      const key = e.struct === 'keep' ? 'keep' : e.sprite;
      const sh = scaffold ? 20 : (safeH(key) * (STRUCT_SCALE[key] || 1));
      const y = Math.round((fp.y0 + fp.h) * TILE - sh - 6);
      const w = Math.max(12, fp.w * TILE - 6);
      const keep = e.struct === 'keep';
      const hgt = keep ? 4 : 2;
      c.fillStyle = 'rgba(10,8,20,0.8)';
      c.fillRect(Math.round(x - w / 2) - 1, y - 1, w + 2, hgt + 2);
      if (scaffold) {
        c.fillStyle = '#ffcf4a';
        c.fillRect(Math.round(x - w / 2), y, Math.round(w * e.built), hgt);
        return;
      }
      c.fillStyle = e.team === 0 ? '#5aa2ff' : e.team === 1 ? '#ff5a4d' : '#c9b79c';
      c.fillRect(Math.round(x - w / 2), y, Math.round(w * Math.max(0, e.hp / e.maxHp)), hgt);
      if (keep) {
        c.font = `8px ${FONT}`;
        c.textAlign = 'center';
        c.strokeStyle = 'rgba(0,0,0,0.85)';
        c.lineWidth = 2;
        c.fillStyle = '#fff';
        const txt = String(Math.ceil(e.hp));
        c.strokeText(txt, Math.round(x), y - 2);
        c.fillText(txt, Math.round(x), y - 2);
      }
      return;
    }
    if (e.kind === 'villager' && e.hp >= e.maxHp) return;
    super.drawBars(c, e);
  }

  drawUi(c, ui, t) {
    super.drawUi(c, { ...ui, ghost: ui.ghost }, t);
    const R = this.B;
    const h = R.players[0]?.hero;
    // aim line for the joystick-steered hero's target
    if (h?.alive && h.joy && h.focus == null) {
      /* auto-aim only */
    }
    if (ui.selectedStructure?.alive) {
      const s = ui.selectedStructure;
      c.strokeStyle = '#ffcf4a';
      c.setLineDash([2, 2]);
      c.strokeRect(s.fp.x0 * TILE - 1.5, s.fp.y0 * TILE - 1.5, s.fp.w * TILE + 3, s.fp.h * TILE + 3);
      c.setLineDash([]);
      if (s.range) {
        c.strokeStyle = 'rgba(255,207,74,0.35)';
        c.beginPath();
        c.arc(s.x * TILE, s.y * TILE, s.range * TILE, 0, Math.PI * 2);
        c.stroke();
      }
    }
    void t;
  }

  // ───────────────────────── night ─────────────────────────

  drawNight(c, t, x0, y0) {
    const R = this.B;
    const k = R.nightK;
    const chaos = R.ageIdx >= 3 ? 1 : 0;
    if (chaos) {
      c.fillStyle = `rgba(90,20,110,${0.08 + 0.03 * Math.sin(t * 0.7)})`;
      c.fillRect(0, 0, this.world.width, this.world.height);
    }
    if (k < 0.02) return;
    const l = this.lctx;
    const w = this.light.width;
    const h = this.light.height;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, w, h);
    l.fillStyle = `rgba(8,10,40,${0.62 * k})`;
    l.fillRect(0, 0, w, h);
    l.globalCompositeOperation = 'destination-out';
    const glow = (x, y, r, a = 1) => {
      const px = x * TILE - x0;
      const py = y * TILE - y0;
      const rr = r * TILE;
      if (px < -rr || py < -rr || px > w + rr || py > h + rr) return;
      const g = l.createRadialGradient(px, py, rr * 0.15, px, py, rr);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g;
      l.fillRect(px - rr, py - rr, rr * 2, rr * 2);
    };
    const flick = 1 + Math.sin(t * 9) * 0.04;
    for (const s of R.structures) {
      if (!s.alive || s.built < 1 || s.isWall) continue;
      const r = s.struct === 'keep' ? 5.5 : s.struct === 'tower' ? 3.2 : s.struct === 'shrine' ? 3.5 : s.struct === 'nest' ? 0 : 2.4;
      if (r) glow(s.x, s.y - 0.5, r * flick, 0.95);
    }
    for (const e of R.entities) {
      if (!e.alive) continue;
      if (e.kind === 'hero') glow(e.x, e.y - 0.5, 3.2, 0.9);
      else if (e.kind === 'pickup') glow(e.x, e.y, 1.4, 0.8);
    }
    const tv = this.tv;
    for (let ty = tv.y0; ty < tv.y1; ty++) {
      for (let tx = tv.x0; tx < tv.x1; tx++) {
        const i = ty * R.W + tx;
        if (R.fireGrid[i] > 0) glow(tx + 0.5, ty + 0.5, 1.8, 0.8);
      }
    }
    for (const i of this.lavaTiles) {
      const tx = i % R.W;
      const ty = Math.floor(i / R.W);
      if (tx >= tv.x0 && tx < tv.x1 && ty >= tv.y0 && ty < tv.y1) glow(tx + 0.5, ty + 0.5, 1.3, 0.6);
    }
    for (const p of R.projectiles) if (p.alive && (p.proj === 'fireball' || p.proj === 'rocket')) glow(p.x, p.y, 1, 0.7);
    l.globalCompositeOperation = 'source-over';
    c.drawImage(this.light, 0, 0);
    // warm light tint near fires and windows is implied by the cut-outs; add a few fireflies
    if (k > 0.5) {
      for (let i = 0; i < 10; i++) {
        const fx = ((i * 97 + t * 7 * ((i % 3) + 1)) % w);
        const fy = ((i * 53 + Math.sin(t + i) * 20 + i * 41) % h + h) % h;
        c.fillStyle = `rgba(220,255,140,${0.4 + 0.4 * Math.sin(t * 3 + i)})`;
        c.fillRect(Math.round(fx), Math.round(fy), 1, 1);
      }
    }
  }

  // ───────────────────────── minimap ─────────────────────────

  /** Draw the island, borders, buildings, units and the camera box into a small canvas (1 css px per tile * s). */
  drawMinimap(mc, s = 2) {
    const R = this.B;
    const W = R.W;
    const H = R.H;
    if (!this.minimapBase || this.minimapDirty) {
      this.minimapDirty = false;
      const base = this.minimapBase || document.createElement('canvas');
      base.width = W;
      base.height = H;
      const b = base.getContext('2d');
      const img = b.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        const hex = safeColor(R.tiles[i], this.biome);
        img.data[i * 4] = parseInt(hex.slice(1, 3), 16);
        img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
        img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
        img.data[i * 4 + 3] = 255;
      }
      b.putImageData(img, 0, 0);
      this.minimapBase = base;
    }
    mc.imageSmoothingEnabled = false;
    mc.clearRect(0, 0, W * s, H * s);
    mc.drawImage(this.minimapBase, 0, 0, W * s, H * s);
    // territory tint
    for (let i = 0; i < W * H; i++) {
      const o = R.owner[i];
      if (o !== 0 && o !== 1) continue;
      mc.fillStyle = o === 0 ? 'rgba(80,150,255,0.35)' : 'rgba(255,90,80,0.35)';
      mc.fillRect((i % W) * s, Math.floor(i / W) * s, s, s);
    }
    for (const d of R.deposits) {
      if (d.amount <= 0) continue;
      mc.fillStyle = '#ffb36a';
      mc.fillRect(Math.floor(d.x) * s, Math.floor(d.y) * s, s, s);
    }
    for (const st of R.structures) {
      if (!st.alive) continue;
      mc.fillStyle = st.team === 0 ? '#9cc8ff' : st.team === 1 ? '#ffa49a' : st.struct === 'nest' ? '#2a1a1a' : '#ffe28a';
      mc.fillRect(st.fp.x0 * s, st.fp.y0 * s, st.fp.w * s, st.fp.h * s);
    }
    for (const e of R.entities) {
      if (!e.alive || e.kind === 'critter' || e.struct || e.kind === 'pet') continue;
      if (e.kind === 'pickup') {
        mc.fillStyle = e.type === 'relic' ? '#ff3a2a' : '#ffffff';
        mc.fillRect(Math.floor(e.x * s) - 1, Math.floor(e.y * s) - 1, 3, 3);
        continue;
      }
      if (e.kind === 'building') continue;
      if (e.team === 1 && e.status?.invisible > 0) continue;
      mc.fillStyle = e.kind === 'hero' ? (e.team === 0 ? '#ffffff' : '#ffe14a') : e.team === 0 ? TEAM_COL[0] : e.team === 1 ? TEAM_COL[1] : '#3a2a2a';
      const sz = e.kind === 'hero' ? 3 : e.kind === 'villager' ? 1 : 2;
      mc.fillRect(Math.floor(e.x * s - sz / 2), Math.floor(e.y * s - sz / 2), sz, sz);
    }
    // camera box
    const z = this.cam.zoom;
    const vw = (this.layout.cssW / z / TILE) * s;
    const vh = (this.layout.cssH / z / TILE) * s;
    mc.strokeStyle = 'rgba(255,255,255,0.9)';
    mc.lineWidth = 1;
    mc.strokeRect(Math.round(this.cam.x * s - vw / 2) + 0.5, Math.round(this.cam.y * s - vh / 2) + 0.5, Math.round(vw), Math.round(vh));
    void TEAM_DARK;
    void TEAM_LIGHT;
    void WILD;
    void drawSprite;
    void drawHero;
  }
}

function hasSprite(key) {
  try {
    return !!spriteSize(key);
  } catch {
    return false;
  }
}

function safeH(key) {
  try {
    return spriteSize(key)?.h || 24;
  } catch {
    return 24;
  }
}

const colorCache = new Map();
function safeColor(type, biome) {
  const k = `${biome}|${type}`;
  let c = colorCache.get(k);
  if (!c) {
    try {
      c = realmTileColor(type, biome);
    } catch {
      c = null;
    }
    if (!c || !/^#[0-9a-f]{6}$/i.test(c)) c = ['#123a6b', '#2e6fb0', '#e6d39a', '#4f9a3e', '#2f6b2a', '#7a9a4e', '#6b6370', '#4a4040', '#e8eef5', '#ff6a1e', '#5f5a3a', '#9a6bff', '#b08a5a'][type] || '#444';
    colorCache.set(k, c);
  }
  return c;
}

function fallbackMap(R) {
  const cv = document.createElement('canvas');
  cv.width = R.W * TILE;
  cv.height = R.H * TILE;
  const c = cv.getContext('2d');
  for (let i = 0; i < R.tiles.length; i++) {
    c.fillStyle = safeColor(R.tiles[i], R.arena?.biome || 'meadow');
    c.fillRect((i % R.W) * TILE, Math.floor(i / R.W) * TILE, TILE, TILE);
  }
  return cv;
}
