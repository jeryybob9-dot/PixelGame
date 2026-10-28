// The rival god: builds a small village, sends troops at your castle, defends its half, and steers its hero.
// The same controller can drive team 0 for AI-vs-AI tests.

import { dist, dist2 } from '../core/util.js';
import { CARDS } from '../data/cards.js';
import { AI_DIFFICULTY } from '../data/arenas.js';
import { isBuildingKind } from '../battle/combat.js';
import { spellReady } from '../battle/hero.js';
import { STRUCTURES, WILD, cardBricks } from './constants.js';

/** How much the rival builds, by difficulty: [houses, towers, barracks] targets. */
const BUILD_PLAN = {
  tutorial: [1, 1, 0],
  easy: [2, 1, 1],
  normal: [3, 2, 1],
  hard: [3, 2, 2],
  master: [4, 3, 2],
};
/** Bricks the rival waits for before it starts an attack. */
const PUSH_AT = { tutorial: 260, easy: 200, normal: 170, hard: 150, master: 140 };

export class RealmAI {
  /**
   * @param {import('./realm.js').Realm} R
   * @param {number} team
   * @param {string} difficulty
   */
  constructor(R, team, difficulty = 'normal') {
    this.R = R;
    this.team = team;
    this.diffId = AI_DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.diff = AI_DIFFICULTY[this.diffId];
    this.t = 2 + R.rng.next();
    this.heroT = 0.3;
    this.emoteCd = 0;
    this.enabled = true;
    R.on('end', (r) => this.react(r.winner === this.team ? 'laugh' : 'gg', 0.9, true));
    R.on('crown', ({ team: t }) => this.react(t === this.team ? 'laugh' : 'angry', 0.5));
  }

  get me() {
    return this.R.players[this.team];
  }
  get enemy() {
    return this.R.players[1 - this.team];
  }

  react(id, chance, force = false) {
    if (!force && this.emoteCd > 0) return;
    if (this.R.rng.chance(chance)) {
      this.R.emote(this.team, id);
      this.emoteCd = 10;
    }
  }

  update(dt) {
    const R = this.R;
    if (!this.enabled || R.phase !== 'play') return;
    if (this.emoteCd > 0) this.emoteCd -= dt;
    this.heroT -= dt;
    if (this.heroT <= 0) {
      this.heroT = 0.35;
      this.driveHero();
    }
    this.t -= dt;
    if (this.t > 0) return;
    const [a, b] = this.diff.think;
    this.t = a + R.rng.next() * (b - a);
    if (R.rng.chance(this.diff.mistakes)) return;
    if (this.defend()) return;
    if (this.build()) return;
    this.attack();
  }

  // ───────────────────────── reading the island ─────────────────────────

  /** Enemy units on our half of the island. */
  threats() {
    const R = this.R;
    const list = [];
    for (const e of R.entities) {
      if (!e.alive || e.team === this.team || e.team === WILD || e.untargetable || isBuildingKind(e)) continue;
      if (e.kind !== 'troop' && e.kind !== 'hero') continue;
      if (e.status?.invisible > 0) continue;
      if (R.tileOwner(e.x, e.y) === this.team) list.push(e);
    }
    if (!list.length) return null;
    let value = 0;
    let cx = 0;
    let cy = 0;
    let air = 0;
    for (const e of list) {
      const v = e.kind === 'hero' ? 3 : e.costShare || 1;
      value += v;
      cx += e.x * v;
      cy += e.y * v;
      if (e.flying) air += v;
    }
    return { list, value, x: cx / value, y: cy / value, air };
  }

  /** Our fighters near a point. */
  defenseAt(x, y) {
    let own = 0;
    for (const e of this.R.entities) {
      if (!e.alive || e.team !== this.team) continue;
      if (isBuildingKind(e)) {
        if (e.dmg && e.built >= 1 && dist2(e.x, e.y, x, y) <= (e.range + 1) ** 2) own += e.struct === 'keep' ? 3 : 2;
        continue;
      }
      if (e.kind === 'villager' || dist2(e.x, e.y, x, y) > 5 * 5) continue;
      own += e.kind === 'hero' ? 3 : e.costShare || 1;
    }
    return own;
  }

  clusterAt(x, y, r) {
    let value = 0;
    let friendly = 0;
    for (const e of this.R.entities) {
      if (!e.alive || e.untargetable || e.kind === 'critter' || e.kind === 'pickup') continue;
      if (dist2(e.x, e.y, x, y) > r * r) continue;
      const v = e.kind === 'hero' ? 3 : isBuildingKind(e) ? (e.struct === 'keep' ? 4 : 2) : e.kind === 'villager' ? 0.5 : e.costShare || 1;
      if (e.team === this.team) friendly += v;
      else if (e.team !== WILD) value += v;
    }
    return { value, friendly };
  }

  hand() {
    return this.me.hand.map((id, slot) => ({ id, slot, card: CARDS[id], cost: cardBricks(CARDS[id]) })).filter((c) => c.card);
  }

  play(c, x, y) {
    const R = this.R;
    const pt = R.previewPlacement(this.team, c.id, x, y);
    if (!pt) return false;
    return R.playCard(this.team, c.slot, pt.x, pt.y).ok;
  }

  /** A spot on our side of the river, in front of our castle, toward (x, y). */
  frontSpot(x) {
    const R = this.R;
    const y = this.team === 0 ? R.H / 2 + 3 : R.H / 2 - 3;
    return { x: Math.max(3, Math.min(R.W - 3, x)), y };
  }

  // ───────────────────────── decisions ─────────────────────────

  defend() {
    const p = this.me;
    const th = this.threats();
    if (!th || th.value < 1.5 || this.defenseAt(th.x, th.y) >= th.value * 1.4) return false;
    const hand = this.hand().filter((c) => c.cost <= p.bricks);
    // a spell on a real clump
    for (const c of hand.filter((h) => h.card.type === 'spell' && h.card.spell.radius && !['bless', 'wall'].includes(h.card.spell.kind))) {
      const cl = this.clusterAt(th.x, th.y, c.card.spell.radius);
      if (cl.value >= c.card.cost * 1.2 && cl.friendly < cl.value * 0.5 && this.play(c, th.x, th.y)) return true;
    }
    const fighters = hand.filter((c) => c.card.type !== 'spell' && !c.card.roles.includes('builder') && !c.card.roles.includes('economy'));
    if (!fighters.length) return false;
    const pick = fighters.find((c) => (th.air > th.value * 0.4 ? c.card.unit?.targets === 'both' || c.card.building?.targets === 'both' : true)) || fighters[0];
    const k = p.keep;
    const x = k ? (k.x + th.x * 2) / 3 : th.x;
    const y = k ? (k.y + th.y * 2) / 3 : th.y;
    return this.play(pick, x, y);
  }

  count(id) {
    return this.R.structures.filter((s) => s.alive && s.team === this.team && s.struct === id).length;
  }

  build() {
    const R = this.R;
    const p = this.me;
    if (!p.keep?.alive) return false;
    const sites = R.structures.filter((s) => s.alive && s.team === this.team && s.built < 1).length;
    if (sites >= 2) return false;
    const [houses, towers, barracks] = BUILD_PLAN[this.diffId] || BUILD_PLAN.normal;
    const t = R.time;
    const wants = [];
    if (this.count('house') < Math.min(houses, 1 + Math.floor(t / 40))) wants.push('house');
    if (t > 25 && this.count('tower') < Math.min(towers, 1 + Math.floor(t / 90))) wants.push('tower');
    if (t > 50 && this.count('barracks') < Math.min(barracks, 1 + Math.floor(t / 120))) wants.push('barracks');
    for (const id of wants) {
      if (p.bricks < STRUCTURES[id].cost) continue;
      const spot = this.findSpot(id);
      if (spot && R.orderBuild(this.team, id, spot.x0, spot.y0).ok) return true;
    }
    return false;
  }

  attack() {
    const R = this.R;
    const p = this.me;
    const hand = this.hand();
    const affordable = hand.filter((c) => c.cost <= p.bricks);
    if (!affordable.length) return;
    // value spells on enemy clumps
    for (const c of affordable.filter((h) => h.card.type === 'spell' && h.card.spell.radius && !['bless', 'wall'].includes(h.card.spell.kind))) {
      const best = this.bestCluster(c.card.spell.radius);
      if (best && best.value >= c.card.cost * 1.4 && best.friendly < best.value * 0.4 && this.play(c, best.x, best.y)) return;
    }
    // gather a wave: wait for enough bricks, then play several cards in a row at the same bridge
    const pushAt = PUSH_AT[this.diffId] * (R.rush ? 0.6 : 1);
    if (p.bricks < pushAt && !this.pushing) return;
    const troops = affordable
      .filter((c) => c.card.type === 'troop' && !c.card.roles.includes('builder'))
      .sort((a, b) => (b.card.roles.includes('tank') ? 1 : 0) - (a.card.roles.includes('tank') ? 1 : 0) || b.cost - a.cost);
    if (!troops.length) return;
    const ek = this.enemy?.keep;
    const lane = this.lane ?? (this.lane = [5, this.R.W / 2, this.R.W - 5][Math.floor(R.rng.next() * 3)]);
    const spot = this.frontSpot(ek ? (lane + ek.x) / 2 : lane);
    if (this.play(troops[0], spot.x, spot.y)) {
      // keep the push going for a few cards, then pick a new lane next time
      this.pushing = (this.pushing || 0) + 1;
      if (this.pushing >= 3 + (this.diffId === 'hard' || this.diffId === 'master' ? 1 : 0) || p.bricks < 30) {
        this.pushing = 0;
        this.lane = null;
      }
    }
  }

  bestCluster(r) {
    let best = null;
    for (const e of this.R.entities) {
      if (!e.alive || e.team === this.team || e.team === WILD || e.untargetable || e.kind === 'critter' || e.kind === 'villager') continue;
      const c = this.clusterAt(e.x, e.y, r);
      if (!best || c.value > best.value) best = { ...c, x: e.x, y: e.y };
    }
    return best;
  }

  /** Choose a footprint for a building on our half. */
  findSpot(id) {
    const R = this.R;
    const def = STRUCTURES[id];
    const k = this.me.keep;
    const toRiver = this.team === 0 ? -1 : 1;
    let best = null;
    let bs = Infinity;
    for (let y0 = 1; y0 < R.H - def.h; y0++) {
      for (let x0 = 1; x0 < R.W - def.w; x0++) {
        const cx = x0 + def.w / 2;
        const cy = y0 + def.h / 2;
        if (R.owner[Math.floor(cy) * R.W + Math.floor(cx)] !== this.team) continue;
        const dk = dist(cx, cy, k.x, k.y);
        let score;
        // towers stand between the castle and the river; houses and barracks stay behind
        if (id === 'tower') score = Math.abs(dk - 5.5) + Math.abs(cx - k.x) * 0.3 + this.nearSame(cx, cy, 'tower') * 3 - (cy - k.y) * toRiver * 0.4;
        else score = dk + (dk < 3.4 ? 8 : 0) + R.rng.next() * 1.5 + (id === 'barracks' ? Math.max(0, (cy - k.y) * toRiver * -0.5) : 0);
        if (score >= bs) continue;
        if (R.placementProblem(this.team, id, x0, y0)) continue;
        if (this.crowded(x0, y0, def.w, def.h)) continue;
        bs = score;
        best = { x0, y0 };
      }
    }
    return best;
  }

  nearSame(x, y, id) {
    let n = 0;
    for (const s of this.R.structures) if (s.alive && s.team === this.team && s.struct === id && dist2(s.x, s.y, x, y) < 16) n++;
    return n;
  }

  crowded(x0, y0, w, h) {
    const R = this.R;
    let blockedSides = 0;
    const sides = [
      [x0 - 1, y0, 1, h],
      [x0 + w, y0, 1, h],
      [x0, y0 - 1, w, 1],
      [x0, y0 + h, w, 1],
    ];
    for (const [sx, sy, sw, sh] of sides) {
      let bad = false;
      for (let y = sy; y < sy + sh && !bad; y++) for (let x = sx; x < sx + sw; x++) {
        if (!R.grid.inside(x, y) || R.grid.occ[y * R.W + x] !== 0) {
          bad = true;
          break;
        }
      }
      if (bad) blockedSides++;
    }
    return blockedSides > 1;
  }

  // ───────────────────────── hero ─────────────────────────

  driveHero() {
    const R = this.R;
    const p = this.me;
    const h = p.hero;
    if (!h || !h.alive) return;
    const k = p.keep;
    const near = this.clusterAt(h.x, h.y, 3.2);
    if (this.diff.heroSpells !== false && near.value >= 2 && (spellReady(h, 0) || spellReady(h, 1))) R.heroPower(this.team);
    // retreat when hurt
    if (h.hp < h.maxHp * 0.3 && k) {
      if (dist2(h.x, h.y, k.x, k.y) > 9) R.heroMove(this.team, k.x, k.y + (this.team === 0 ? -2 : 2));
      return;
    }
    // defend our half
    const th = this.threats();
    if (th && th.value >= 1.5) {
      const tgt = th.list.reduce((a, b) => (dist2(a.x, a.y, h.x, h.y) < dist2(b.x, b.y, h.x, h.y) ? a : b));
      if (h.focus !== tgt) R.heroFocus(this.team, tgt);
      return;
    }
    // walk with our troops when they cross the river; otherwise wait at the front
    let lead = null;
    let ld = Infinity;
    const ek = this.enemy?.keep;
    for (const e of R.entities) {
      if (!e.alive || e.team !== this.team || e.kind !== 'troop' || !ek) continue;
      const d = dist2(e.x, e.y, ek.x, ek.y);
      if (d < ld) {
        ld = d;
        lead = e;
      }
    }
    if (lead && R.tileOwner(lead.x, lead.y) !== this.team && ek) {
      const tgt = R.nearestEnemyBuilding(this.team, h.x, h.y);
      if (tgt && dist2(tgt.x, tgt.y, lead.x, lead.y) < 49) {
        if (h.focus !== tgt) R.heroFocus(this.team, tgt);
      } else if (!h.moveTo || R.rng.chance(0.1)) R.heroMove(this.team, lead.x, lead.y + (this.team === 0 ? 1.2 : -1.2));
      return;
    }
    if (!h.moveTo && !h.focus && R.rng.chance(0.12)) {
      const spot = this.frontSpot(R.W / 2 + (R.rng.next() - 0.5) * 8);
      R.heroMove(this.team, spot.x, spot.y + (this.team === 0 ? 1.5 : -1.5));
    }
  }
}
