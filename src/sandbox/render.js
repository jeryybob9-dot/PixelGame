// God Box — canvas renderer: terrain buffer, borders, sprites, weather and effects.
import { SP, BT, IS_WATER } from './constants.js';
import { tileColor, hexToRgb, pack } from './palette.js';
import { creatureSprite, buildingSprite, cloudSprite } from './sprites.js';
import { K, weaponTier } from './creatures.js';
import { hash2 } from './rng.js';

const WEAPON_COLS = ['#8a6438', '#c8a070', '#d8e0ea', '#ffcf4a'];
const CARRY_COLS = ['', '#a8743a', '#b0aca4', '#ffd24a', '#ffe066'];
const FIRE_COLS = ['#ffd24a', '#ff8a2e', '#e8433b'];

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let s = null;
  let tcv;
  let tctx;
  let timg;
  let tu32;
  let bcv;
  let bctx;
  let bimg;
  let bu32;
  let sparkles = [];
  let sparkleAt = 0;
  let bordersAt = 0;
  let W = 1;
  let H = 1;
  let dpr = 1;
  let labelFont = '"Pixelify Sans", system-ui, sans-serif';
  const drawList = [];
  const fireBuckets = [[], [], []];

  function makeLayer(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c2 = cv.getContext('2d');
    const img = c2.createImageData(w, h);
    return [cv, c2, img, new Uint32Array(img.data.buffer)];
  }

  function setState(state) {
    s = state;
    [tcv, tctx, timg, tu32] = makeLayer(s.w, s.h);
    [bcv, bctx, bimg, bu32] = makeLayer(s.w, s.h);
    s.dirty = { x0: 0, y0: 0, x1: s.w - 1, y1: s.h - 1, any: true };
    s.bordersDirty = true;
    bordersAt = 0;
    syncTerrain();
    rebuildSparkles();
  }

  function repaintRect(x0, y0, x1, y1) {
    const w = s.w;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tu32[y * w + x] = tileColor(s, y * w + x);
    tctx.putImageData(timg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  function syncTerrain() {
    const d = s.dirty;
    if (!d.any) return;
    d.any = false;
    repaintRect(Math.max(0, d.x0 - 1), Math.max(0, d.y0 - 1), Math.min(s.w - 1, d.x1 + 1), Math.min(s.h - 1, d.y1 + 1));
  }

  function syncBorders(now) {
    if (!s.bordersDirty || now - bordersAt < 350) return;
    s.bordersDirty = false;
    bordersAt = now;
    const vk = new Uint32Array(s.nextVid + 1);
    const fill = new Uint32Array(s.nextVid + 1);
    const edge = new Uint32Array(s.nextVid + 1);
    for (const v of s.villages.values()) {
      const k = s.kingdoms.get(v.kd);
      if (!k || v.id > s.nextVid) continue;
      const [r, g, b] = hexToRgb(k.color);
      vk[v.id] = k.id;
      fill[v.id] = pack(r, g, b, 52);
      edge[v.id] = pack(r, g, b, 215);
    }
    const w = s.w;
    const h = s.h;
    const z = s.zone;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const vid = z[i];
        const kid = vid ? vk[vid] : 0;
        if (!kid) {
          bu32[i] = 0;
          continue;
        }
        const e =
          x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          vk[z[i - 1]] !== kid || vk[z[i + 1]] !== kid || vk[z[i - w]] !== kid || vk[z[i + w]] !== kid;
        bu32[i] = e ? edge[vid] : fill[vid];
      }
    }
    bctx.putImageData(bimg, 0, 0);
  }

  function rebuildSparkles() {
    sparkles = [];
    for (let k = 0; k < 700; k++) {
      const i = (Math.random() * s.n) | 0;
      if (IS_WATER[s.tile[i]]) sparkles.push(i, Math.random());
    }
  }

  function resize(cssW, cssH, ratio) {
    W = Math.max(1, cssW);
    H = Math.max(1, cssH);
    dpr = ratio;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    try {
      const f = getComputedStyle(canvas).getPropertyValue('--font-body').trim();
      if (f) labelFont = f;
    } catch {
      /* ignore */
    }
  }

  const lerpX = (c, a) => (c.px === undefined ? c.x : c.px + (c.x - c.px) * a);
  const lerpY = (c, a) => (c.py === undefined ? c.y : c.py + (c.y - c.py) * a);

  /**
   * Draw a frame.
   * @param {{x:number,y:number,z:number}} cam world coords of the screen's top-left, CSS px per tile
   * @param {object} o frame options from the UI
   */
  function draw(cam, o) {
    if (!s) return;
    const now = o.now;
    const time = now / 1000;
    syncTerrain();
    syncBorders(now);
    if (now - sparkleAt > 5000) {
      sparkleAt = now;
      rebuildSparkles();
    }
    const k = cam.z * dpr;
    const ox = Math.round((-cam.x * cam.z + o.shakeX) * dpr);
    const oy = Math.round((-cam.y * cam.z + o.shakeY) * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#16305e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, ox, oy);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tcv, 0, 0);
    if (o.showBorders) ctx.drawImage(bcv, 0, 0);

    const view = {
      x0: -ox / k - 1, y0: -oy / k - 1,
      x1: (canvas.width - ox) / k + 1, y1: (canvas.height - oy) / k + 1,
    };
    const inView = (x, y, m = 2) => x > view.x0 - m && x < view.x1 + m && y > view.y0 - m && y < view.y1 + m + 6;
    const w = s.w;

    // Water sparkles.
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let j = 0; j < sparkles.length; j += 2) {
      const i = sparkles[j];
      const ph = (time * 0.7 + sparkles[j + 1]) % 1;
      if (ph > 0.12 || !IS_WATER[s.tile[i]]) continue;
      const x = i % w;
      const y = (i / w) | 0;
      if (inView(x, y)) ctx.fillRect(x + (ph > 0.06 ? 1 : 0), y, 1, 1);
    }

    // Lava and acid glints.
    const slow = (time * 3) | 0;
    ctx.fillStyle = '#ffd24a';
    for (const i of s.lavas) {
      const x = i % w;
      const y = (i / w) | 0;
      if (inView(x, y) && hash2(i, slow, 3) < 0.2) ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = '#e8ff9a';
    for (const i of s.acids) {
      const x = i % w;
      const y = (i / w) | 0;
      if (inView(x, y) && hash2(i, slow, 5) < 0.12) ctx.fillRect(x, y, 1, 1);
    }

    // Collect visible buildings and ground creatures, sort by feet y.
    drawList.length = 0;
    const alpha = o.alpha;
    for (const b of s.buildings.values()) {
      if (!inView(b.x + b.w / 2, b.y + b.h / 2, 6)) continue;
      b._sy = b.y + b.h - 0.01;
      drawList.push(b);
    }
    const flyers = [];
    for (const c of s.creatures) {
      if (c.dead) continue;
      const x = lerpX(c, alpha);
      const y = lerpY(c, alpha);
      if (!inView(x, y)) continue;
      c._rx = x;
      c._ry = y;
      if (c.fly) {
        flyers.push(c);
        continue;
      }
      c._sy = y;
      drawList.push(c);
    }
    drawList.sort((a, b) => a._sy - b._sy);

    const frame = ((time * 6) | 0) % 2;
    for (const e of drawList) {
      if (e.type !== undefined) drawBuilding(e, frame, o);
      else drawCreature(e, time, o);
    }

    // Fires on top of the ground layer.
    for (const bkt of fireBuckets) bkt.length = 0;
    const flick = (time * 10) | 0;
    for (const i of s.fires) {
      if (!s.fire[i]) continue;
      const x = i % w;
      const y = (i / w) | 0;
      if (!inView(x, y)) continue;
      const hsh = hash2(i, flick, 9);
      fireBuckets[hsh < 0.33 ? 0 : hsh < 0.75 ? 1 : 2].push(x, y, hsh);
    }
    for (let bkt = 0; bkt < 3; bkt++) {
      ctx.fillStyle = FIRE_COLS[bkt];
      const arr = fireBuckets[bkt];
      for (let j = 0; j < arr.length; j += 3) {
        ctx.fillRect(arr[j], arr[j + 1], 1, 1);
        if (arr[j + 2] < 0.2) ctx.fillRect(arr[j], arr[j + 1] - 1, 1, 1);
      }
    }

    // Flyers with shadows.
    for (const c of flyers) {
      const x = c._rx;
      const y = c._ry;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x - 2, y, 4, 1);
      drawCreature(c, time, o);
    }

    // Weather clouds.
    for (const c of s.clouds) {
      if (!inView(c.x, c.y, c.r + 6)) continue;
      const fade = Math.max(0, Math.min(1, c.ttl / 40, (c.max - c.ttl) / 15));
      ctx.globalAlpha = fade * 0.92;
      const cw = c.r * 2.4;
      const ch = cw * (7 / 16);
      const fallCol = c.kind === 'rain' ? 'rgba(170,205,255,0.85)' : c.kind === 'plague' ? 'rgba(150,230,90,0.8)' : 'rgba(110,104,96,0.85)';
      ctx.fillStyle = fallCol;
      const drops = Math.round(c.r * 3);
      for (let d = 0; d < drops; d++) {
        const hx = hash2(d, c.seed, 1);
        const hy = hash2(d, c.seed, 2);
        const fall = c.kind === 'rain' ? 22 : 6;
        const span = c.r * 1.5;
        const dy = (time * fall + hy * span) % span;
        ctx.fillRect(c.x - c.r + hx * c.r * 2, c.y - c.r * 0.2 + dy, 0.35, c.kind === 'rain' ? 1.3 : 0.5);
      }
      ctx.drawImage(cloudSprite(c.kind), c.x - cw / 2, c.y - ch - c.r * 0.35, cw, ch);
      ctx.globalAlpha = 1;
    }

    // Black holes.
    for (const hole of s.holes) {
      const age = hole.max - hole.ttl;
      const eat = 1.5 + 5 * Math.min(1, age / 100);
      const fade = Math.min(1, hole.ttl / 20);
      ctx.globalAlpha = fade;
      ctx.fillStyle = 'rgba(180,91,232,0.25)';
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, eat + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#05030a';
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, eat, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d89aff';
      for (let d = 0; d < 14; d++) {
        const a = time * 3 + (d / 14) * Math.PI * 2;
        const rr = eat + 0.8 + Math.sin(time * 5 + d) * 0.4;
        ctx.fillRect(hole.x + Math.cos(a) * rr - 0.35, hole.y + Math.sin(a) * rr * 0.8 - 0.35, 0.7, 0.7);
      }
      ctx.globalAlpha = 1;
    }

    o.particles.draw(ctx, view);
    drawEffects(o, now);
    drawSelection(o, time);

    // Screen-space overlays.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (o.showNames) drawLabels(cam, o);
    if (o.brush) {
      const bx = (o.brush.x - cam.x) * cam.z + o.shakeX;
      const by = (o.brush.y - cam.y) * cam.z + o.shakeY;
      const br = Math.max(6, o.brush.r * cam.z);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(bx, by, br + 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (o.flash > 0) {
      ctx.fillStyle = `rgba(255,250,235,${Math.min(1, o.flash)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawBuilding(b, frame, o) {
    const v = s.villages.get(b.vil);
    const kd = v ? s.kingdoms.get(v.kd) : null;
    const level = v ? v.level : 1;
    const tribe = v ? v.tribe : 0;
    const cv = buildingSprite(b, level, tribe, kd ? kd.color : '#ffffff', frame);
    const dx = b.x + (b.w - cv.width) / 2;
    const dy = b.y + b.h - cv.height;
    if (b.prog < 1) {
      if (b.type === BT.HALL) ctx.drawImage(cv, dx, dy);
      const h = Math.max(1, Math.round(cv.height * b.prog));
      if (b.type !== BT.HALL) ctx.drawImage(cv, 0, cv.height - h, cv.width, h, dx, b.y + b.h - h, cv.width, h);
      ctx.fillStyle = '#a8743a';
      ctx.fillRect(b.x, b.y + b.h - 0.4, b.w, 0.4);
      ctx.fillRect(b.x, b.y + b.h - cv.height, 0.35, cv.height);
      ctx.fillRect(b.x + b.w - 0.35, b.y + b.h - cv.height, 0.35, cv.height);
      ctx.fillRect(b.x, b.y + b.h - cv.height * 0.6, b.w, 0.3);
      return;
    }
    ctx.drawImage(cv, dx, dy);
    if (b.hp < b.mhp * 0.5) {
      ctx.fillStyle = '#1a1414';
      ctx.fillRect(dx + 1, dy + cv.height - 2, 1, 1);
      if (Math.random() < 0.04) o.particles.emit('smoke', b.x + b.w / 2, dy, 1);
    }
    if (b.type === BT.HALL && level <= 1 && Math.random() < 0.02) o.particles.emit('ember', b.x + 2.5, b.y + 4.2, 1);
  }

  function drawCreature(c, time, o) {
    const x = c._rx;
    let y = c._ry;
    let frame = c.mv ? ((time * 7 + c.id * 0.37) | 0) % 2 : 0;
    if (c.sp === SP.FISH) frame = ((time * 3 + c.id) | 0) % 2;
    if (c.fly) frame = ((time * (c.sp === SP.DRAGON ? 4 : 6) + c.id) | 0) % 2;
    const kd = c.kd ? s.kingdoms.get(c.kd) : null;
    const king = !!kd && kd.king === c.id;
    const elder = c.sp === SP.VILLAGER && s.tick - c.born > c.life * 0.78;
    const flash = s.tick - (c.hitT ?? -99) <= 2;
    const cv = creatureSprite(c, frame, { king, elder, flash });
    if (c.held) {
      const u = s.byId.get(c.held);
      if (u) y -= ((45 - u.tt) / 45) * 6;
    }
    if (c.fly) y -= c.sp === SP.DRAGON ? (c.low ? 3 : 7) + Math.sin(time * 2 + c.id) * 0.6 : 6 + Math.sin(time * 3 + c.id) * 0.5;
    const dx = x - cv.width / 2;
    const dy = y - cv.height + 0.5;
    if (c.sp === SP.FISH) {
      const deep = s.tile[(c.y | 0) * s.w + (c.x | 0)] === 0;
      ctx.globalAlpha = deep ? 0.45 : 0.8;
      ctx.drawImage(cv, dx, dy);
      ctx.globalAlpha = 1;
      return;
    }
    if (c.sp === SP.UFO && c.task === K.BEAM) {
      const t = s.byId.get(c.tgt);
      if (t) {
        ctx.fillStyle = 'rgba(127,232,255,0.28)';
        ctx.beginPath();
        ctx.moveTo(x - 1.5, dy + cv.height);
        ctx.lineTo(x + 1.5, dy + cv.height);
        ctx.lineTo(x + 3, (t._ry ?? t.y) + 0.5);
        ctx.lineTo(x - 3, (t._ry ?? t.y) + 0.5);
        ctx.fill();
      }
    }
    if (c.bless > 0) {
      ctx.fillStyle = 'rgba(255,207,74,0.35)';
      ctx.fillRect(dx - 0.5, dy - 0.5, cv.width + 1, cv.height + 1);
    }
    ctx.drawImage(cv, dx, dy);
    if (c.sp === SP.VILLAGER && !c.child) {
      const tier = weaponTier(s, c);
      if (c.job === 5 || c.task === K.FIGHT) {
        ctx.fillStyle = WEAPON_COLS[tier];
        const wx = c.dir > 0 ? dx + cv.width : dx - 1;
        ctx.fillRect(wx, dy + (tier === 1 ? 0 : 1), 1, tier === 1 ? 3 : 2);
      }
      if (c.carry) {
        ctx.fillStyle = CARRY_COLS[c.carry];
        ctx.fillRect(c.dir > 0 ? dx - 1 : dx + cv.width, dy + 2, 1, 1);
      }
    }
    if (c.burn > 0) {
      ctx.fillStyle = (time * 10 + c.id) % 2 < 1 ? '#ffd24a' : '#ff8a2e';
      ctx.fillRect(x - 0.5, dy - 1, 1, 1);
    } else if (c.sick > 0) {
      ctx.fillStyle = '#9fe35f';
      ctx.fillRect(x - 0.5, dy - 1, 1, 1);
    }
  }

  function drawEffects(o, now) {
    const ef = o.effects;
    // Falling projectiles (meteor / bomb / nuke) before impact.
    for (const p of ef.projectiles) {
      const t = Math.min(1, (now - p.t0) / p.dur);
      if (p.kind === 'meteor') {
        const sx = p.x + 26 * (1 - t);
        const sy = p.y - 48 * (1 - t);
        ctx.strokeStyle = 'rgba(255,170,60,0.55)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(sx + 9, sy - 16);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.fillStyle = '#ff8a2e';
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
        ctx.fillStyle = '#fff3a0';
        ctx.fillRect(sx - 0.7, sy - 0.7, 1.4, 1.4);
      } else {
        const big = p.kind === 'nuke';
        const sy = p.y - (big ? 55 : 40) * (1 - t * t);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(p.x - (big ? 2 : 1) * t, p.y, (big ? 4 : 2) * t + 0.5, 0.6);
        ctx.fillStyle = big ? '#8a94a8' : '#22202c';
        ctx.fillRect(p.x - (big ? 1.2 : 1), sy - (big ? 4 : 2), big ? 2.4 : 2, big ? 4 : 2);
        if (big) {
          ctx.fillStyle = '#ffe066';
          ctx.fillRect(p.x - 1.2, sy - 2.6, 2.4, 0.7);
        } else {
          ctx.fillStyle = (now / 80) % 2 < 1 ? '#ffd24a' : '#ff8a2e';
          ctx.fillRect(p.x + 0.6, sy - 2.8, 0.6, 0.6);
        }
      }
    }
    for (const r of ef.rings) {
      const t = (now - r.t0) / r.dur;
      if (t >= 1) continue;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * (0.2 + t), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const m of ef.mushrooms) {
      const t = (now - m.t0) / 3200;
      if (t >= 1) continue;
      const rise = m.r * 1.2 * Math.min(1, t * 2.2);
      ctx.globalAlpha = Math.min(1, (1 - t) * 1.6);
      ctx.fillStyle = t < 0.3 ? '#ffb52e' : '#8a7a6a';
      ctx.fillRect(m.x - m.r * 0.12, m.y - rise, m.r * 0.24, rise);
      ctx.fillStyle = t < 0.25 ? '#fff3a0' : t < 0.5 ? '#ff8a2e' : '#6e6470';
      ctx.beginPath();
      ctx.ellipse(m.x, m.y - rise, m.r * (0.35 + t * 0.5), m.r * (0.2 + t * 0.25), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const b of ef.bolts) {
      const t = (now - b.t0) / 260;
      if (t >= 1) continue;
      ctx.globalAlpha = 1 - t;
      ctx.lineCap = 'square';
      for (const [col, lw] of [['rgba(255,240,140,0.5)', 1.6], ['#ffffff', 0.55]]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(b.pts[0], b.pts[1]);
        for (let j = 2; j < b.pts.length; j += 2) ctx.lineTo(b.pts[j], b.pts[j + 1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#3a2a1a';
    for (const a of ef.arrows) {
      const t = (now - a.t0) / 220;
      if (t >= 1) continue;
      const x = a.x0 + (a.x1 - a.x0) * t;
      const y = a.y0 + (a.y1 - a.y0) * t - Math.sin(t * Math.PI) * 2;
      ctx.fillRect(x - 0.4, y - 0.2, 0.9, 0.4);
    }
  }

  function drawSelection(o, time) {
    const sel = o.selected;
    if (!sel) return;
    const bob = Math.sin(time * 6) * 0.6;
    if (sel.type === 'creature') {
      const c = s.byId.get(sel.id);
      if (!c) return;
      const x = c._rx ?? c.x;
      let y = c._ry ?? c.y;
      if (c.fly) y -= 7;
      ctx.fillStyle = '#ffcf4a';
      const top = y - 7 + bob;
      ctx.beginPath();
      ctx.moveTo(x - 1.2, top - 1.4);
      ctx.lineTo(x + 1.2, top - 1.4);
      ctx.lineTo(x, top);
      ctx.fill();
    } else if (sel.type === 'village' || sel.type === 'kingdom') {
      const list = sel.type === 'village' ? [s.villages.get(sel.id)] : [...s.villages.values()].filter((v) => v.kd === sel.id);
      ctx.lineWidth = 0.5;
      ctx.setLineDash([1.5, 1]);
      for (const v of list) {
        if (!v) continue;
        const kd = s.kingdoms.get(v.kd);
        ctx.strokeStyle = kd ? kd.color : '#ffffff';
        ctx.beginPath();
        ctx.arc(v.x, v.y, v.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  function drawLabels(cam, o) {
    if (cam.z < 1.7) return;
    const size = Math.round(Math.max(10, Math.min(14, cam.z * 3.2)));
    ctx.font = `${size}px ${labelFont}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const v of s.villages.values()) {
      const sx = (v.x - cam.x) * cam.z + o.shakeX;
      const sy = (v.y - 6.5 - cam.y) * cam.z + o.shakeY;
      if (sx < -80 || sx > W + 80 || sy < -20 || sy > H + 20) continue;
      const kd = s.kingdoms.get(v.kd);
      const text = `${v.name} ${v.pop}`;
      const tw = ctx.measureText(text).width + 10;
      ctx.fillStyle = 'rgba(20,18,31,0.78)';
      ctx.fillRect(Math.round(sx - tw / 2), Math.round(sy - size * 0.7), Math.round(tw), Math.round(size * 1.4));
      ctx.fillStyle = kd ? kd.color : '#ffffff';
      ctx.fillRect(Math.round(sx - tw / 2), Math.round(sy - size * 0.7), 3, Math.round(size * 1.4));
      ctx.fillStyle = '#f4efe6';
      ctx.fillText(text, Math.round(sx + 1), Math.round(sy + 1));
    }
  }

  return {
    setState,
    resize,
    draw,
    get size() {
      return { w: W, h: H, dpr };
    },
  };
}
