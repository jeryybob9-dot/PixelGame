// The realm minimap: island colours, borders, deposits, buildings, units, alert pings and the camera's view.

import { realmTileColor } from '../art/realm-tiles.js';

const TEAM_COL = ['#3b7dd8', '#d8453b'];
const FALLBACK = ['#123a6b', '#2e6fb0', '#e6d39a', '#4f9a3e', '#2f6b2a', '#7a9a4e', '#6b6370', '#4a4040', '#e8eef5', '#ff6a1e', '#5f5a3a', '#9a6bff', '#b08a5a'];

const colorCache = new Map();
/** '#rrggbb' for a terrain tile in a biome (falls back to a fixed palette). */
export function tileColor(type, biome) {
  const k = `${biome}|${type}`;
  let c = colorCache.get(k);
  if (!c) {
    try {
      c = realmTileColor(type, biome);
    } catch {
      c = null;
    }
    if (!c || !/^#[0-9a-f]{6}$/i.test(c)) c = FALLBACK[type] || '#444';
    colorCache.set(k, c);
  }
  return c;
}

export class Minimap {
  /** @param {import('./realm.js').Realm} R @param {string} biome */
  constructor(R, biome) {
    this.R = R;
    this.biome = biome;
    this.base = null;
    this.dirty = true;
    this.pings = [];
  }

  ping(x, y, t) {
    this.pings.push({ x, y, t });
  }

  /**
   * @param {CanvasRenderingContext2D} mc
   * @param {number} s css px per tile
   * @param {number} t renderer time
   * @param {{x:number,y:number}[]} view the camera's visible ground, as a polygon in tiles
   */
  draw(mc, s, t, view) {
    const R = this.R;
    const W = R.W;
    const H = R.H;
    if (!this.base || this.dirty) {
      this.dirty = false;
      const base = this.base || document.createElement('canvas');
      base.width = W;
      base.height = H;
      const b = base.getContext('2d');
      const img = b.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        const hex = tileColor(R.tiles[i], this.biome);
        img.data[i * 4] = parseInt(hex.slice(1, 3), 16);
        img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
        img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
        img.data[i * 4 + 3] = 255;
      }
      b.putImageData(img, 0, 0);
      this.base = base;
    }
    mc.imageSmoothingEnabled = false;
    mc.clearRect(0, 0, W * s, H * s);
    mc.drawImage(this.base, 0, 0, W * s, H * s);
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
    this.pings = this.pings.filter((p) => t - p.t < 3);
    for (const p of this.pings) {
      const k = (t - p.t) % 1;
      mc.strokeStyle = `rgba(255,70,60,${1 - k})`;
      mc.lineWidth = 1.5;
      mc.beginPath();
      mc.arc(p.x * s, p.y * s, 2 + k * 8, 0, Math.PI * 2);
      mc.stroke();
    }
    if (view?.length) {
      mc.strokeStyle = 'rgba(255,255,255,0.9)';
      mc.lineWidth = 1;
      mc.beginPath();
      view.forEach((p, i) => (i ? mc.lineTo(p.x * s, p.y * s) : mc.moveTo(p.x * s, p.y * s)));
      mc.closePath();
      mc.stroke();
    }
  }
}
