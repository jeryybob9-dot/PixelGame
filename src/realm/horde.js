// Horde Nights: your village alone on the island. Each night a bigger horde lands on the beaches and marches on
// your Keep; nests join in. Survive as many nights as you can.

import { WILD, T } from './constants.js';

export const HORDE_DAY = 50;
export const HORDE_NIGHT = 30;

export class HordeDirector {
  /** @param {import('./realm.js').Realm} R */
  constructor(R) {
    this.R = R;
    this.night = 0;
    this.spawnQ = [];
    R.matchLength = R.clock = 99999;
    // beach tiles far from the keep are landing spots
    const k = R.players[0].keep;
    this.beaches = [];
    for (let y = 1; y < R.H - 1; y++) {
      for (let x = 1; x < R.W - 1; x++) {
        const i = y * R.W + x;
        if (R.tiles[i] !== T.SAND && R.tiles[i] !== T.GRASS) continue;
        const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => R.tiles[(y + dy) * R.W + x + dx] <= T.WATER);
        if (!nearWater || R.grid.occ[i] !== 0) continue;
        if (Math.hypot(x - k.x, y - k.y) < 22) continue;
        this.beaches.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
  }

  /** Night schedule for the realm clock. */
  isNight(elapsed) {
    if (elapsed < HORDE_DAY) return false;
    return (elapsed - HORDE_DAY) % (HORDE_DAY + HORDE_NIGHT) < HORDE_NIGHT;
  }

  get level() {
    return 1 + Math.floor(this.night / 2);
  }

  onNight() {
    const R = this.R;
    this.night++;
    R.sfx('raid', { volume: 0.7 });
    R.emit('banner', { text: `NIGHT ${this.night}`, sub: this.night % 5 === 0 ? 'A giant leads the horde!' : 'Defend your castle!', kind: 'bad' });
    const n = 3 + this.night * 2;
    const kinds = this.night < 3 ? ['wolf'] : this.night < 6 ? ['wolf', 'bandit'] : ['wolf', 'bandit', 'skeleton', 'skeleton'];
    const landings = [];
    for (let g = 0; g < Math.min(3, 1 + Math.floor(this.night / 3)); g++) landings.push(this.beaches[Math.floor(R.rng.next() * this.beaches.length)]);
    for (let i = 0; i < n; i++) {
      const at = landings[i % landings.length];
      if (!at) break;
      this.spawnQ.push({ t: 1 + i * 0.6, kind: kinds[i % kinds.length], x: at.x + (R.rng.next() - 0.5) * 2, y: at.y + (R.rng.next() - 0.5) * 2 });
    }
    if (this.night % 5 === 0 && landings[0]) this.spawnQ.push({ t: 2, kind: 'boss', x: landings[0].x, y: landings[0].y });
  }

  onDay() {
    const R = this.R;
    R.emit('banner', { text: 'DAWN', sub: `Night ${this.night} survived`, kind: 'good' });
    R.addBricks(0, 20 + this.night * 10);
  }

  update(dt) {
    const R = this.R;
    if (R.phase !== 'play' || !this.spawnQ.length) return;
    for (const s of this.spawnQ) s.t -= dt;
    const due = this.spawnQ.filter((s) => s.t <= 0);
    this.spawnQ = this.spawnQ.filter((s) => s.t > 0);
    for (const s of due) {
      let u;
      if (s.kind === 'boss') {
        u = R.spawnUnit(WILD, 'giant', s.x, s.y, this.level + 1, { deployT: 0.6, hpMult: 2.2 });
        if (u) {
          u.boss = true;
          u.role = 'monster';
          R.sfx('dragon_roar');
        }
      } else u = R.spawnMonster(s.kind, s.x, s.y);
      if (u) {
        u.raid = { team: 0 };
        R.puff(u.x, u.y, '#9ad7ff', 6);
      }
    }
  }
}
