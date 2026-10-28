// Siege Waves: defend your towers against endless monster waves. Every 5th wave is a boss.

import { CARDS } from '../data/cards.js';
import { ARENA_W } from './constants.js';

const POOL = [
  { id: 'skeletons', from: 1, w: 6 },
  { id: 'gunners', from: 1, w: 5 },
  { id: 'bats', from: 2, w: 4 },
  { id: 'knight', from: 1, w: 4 },
  { id: 'sheep', from: 3, w: 3 },
  { id: 'zombies', from: 4, w: 4 },
  { id: 'archers', from: 2, w: 3 },
  { id: 'bomber', from: 3, w: 3 },
  { id: 'boarrider', from: 5, w: 3 },
  { id: 'giant', from: 6, w: 3 },
  { id: 'necro', from: 7, w: 2 },
  { id: 'dragon', from: 7, w: 2 },
  { id: 'ninja', from: 8, w: 2 },
  { id: 'flamer', from: 6, w: 2 },
  { id: 'rocketeer', from: 9, w: 2 },
  { id: 'ufo', from: 11, w: 2 },
  { id: 'crab', from: 12, w: 2 },
  { id: 'mech', from: 14, w: 1.5 },
  { id: 'titan', from: 16, w: 1.5 },
  { id: 'phoenix', from: 13, w: 1.5 },
  { id: 'bonedragon', from: 18, w: 1.2 },
];
const BOSSES = ['crab', 'bonedragon', 'titan', 'mech', 'phoenix', 'giant'];

export class WaveDirector {
  /** @param {import('./battle.js').Battle} B */
  constructor(B) {
    this.B = B;
    this.wave = 0;
    this.state = 'rest';
    this.restT = 2.5;
    this.queue = [];
    this.spawnT = 0;
    B.waveMult = 1;
  }

  update(dt) {
    const B = this.B;
    if (B.phase !== 'play') return;
    if (this.state === 'rest') {
      this.restT -= dt;
      if (this.restT <= 0) this.startWave();
      return;
    }
    if (this.queue.length) {
      this.spawnT -= dt;
      while (this.spawnT <= 0 && this.queue.length) {
        const q = this.queue.shift();
        this.spawn(q);
        this.spawnT += q.gap;
      }
      return;
    }
    const alive = B.entities.some((e) => e.alive && e.team === 1 && (e.kind === 'troop' || e.kind === 'building'));
    if (!alive) {
      this.state = 'rest';
      this.restT = 5;
      B.addElixir(0, 3);
      B.addBricks(0, 15 + this.wave * 2);
      B.emit('banner', { text: `WAVE ${this.wave} CLEARED`, kind: 'cleared' });
      B.sfx('rarity_up', { volume: 0.6 });
    }
  }

  startWave() {
    const B = this.B;
    const rng = B.rng;
    this.wave++;
    const w = this.wave;
    B.waveMult = 1 + (w - 1) * 0.075;
    const level = Math.min(10, 1 + Math.floor(w / 4));
    const boss = w % 5 === 0;
    let budget = 4 + w * 2.3;
    const list = [];
    if (boss) {
      const id = BOSSES[(w / 5 - 1) % BOSSES.length];
      list.push({ id, level, boss: true, hpMult: 1.6 + w * 0.06, gap: 1.2 });
      budget *= 0.55;
    }
    const pool = POOL.filter((p) => p.from <= w);
    let guard = 0;
    while (budget > 0.5 && guard++ < 40) {
      let total = 0;
      for (const p of pool) total += p.w;
      let r = rng.next() * total;
      let pick = pool[0];
      for (const p of pool) {
        r -= p.w;
        if (r <= 0) {
          pick = p;
          break;
        }
      }
      list.push({ id: pick.id, level, gap: rng.range(0.5, 1.4) });
      budget -= CARDS[pick.id].cost;
    }
    this.queue = list;
    this.spawnT = 0.5;
    this.state = 'active';
    B.emit('banner', { text: boss ? `BOSS WAVE ${w}!` : `WAVE ${w}`, kind: boss ? 'boss' : 'wave' });
    B.sfx(boss ? 'dragon_roar' : 'countdown', { volume: 0.8 });
    B.audio?.setIntensity?.(boss ? 1 : Math.min(0.8, w / 20));
  }

  spawn(q) {
    const B = this.B;
    const rng = B.rng;
    const card = CARDS[q.id];
    const lane = rng.pick([3.5, 9, 14.5]);
    const x = Math.min(ARENA_W - 1, Math.max(1, lane + rng.range(-1.5, 1.5)));
    const y = rng.range(1.2, 3.2);
    const n = card.unit?.count || 1;
    for (let i = 0; i < n; i++) {
      const e = B.spawnUnit(1, q.id, x + (i % 3 - 1) * 0.6, y + Math.floor(i / 3) * 0.6, q.level, { deployT: 0.6, hpMult: q.hpMult || 1 });
      if (e && q.boss) {
        e.boss = true;
        e.r *= 1.15;
      }
    }
    B.dust(x, y, 0.8);
  }
}
