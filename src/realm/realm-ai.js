// The rival god: plans its village, casts Divine Cards, steers its hero and sounds the war horn.
// The same controller can drive team 0 for AI-vs-AI tests and attract mode.

import { dist, dist2 } from '../core/util.js';
import { CARDS } from '../data/cards.js';
import { AI_DIFFICULTY } from '../data/arenas.js';
import { isBuildingKind } from '../battle/combat.js';
import { spellReady, gadgetReady, formUpgradeCost } from '../battle/hero.js';
import { STRUCTURES, WILD, ELEMENT_COST, AGES } from './constants.js';

const ELEMENTS = ['fire', 'ice', 'lightning', 'earth'];

export class RealmAI {
  /**
   * @param {import('./realm.js').Realm} R
   * @param {number} team
   * @param {string} difficulty
   */
  constructor(R, team, difficulty = 'normal') {
    this.R = R;
    this.team = team;
    this.diffId = difficulty;
    this.diff = AI_DIFFICULTY[difficulty] || AI_DIFFICULTY.normal;
    this.t = 1.5 + R.rng.next();
    this.buildT = 2 + R.rng.next() * 2;
    this.heroT = 0.3;
    this.emoteCd = 0;
    this.enabled = true;
    this.chargeUntil = 0;
    R.on('end', (r) => this.react(r.winner === this.team ? 'laugh' : 'gg', 0.9, true));
    R.on('crown', ({ team: t }) => this.react(t === this.team ? 'laugh' : 'angry', 0.5));
    R.on('relic', ({ team: t }) => t === this.team && this.react('thumbs', 0.3));
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
    this.buildT -= dt;
    if (this.buildT <= 0) {
      const [a, b] = this.diff.think;
      this.buildT = (a + b) * 1.3 + R.rng.next();
      this.planBuild();
      this.stance();
    }
    this.t -= dt;
    if (this.t > 0) return;
    const [a, b] = this.diff.think;
    this.t = a + R.rng.next() * (b - a);
    if (R.rng.chance(this.diff.mistakes)) return;
    this.playCards();
  }

  // ───────────────────────── reading the island ─────────────────────────

  /** Enemy units inside or right next to our territory. */
  threats() {
    const R = this.R;
    const list = [];
    for (const e of R.entities) {
      if (!e.alive || e.team === this.team || e.untargetable || isBuildingKind(e)) continue;
      if (e.kind !== 'troop' && e.kind !== 'hero') continue;
      if (e.status?.invisible > 0) continue;
      if (R.tileOwner(e.x, e.y) === this.team || this.nearOwnBuilding(e, 4)) list.push(e);
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

  nearOwnBuilding(e, r) {
    for (const s of this.R.structures) {
      if (s.alive && s.team === this.team && dist2(s.x, s.y, e.x, e.y) <= r * r) return true;
    }
    return false;
  }

  /** Defenders near a point: our units, hero and shooting buildings. */
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

  /** Our territory tile closest to (x, y). */
  frontier(x, y) {
    const R = this.R;
    let best = null;
    let bd = Infinity;
    for (let ty = 0; ty < R.H; ty++) {
      for (let tx = 0; tx < R.W; tx++) {
        const i = ty * R.W + tx;
        if (R.owner[i] !== this.team || R.grid.occ[i] !== 0) continue;
        const d = dist2(tx + 0.5, ty + 0.5, x, y);
        if (d < bd) {
          bd = d;
          best = { x: tx + 0.5, y: ty + 0.5 };
        }
      }
    }
    return best;
  }

  clusterAt(x, y, r, team = 'enemy') {
    let value = 0;
    let friendly = 0;
    let buildings = 0;
    for (const e of this.R.entities) {
      if (!e.alive || e.untargetable || e.kind === 'critter' || e.kind === 'pickup') continue;
      if (dist2(e.x, e.y, x, y) > r * r) continue;
      const v = e.kind === 'hero' ? 3 : isBuildingKind(e) ? (e.struct === 'keep' ? 4 : 2) : e.kind === 'villager' ? 0.6 : e.costShare || 1;
      if (e.team === this.team) friendly += v;
      else if (team === 'enemy' && e.team !== WILD) {
        value += v;
        if (isBuildingKind(e)) buildings++;
      }
    }
    return { value, friendly, buildings };
  }

  bestCluster(r) {
    let best = null;
    for (const e of this.R.entities) {
      if (!e.alive || e.team === this.team || e.team === WILD || e.untargetable || e.kind === 'critter') continue;
      const c = this.clusterAt(e.x, e.y, r);
      if (!best || c.value > best.value) best = { ...c, x: e.x, y: e.y };
    }
    return best;
  }

  hand() {
    const p = this.me;
    return p.hand.map((id, slot) => ({ id, slot, card: CARDS[id] })).filter((c) => c.card);
  }

  play(c, x, y) {
    const R = this.R;
    const pt = R.previewPlacement(this.team, c.id, x, y);
    if (!pt) return false;
    return R.playCard(this.team, c.slot, pt.x, pt.y).ok;
  }

  // ───────────────────────── cards ─────────────────────────

  playCards() {
    const R = this.R;
    const p = this.me;
    const hand = this.hand();
    const affordable = hand.filter((c) => c.card.cost <= p.elixir);
    if (!affordable.length) return;
    const th = this.threats();

    // 1) defend the village
    if (th && th.value >= 2 && this.defenseAt(th.x, th.y) < th.value * 1.3) {
      // a spell on a big clump first
      const spells = affordable.filter((c) => c.card.type === 'spell' && c.card.spell.radius && c.card.spell.kind !== 'bless' && c.card.spell.kind !== 'wall');
      for (const c of spells) {
        const cl = this.clusterAt(th.x, th.y, c.card.spell.radius);
        if (cl.value >= c.card.cost && cl.friendly < cl.value * 0.6) {
          if (this.play(c, th.x, th.y)) return;
        }
      }
      const troops = affordable.filter((c) => c.card.type !== 'spell' && !c.card.roles.includes('builder') && !c.card.roles.includes('economy'));
      if (troops.length) {
        const pick = troops.find((c) => th.air > th.value * 0.4 ? c.card.unit?.targets === 'both' || c.card.building?.targets === 'both' : true) || troops[0];
        // between the threat and our nearest building
        const home = this.nearestOwnStructure(th.x, th.y);
        const x = home ? (home.x * 2 + th.x) / 3 : th.x;
        const y = home ? (home.y * 2 + th.y) / 3 : th.y;
        if (this.play(pick, x, y)) return;
      }
    }

    // 2) value spells on enemy clumps (and their buildings late in the game)
    for (const c of affordable.filter((c) => c.card.type === 'spell' && c.card.spell.radius && !['bless', 'wall'].includes(c.card.spell.kind))) {
      const cl = this.bestCluster(c.card.spell.radius);
      if (cl && cl.value >= c.card.cost + 1.5 && cl.friendly < cl.value * 0.5) {
        if (this.play(c, cl.x, cl.y)) return;
      }
    }

    // 3) villagers when there is room in the tribe
    const builder = affordable.find((c) => c.card.roles.includes('builder'));
    if (builder && p.pop + 2 <= p.popCap && !th && p.elixir >= 4) {
      const k = p.keep;
      if (k && this.play(builder, k.x, k.y + (this.team === 0 ? -2.5 : 2.5))) return;
    }

    // 4) push: summons at the frontier facing the enemy (or beside our hero on the attack)
    const pushAt = this.diff.pushAt - (R.ageIdx >= 3 ? 2 : R.ageIdx >= 2 ? 1 : 0);
    if (p.elixir >= pushAt || p.elixir >= 9.5) {
      const troops = affordable
        .filter((c) => c.card.type === 'troop' && !c.card.roles.includes('builder'))
        .sort((a, b) => (b.card.roles.includes('win') || b.card.roles.includes('tank') ? 1 : 0) - (a.card.roles.includes('win') || a.card.roles.includes('tank') ? 1 : 0) || b.card.cost - a.card.cost);
      const target = R.nearestEnemyBuilding(this.team, p.keep?.x ?? R.W / 2, p.keep?.y ?? R.H / 2);
      if (troops.length && target) {
        const h = p.hero;
        let spot = null;
        if (h && h.alive && dist2(h.x, h.y, target.x, target.y) < dist2(p.keep.x, p.keep.y, target.x, target.y) * 0.6) spot = { x: h.x, y: h.y };
        else spot = this.frontier(target.x, target.y);
        if (spot && this.play(troops[0], spot.x, spot.y)) {
          this.lastPush = R.time;
          return;
        }
      }
      // spend instead of wasting Faith: defensive buildings near the front
      const bld = affordable.find((c) => c.card.type === 'building' && !c.card.roles.includes('economy'));
      if (bld && p.elixir >= 9.5 && target) {
        const spot = this.frontier(target.x, target.y);
        if (spot && this.play(bld, spot.x, spot.y)) return;
      }
      const mine = affordable.find((c) => c.card.roles.includes('economy') && c.card.type === 'building');
      if (mine && p.elixir >= 9.5 && p.keep) this.play(mine, p.keep.x + 2.5, p.keep.y);
    }
  }

  nearestOwnStructure(x, y) {
    let best = null;
    let bd = Infinity;
    for (const s of this.R.structures) {
      if (!s.alive || s.team !== this.team) continue;
      const d = dist2(s.x, s.y, x, y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  // ───────────────────────── village planning ─────────────────────────

  count(id, builtOnly = false) {
    return this.R.structures.filter((s) => s.alive && s.team === this.team && s.struct === id && (!builtOnly || s.built >= 1)).length;
  }

  planBuild() {
    const R = this.R;
    const p = this.me;
    if (!p.keep?.alive) return;
    const age = R.ageIdx;
    const scaffolds = R.structures.filter((s) => s.alive && s.team === this.team && s.built < 1).length;
    if (scaffolds >= 2 + (age >= 2 ? 1 : 0)) return;
    const houses = this.count('house');
    const towers = this.count('tower');
    const temples = this.count('temple');
    const barracks = this.count('barracks');
    const outposts = this.count('outpost');
    const pendingHouses = R.structures.filter((s) => s.alive && s.team === this.team && s.struct === 'house' && s.built < 1).length;
    const wants = [];
    if (p.pop >= p.popCap - 1 && pendingHouses === 0 && houses < 9) wants.push('house');
    if (R.time > 25 && temples < 1) wants.push('temple');
    if (R.time > 45 && barracks < 1) wants.push('barracks');
    if (this.homeDepositsLow() && outposts < 4) wants.push('outpost');
    if (R.time > 60 && towers < 1 + Math.ceil(age * 1.5)) wants.push('tower');
    if (age >= 1 && outposts < 2 && R.shrine && R.shrine.team !== this.team) wants.push('outpost');
    if (age >= 2 && barracks < 2 + (p.bricks > 300 ? 1 : 0)) wants.push('barracks');
    if (age >= 1 && temples < 2 && p.bricks > 160) wants.push('temple');
    if (p.bricks > 220 && houses < 9) wants.push('house');
    // hero forms come first when affordable and the village is fine
    const h = p.hero;
    const formCost = h?.alive ? formUpgradeCost(h) : null;
    if (formCost != null && this.diff.upgrades && p.bricks >= formCost && (age >= 1 || p.bricks >= formCost + 60)) {
      R.heroUpgrade(this.team);
      return;
    }
    // tower elements
    if (this.diff.towers && p.bricks >= ELEMENT_COST + 60) {
      const tw = R.structuresOf(this.team, 'tower').find((t) => !t.element);
      if (tw) {
        R.elementTower(this.team, tw, ELEMENTS[Math.floor(R.rng.next() * ELEMENTS.length)]);
        return;
      }
    }
    for (const id of wants) {
      if (p.bricks < STRUCTURES[id].cost) continue;
      const spot = this.findSpot(id);
      if (!spot) continue;
      const res = R.orderBuild(this.team, id, spot.x0, spot.y0);
      if (res.ok) return;
    }
  }

  homeDepositsLow() {
    const R = this.R;
    let left = 0;
    for (const d of R.deposits) {
      if (d.amount <= 0) continue;
      for (const k of R.dropOffs(this.team)) {
        if (dist(k.x, k.y, d.x, d.y) <= 15 && R.tileOwner(d.x, d.y) !== 1 - this.team) {
          left += d.amount;
          break;
        }
      }
    }
    return left < 220;
  }

  /** Choose a footprint for a structure. */
  findSpot(id) {
    const R = this.R;
    const def = STRUCTURES[id];
    const p = this.me;
    const k = p.keep;
    const ek = this.enemy?.keep;
    const toward = ek ? { x: ek.x, y: ek.y } : { x: R.W / 2, y: R.H / 2 };
    // outposts aim at the best rich deposit or the shrine
    let goal = null;
    if (id === 'outpost') {
      let bd = Infinity;
      for (const d of R.deposits) {
        if (d.amount <= 100 || R.tileOwner(d.x, d.y) === this.team) continue;
        const near = Math.min(...R.dropOffs(this.team).map((o) => dist(o.x, o.y, d.x, d.y)));
        if (near <= 7) continue;
        const sc = dist(k.x, k.y, d.x, d.y) + (R.tileOwner(d.x, d.y) === 1 - this.team ? 30 : 0);
        if (sc < bd) {
          bd = sc;
          goal = d;
        }
      }
      if (!goal && R.shrine && R.shrine.team !== this.team) goal = R.shrine;
      if (!goal) goal = toward;
    }
    let best = null;
    let bs = Infinity;
    const step = id === 'wall' ? 1 : 1;
    for (let y0 = 1; y0 < R.H - def.h; y0 += step) {
      for (let x0 = 1; x0 < R.W - def.w; x0 += step) {
        const cx = x0 + def.w / 2;
        const cy = y0 + def.h / 2;
        // quick reject: centre must be ours
        if (R.owner[Math.floor(cy) * R.W + Math.floor(cx)] !== this.team) continue;
        const dk = dist(cx, cy, k.x, k.y);
        let score;
        if (id === 'house' || id === 'temple') score = dk + (dk < 3.2 ? 6 : 0) + R.rng.next() * 1.5;
        else if (id === 'barracks') score = dk * 0.6 + dist(cx, cy, toward.x, toward.y) * 0.3 + (dk < 3.5 ? 6 : 0);
        else if (id === 'tower') score = dist(cx, cy, toward.x, toward.y) + dk * 0.4 + this.nearSame(cx, cy, 'tower') * 4;
        else if (id === 'outpost') score = dist(cx, cy, goal.x, goal.y);
        else score = dk;
        if (score >= bs) continue;
        if (R.placementProblem(this.team, id, x0, y0)) continue;
        // leave room to walk around buildings
        if (id !== 'wall' && this.crowded(x0, y0, def.w, def.h)) continue;
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
    // require a free ring of tiles on at least 3 sides
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

  stance() {
    const R = this.R;
    const p = this.me;
    if (this.diffId === 'tutorial') return;
    // gentle rivals keep their warriors home until the Age of War
    if (this.diffId === 'easy' && R.ageIdx < 2) return R.setStance(this.team, 'guard');
    if (R.ageIdx < 1 && R.time < 120) return R.setStance(this.team, 'guard');
    const enough = p.warriors >= (R.ageIdx >= 3 ? 3 : R.ageIdx >= 2 ? 4 : 6);
    if (p.stance === 'guard' && enough && !this.threats()) {
      R.setStance(this.team, 'charge');
      this.chargeUntil = R.time + 35;
    } else if (p.stance === 'charge' && (p.warriors < 2 || R.time > this.chargeUntil)) {
      R.setStance(this.team, 'guard');
    }
  }

  // ───────────────────────── hero ─────────────────────────

  driveHero() {
    const R = this.R;
    const p = this.me;
    const h = p.hero;
    if (!h || !h.alive) return;
    const k = p.keep;
    const th = this.threats();
    // spells & gadget
    if (this.diff.heroSpells) {
      const near = this.clusterAt(h.x, h.y, 3.2);
      for (let i = 0; i < 2; i++) {
        if (spellReady(h, i) && (near.value >= 2 || (h.hp < h.maxHp * 0.4 && near.value >= 1))) {
          R.heroSpell(this.team, i);
          break;
        }
      }
      if (gadgetReady(h) && (h.gadget === 'medkit' ? h.hp < h.maxHp * 0.5 : near.value >= 2)) R.heroGadget(this.team);
    }
    // retreat when hurt
    if (h.hp < h.maxHp * 0.3 && k) {
      if (dist2(h.x, h.y, k.x, k.y) > 9) R.heroMove(this.team, k.x, k.y + (this.team === 0 ? 2 : -2));
      return;
    }
    // defend home
    if (th && th.value >= 1.5) {
      const tgt = th.list.reduce((a, b) => (dist2(a.x, a.y, h.x, h.y) < dist2(b.x, b.y, h.x, h.y) ? a : b));
      if (h.focus !== tgt) R.heroFocus(this.team, tgt);
      return;
    }
    // grab relics
    const relic = R.pickups.find((pk) => pk.alive && pk.type === 'relic' && dist2(pk.x, pk.y, h.x, h.y) < 20 * 20);
    if (relic) {
      R.heroMove(this.team, relic.x, relic.y);
      return;
    }
    // clear the closest nest once the hero is strong enough
    if (R.ageIdx >= 1 && h.hp > h.maxHp * 0.65) {
      const nest = R.nests.filter((n) => n.alive).sort((a, b) => dist2(a.x, a.y, k.x, k.y) - dist2(b.x, b.y, k.x, k.y))[0];
      if (nest && dist(nest.x, nest.y, k.x, k.y) < 26 && (h.form >= 2 || R.ageIdx >= 2)) {
        if (h.focus !== nest) R.heroFocus(this.team, nest);
        return;
      }
    }
    // take the shrine
    if (R.shrine && R.shrine.team !== this.team && R.ageIdx >= 1 && h.hp > h.maxHp * 0.6) {
      if (dist2(h.x, h.y, R.shrine.x, R.shrine.y) > 4) R.heroMove(this.team, R.shrine.x, R.shrine.y + (this.team === 0 ? 1.8 : -1.8));
      return;
    }
    // join a charge, otherwise guard the frontier
    if (p.stance === 'charge') {
      const tgt = R.nearestEnemyBuilding(this.team, h.x, h.y);
      if (tgt && h.focus !== tgt) R.heroFocus(this.team, tgt);
      return;
    }
    if (!h.moveTo && !h.focus && R.rng.chance(0.15)) {
      const ek = this.enemy?.keep;
      const g = ek ? this.frontier(ek.x, ek.y) : null;
      if (g) R.heroMove(this.team, g.x + (R.rng.next() - 0.5) * 3, g.y + (this.team === 0 ? 1.5 : -1.5));
    }
  }
}

export { AGES };
