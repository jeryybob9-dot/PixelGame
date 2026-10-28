// God Box — pooled pixel particles in world units (canvas drawing; logic is DOM-free).

const KINDS = {
  fire: { cols: ['#fff3a0', '#ffd24a', '#ff8a2e', '#e8433b', '#7a5a5a'], life: [0.35, 0.8], spd: 0.8, up: -3.5, grav: -2, size: 1, byAge: true },
  smoke: { cols: ['rgba(120,114,128,0.75)', 'rgba(96,90,104,0.6)', 'rgba(70,66,80,0.45)'], life: [1.0, 2.0], spd: 0.5, up: -2.2, grav: -0.4, size: 1.4, byAge: true },
  spark: { cols: ['#ffffff', '#fff3a0', '#ffd24a'], life: [0.2, 0.55], spd: 9, up: -3, grav: 14, size: 0.6 },
  debris: { cols: ['#7a5030', '#6a6660', '#9a9690', '#4a3a2a'], life: [0.5, 1.1], spd: 6, up: -6, grav: 22, size: 0.8 },
  blood: { cols: ['#c43a2a', '#8a1f18'], life: [0.3, 0.6], spd: 3, up: -3, grav: 16, size: 0.5 },
  bone: { cols: ['#ece8dc', '#b8b4a8'], life: [0.4, 0.8], spd: 3, up: -3, grav: 16, size: 0.6 },
  hit: { cols: ['#ffffff', '#fff3a0'], life: [0.08, 0.2], spd: 2.5, up: 0, grav: 0, size: 0.5 },
  gold: { cols: ['#fff3a0', '#ffcf4a', '#ffffff'], life: [0.6, 1.3], spd: 1.6, up: -3, grav: -1, size: 0.6 },
  plague: { cols: ['#9fe35f', '#5fa83a', '#c8ff6a'], life: [0.6, 1.2], spd: 1, up: -1.6, grav: -0.4, size: 0.7 },
  magic: { cols: ['#4ae3ff', '#b45be8', '#ffffff'], life: [0.4, 0.9], spd: 3, up: -1, grav: 0, size: 0.6 },
  steam: { cols: ['rgba(255,255,255,0.8)', 'rgba(216,228,240,0.6)'], life: [0.5, 1.0], spd: 0.8, up: -3, grav: -1, size: 1, byAge: true },
  splash: { cols: ['#bfe4ff', '#ffffff', '#7fb8ff'], life: [0.3, 0.6], spd: 3, up: -4, grav: 18, size: 0.5 },
  dust: { cols: ['rgba(200,168,120,0.8)', 'rgba(168,138,96,0.7)', 'rgba(224,200,160,0.6)'], life: [0.5, 1.1], spd: 1.6, up: -1, grav: 1, size: 0.9 },
  chip: { cols: ['#b8b4ac', '#6a6660'], life: [0.25, 0.45], spd: 3, up: -3, grav: 16, size: 0.5 },
  wood: { cols: ['#d8aa6a', '#7a5030'], life: [0.25, 0.45], spd: 3, up: -3, grav: 16, size: 0.5 },
  leaf: { cols: ['#8fe35f', '#3f9a2f'], life: [0.3, 0.6], spd: 2, up: -2, grav: 8, size: 0.5 },
  acid: { cols: ['#c8ff6a', '#8cff3a'], life: [0.4, 0.8], spd: 0.6, up: -1.6, grav: -0.4, size: 0.6 },
  ash: { cols: ['rgba(110,104,112,0.8)', 'rgba(140,132,144,0.7)', 'rgba(80,76,86,0.8)'], life: [2, 4], spd: 0.6, up: 0, grav: 0.5, size: 0.7 },
  ember: { cols: ['#ffd24a', '#ff8a2e', '#e8433b'], life: [0.6, 1.4], spd: 2, up: -2.5, grav: -0.6, size: 0.5, byAge: true },
  rain: { cols: ['rgba(160,200,255,0.8)'], life: [0.25, 0.4], spd: 0, up: 9, grav: 0, size: 0.4 },
};
const KIND_LIST = Object.keys(KINDS);
const KIND_ID = Object.fromEntries(KIND_LIST.map((k, i) => [k, i]));

/** @param {number} max */
export function createParticles(max = 2600) {
  const x = new Float32Array(max);
  const y = new Float32Array(max);
  const vx = new Float32Array(max);
  const vy = new Float32Array(max);
  const life = new Float32Array(max);
  const maxLife = new Float32Array(max);
  const size = new Float32Array(max);
  const grav = new Float32Array(max);
  const kind = new Uint8Array(max);
  const col = new Uint8Array(max);
  const tx = new Float32Array(max);
  const ty = new Float32Array(max);
  const custom = new Array(max);
  let n = 0;

  /**
   * Emit particles. o.spread widens the spawn area, o.color overrides colour,
   * o.tx/o.ty make the particle home in on a point (black holes).
   */
  function emit(kindName, px, py, count = 4, o = {}) {
    const def = KINDS[kindName];
    const kid = KIND_ID[kindName];
    if (!def) return;
    const spread = o.spread ?? 0.4;
    for (let k = 0; k < count; k++) {
      if (n >= max) return;
      const i = n++;
      const a = Math.random() * Math.PI * 2;
      const sp = def.spd * (0.3 + Math.random() * 0.9) * (o.power ?? 1);
      x[i] = px + (Math.random() - 0.5) * spread * 2;
      y[i] = py + (Math.random() - 0.5) * spread * 2;
      vx[i] = Math.cos(a) * sp;
      vy[i] = Math.sin(a) * sp + def.up * (0.6 + Math.random() * 0.6);
      const l = def.life[0] + Math.random() * (def.life[1] - def.life[0]);
      life[i] = l * (o.lifeMul ?? 1);
      maxLife[i] = life[i];
      size[i] = def.size * (o.sizeMul ?? 1) * (0.7 + Math.random() * 0.6);
      grav[i] = def.grav;
      kind[i] = kid;
      col[i] = (Math.random() * def.cols.length) | 0;
      custom[i] = o.color || null;
      tx[i] = o.tx ?? NaN;
      ty[i] = o.ty ?? NaN;
    }
  }

  function update(dt) {
    let i = 0;
    while (i < n) {
      life[i] -= dt;
      if (life[i] <= 0) {
        const last = --n;
        if (i !== last) {
          x[i] = x[last]; y[i] = y[last]; vx[i] = vx[last]; vy[i] = vy[last];
          life[i] = life[last]; maxLife[i] = maxLife[last]; size[i] = size[last]; grav[i] = grav[last];
          kind[i] = kind[last]; col[i] = col[last]; custom[i] = custom[last]; tx[i] = tx[last]; ty[i] = ty[last];
        }
        continue;
      }
      if (tx[i] === tx[i]) {
        const dx = tx[i] - x[i];
        const dy = ty[i] - y[i];
        const d = Math.hypot(dx, dy) || 1;
        const pull = 14 / (d + 1);
        vx[i] = vx[i] * 0.9 + (dx / d) * pull + (-dy / d) * 2;
        vy[i] = vy[i] * 0.9 + (dy / d) * pull + (dx / d) * 2;
        if (d < 0.6) life[i] = 0;
      } else vy[i] += grav[i] * dt;
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      i++;
    }
  }

  /** Draw in world space (ctx already transformed). */
  function draw(ctx, view) {
    for (let i = 0; i < n; i++) {
      if (x[i] < view.x0 || x[i] > view.x1 || y[i] < view.y0 || y[i] > view.y1) continue;
      const def = KINDS[KIND_LIST[kind[i]]];
      let c = custom[i];
      if (!c) {
        if (def.byAge) {
          const age = 1 - life[i] / maxLife[i];
          c = def.cols[Math.min(def.cols.length - 1, (age * def.cols.length) | 0)];
        } else c = def.cols[col[i]];
      }
      ctx.fillStyle = c;
      const s = size[i];
      if (KIND_LIST[kind[i]] === 'rain') ctx.fillRect(x[i], y[i], 0.35, 1.4);
      else ctx.fillRect(x[i] - s / 2, y[i] - s / 2, s, s);
    }
  }

  return {
    emit,
    update,
    draw,
    clear() {
      n = 0;
    },
    get count() {
      return n;
    },
  };
}
