// Draws a Battle onto a canvas: pixel world at 288x512, scaled crisply to the screen.

import { TILE, PX_W, PX_H, ARENA_W, ARENA_H, RIVER_TOP, RIVER_BOTTOM, inZones } from './constants.js';
import { drawSprite, drawHero, spriteSize } from '../art/sprite-cache.js';
import { renderArenaBackground, drawRiver } from '../art/tiles.js';

const FONT = '"Press Start 2P", ui-monospace, monospace';
const TEAM_COL = ['#3b7dd8', '#d8453b'];
const TEAM_LIGHT = ['#7fb8ff', '#ff8a7f'];

const PROJ_SPRITE = { arrow: 'arrow', bullet: 'bullet', brick: 'brick', rocket: 'rocket', fireball: 'fireball', iceshard: 'iceshard', bone: 'bone', sheep: 'sheep' };

export class BattleRenderer {
  /**
   * @param {import('./battle.js').Battle} battle
   * @param {HTMLCanvasElement} canvas visible canvas
   */
  constructor(battle, canvas) {
    this.B = battle;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = document.createElement('canvas');
    this.world.width = PX_W;
    this.world.height = PX_H;
    this.w = this.world.getContext('2d');
    this.w.imageSmoothingEnabled = false;
    this.bg = null;
    this.t = 0;
    this.layout = { scale: 1, ox: 0, oy: 0, cssW: PX_W, cssH: PX_H, dpr: 1 };
    try {
      this.bg = renderArenaBackground(battle.arena.biome, battle.rng.seed || 1);
    } catch (err) {
      console.warn('arena background failed', err);
    }
  }

  /** Fit the arena into a css box. */
  resize(cssW, cssH, dpr = Math.min(3, globalThis.devicePixelRatio || 1)) {
    const scale = Math.min(cssW / PX_W, cssH / PX_H);
    const w = Math.round(PX_W * scale);
    const h = Math.round(PX_H * scale);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.layout = { scale, cssW: w, cssH: h, dpr };
    return this.layout;
  }

  /** Convert a pointer position relative to the canvas (css px) to tile coords. */
  toWorld(px, py) {
    const s = this.layout.scale * TILE;
    return { x: px / s, y: py / s };
  }
  toCss(x, y) {
    const s = this.layout.scale * TILE;
    return { x: x * s, y: y * s };
  }

  draw(ui = {}, dt = 0) {
    this.t += dt;
    const B = this.B;
    const c = this.w;
    const t = this.t;
    c.save();
    c.imageSmoothingEnabled = false;
    // ground
    if (this.bg) c.drawImage(this.bg, 0, 0);
    else {
      c.fillStyle = '#3f7d3a';
      c.fillRect(0, 0, PX_W, PX_H);
      c.fillStyle = '#2e6fb0';
      c.fillRect(0, RIVER_TOP * TILE, PX_W, (RIVER_BOTTOM - RIVER_TOP) * TILE);
    }
    try {
      drawRiver(c, B.arena.biome, t);
    } catch {
      /* art not ready */
    }
    this.drawGround(c, t);
    if (ui.ghost) this.drawZones(c, ui.ghost);
    for (const p of B.piles) this.sprite(c, 'brickpile', p.x * TILE, p.y * TILE + 6, { t });

    // entities, sorted by feet position
    const ents = B.entities.filter((e) => e.alive);
    for (const e of ents) this.drawShadow(c, e);
    const deadTowers = B.towers.filter((tw) => !tw.alive);
    for (const tw of deadTowers) this.sprite(c, 'tower_ruin', tw.x * TILE, tw.y * TILE + tw.r * TILE * 0.7, { team: tw.team });
    ents.sort((a, b) => (a.flying ? 1 : 0) - (b.flying ? 1 : 0) || a.y - b.y);
    for (const e of ents) this.drawEntity(c, e, t);

    this.drawProjectiles(c, t);
    this.drawAreas(c, t);
    this.drawLines(c, t);
    this.drawParticles(c);
    for (const e of ents) this.drawBars(c, e);
    this.drawTexts(c);
    this.drawEmotes(c, t);
    this.drawUi(c, ui, t);
    if (B.whiteFlash > 0) {
      c.fillStyle = `rgba(255,255,255,${B.whiteFlash * 0.8})`;
      c.fillRect(0, 0, PX_W, PX_H);
    }
    c.restore();

    // blit to the screen
    const ctx = this.ctx;
    const { dpr, cssW, cssH } = this.layout;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#14121f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    let sx = 0;
    let sy = 0;
    if (B.shakeT > 0) {
      const k = B.shakeT * 6 * this.layout.scale;
      sx = (Math.random() - 0.5) * k;
      sy = (Math.random() - 0.5) * k;
    }
    ctx.drawImage(this.world, Math.round(sx * dpr), Math.round(sy * dpr), Math.round(cssW * dpr), Math.round(cssH * dpr));
  }

  sprite(c, key, x, y, opts = {}) {
    try {
      drawSprite(c, key, Math.round(x), Math.round(y), opts);
      return true;
    } catch {
      // fallback block so missing art never crashes the game
      c.fillStyle = opts.team === 1 ? '#d8453b' : opts.team === 0 ? '#3b7dd8' : '#999';
      c.fillRect(Math.round(x) - 4, Math.round(y) - 8, 8, 8);
      return false;
    }
  }

  drawGround(c, t) {
    const B = this.B;
    for (const d of B.decals) {
      const a = Math.min(1, d.t / 3) * 0.45;
      c.fillStyle = `rgba(30,20,20,${a})`;
      c.beginPath();
      c.ellipse(d.x * TILE, d.y * TILE, d.r * TILE * 0.8, d.r * TILE * 0.55, 0, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < B.fireGrid.length; i++) {
      const w = B.wasteGrid[i];
      const f = B.fireGrid[i];
      if (w <= 0 && f <= 0) continue;
      const x = (i % ARENA_W) * TILE;
      const y = Math.floor(i / ARENA_W) * TILE;
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
        c.fillStyle = 'rgba(255,220,90,0.6)';
        for (let k = 0; k < 3; k++) {
          const px = x + ((i * 3 + k * 5 + Math.floor(t * 10)) % 14) + 1;
          const py = y + TILE - 3 - ((k * 4 + Math.floor(t * 14)) % 8);
          c.fillRect(px, py, 1, 2);
        }
      }
    }
    for (const cr of B.cracks) {
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

  drawZones(c, ghost) {
    const B = this.B;
    const zones = B.zonesFor(0);
    const spell = ghost.isSpell;
    if (spell && !ghost.ownSide) return;
    c.fillStyle = 'rgba(216,69,59,0.22)';
    for (let ty = 0; ty < ARENA_H; ty++) {
      for (let tx = 0; tx < ARENA_W; tx++) {
        if (inZones(zones, tx + 0.5, ty + 0.5) && !B.isWasteland(tx + 0.5, ty + 0.5)) continue;
        c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
  }

  drawShadow(c, e) {
    if (e.deployT > 0 && e.kind === 'troop' && e.deployT > 0.6) return;
    const r = e.kind === 'tower' ? e.r * 0.9 : e.r;
    const x = e.x * TILE;
    const y = e.y * TILE + (e.flying ? 2 : 1);
    c.fillStyle = e.flying ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.28)';
    c.beginPath();
    c.ellipse(x, y, r * TILE * 0.95, r * TILE * 0.45, 0, 0, Math.PI * 2);
    c.fill();
  }

  drawEntity(c, e, t) {
    const B = this.B;
    const x = e.x * TILE;
    let y = e.y * TILE;
    const flash = e.flash || 0;
    let alpha = 1;
    if (e.kind === 'troop' && e.deployT > 0) {
      // drop in from above
      const k = Math.min(1, e.deployT);
      y -= k * k * 40;
      alpha = 1 - k * 0.5;
    }
    if (e.kind === 'building' && e.deployT > 0) alpha = 0.5 + 0.5 * (1 - Math.min(1, e.deployT));
    if (e.status?.invisible > 0) alpha = e.team === 0 ? 0.4 : 0.12 + 0.08 * Math.sin(t * 8);
    if (e.flying) y -= 12 + Math.sin(t * 4 + e.id) * 1.5;
    const st = e.status || {};

    if (e.kind === 'tower') {
      this.drawTower(c, e, x, y, t);
      return;
    }
    if (e.kind === 'hero') {
      if (!e.alive) return;
      if (st.invuln > 0 && Math.floor(t * 12) % 2 === 0) alpha = 0.5;
      if (e.form === 3) {
        c.fillStyle = hexA(B.elementColor(e.def.element), 0.18 + 0.08 * Math.sin(t * 5));
        c.beginPath();
        c.ellipse(x, y - 8, 9, 12, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = alpha;
      try {
        drawHero(c, {
          heroId: e.heroId, form: e.form, skin: e.skin, x: Math.round(x), y: Math.round(y), anim: e.anim, t: e.age, team: e.team,
          flip: e.facing < 0, flash, weaponId: e.weapon.id, aim: e.aim,
        });
      } catch {
        this.sprite(c, 'knight', x, y, { team: e.team, flash });
      }
      c.globalAlpha = 1;
      this.drawStatus(c, e, x, y, t);
      if (e.shield > 0) this.bubble(c, x, y - 8, 11, '#7fd7ff', t);
      if (e.channel?.id === 'firespin') this.bubble(c, x, y - 6, 22, '#ff7a2e', t);
      // team marker under hero
      c.strokeStyle = TEAM_LIGHT[e.team];
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(x, y + 1, 8, 3.5, 0, 0, Math.PI * 2);
      c.stroke();
      return;
    }
    let anim = e.anim || 'idle';
    if (e.kind === 'building' && e.hidden) anim = 'hidden';
    if (e.isWall) anim = 'idle';
    if (st.freeze > 0) anim = 'idle';
    const scale = e.boss ? 1.25 : 1;
    c.globalAlpha = alpha;
    this.sprite(c, e.sprite, x, y, { anim, t: e.age, team: e.team, flip: e.facing < 0, flash, scale });
    c.globalAlpha = 1;
    if (e.special?.builder && e.carry) this.sprite(c, 'brick', x + (e.facing < 0 ? -4 : 4), y - 14, {});
    this.drawStatus(c, e, x, y, t);
    if (e.shield > 0) this.bubble(c, x, y - e.h * TILE * 0.45, e.r * TILE + 4, '#7fd7ff', t);
    if (e.boss) {
      c.fillStyle = '#ffcf4a';
      c.font = `8px ${FONT}`;
      c.textAlign = 'center';
      c.fillText('BOSS', x, y - e.h * TILE * scale - 10);
    }
  }

  drawTower(c, e, x, y, t) {
    const key = e.type === 'king' ? 'king_tower' : 'princess_tower';
    const bottom = y + e.r * TILE * 0.75;
    this.sprite(c, key, x, bottom, { team: e.team, flash: e.flash, anim: e.anim === 'attack' ? 'attack' : 'idle', t });
    const { h } = safeSize(key, 40);
    if (e.type === 'king') {
      const kAnim = e.cheer ? 'cheer' : e.active ? 'angry' : 'idle';
      this.sprite(c, 'king', x, bottom - h + 6, { team: e.team, anim: kAnim, t });
      if (e.activateT > 0) {
        c.fillStyle = '#ffcf4a';
        c.font = `8px ${FONT}`;
        c.textAlign = 'center';
        c.fillText('!', x, bottom - h - 6 - Math.abs(Math.sin(t * 10)) * 3);
      }
    }
    if (e.element) this.sprite(c, `elem_${e.element}`, x, bottom - h + 4 + Math.sin(t * 3) * 1, { t });
    this.drawStatus(c, e, x, bottom - 10, t);
  }

  drawStatus(c, e, x, y, t) {
    const st = e.status || {};
    const top = y - (e.h || 1) * TILE * 0.9;
    if (st.freeze > 0) {
      c.fillStyle = 'rgba(170,230,255,0.45)';
      c.fillRect(Math.round(x - e.r * TILE), Math.round(top), Math.round(e.r * TILE * 2), Math.round(y - top));
      c.strokeStyle = 'rgba(230,250,255,0.9)';
      c.strokeRect(Math.round(x - e.r * TILE) + 0.5, Math.round(top) + 0.5, Math.round(e.r * TILE * 2) - 1, Math.round(y - top) - 1);
    }
    if (st.stun > 0) {
      for (let i = 0; i < 3; i++) {
        const a = t * 6 + (i * Math.PI * 2) / 3;
        c.fillStyle = '#ffe14a';
        c.fillRect(Math.round(x + Math.cos(a) * 5), Math.round(top - 2 + Math.sin(a) * 2), 2, 2);
      }
    }
    if (st.burn?.t > 0 && Math.random() < 0.5) {
      this.B.fx.push({ x: e.x + (Math.random() - 0.5) * e.r, y: e.y - (e.h || 1) * 0.5 - (e.flying ? 0.8 : 0), vx: 0, vy: -1.6, life: 0.3, max: 0.3, color: Math.random() < 0.5 ? '#ff7a2e' : '#ffd166', size: 1, kind: 'fire' });
    }
    if ((st.poison?.t > 0 || st.plague?.t > 0) && Math.random() < 0.25) {
      this.B.fx.push({ x: e.x + (Math.random() - 0.5) * e.r, y: e.y - (e.h || 1) * 0.6, vx: 0, vy: -0.8, life: 0.5, max: 0.5, color: st.plague?.t > 0 ? '#9be35a' : '#7dd35a', size: 1 });
    }
    if (st.slow?.t > 0 && !(st.freeze > 0)) {
      c.fillStyle = 'rgba(160,220,255,0.9)';
      c.fillRect(Math.round(x + e.r * TILE * 0.6), Math.round(top), 2, 2);
    }
    if (st.rage?.t > 0) {
      c.strokeStyle = `rgba(255,90,90,${0.5 + 0.3 * Math.sin(t * 10)})`;
      c.beginPath();
      c.ellipse(x, y - 1, e.r * TILE + 2, e.r * TILE * 0.5 + 1, 0, 0, Math.PI * 2);
      c.stroke();
    }
    if (st.regen?.t > 0 && Math.random() < 0.3) this.B.fx.push({ x: e.x + (Math.random() - 0.5) * 0.6, y: e.y - 0.5, vx: 0, vy: -1, life: 0.5, max: 0.5, color: '#9dffb0', size: 1, kind: 'twinkle' });
  }

  bubble(c, x, y, r, color, t) {
    c.strokeStyle = hexA(color, 0.6 + 0.2 * Math.sin(t * 6));
    c.lineWidth = 1;
    c.beginPath();
    c.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = hexA(color, 0.12);
    c.fill();
  }

  drawProjectiles(c, t) {
    for (const p of this.B.projectiles) {
      const x = p.x * TILE;
      const y = p.y * TILE - (p.z || 0) * TILE;
      if (p.lob) {
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.beginPath();
        c.ellipse(p.x * TILE, p.y * TILE, 3, 1.5, 0, 0, Math.PI * 2);
        c.fill();
      }
      const ang = p.straight ? p.dir : Math.atan2(p.ty - p.y, p.tx - p.x);
      const key = PROJ_SPRITE[p.proj];
      if (p.proj === 'rainbow') {
        const cols = ['#ff4a4a', '#ffb14a', '#ffe14a', '#5fd35f', '#4ac8ff', '#b45be8'];
        for (let i = 0; i < 6; i++) {
          c.fillStyle = cols[i];
          c.fillRect(Math.round(x - Math.cos(ang) * i * 2), Math.round(y - Math.sin(ang) * i * 2), 2, 2);
        }
        continue;
      }
      if (p.proj === 'void') {
        c.fillStyle = '#1b0f2e';
        c.beginPath();
        c.arc(x, y, 3, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#a35bff';
        c.stroke();
        continue;
      }
      if (p.proj === 'bomb') {
        c.fillStyle = '#2b2236';
        c.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
        c.fillStyle = Math.floor(t * 20) % 2 ? '#ffd166' : '#ff7a2e';
        c.fillRect(Math.round(x) + 1, Math.round(y) - 3, 1, 1);
        continue;
      }
      if (key) {
        c.save();
        c.translate(Math.round(x), Math.round(y));
        if (key !== 'sheep' && key !== 'fireball') c.rotate(ang);
        if (key === 'sheep') c.rotate(t * 10);
        try {
          drawSprite(c, key, 0, 2, { team: p.team, t });
        } catch {
          c.fillStyle = '#fff';
          c.fillRect(-2, -1, 4, 2);
        }
        c.restore();
        if (p.elem === 'fire' || p.proj === 'fireball') this.B.low() || Math.random() < 0.4 && this.B.fx.push({ x: p.x, y: p.y - (p.z || 0), vx: 0, vy: -0.5, life: 0.2, max: 0.2, color: '#ffb347', size: 1 });
      } else {
        c.fillStyle = '#fff6c8';
        c.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
      }
    }
  }

  drawAreas(c, t) {
    for (const a of this.B.areas) {
      const x = a.x * TILE;
      const y = a.y * TILE;
      const r = (a.radius || 1) * TILE;
      const k = a.dur ? 1 - a.t / a.dur : 0;
      switch (a.kind) {
        case 'volley': {
          c.strokeStyle = 'rgba(255,255,255,0.35)';
          c.setLineDash([3, 3]);
          c.beginPath();
          c.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
          c.stroke();
          c.setLineDash([]);
          for (let i = 0; i < 14; i++) {
            const ax = x + Math.sin(i * 12.9898) * r * 0.8;
            const ay = y + Math.cos(i * 4.1414) * r * 0.55 - (1 - k) * 70 - (i % 4) * 6;
            try {
              c.save();
              c.translate(Math.round(ax), Math.round(ay));
              c.rotate(Math.PI / 2);
              drawSprite(c, 'arrow', 0, 0, { team: a.team });
              c.restore();
            } catch {
              c.restore();
            }
          }
          break;
        }
        case 'meteor': {
          c.strokeStyle = `rgba(255,120,40,${0.4 + 0.4 * k})`;
          c.beginPath();
          c.ellipse(x, y, r * (0.4 + 0.6 * k), r * 0.7 * (0.4 + 0.6 * k), 0, 0, Math.PI * 2);
          c.stroke();
          const mx = x + (1 - k) * 90;
          const my = y - (1 - k) * 160;
          c.fillStyle = '#ffb347';
          c.beginPath();
          c.arc(mx, my, 6, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = '#7a3a1a';
          c.fillRect(mx - 3, my - 3, 6, 6);
          for (let i = 1; i < 6; i++) {
            c.fillStyle = `rgba(255,${120 + i * 20},40,${0.6 - i * 0.1})`;
            c.fillRect(mx + i * 5, my - i * 9, 5 - i * 0.6, 5 - i * 0.6);
          }
          break;
        }
        case 'nuke': {
          const blink = Math.floor(t * 8) % 2;
          c.strokeStyle = blink ? 'rgba(255,240,80,0.9)' : 'rgba(255,80,60,0.9)';
          c.setLineDash([4, 3]);
          c.beginPath();
          c.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
          c.stroke();
          c.setLineDash([]);
          const by = y - (1 - k) * 220;
          c.fillStyle = '#4a5a3a';
          c.fillRect(x - 3, by - 8, 6, 10);
          c.fillStyle = '#ffe14a';
          c.fillRect(x - 3, by - 2, 6, 2);
          break;
        }
        case 'quake':
          c.fillStyle = `rgba(90,60,30,${0.18 + 0.08 * Math.sin(t * 30)})`;
          c.beginPath();
          c.ellipse(x, y, r, r * 0.75, 0, 0, Math.PI * 2);
          c.fill();
          for (let i = 0; i < 6; i++) {
            const a2 = i + t;
            c.fillStyle = '#5b4026';
            c.fillRect(Math.round(x + Math.cos(i * 2.1) * r * 0.6), Math.round(y + Math.sin(i * 1.7) * r * 0.4 + Math.sin(a2 * 20)), 3, 1);
          }
          break;
        case 'acid': {
          c.fillStyle = 'rgba(120,200,60,0.18)';
          c.beginPath();
          c.ellipse(x, y, r, r * 0.75, 0, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = 'rgba(70,110,50,0.75)';
          for (let i = 0; i < 7; i++) {
            c.beginPath();
            c.ellipse(x + Math.cos(i * 0.9 + t * 0.3) * r * 0.55, y - 42 + Math.sin(i * 1.3) * 6, 12, 7, 0, 0, Math.PI * 2);
            c.fill();
          }
          c.fillStyle = '#b8ff6a';
          for (let i = 0; i < 18; i++) {
            const dx = Math.sin(i * 77.7) * r * 0.9;
            const dy = ((t * 120 + i * 37) % 48) - 40;
            c.fillRect(Math.round(x + dx), Math.round(y + dy), 1, 3);
          }
          break;
        }
        case 'blizzard': {
          c.fillStyle = `rgba(220,245,255,${0.35 * (1 - k)})`;
          c.beginPath();
          c.ellipse(x, y, r, r * 0.75, 0, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = '#ffffff';
          for (let i = 0; i < 24; i++) {
            const dx = Math.sin(i * 51.3 + t * 2) * r;
            const dy = Math.cos(i * 33.1) * r * 0.7 + ((t * 40 + i * 9) % 20) - 10;
            c.fillRect(Math.round(x + dx), Math.round(y + dy), 1, 1);
          }
          break;
        }
        case 'plague':
          c.fillStyle = `rgba(130,200,70,${0.3 * (1 - k)})`;
          c.beginPath();
          c.ellipse(x, y, r * (0.8 + k * 0.4), r * 0.7 * (0.8 + k * 0.4), 0, 0, Math.PI * 2);
          c.fill();
          break;
        case 'vortex': {
          const rr = r * (a.big ? 1 : 0.9);
          c.fillStyle = 'rgba(25,10,45,0.35)';
          c.beginPath();
          c.ellipse(x, y, rr, rr * 0.7, 0, 0, Math.PI * 2);
          c.fill();
          for (let i = 0; i < 24; i++) {
            const ang = t * 6 + i * 0.6;
            const d = rr * (((i * 0.37 + t * 0.8) % 1));
            c.fillStyle = i % 3 ? '#a35bff' : '#e2c6ff';
            c.fillRect(Math.round(x + Math.cos(ang) * d), Math.round(y + Math.sin(ang) * d * 0.7), 2, 2);
          }
          c.fillStyle = '#05010a';
          c.beginPath();
          c.arc(x, y, 3 + Math.sin(t * 9), 0, Math.PI * 2);
          c.fill();
          break;
        }
        default:
          break;
      }
    }
  }

  drawLines(c, t) {
    const B = this.B;
    for (const b of B.beams) {
      c.strokeStyle = hexA(b.color, Math.min(1, b.t / b.max + 0.3));
      c.lineWidth = b.w;
      c.beginPath();
      c.moveTo(b.x0 * TILE, b.y0 * TILE);
      c.lineTo(b.x1 * TILE, b.y1 * TILE);
      c.stroke();
      if (b.w >= 2) {
        c.strokeStyle = 'rgba(255,255,255,0.7)';
        c.lineWidth = 1;
        c.stroke();
      }
    }
    for (const b of B.bolts) {
      const a = b.t / b.max;
      for (const [w, col] of [[b.w + 2, hexA(b.color, 0.35 * a)], [b.w, hexA(b.color, a)], [1, `rgba(255,255,255,${a})`]]) {
        c.strokeStyle = col;
        c.lineWidth = w;
        c.beginPath();
        b.pts.forEach((p, i) => (i ? c.lineTo(p.x * TILE, p.y * TILE) : c.moveTo(p.x * TILE, p.y * TILE)));
        c.stroke();
      }
    }
    for (const tr of B.trails) {
      c.strokeStyle = hexA(tr.color, tr.t / tr.max);
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(tr.x0 * TILE, tr.y0 * TILE);
      c.lineTo(tr.x1 * TILE, tr.y1 * TILE);
      c.stroke();
    }
    for (const r of B.rings) {
      const k = 1 - r.t / r.max;
      const rad = r.r * TILE * (r.fill ? 0.5 + k * 0.6 : 0.4 + k * 0.6);
      if (r.arc) {
        c.strokeStyle = `rgba(255,255,255,${1 - k})`;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(r.x * TILE, r.y * TILE, rad, r.arc.a - r.arc.w / 2, r.arc.a + r.arc.w / 2);
        c.stroke();
        continue;
      }
      if (r.fill) {
        c.fillStyle = hexA(r.color, 0.5 * (1 - k));
        c.beginPath();
        c.ellipse(r.x * TILE, r.y * TILE, rad, rad * 0.75, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.strokeStyle = hexA(r.color, 1 - k);
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(r.x * TILE, r.y * TILE, rad, rad * 0.75, 0, 0, Math.PI * 2);
      c.stroke();
    }
  }

  drawParticles(c) {
    for (const p of this.B.fx) {
      const a = Math.max(0, Math.min(1, p.life / (p.max || 1)));
      if (p.kind === 'brick') {
        c.fillStyle = '#e8743b';
        c.fillRect(Math.round(p.x * TILE) - 2, Math.round(p.y * TILE) - 2, 4, 3);
        c.fillStyle = '#ffb07a';
        c.fillRect(Math.round(p.x * TILE) - 1, Math.round(p.y * TILE) - 3, 1, 1);
        continue;
      }
      if (p.kind === 'smoke') {
        c.fillStyle = hexA(p.color, a * 0.5);
        const s = p.size + (1 - a) * 4;
        c.fillRect(Math.round(p.x * TILE - s / 2), Math.round(p.y * TILE - s / 2), s, s);
        continue;
      }
      c.fillStyle = p.kind === 'twinkle' ? hexA(p.color, a * (0.5 + 0.5 * Math.sin(p.life * 30))) : hexA(p.color, a);
      const s = p.size;
      c.fillRect(Math.round(p.x * TILE - s / 2), Math.round(p.y * TILE - s / 2), s, s);
    }
  }

  drawBars(c, e) {
    if (e.kind === 'pet' && e.hp >= e.maxHp) return;
    const tower = e.kind === 'tower';
    if (!tower && e.kind !== 'hero' && e.hp >= e.maxHp && !e.lifetime) return;
    if (e.isWall && e.hp >= e.maxHp * 0.98) return;
    if (e.status?.invisible > 0 && e.team !== 0) return;
    const x = e.x * TILE;
    let y = e.y * TILE - (e.h || 1) * TILE - 4;
    if (e.flying) y -= 12;
    let w = tower ? (e.type === 'king' ? 34 : 26) : e.kind === 'hero' ? 16 : Math.max(10, Math.min(20, e.r * TILE * 2));
    if (tower) {
      const { h } = safeSize(e.type === 'king' ? 'king_tower' : 'princess_tower', 40);
      y = e.y * TILE + e.r * TILE * 0.75 - h - (e.type === 'king' ? 14 : 6);
      y = Math.max(12, y);
    }
    const frac = Math.max(0, e.hp / e.maxHp);
    const hgt = tower ? 4 : 2;
    c.fillStyle = 'rgba(10,8,20,0.8)';
    c.fillRect(Math.round(x - w / 2) - 1, Math.round(y) - 1, w + 2, hgt + 2);
    c.fillStyle = e.team === 0 ? '#5aa2ff' : '#ff5a4d';
    c.fillRect(Math.round(x - w / 2), Math.round(y), Math.round(w * frac), hgt);
    if (e.kind === 'hero' && e.maxArmor) {
      c.fillStyle = '#9ff6ff';
      c.fillRect(Math.round(x - w / 2), Math.round(y) + hgt + 1, Math.round(w * (e.armor / e.maxArmor)), 1);
      // form pips
      for (let i = 0; i < 3; i++) {
        c.fillStyle = i < e.form ? this.B.elementColor(e.def.element) : 'rgba(255,255,255,0.25)';
        c.fillRect(Math.round(x - 5 + i * 4), Math.round(y) - 4, 2, 2);
      }
    }
    if (tower) {
      c.font = `8px ${FONT}`;
      c.textAlign = 'center';
      c.fillStyle = '#ffffff';
      c.strokeStyle = 'rgba(0,0,0,0.8)';
      c.lineWidth = 2;
      const txt = String(Math.ceil(e.hp));
      c.strokeText(txt, Math.round(x), Math.round(y) - 2);
      c.fillText(txt, Math.round(x), Math.round(y) - 2);
      if (e.level) {
        c.fillStyle = e.team === 0 ? '#23468c' : '#8c2a23';
        c.fillRect(Math.round(x - w / 2) - 9, Math.round(y) - 2, 8, 8);
        c.fillStyle = '#fff';
        c.fillText(String(e.level), Math.round(x - w / 2) - 5, Math.round(y) + 5);
      }
    }
  }

  drawTexts(c) {
    c.textAlign = 'center';
    for (const tx of this.B.texts) {
      const a = Math.min(1, tx.t / tx.max + 0.2);
      c.font = `${tx.scale > 1.1 ? 10 : 8}px ${FONT}`;
      c.globalAlpha = a;
      c.strokeStyle = 'rgba(0,0,0,0.85)';
      c.lineWidth = 2;
      c.strokeText(tx.text, Math.round(tx.x * TILE), Math.round(tx.y * TILE));
      c.fillStyle = tx.color;
      c.fillText(tx.text, Math.round(tx.x * TILE), Math.round(tx.y * TILE));
    }
    c.globalAlpha = 1;
  }

  drawEmotes(c, t) {
    for (const em of this.B.emotes) {
      const k = 1 - em.t / em.max;
      const pop = k < 0.15 ? k / 0.15 : 1;
      const x = em.x * TILE;
      const y = em.y * TILE - Math.sin(t * 4) * 1.5;
      c.globalAlpha = em.t < 0.3 ? em.t / 0.3 : 1;
      c.fillStyle = '#ffffff';
      c.fillRect(Math.round(x - 15), Math.round(y - 30), 30, 28);
      c.fillRect(Math.round(x - 3), Math.round(y - 2), 6, 3);
      c.strokeStyle = em.team === 0 ? '#3b7dd8' : '#d8453b';
      c.strokeRect(Math.round(x - 15) + 0.5, Math.round(y - 30) + 0.5, 29, 27);
      this.sprite(c, `emote_${em.id}`, x, y - 4, { scale: pop, t });
      c.globalAlpha = 1;
    }
  }

  drawUi(c, ui, t) {
    const B = this.B;
    const hero = B.players[0]?.hero;
    if (hero && hero.alive && hero.moveTo) {
      const x = hero.moveTo.x * TILE;
      const y = hero.moveTo.y * TILE;
      const s = 3 + Math.sin(t * 8);
      c.strokeStyle = '#7fb8ff';
      c.beginPath();
      c.moveTo(x - s, y - s);
      c.lineTo(x + s, y + s);
      c.moveTo(x + s, y - s);
      c.lineTo(x - s, y + s);
      c.stroke();
    }
    if (hero && hero.alive && hero.focus && hero.focus.alive) {
      const f = hero.focus;
      c.strokeStyle = `rgba(255,225,74,${0.6 + 0.4 * Math.sin(t * 10)})`;
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(f.x * TILE, f.y * TILE, (f.r + 0.2) * TILE, (f.r + 0.2) * TILE * 0.5, 0, 0, Math.PI * 2);
      c.stroke();
    }
    if (ui.selectedTower) {
      const tw = ui.selectedTower;
      c.strokeStyle = '#ffcf4a';
      c.setLineDash([2, 2]);
      c.beginPath();
      c.ellipse(tw.x * TILE, tw.y * TILE, tw.r * TILE + 4, (tw.r * TILE + 4) * 0.6, 0, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
    const g = ui.ghost;
    if (g && g.pos) {
      const x = g.pos.x * TILE;
      const y = g.pos.y * TILE;
      if (g.radius) {
        c.fillStyle = g.valid ? 'rgba(255,255,255,0.12)' : 'rgba(255,80,80,0.15)';
        c.strokeStyle = g.valid ? 'rgba(255,255,255,0.8)' : 'rgba(255,90,90,0.9)';
        c.setLineDash([3, 2]);
        c.beginPath();
        c.ellipse(x, y, g.radius * TILE, g.radius * TILE * 0.75, 0, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.setLineDash([]);
      }
      if (g.sprite) {
        c.globalAlpha = g.valid ? 0.65 : 0.3;
        const n = Math.min(g.count || 1, 5);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const sp = n === 1 ? 0 : n <= 3 ? 0.55 : 0.8;
          this.sprite(c, g.sprite, x + Math.cos(a) * sp * TILE, y + Math.sin(a) * sp * TILE * 0.8, { team: 0, t });
        }
        c.globalAlpha = 1;
      }
      if (g.range) {
        c.strokeStyle = 'rgba(127,184,255,0.35)';
        c.beginPath();
        c.ellipse(x, y, g.range * TILE, g.range * TILE * 0.75, 0, 0, Math.PI * 2);
        c.stroke();
      }
    }
  }
}

function safeSize(key, fallbackH) {
  try {
    return spriteSize(key) || { w: 32, h: fallbackH };
  } catch {
    return { w: 32, h: fallbackH };
  }
}

const hexCache = new Map();
/** '#rrggbb' + alpha → rgba() string. */
export function hexA(hex, a) {
  let rgb = hexCache.get(hex);
  if (!rgb) {
    const h = hex.replace('#', '');
    rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    hexCache.set(hex, rgb);
  }
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
