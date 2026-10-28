// AI opponent: reads the board, defends with counters, punishes with spells, builds pushes,
// steers its hero, spends bricks and sends emotes.

import { dist2, clamp } from '../core/util.js';
import { ARENA_W, ARENA_H, RIVER_TOP, RIVER_BOTTOM, TOWER_ELEMENT_COST } from './constants.js';
import { CARDS, levelMult } from '../data/cards.js';
import { AI_DIFFICULTY } from '../data/arenas.js';
import { isBuildingKind } from './combat.js';
import { spellReady, gadgetReady, formUpgradeCost } from './hero.js';

export class AIController {
  /**
   * @param {import('./battle.js').Battle} B
   * @param {number} team
   * @param {string} difficulty
   */
  constructor(B, team, difficulty = 'normal') {
    this.B = B;
    this.team = team;
    this.diff = AI_DIFFICULTY[difficulty] || AI_DIFFICULTY.normal;
    this.t = 2 + B.rng.next();
    this.heroT = 0.5;
    this.pushPlan = null;
    this.enabled = true;
    this.emoteCd = 0;
    B.on('crown', ({ team: scorer }) => this.react(scorer === this.team ? 'laugh' : B.rng.chance(0.5) ? 'cry' : 'angry', 0.55));
    B.on('end', (r) => this.react(r.winner === this.team ? 'laugh' : 'gg', 0.9, true));
    B.on('heroDeath', ({ team: t }) => t !== this.team && this.react('thumbs', 0.2));
  }

  get me() {
    return this.B.players[this.team];
  }
  /** y direction toward the enemy: -1 for bottom team, +1 for top team. */
  get fwd() {
    return this.team === 0 ? -1 : 1;
  }
  ownSide(y) {
    return this.team === 1 ? y < RIVER_BOTTOM + 0.5 : y > RIVER_TOP - 0.5;
  }
  mirrorY(y) {
    return this.team === 1 ? y : ARENA_H - y;
  }

  react(id, chance, force = false) {
    if (!force && this.emoteCd > 0) return;
    if (this.B.rng.chance(chance)) {
      this.B.emote(this.team, id);
      this.emoteCd = 8;
    }
  }

  update(dt) {
    const B = this.B;
    if (!this.enabled || (B.phase !== 'play' && B.phase !== 'overtime')) return;
    if (this.emoteCd > 0) this.emoteCd -= dt;
    this.heroT -= dt;
    if (this.heroT <= 0) {
      this.heroT = 0.4;
      this.driveHero();
      this.spendBricks();
    }
    this.t -= dt;
    if (this.t > 0) return;
    const [a, b] = this.diff.think;
    this.t = a + B.rng.next() * (b - a);
    this.decide();
  }

  // ───────────────────────── board reading ─────────────────────────

  threats() {
    const B = this.B;
    const list = [];
    for (const e of B.entities) {
      if (!e.alive || e.team === this.team || e.kind === 'tower') continue;
      if (e.kind === 'building' && !e.dmg) continue;
      if (e.status?.invisible > 0) continue;
      // only units that crossed (or are on a bridge heading in) count as threats
      const crossed = this.team === 1 ? e.y < RIVER_BOTTOM - 0.2 : e.y > RIVER_TOP + 0.2;
      if (crossed) list.push(e);
    }
    if (!list.length) return null;
    let value = 0;
    let cx = 0;
    let cy = 0;
    let air = 0;
    let swarm = 0;
    let tankHp = 0;
    let buildingTargeters = 0;
    for (const e of list) {
      const v = e.kind === 'hero' ? 3 : e.costShare || 1;
      value += v;
      cx += e.x * v;
      cy += e.y * v;
      if (e.flying) air += v;
      if (e.maxHp < 300 && e.kind === 'troop') swarm++;
      if (e.maxHp > 1400) tankHp = Math.max(tankHp, e.hp);
      if (e.targets === 'buildings') buildingTargeters += v;
    }
    return { list, value, x: cx / value, y: cy / value, air, swarm, tankHp, buildingTargeters };
  }

  /** True when our towers and nearby troops are enough to deal with a threat. */
  covered(th) {
    let own = 0;
    for (const e of this.B.entities) {
      if (!e.alive || e.team !== this.team) continue;
      if (e.kind === 'tower') {
        if (dist2(e.x, e.y, th.x, th.y) <= (e.range + 1) ** 2) own += e.type === 'king' ? 2 : 2.5;
        continue;
      }
      if (dist2(e.x, e.y, th.x, th.y) > 4.5 * 4.5) continue;
      own += e.kind === 'hero' ? 3 : e.costShare || 1;
    }
    const value = th.value + (th.tankHp > 1500 ? 2 : 0);
    return own >= value * 1.25 && value < 6;
  }

  playable() {
    const p = this.me;
    return p.hand.map((id, slot) => ({ id, slot, card: CARDS[id] })).filter((c) => c.card && c.card.cost <= p.elixir);
  }

  // ───────────────────────── decisions ─────────────────────────

  decide() {
    const B = this.B;
    const p = this.me;
    const hand = this.playable();
    if (!hand.length) return;
    const rng = B.rng;

    // mistakes: sometimes play something random somewhere reasonable
    if (rng.chance(this.diff.mistakes * 0.5) && p.elixir >= 6) {
      const c = rng.pick(hand);
      const x = rng.pick([3.5, 9, 14.5]);
      this.play(c, x, this.mirrorY(c.card.type === 'spell' ? 25 : 9 + rng.range(-2, 2)));
      return;
    }

    // 1) finish a low tower with a spell
    for (const c of hand) {
      if (c.card.type !== 'spell' || !c.card.spell.dmg) continue;
      const s = c.card.spell;
      const lvl = p.setup.cardLevels?.[c.id] ?? 1;
      const towerHit = s.dmg * levelMult(lvl) * (s.towerMult ?? 0.35) * (s.strikes ? 1 : 1);
      const target = B.towers.find((t) => t.alive && t.team !== this.team && t.hp <= towerHit);
      if (target) {
        this.play(c, target.x, target.y);
        return;
      }
    }

    const th = this.threats();
    // 2) defend (unless towers and troops already on the spot can handle it)
    if (th && th.value >= 1 && !this.covered(th)) {
      const pick = this.bestCounter(hand, th);
      if (pick) {
        const pos = this.counterPlacement(pick.card, th);
        if (pos) {
          this.play(pick, pos.x, pos.y);
          return;
        }
      }
    }

    // 3) spell value on clusters anywhere
    for (const c of hand) {
      if (c.card.type !== 'spell' || !c.card.spell.radius || c.card.spell.kind === 'bless' || c.card.spell.kind === 'wall') continue;
      const cluster = this.bestCluster(c.card.spell.radius);
      if (cluster && cluster.value >= c.card.cost + 1.5) {
        if (c.card.spell.kind === 'nuke' && cluster.friendly > cluster.value * 0.5) continue;
        this.play(c, cluster.x, cluster.y);
        return;
      }
    }

    // 4) economy & builders early
    const builder = hand.find((c) => c.card.roles.includes('builder'));
    if (builder && B.time < 40 && p.elixir >= 4 && !th) {
      this.play(builder, rngLane(rng), this.mirrorY(3.5));
      return;
    }
    const mine = hand.find((c) => c.card.roles.includes('economy') && c.card.type === 'building');
    if (mine && p.elixir >= 9 && !th) {
      this.play(mine, rng.pick([5.5, 12.5]), this.mirrorY(1.8));
      return;
    }

    // 5) push
    const pushAt = B.elixirMult > 1 ? this.diff.pushAt - 1 : this.diff.pushAt;
    if (p.elixir >= pushAt || p.elixir >= 9.6) {
      this.push(hand, th);
      return;
    }
    // support an ongoing push
    if (this.pushPlan && B.time - this.pushPlan.t < 6 && p.elixir >= 3) {
      const support = hand
        .filter((c) => c.card.type === 'troop' && !c.card.roles.includes('win') && !c.card.roles.includes('builder'))
        .sort((x, y) => y.card.cost - x.card.cost)[0];
      if (support) {
        const lead = this.frontUnit(this.pushPlan.x);
        const y = lead ? clamp(lead.y - this.fwd * 1.8, 0, ARENA_H) : this.mirrorY(this.pushPlan.y);
        this.play(support, this.pushPlan.x, y);
        this.pushPlan = null;
      }
    }
  }

  push(hand, th) {
    const B = this.B;
    const rng = B.rng;
    const lane = this.weakLane();
    const win = hand.filter((c) => c.card.roles.includes('win') || c.card.roles.includes('tank')).sort((a, b) => b.card.cost - a.card.cost)[0];
    if (win) {
      const fast = win.card.unit && win.card.unit.speed >= 1.4;
      const y = fast ? this.mirrorY(14) : this.mirrorY(2.5);
      this.play(win, lane, y);
      this.pushPlan = { x: lane, y: fast ? 14 : 3, t: B.time };
      return;
    }
    // no win condition in hand: cycle a cheap troop at the back or bridge
    const troops = hand.filter((c) => c.card.type === 'troop' && !c.card.roles.includes('builder')).sort((a, b) => a.card.cost - b.card.cost);
    if (troops.length) {
      this.play(troops[0], lane, this.mirrorY(th ? 9 : 13.5));
      return;
    }
    const bld = hand.find((c) => c.card.type === 'building');
    if (bld && this.me.elixir >= 9.5) this.play(bld, 9 + rng.range(-1, 1), this.mirrorY(10.5));
  }

  bestCounter(hand, th) {
    const rng = this.B.rng;
    let best = null;
    let bestScore = -Infinity;
    for (const c of hand) {
      const card = c.card;
      if (card.roles.includes('builder') || card.roles.includes('economy')) continue;
      let s = 0;
      const u = card.unit;
      const b = card.building;
      const hitsAir = (u && u.targets === 'both') || (b && b.targets === 'both') || card.type === 'spell';
      if (card.type === 'spell') {
        const sp = card.spell;
        if (sp.kind === 'wall' || sp.kind === 'bless') {
          s = sp.kind === 'wall' && th.value >= 4 && !th.air ? 2 : -5;
        } else if (sp.radius) {
          const cl = this.clusterAt(th.x, th.y, sp.radius);
          s = cl.value - card.cost + (th.swarm >= 3 ? 2 : 0) - (th.tankHp > 1500 ? 2 : 0);
        } else s = -3;
      } else {
        s = 2;
        if (th.air >= th.value * 0.5 && !hitsAir) s -= 6;
        if (th.air > 0 && hitsAir) s += 2;
        if (th.swarm >= 3 && (u?.splash || b?.splash || card.roles.includes('splash'))) s += 3;
        if (th.tankHp > 1200 && (card.roles.includes('dps') || card.roles.includes('swarm'))) s += 2.5;
        if (th.buildingTargeters >= 3 && card.type === 'building') s += 3;
        if (card.roles.includes('win') && !card.roles.includes('tank')) s -= 3;
        if (u?.targets === 'buildings') s -= 6;
        s -= Math.max(0, card.cost - th.value) * 0.5;
      }
      s += rng.range(-0.5, 0.5);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return bestScore > 0 ? best : null;
  }

  counterPlacement(card, th) {
    const B = this.B;
    if (card.type === 'spell') {
      if (card.spell.kind === 'wall') return { x: clamp(th.x, 3, 15), y: clamp(th.y - this.fwd * 2, ...this.ownRange()) };
      // lead the target slightly toward our side
      return { x: th.x, y: th.y - this.fwd * 0.6 };
    }
    if (card.type === 'building') return { x: 9 + (th.x < 9 ? -1 : 1), y: this.mirrorY(10.5) };
    // troops: between the threat and our nearest tower, a little toward our side
    const ourTowers = B.towers.filter((t) => t.alive && t.team === this.team);
    if (!ourTowers.length) return null;
    const tower = ourTowers.reduce((a, b) => (dist2(a.x, a.y, th.x, th.y) < dist2(b.x, b.y, th.x, th.y) ? a : b));
    const u = card.unit;
    const ranged = u && u.range >= 3;
    const t = ranged ? 0.75 : 0.45;
    let x = th.x + (tower.x - th.x) * t;
    let y = th.y + (tower.y - th.y) * t;
    const [y0, y1] = this.ownRange();
    y = clamp(y, y0, y1);
    x = clamp(x, 1, ARENA_W - 1);
    return { x, y };
  }

  ownRange() {
    return this.team === 1 ? [0.8, RIVER_TOP - 0.6] : [RIVER_BOTTOM + 0.6, ARENA_H - 0.8];
  }

  clusterAt(x, y, r) {
    let value = 0;
    let friendly = 0;
    for (const e of this.B.entities) {
      if (!e.alive || e.kind === 'tower') continue;
      if (dist2(e.x, e.y, x, y) > r * r) continue;
      const v = e.kind === 'hero' ? 3 : isBuildingKind(e) ? (e.costShare || 3) * 0.6 : e.costShare || 1;
      if (e.team === this.team) friendly += v;
      else value += v;
    }
    for (const t of this.B.towers) if (t.alive && t.team !== this.team && dist2(t.x, t.y, x, y) <= (r + t.r * 0.5) ** 2) value += 1.5;
    return { value, friendly };
  }

  bestCluster(r) {
    let best = null;
    for (const e of this.B.entities) {
      if (!e.alive || e.team === this.team || e.kind === 'tower') continue;
      const c = this.clusterAt(e.x, e.y, r);
      if (!best || c.value > best.value) best = { ...c, x: e.x, y: e.y };
    }
    return best;
  }

  weakLane() {
    const enemy = this.B.towers.filter((t) => t.alive && t.team !== this.team && t.type === 'princess');
    if (!enemy.length) return this.B.rng.pick([3.5, 14.5]);
    const weakest = enemy.reduce((a, b) => (a.hp < b.hp ? a : b));
    return weakest.side === 'left' ? 3.5 : 14.5;
  }

  frontUnit(laneX) {
    let best = null;
    for (const e of this.B.entities) {
      if (!e.alive || e.team !== this.team || e.kind !== 'troop') continue;
      if (Math.abs(e.x - laneX) > 4) continue;
      if (!best || (this.team === 1 ? e.y > best.y : e.y < best.y)) best = e;
    }
    return best;
  }

  play(c, x, y) {
    const r = this.B.playCard(this.team, c.slot, x, y);
    return r.ok;
  }

  // ───────────────────────── hero & bricks ─────────────────────────

  driveHero() {
    const B = this.B;
    const h = this.me.hero;
    if (!h || !h.alive) return;
    const th = this.threats();
    const near = th ? th.list.filter((e) => dist2(e.x, e.y, h.x, h.y) < 16) : [];
    const homeThreats = th ? th.list.filter((e) => this.ownSide(e.y)) : [];
    if (homeThreats.length) {
      const target = homeThreats.reduce((a, b) => (dist2(a.x, a.y, h.x, h.y) < dist2(b.x, b.y, h.x, h.y) ? a : b));
      if (h.focus !== target) B.heroFocus(this.team, target);
    } else if (this.raid) {
      // hero raid on the weakest enemy tower; retreat when hurt
      const tower = B.towers.filter((t) => t.alive && t.team !== this.team).sort((a, b) => a.hp - b.hp)[0];
      if (!tower || h.hp < h.maxHp * 0.4) {
        this.raid = false;
        B.heroMove(this.team, 9, this.mirrorY(8));
      } else if (h.focus !== tower) B.heroFocus(this.team, tower);
    } else {
      if (this.diff.raid && h.form >= 2 && h.hp > h.maxHp * 0.85 && B.rng.chance(this.diff.raid)) this.raid = true;
      const lead = this.frontUnit(3.5) || this.frontUnit(14.5);
      if (lead && !this.ownSide(lead.y)) {
        B.heroMove(this.team, lead.x, clamp(lead.y - this.fwd * 1.6, 0.5, ARENA_H - 0.5));
      } else if (!h.moveTo && (h.focus == null)) {
        const home = { x: 9 + Math.sin(B.time * 0.3) * 4, y: this.mirrorY(10) };
        if (dist2(home.x, home.y, h.x, h.y) > 4) B.heroMove(this.team, home.x, home.y);
      }
    }
    if (!this.diff.heroSpells) return;
    const hurt = h.hp < h.maxHp * 0.5;
    for (let i = 1; i >= 0; i--) {
      if (spellReady(h, i) && (near.length >= 2 || (near.length >= 1 && hurt))) {
        B.heroSpell(this.team, i);
        return;
      }
    }
    if (gadgetReady(h)) {
      const g = h.gadget;
      if ((g === 'medkit' && h.hp < h.maxHp * 0.45) || (g === 'shield' && hurt && near.length) || (g !== 'medkit' && g !== 'shield' && g !== 'jetpack' && near.length >= 2)) {
        B.heroGadget(this.team);
      }
    }
  }

  spendBricks() {
    if (!this.diff.upgrades) return;
    const B = this.B;
    const p = this.me;
    const h = p.hero;
    const cost = h ? formUpgradeCost(h) : null;
    if (h && h.alive && cost != null && p.bricks >= cost) {
      B.heroUpgrade(this.team);
      return;
    }
    if (!this.diff.towers) return;
    if (p.bricks >= TOWER_ELEMENT_COST + (cost != null && h?.form < 3 ? 40 : 0)) {
      const towers = B.towers.filter((t) => t.alive && t.team === this.team && t.type === 'princess' && !t.element);
      if (towers.length) {
        const t = towers.reduce((a, b) => (a.hp < b.hp ? a : b));
        const el = h?.def?.element && h.def.element !== 'shadow' ? h.def.element : B.rng.pick(['fire', 'ice', 'lightning', 'earth']);
        B.elementTower(this.team, t, el);
      }
    }
  }
}

function rngLane(rng) {
  return rng.pick([4.5, 13.5]);
}
