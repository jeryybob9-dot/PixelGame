// Tile grid helpers for the realm: walkability, A* paths, line of sight and territory.

import { BLOCKING, TILE_SPEED } from './constants.js';

const SQRT2 = Math.SQRT2;

export class Grid {
  /**
   * @param {number} w
   * @param {number} h
   * @param {Uint8Array} tiles terrain ids
   */
  constructor(w, h, tiles) {
    this.w = w;
    this.h = h;
    this.tiles = tiles;
    /** 0 free, 1 terrain, 2 building of team 0, 3 building of team 1, 4 neutral building, 5/6 wall of team 0/1 */
    this.occ = new Uint8Array(w * h);
    this.occBy = new Int32Array(w * h); // entity id occupying the tile
    this.cost = new Float32Array(w * h);
    this.refreshTerrain();
    // A* scratch
    const n = w * h;
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.stamp = 0;
    this.heap = new Int32Array(n * 4);
    this.heapF = new Float32Array(n * 4);
  }

  idx(x, y) {
    return y * this.w + x;
  }
  inside(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }

  refreshTerrain() {
    for (let i = 0; i < this.tiles.length; i++) this.refreshTile(i);
  }
  refreshTile(i) {
    const t = this.tiles[i];
    if (this.occ[i] === 0 || this.occ[i] === 1) this.occ[i] = BLOCKING.has(t) ? 1 : 0;
    this.cost[i] = 1 / (TILE_SPEED[t] || 1);
  }

  /** Terrain blocked (ignores buildings). */
  terrainBlocked(tx, ty) {
    if (!this.inside(tx, ty)) return true;
    return BLOCKING.has(this.tiles[this.idx(tx, ty)]);
  }

  /** Can a ground unit of `team` stand on this tile? */
  walkable(tx, ty, team = -1) {
    if (!this.inside(tx, ty)) return false;
    const o = this.occ[this.idx(tx, ty)];
    return o === 0;
  }

  /** Occupy (or free with team = null) a footprint. */
  setFootprint(x0, y0, w, h, team, id, isWall = false) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (!this.inside(x, y)) continue;
        const i = this.idx(x, y);
        if (team == null) {
          if (this.occBy[i] !== id) continue;
          this.occ[i] = BLOCKING.has(this.tiles[i]) ? 1 : 0;
          this.occBy[i] = 0;
        } else {
          this.occ[i] = isWall ? (team === 0 ? 5 : team === 1 ? 6 : 4) : team === 0 ? 2 : team === 1 ? 3 : 4;
          this.occBy[i] = id;
        }
      }
    }
  }

  /** Tile step cost for a team: Infinity when impassable. Enemy walls are passable at a price (units smash them). */
  stepCost(i, team) {
    const o = this.occ[i];
    if (o === 0) return this.cost[i];
    if (o === 5 && team === 1) return 7;
    if (o === 6 && team === 0) return 7;
    if ((o === 5 || o === 6) && team === 2) return 7;
    return Infinity;
  }

  /**
   * A* from (sx, sy) to (tx, ty) in tile units. Returns world-space waypoints (tile centres, smoothed) or null.
   * The goal tile may be blocked (a building): the path then ends next to it.
   */
  findPath(sx, sy, tx, ty, team, maxNodes = 2600) {
    const w = this.w;
    const sxi = Math.floor(sx);
    const syi = Math.floor(sy);
    let gx = Math.max(0, Math.min(w - 1, Math.floor(tx)));
    let gy = Math.max(0, Math.min(this.h - 1, Math.floor(ty)));
    if (!this.inside(sxi, syi)) return null;
    const start = this.idx(sxi, syi);
    const goal = this.idx(gx, gy);
    if (start === goal) return [{ x: tx, y: ty }];
    this.stamp++;
    if (this.stamp > 4e9) {
      this.stamp = 1;
      this.seen.fill(0);
      this.closed.fill(0);
    }
    const S = this.stamp;
    let hn = 0;
    const push = (node, f) => {
      let i = hn++;
      this.heap[i] = node;
      this.heapF[i] = f;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.heapF[p] <= this.heapF[i]) break;
        const tn = this.heap[p];
        const tf = this.heapF[p];
        this.heap[p] = this.heap[i];
        this.heapF[p] = this.heapF[i];
        this.heap[i] = tn;
        this.heapF[i] = tf;
        i = p;
      }
    };
    const pop = () => {
      const top = this.heap[0];
      hn--;
      if (hn > 0) {
        this.heap[0] = this.heap[hn];
        this.heapF[0] = this.heapF[hn];
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < hn && this.heapF[l] < this.heapF[m]) m = l;
          if (r < hn && this.heapF[r] < this.heapF[m]) m = r;
          if (m === i) break;
          const tn = this.heap[m];
          const tf = this.heapF[m];
          this.heap[m] = this.heap[i];
          this.heapF[m] = this.heapF[i];
          this.heap[i] = tn;
          this.heapF[i] = tf;
          i = m;
        }
      }
      return top;
    };
    const hcost = (i) => {
      const dx = Math.abs((i % w) - gx);
      const dy = Math.abs(((i / w) | 0) - gy);
      return (dx + dy + (SQRT2 - 2) * Math.min(dx, dy)) * 0.87;
    };
    this.g[start] = 0;
    this.seen[start] = S;
    this.from[start] = -1;
    push(start, hcost(start));
    let best = start;
    let bestH = hcost(start);
    let expanded = 0;
    let found = false;
    while (hn > 0) {
      const cur = pop();
      if (this.closed[cur] === S) continue;
      this.closed[cur] = S;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > maxNodes) break;
      const cx = cur % w;
      const cy = (cur / w) | 0;
      for (let k = 0; k < 8; k++) {
        const dx = DX[k];
        const dy = DY[k];
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= this.h) continue;
        const ni = ny * w + nx;
        if (this.closed[ni] === S) continue;
        let c = ni === goal ? 1 : this.stepCost(ni, team);
        if (c === Infinity) continue;
        if (dx && dy) {
          // no corner cutting
          if (this.stepCost(cy * w + nx, team) === Infinity || this.stepCost(ny * w + cx, team) === Infinity) continue;
          c *= SQRT2;
        }
        const ng = this.g[cur] + c;
        if (this.seen[ni] === S && ng >= this.g[ni]) continue;
        this.seen[ni] = S;
        this.g[ni] = ng;
        this.from[ni] = cur;
        const h = hcost(ni);
        if (h < bestH) {
          bestH = h;
          best = ni;
        }
        push(ni, ng + h);
      }
    }
    const end = found ? goal : best;
    if (end === start) return null;
    const cells = [];
    for (let c = end; c !== -1 && c !== start; c = this.from[c]) cells.push(c);
    cells.reverse();
    // tile centres; final point is the exact target when we reached the goal tile
    const pts = cells.map((c) => ({ x: (c % w) + 0.5, y: ((c / w) | 0) + 0.5 }));
    if (found && this.stepCost(goal, team) !== Infinity) pts[pts.length - 1] = { x: tx, y: ty };
    else if (found) pts.pop(); // stop beside a blocked goal (a building)
    return this.smooth(sx, sy, pts, team);
  }

  /** Drop waypoints that can be skipped with a clear straight line. */
  smooth(sx, sy, pts, team) {
    if (pts.length <= 2) return pts;
    const out = [];
    let ax = sx;
    let ay = sy;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineClear(ax, ay, pts[j].x, pts[j].y, team)) j--;
      out.push(pts[j]);
      ax = pts[j].x;
      ay = pts[j].y;
      i = j + 1;
    }
    return out;
  }

  /** True when a unit can walk straight from a to b (samples every 0.35 tiles, with a little body width). */
  lineClear(ax, ay, bx, by, team) {
    const d = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(d / 0.35));
    const px = -(by - ay) / (d || 1) * 0.28;
    const py = (bx - ax) / (d || 1) * 0.28;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      for (const s of [0, 1, -1]) {
        const tx = Math.floor(x + px * s);
        const ty = Math.floor(y + py * s);
        if (!this.inside(tx, ty)) return false;
        const i = ty * this.w + tx;
        if (this.stepCost(i, team) > 3) return false;
      }
    }
    return true;
  }

  /** Breadth-first reachability from a tile over terrain only. */
  reachable(sx, sy) {
    const seen = new Uint8Array(this.w * this.h);
    const q = [this.idx(sx, sy)];
    seen[q[0]] = 1;
    while (q.length) {
      const c = q.pop();
      const cx = c % this.w;
      const cy = (c / this.w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (!this.inside(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (seen[ni] || BLOCKING.has(this.tiles[ni])) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    return seen;
  }
}

const DX = [1, 0, -1, 0, 1, 1, -1, -1];
const DY = [0, 1, 0, -1, 1, -1, 1, -1];

/**
 * Territory from claims: tiles go to the team with the strongest influence (sum of claim - distance).
 * @param {number} w @param {number} h
 * @param {{x:number,y:number,claim:number,team:number}[]} claims
 * @param {Uint8Array} tiles @param {Set<number>} water tiles that cannot be owned
 * @returns {Int8Array} owner per tile: -1 none, 0, 1
 */
export function computeTerritory(w, h, claims, tiles, water) {
  const inf0 = new Float32Array(w * h);
  const inf1 = new Float32Array(w * h);
  for (const c of claims) {
    if (c.team !== 0 && c.team !== 1) continue;
    const arr = c.team === 0 ? inf0 : inf1;
    const r = c.claim;
    const x0 = Math.max(0, Math.floor(c.x - r));
    const x1 = Math.min(w - 1, Math.ceil(c.x + r));
    const y0 = Math.max(0, Math.floor(c.y - r));
    const y1 = Math.min(h - 1, Math.ceil(c.y + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
        if (d >= r) continue;
        arr[y * w + x] += r - d + 0.5;
      }
    }
  }
  const owner = new Int8Array(w * h).fill(-1);
  for (let i = 0; i < owner.length; i++) {
    if (water.has(tiles[i])) continue;
    const a = inf0[i];
    const b = inf1[i];
    if (a <= 0 && b <= 0) continue;
    if (a > b + 0.25) owner[i] = 0;
    else if (b > a + 0.25) owner[i] = 1;
  }
  return owner;
}
