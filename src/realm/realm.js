// Realm Clash: a living island, two villages, two heroes and two gods' decks. Extends the battle simulation so all
// combat, hero, spell and card code is shared. See docs/DESIGN.md.

import { Battle, STEP } from '../battle/battle.js';
import { clamp, dist, dist2 } from '../core/util.js';
import { CARDS, EXTRA_UNITS, levelMult } from '../data/cards.js';
import { ELEMENTS } from '../data/heroes.js';
import { kingMult } from '../data/progression.js';
import { tickStatus, damage, kill, updateProjectiles, updateAreas, isBuildingKind } from '../battle/combat.js';
import { updateTroop, updateBuilding, updateTower, separate, findTarget } from '../battle/units.js';
import { updateHero, updatePet, createHero, createPet } from '../battle/hero.js';
import {
  REALM_W, REALM_H, T, BLOCKING, BUILDABLE, TILE_SPEED, WILD, MATCH_LENGTH, AGES, ageIndexAt, DAY_LENGTH, NIGHT_LENGTH,
  FAITH_MAX, FAITH_START, FAITH_BASE, FAITH_PER_VILLAGER, FAITH_PER_TEMPLE, FAITH_SHRINE, BRICKS_START, BRICK_TRICKLE,
  VILLAGER_EVERY, KEEP_POP, HOUSE_POP, START_VILLAGERS, HERO_RESPAWN, HERO_KILL_BRICKS, NEST_BRICKS, SUMMON_HERO_RADIUS,
  ELEMENT_COST, VILLAGER, WARRIOR, STRUCTURES, BARRACKS_EVERY, BARRACKS_MAX, NEST, MONSTERS, RELICS, DOMINION,
} from './constants.js';
import { generateRealm } from './worldgen.js';
import { Grid, computeTerritory } from './grid.js';
import { updateVillager, assignJobs } from './village.js';

// realm-only unit types join the shared unit table so spawnUnit() can build them
Object.assign(EXTRA_UNITS, {
  warrior: WARRIOR,
  wolf: MONSTERS.wolf,
  bandit: MONSTERS.bandit,
  wild_skeleton: MONSTERS.skeleton,
});

const WATER_TILES = new Set([T.DEEP, T.WATER, T.LAVA]);

export { STEP };

export class Realm extends Battle {
  /**
   * @param {{ mode?: 'clash'|'horde'|'training', arena: object, players: [object, object|null], seed?: number, audio?: any,
   *   settings?: object, matchTime?: number }} opts
   */
  constructor(opts) {
    super({ ...opts, mode: opts.mode || 'clash', matchTime: opts.matchTime ?? MATCH_LENGTH });
  }

  // ───────────────────────── world setup ─────────────────────────

  initWorld(opts) {
    this.isRealm = true;
    const seed = this.rng.seed || opts.seed || 1;
    this.map = generateRealm({ seed, biome: opts.arena?.biome || 'meadow' });
    this.W = this.map.w;
    this.H = this.map.h;
    this.tiles = this.map.tiles;
    this.origForest = new Uint8Array(this.W * this.H);
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === T.FOREST) this.origForest[i] = 1;
    this.regrowT = new Float32Array(this.W * this.H);
    this.grid = new Grid(this.W, this.H, this.tiles);
    this.owner = new Int8Array(this.W * this.H).fill(-1);
    this.territoryDirty = true;
    this.territoryT = 0;
    this.territoryVersion = 0;
    this.tileChanges = [];
    this.piles = [];
    this.deposits = this.map.deposits.map((d, i) => ({ id: i + 1, ...d, max: d.amount }));
    this.structures = [];
    this.pickups = [];
    this.ageIdx = 0;
    this.night = false;
    this.nightK = 0; // 0 day .. 1 night, eased for the renderer
    this.disasterT = 14;
    this.matchLength = MATCH_LENGTH;
    this.pathBudget = 0;
    this.dominion = [0, 0];
    this.dominionT = 0;
    this.shrine = null;
    this.nests = [];
    this.pending = [];
    this.warnings = [];
  }

  makePlayer(team, setup) {
    const p = super.makePlayer(team, setup);
    p.elixir = FAITH_START; // Faith is stored where the shared card code expects it
    p.bricks = BRICKS_START;
    p.keep = null;
    p.villagerT = 3;
    p.pop = 0;
    p.popCap = KEEP_POP;
    p.villagers = 0;
    p.warriors = 0;
    p.stance = 'guard';
    p.perks = {};
    p.relics = [];
    p.faithRate = FAITH_BASE;
    p.destroyed = 0;
    p.jobT = 0;
    Object.assign(p.stats, { built: 0, relics: 0, nests: 0, destroyed: 0, villagers: 0, warriors: 0, shrine: 0 });
    return p;
  }

  setupSides() {
    const m = this.map;
    for (let team = 0; team < 2; team++) {
      const p = this.players[team];
      if (!p) continue;
      const k = m.keeps[team];
      const keep = this.placeStructure(team, 'keep', Math.floor(k.x) - 1, Math.floor(k.y) - 1, { instant: true });
      keep.hp = keep.maxHp = STRUCTURES.keep.hp * kingMult(p.kingLevel);
      keep.dmg = STRUCTURES.keep.dmg * kingMult(p.kingLevel);
      p.keep = keep;
      for (let i = 0; i < START_VILLAGERS; i++) {
        const a = (i / START_VILLAGERS) * Math.PI * 2;
        this.spawnVillager(team, keep.x + Math.cos(a) * 2.2, keep.y + Math.sin(a) * 2.2 + (team === 0 ? -0.5 : 0.5));
      }
      if (p.setup.heroId) this.spawnHero(team);
    }
    // neutral shrine in the centre
    const sh = m.shrine;
    this.shrine = this.placeStructure(-1, 'shrine', Math.floor(sh.x) - 1, Math.floor(sh.y) - 1, { instant: true });
    for (const n of m.nests) this.spawnNest(n.x, n.y, n.kind);
    for (const c of m.critters) this.spawnCritter(c.x, c.y);
    this.recomputeTerritory();
  }

  // ───────────────────────── structures ─────────────────────────

  /** Footprint top-left tile for a structure centred near (x, y). */
  footprintAt(id, x, y) {
    const d = id === 'shrine' ? { w: 2, h: 2 } : id === 'nest' ? { w: 2, h: 1 } : STRUCTURES[id];
    return { x0: Math.round(x - d.w / 2), y0: Math.round(y - d.h / 2), w: d.w, h: d.h };
  }

  /** Can `team` place structure `id` with its footprint's top-left at (x0, y0)? Returns a reason string or null. */
  placementProblem(team, id, x0, y0) {
    const def = STRUCTURES[id];
    if (!def) return 'unknown';
    for (let y = y0; y < y0 + def.h; y++) {
      for (let x = x0; x < x0 + def.w; x++) {
        if (!this.grid.inside(x, y)) return 'edge';
        const i = y * this.W + x;
        if (!BUILDABLE.has(this.tiles[i])) return 'terrain';
        if (this.grid.occ[i] !== 0) return 'occupied';
        if (this.owner[i] !== team) return 'territory';
        if (this.fireGrid[i] > 0) return 'fire';
      }
    }
    for (const d of this.deposits) {
      if (d.amount <= 0) continue;
      if (d.x >= x0 - 0.5 && d.x <= x0 + def.w + 0.5 && d.y >= y0 - 0.5 && d.y <= y0 + def.h + 0.5) return 'deposit';
    }
    // do not wall in a keep completely: keep the tiles right around keeps free of walls
    if (id === 'wall') {
      for (const p of this.players) {
        const k = p?.keep;
        if (k && Math.abs(x0 + 0.5 - k.x) < 2.6 && Math.abs(y0 + 0.5 - k.y) < 2.6) return 'too close';
      }
    }
    return null;
  }

  /** Spend bricks and put down a scaffold (villagers build it). */
  orderBuild(team, id, x0, y0) {
    const p = this.players[team];
    const def = STRUCTURES[id];
    if (!p || !def || id === 'keep') return { ok: false, reason: 'unknown' };
    if (this.phase !== 'play') return { ok: false, reason: 'not-started' };
    if (p.bricks < def.cost) return { ok: false, reason: 'bricks' };
    const prob = this.placementProblem(team, id, x0, y0);
    if (prob) return { ok: false, reason: prob };
    p.bricks -= def.cost;
    const s = this.placeStructure(team, id, x0, y0, {});
    this.dust(s.x, s.y + 0.3, 1);
    this.sfx('build', { volume: 0.6, pitch: 1.2 });
    this.emit('order', { team, id, s });
    return { ok: true, s };
  }

  placeStructure(team, id, x0, y0, { instant = false } = {}) {
    const isShrine = id === 'shrine';
    const def = isShrine ? { name: 'Shrine', w: 2, h: 2, hp: 1, claim: 5, build: 0, sprite: 'temple' } : STRUCTURES[id];
    const relHp = team >= 0 && this.players[team]?.perks.walls ? 1.25 : 1;
    const hp = def.hp * relHp;
    const tower = id === 'keep' || id === 'tower';
    const e = {
      id: this.nextId++,
      kind: tower ? 'tower' : 'building',
      type: id === 'keep' ? 'king' : id === 'tower' ? 'princess' : undefined,
      struct: id,
      cardId: null,
      sprite: def.sprite,
      team,
      x: x0 + def.w / 2,
      y: y0 + def.h / 2,
      r: Math.max(def.w, def.h) * 0.5 * (def.w === 1 ? 0.9 : 0.78),
      h: id === 'keep' ? 2.6 : id === 'tower' ? 2.4 : id === 'wall' ? 1 : 1.5,
      fp: { x0, y0, w: def.w, h: def.h },
      hp: instant ? hp : Math.max(1, hp * 0.1),
      maxHp: hp,
      built: instant ? 1 : 0,
      buildTime: def.build,
      claim: def.claim,
      dmg: def.dmg || 0,
      hs: def.hs || 1,
      range: def.range || 0,
      targets: def.dmg ? 'both' : 'none',
      proj: id === 'keep' ? 'brick' : 'arrow',
      splash: 0,
      special: {},
      alive: true,
      active: true,
      activateT: 0,
      deployT: 0,
      status: {},
      flash: 0,
      attackCd: 0.6,
      shield: 0,
      element: null,
      level: 1,
      anim: 'idle',
      mass: 999,
      isWall: id === 'wall',
      age: 0,
      costShare: (def.cost || 20) / 10,
      untargetable: isShrine,
      workers: 0,
      trainT: BARRACKS_EVERY * 0.5,
    };
    if (isShrine) {
      e.capTeam = -1;
      e.capProg = 0;
    }
    this.entities.push(e);
    if (tower) this.towers.push(e);
    this.structures.push(e);
    this.grid.setFootprint(x0, y0, def.w, def.h, team, e.id, e.isWall);
    if (instant) this.territoryDirty = true;
    return e;
  }

  /** Called by villagers as they build. */
  advanceBuild(s, amount) {
    if (s.built >= 1 || !s.alive) return;
    const before = s.built;
    s.built = Math.min(1, s.built + amount);
    s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.9 * (s.built - before));
    if (s.built >= 1) {
      s.hp = Math.max(s.hp, s.maxHp * 0.92);
      this.territoryDirty = true;
      this.puff(s.x, s.y, '#e8dcc0', 10);
      this.sparkle(s.x, s.y - 0.6, 1.2, '#ffe9a8', 12);
      this.sfx('build');
      const p = this.players[s.team];
      if (p) p.stats.built++;
      this.emit('built', { team: s.team, s });
    }
  }

  freeStructure(s) {
    this.grid.setFootprint(s.fp.x0, s.fp.y0, s.fp.w, s.fp.h, null, s.id);
    this.structures = this.structures.filter((o) => o !== s);
    this.territoryDirty = true;
  }

  structuresOf(team, id = null, builtOnly = true) {
    return this.structures.filter((s) => s.alive && s.team === team && (!id || s.struct === id) && (!builtOnly || s.built >= 1));
  }

  // ───────────────────────── units ─────────────────────────

  spawnVillager(team, x, y) {
    const v = {
      id: this.nextId++,
      kind: 'villager',
      sprite: 'villager',
      team,
      x: clamp(x, 0.5, this.W - 0.5),
      y: clamp(y, 0.5, this.H - 0.5),
      r: VILLAGER.radius,
      h: 0.8,
      hp: VILLAGER.hp,
      maxHp: VILLAGER.hp,
      dmg: VILLAGER.dmg,
      hs: VILLAGER.hs,
      speed: VILLAGER.speed,
      range: VILLAGER.range,
      targets: 'ground',
      alive: true,
      deployT: 0,
      status: {},
      flash: 0,
      facing: 1,
      anim: 'idle',
      age: Math.random() * 3,
      attackCd: 0,
      shield: 0,
      mass: 1,
      job: 'idle',
      state: null,
      carry: 0,
      level: 1,
      lvlMult: 1,
      costShare: 2,
      special: {},
    };
    this.entities.push(v);
    this.landSafely(v);
    const p = this.players[team];
    if (p) p.stats.villagers++;
    return v;
  }

  spawnNest(x, y, kind) {
    const fp = this.footprintAt('nest', x, y);
    const e = {
      id: this.nextId++,
      kind: 'building',
      struct: 'nest',
      nestKind: kind,
      sprite: 'nest',
      team: WILD,
      x: fp.x0 + 1,
      y: fp.y0 + 0.5,
      fp,
      r: 0.85,
      h: 1,
      hp: NEST.hp,
      maxHp: NEST.hp,
      built: 1,
      dmg: 0,
      hs: 1,
      range: 0,
      targets: 'none',
      special: {},
      alive: true,
      deployT: 0,
      status: {},
      flash: 0,
      attackCd: 0,
      shield: 0,
      anim: 'idle',
      mass: 999,
      age: Math.random() * 3,
      spawnT: 2,
      guards: [],
      costShare: 4,
      level: 1,
    };
    this.entities.push(e);
    this.nests.push(e);
    this.grid.setFootprint(fp.x0, fp.y0, fp.w, fp.h, WILD, e.id);
    return e;
  }

  spawnMonster(kind, x, y, extra = {}) {
    const id = kind === 'skeleton' ? 'wild_skeleton' : kind;
    const age = this.ageIdx;
    const u = this.spawnUnit(WILD, id, x, y, 1 + age, { deployT: 0.4, ...extra });
    if (u) {
      u.role = 'monster';
      u.facing = 1;
    }
    return u;
  }

  spawnCritter(x, y) {
    const c = {
      id: this.nextId++,
      kind: 'critter',
      sprite: 'sheep',
      team: WILD,
      x,
      y,
      hx: x,
      hy: y,
      r: 0.3,
      h: 0.6,
      hp: 1,
      maxHp: 1,
      speed: 0.7,
      alive: true,
      deployT: 0,
      status: {},
      flash: 0,
      facing: 1,
      anim: 'idle',
      age: Math.random() * 5,
      untargetable: true,
      noCollide: true,
      wanderT: Math.random() * 4,
    };
    this.entities.push(c);
    return c;
  }

  spawnPickup(type, x, y, extra = {}) {
    const p = { id: this.nextId++, kind: 'pickup', type, x, y, r: 0.3, h: 0.4, team: -1, alive: true, untargetable: true, noCollide: true, status: {}, age: 0, deployT: 0, ...extra };
    this.entities.push(p);
    this.pickups.push(p);
    return p;
  }

  /** Card buildings and spell walls also block tiles in the realm. */
  spawnBuilding(team, cardOrId, x, y, level = 1, extra = {}) {
    const b = super.spawnBuilding(team, cardOrId, x, y, level, extra);
    if (!b) return b;
    const tx = Math.floor(b.x);
    const ty = Math.floor(b.y);
    if (this.grid.inside(tx, ty) && this.grid.occ[ty * this.W + tx] === 0) {
      b.fp = { x0: tx, y0: ty, w: 1, h: 1 };
      this.grid.setFootprint(tx, ty, 1, 1, team, b.id, !!b.isWall);
    }
    return b;
  }

  spawnUnit(team, cardOrUnitId, x, y, level = 1, extra = {}) {
    const u = super.spawnUnit(team, cardOrUnitId, x, y, level, extra);
    if (u && (team === 0 || team === 1) && this.players[team]?.perks.hymn) u.dmg *= 1.15;
    if (u) this.landSafely(u);
    return u;
  }

  spawnHero(team) {
    const h = super.spawnHero(team);
    if (this.players[team]?.perks.might) h.dmgBoost = 1.2;
    return h;
  }

  // ───────────────────────── cards ─────────────────────────

  tileOwner(x, y) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return -1;
    return this.owner[ty * this.W + tx];
  }

  /** Is (x, y) a legal summon spot for `team`? */
  summonOk(team, x, y, flying = false) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!this.grid.inside(tx, ty)) return false;
    const i = ty * this.W + tx;
    if (!flying && this.grid.occ[i] !== 0) return false;
    if (flying && this.grid.occ[i] !== 0 && this.grid.occ[i] !== 1) return false;
    if (this.wasteGrid[i] > 0) return false;
    if (this.owner[i] === team) return true;
    const h = this.players[team]?.hero;
    return !!(h && h.alive && dist(h.x, h.y, x, y) <= SUMMON_HERO_RADIUS);
  }

  previewPlacement(team, cardId, x, y) {
    const card = CARDS[cardId];
    if (!card) return null;
    const px = clamp(x, 0.5, this.W - 0.5);
    const py = clamp(y, 0.5, this.H - 0.5);
    if (card.type === 'spell') return { x: px, y: py };
    const flying = card.type === 'troop' && !!card.unit.flying;
    const building = card.type === 'building';
    const ok = (ax, ay) => {
      if (!this.summonOk(team, ax, ay, flying)) return false;
      if (building && (this.tileOwner(ax, ay) !== team || !BUILDABLE.has(this.tiles[Math.floor(ay) * this.W + Math.floor(ax)]))) return false;
      return true;
    };
    if (ok(px, py)) return { x: px, y: py };
    // snap to the closest legal tile nearby
    let best = null;
    let bd = 2.6 * 2.6;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const ax = Math.floor(px) + dx + 0.5;
        const ay = Math.floor(py) + dy + 0.5;
        const d = dist2(ax, ay, px, py);
        if (d < bd && ok(ax, ay)) {
          bd = d;
          best = { x: ax, y: ay };
        }
      }
    }
    return best;
  }

  deploy(team, card, x, y, level) {
    if (card.type === 'troop' && card.unit.special?.builder) {
      const n = Math.max(2, card.unit.count || 1);
      for (let i = 0; i < n; i++) this.spawnVillager(team, x + (i - (n - 1) / 2) * 0.7, y);
      this.sparkle(x, y - 0.4, 1, '#ffe9a8', 12);
      this.sfx('deploy');
      return;
    }
    super.deploy(team, card, x, y, level);
  }

  // ───────────────────────── orders ─────────────────────────

  heroJoy(team, x, y) {
    const h = this.players[team]?.hero;
    if (!h) return;
    h.joy = x == null ? null : { x, y };
    if (h.joy) {
      h.moveTo = null;
      h.focus = null;
    }
  }

  setStance(team, stance) {
    const p = this.players[team];
    if (!p || p.stance === stance) return;
    p.stance = stance;
    this.emit('stance', { team, stance });
    if (stance === 'charge') this.sfx('fight', { volume: 0.6, pitch: 0.8 });
    else this.sfx('ui_back', { volume: 0.5 });
  }

  canElementTower(team, tower) {
    return tower && tower.alive && tower.team === team && tower.struct === 'tower' && tower.built >= 1 && !tower.element && this.players[team].bricks >= ELEMENT_COST;
  }

  emote(team, id) {
    const k = this.players[team]?.keep;
    const x = k ? k.x : this.W / 2;
    const y = k ? k.y - 3.2 : 10;
    this.emotes = this.emotes.filter((e) => e.team !== team);
    this.emotes.push({ team, id, x, y, t: 2.2, max: 2.2 });
    this.sfx(id === 'baa' ? 'sheep' : 'emote', { volume: 0.6 });
  }

  // ───────────────────────── map hooks used by the shared unit code ─────────────────────────

  speedAt(x, y) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return 1;
    return TILE_SPEED[this.tiles[ty * this.W + tx]] || 1;
  }

  blockedAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return true;
    return BLOCKING.has(this.tiles[ty * this.W + tx]);
  }

  /** Push a ground unit out of water, rock and other impassable terrain. */
  constrain(e) {
    if (e.flying || e.jumping || e.kind === 'tower' || e.kind === 'building' || e.noCollide) return;
    const tx = Math.floor(e.x);
    const ty = Math.floor(e.y);
    if (!this.blockedAt(tx, ty)) {
      // keep a little distance from blocked neighbours so bodies do not overlap the shore
      const m = 0.22;
      const fx = e.x - tx;
      const fy = e.y - ty;
      if (fx < m && this.blockedAt(tx - 1, ty)) e.x = tx + m;
      else if (fx > 1 - m && this.blockedAt(tx + 1, ty)) e.x = tx + 1 - m;
      if (fy < m && this.blockedAt(tx, ty - 1)) e.y = ty + m;
      else if (fy > 1 - m && this.blockedAt(tx, ty + 1)) e.y = ty + 1 - m;
      return;
    }
    this.landSafely(e);
  }

  /** Move an entity standing on blocked terrain to the closest open tile. */
  landSafely(e) {
    const tx = Math.floor(e.x);
    const ty = Math.floor(e.y);
    if (!this.blockedAt(tx, ty)) return;
    let best = null;
    let bd = Infinity;
    for (let r = 1; r <= 6 && !best; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = tx + dx;
          const ny = ty + dy;
          if (this.blockedAt(nx, ny)) continue;
          const cx = clamp(e.x, nx + 0.25, nx + 0.75);
          const cy = clamp(e.y, ny + 0.25, ny + 0.75);
          const d = dist2(cx, cy, e.x, e.y);
          if (d < bd) {
            bd = d;
            best = { x: cx, y: cy };
          }
        }
      }
    }
    if (best) {
      e.x = best.x;
      e.y = best.y;
    }
  }

  /** Waypoint toward (tx, ty) with cached A* paths for ground units. */
  routeTo(e, tx, ty) {
    if (e.flying || e.jumping || e.kind === 'hero' && e.dash) return { x: tx, y: ty };
    const team = e.team;
    let p = e.path;
    const goalMoved = !p || Math.abs(p.gx - tx) + Math.abs(p.gy - ty) > (p.direct ? 0.6 : 1.8);
    if (goalMoved || this.time > p.t + (p.direct ? 0.8 : 2.2) || p.i >= p.pts.length) {
      if (this.grid.lineClear(e.x, e.y, tx, ty, team)) {
        p = { gx: tx, gy: ty, t: this.time, pts: [{ x: tx, y: ty }], i: 0, direct: true };
      } else if (this.pathBudget > 0) {
        this.pathBudget--;
        const pts = this.grid.findPath(e.x, e.y, tx, ty, team, 1800);
        p = { gx: tx, gy: ty, t: this.time + Math.random() * 0.4, pts: pts && pts.length ? pts : [{ x: tx, y: ty }], i: 0, direct: !pts };
      } else if (!p) {
        return { x: tx, y: ty };
      }
      e.path = p;
    }
    // advance past reached waypoints
    while (p.i < p.pts.length - 1 && dist2(e.x, e.y, p.pts[p.i].x, p.pts[p.i].y) < 0.36 * 0.36) p.i++;
    const wp = p.pts[Math.min(p.i, p.pts.length - 1)];
    if (p.i >= p.pts.length - 1) return { x: tx, y: ty };
    // a stuck unit (pushed back by a crowd or a wall) re-plans sooner
    return wp;
  }

  /** Where units go when nothing is in sight (re-decided twice a second). */
  unitGoal(e) {
    if (e.goalCache && this.time < e.goalT && (!e.goalCache.kind || e.goalCache.alive)) return e.goalCache;
    e.goalCache = this.decideGoal(e);
    e.goalT = this.time + 0.5 + Math.random() * 0.2;
    return e.goalCache;
  }

  decideGoal(e) {
    if (e.team === WILD) return this.wildGoal(e);
    const p = this.players[e.team];
    const enemy = 1 - e.team;
    if (e.role === 'warrior' && p?.stance !== 'charge') {
      // guard: hunt intruders inside our land, otherwise hold near home
      const intruder = this.nearestIntruder(e.team, e.x, e.y);
      if (intruder) return intruder;
      if (!e.post || this.time > e.postT) {
        const anchor = this.guardAnchor(e.team, e);
        const a = Math.random() * Math.PI * 2;
        e.post = { x: anchor.x + Math.cos(a) * 2.5, y: anchor.y + Math.sin(a) * 2 };
        e.postT = this.time + 6 + Math.random() * 4;
        this.landSafely(e.post);
      }
      return e.post;
    }
    const target = this.nearestEnemyBuilding(e.team, e.x, e.y);
    if (target) return target;
    const ek = this.players[enemy]?.keep;
    return ek && ek.alive ? ek : { x: e.x, y: e.y };
  }

  guardAnchor(team, e) {
    const towers = this.structuresOf(team, 'tower');
    const k = this.players[team].keep;
    // spread guards between the keep and the towers that face the enemy
    const pool = [k, ...towers].filter(Boolean);
    return pool[(e.id || 0) % pool.length] || { x: this.W / 2, y: this.H / 2 };
  }

  nearestIntruder(team, x, y) {
    let best = null;
    let bd = Infinity;
    for (const o of this.entities) {
      if (!o.alive || o.team === team || o.untargetable || o.kind === 'critter' || o.kind === 'pickup' || isBuildingKind(o)) continue;
      if (o.status?.invisible > 0) continue;
      if (this.tileOwner(o.x, o.y) !== team) continue;
      const d = dist2(o.x, o.y, x, y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Closest building of the other village (nests and walls are never a march goal). */
  nearestEnemyBuilding(team, x, y) {
    let best = null;
    let bd = Infinity;
    for (const s of this.entities) {
      if (!s.alive || !isBuildingKind(s) || s.team === team || s.team === WILD || s.untargetable || s.isWall) continue;
      const d = dist2(s.x, s.y, x, y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  wildGoal(e) {
    if (e.raid) {
      const t = this.nearestEnemyBuilding(WILD, e.x, e.y);
      const tt = e.raid.team;
      let best = null;
      let bd = Infinity;
      for (const s of this.structures) {
        if (!s.alive || s.team !== tt || s.isWall) continue;
        const d = dist2(s.x, s.y, e.x, e.y);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best || t || { x: e.x, y: e.y };
    }
    const nest = e.nest;
    if (!nest || !nest.alive) return { x: e.x, y: e.y };
    if (!e.post || this.time > e.postT || dist2(e.x, e.y, nest.x, nest.y) > NEST.leash * NEST.leash) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 2.5;
      e.post = { x: nest.x + Math.cos(a) * r, y: nest.y + 1 + Math.sin(a) * r };
      this.landSafely(e.post);
      e.postT = this.time + 3 + Math.random() * 4;
    }
    return e.post;
  }

  canBurn(tx, ty) {
    const t = this.tiles[ty * this.W + tx];
    return !WATER_TILES.has(t) && t !== T.MOUNTAIN && t !== T.CRYSTAL;
  }

  // ───────────────────────── economy ─────────────────────────

  addElixir(team, n, x, y) {
    const p = this.players[team];
    if (!p) return;
    p.elixir = Math.min(FAITH_MAX, p.elixir + n);
    if (x != null) this.floatText(x, y, `+${n}`, '#ffd96a', 1.1);
  }

  dropOffs(team) {
    return this.structures.filter((s) => s.alive && s.team === team && s.built >= 1 && (s.struct === 'keep' || s.struct === 'outpost'));
  }

  workMult(team) {
    return this.players[team]?.perks.swift ? 1.4 : 1;
  }

  // ───────────────────────── events from combat ─────────────────────────

  onTowerDestroyed(t, src) {
    const enemy = 1 - t.team;
    this.freeStructure(t);
    this.puff(t.x, t.y - 1, '#d9c7a8', 30);
    this.explosion(t.x, t.y - 1, 2.2, '#ffb347');
    this.shake(0.8);
    this.sfx('tower_destroy');
    const scorer = this.players[enemy];
    if (scorer && t.built >= 1) {
      scorer.destroyed++;
      scorer.stats.destroyed++;
      scorer.stats.towers++;
      this.addBricks(enemy, t.struct === 'keep' ? 0 : 30, t.x, t.y - 1.5);
    }
    if (t.built >= 1) this.emit('crown', { team: enemy, tower: t });
    if (t.struct === 'keep') {
      this.whiteFlash = 0.6;
      this.finish(enemy, 'keep');
    }
  }

  onHeroDeath(h, src) {
    const p = this.players[h.team];
    this.puff(h.x, h.y - 0.4, '#ffffff', 16);
    this.sfx('hero_die');
    p.heroRespawnT = HERO_RESPAWN;
    h.channel = null;
    if (p.pet) p.pet.alive = false;
    const enemy = 1 - h.team;
    if (this.players[enemy]) {
      this.addBricks(enemy, HERO_KILL_BRICKS, h.x, h.y - 1);
      if (src) this.stat(enemy, 'kills', 1);
    }
    this.emit('heroDeath', { team: h.team });
  }

  kingAlive(team) {
    return !!this.players[team]?.keep?.alive;
  }

  onKill(e, src) {
    const killer = src?.team;
    if (e.kind === 'villager') {
      if ((killer === 0 || killer === 1) && killer !== e.team) this.addBricks(killer, 3, e.x, e.y);
      this.emit('villagerLost', { team: e.team });
    }
    if (e.struct === 'nest') {
      this.grid.setFootprint(e.fp.x0, e.fp.y0, e.fp.w, e.fp.h, null, e.id);
      this.nests = this.nests.filter((n) => n !== e);
      this.explosion(e.x, e.y - 0.4, 1.6, '#c46a3a');
      this.spawnPickup('relic', e.x, e.y + 0.2);
      if (killer === 0 || killer === 1) {
        this.addBricks(killer, NEST_BRICKS, e.x, e.y - 1);
        this.players[killer].stats.nests++;
      }
      this.emit('nestCleared', { team: killer, nest: e });
      this.sfx('chest_open', { volume: 0.6 });
      return;
    }
    if (e.struct) {
      this.freeStructure(e);
      if ((killer === 0 || killer === 1) && killer !== e.team) {
        const p = this.players[killer];
        if (e.built >= 1 && !e.isWall) {
          p.destroyed++;
          p.stats.destroyed++;
          this.addBricks(killer, Math.round((STRUCTURES[e.struct]?.cost || 10) * 0.5), e.x, e.y - 1);
        }
      }
      this.emit('structureLost', { team: e.team, s: e });
      return;
    }
    if (e.kind === 'building' && e.fp) this.grid.setFootprint(e.fp.x0, e.fp.y0, 1, 1, null, e.id);
    // temples reward kills on holy ground
    if (e.kind === 'troop' && (killer === 0 || killer === 1) && killer !== e.team && this.tileOwner(e.x, e.y) === killer) {
      if (this.structuresOf(killer, 'temple').length) this.addElixir(killer, 0.5);
    }
  }

  // ───────────────────────── main loop ─────────────────────────

  step(dt = STEP) {
    if (this.phase === 'ended') {
      this.updateFx(dt);
      return;
    }
    if (this.paused) return;
    if (this.phase === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0) {
        this.emit('countdown', after);
        this.sfx('countdown');
      }
      if (this.countdown <= 0) {
        this.phase = 'play';
        this.emit('age', { idx: 0, age: AGES[0] });
        this.emit('banner', { text: AGES[0].name.toUpperCase(), sub: AGES[0].blurb, kind: 'age' });
        this.sfx('fight');
      }
      this.updateFx(dt);
      return;
    }
    this.time += dt;
    this.pathBudget = 10;
    this.tickClock(dt);
    if (this.phase === 'ended') return;
    if (this.territoryDirty) {
      this.territoryT -= dt;
      if (this.territoryT <= 0) this.recomputeTerritory();
    }
    this.countAll();
    for (let team = 0; team < 2; team++) this.tickPlayer(team, dt);
    this.ai?.forEach((a) => a?.update(dt));
    this.horde?.update(dt);
    this.tutorial?.update(dt);
    this.tickWild(dt);
    this.tickShrine(dt);

    for (const e of this.entities) {
      if (!e.alive) continue;
      if (e.kind !== 'pickup' && e.kind !== 'critter') tickStatus(this, e, dt);
      if (!e.alive) continue;
      switch (e.kind) {
        case 'troop':
          updateTroop(this, e, dt);
          break;
        case 'building':
          if (e.struct) this.updateStructure(e, dt);
          else updateBuilding(this, e, dt);
          break;
        case 'tower':
          if (e.built >= 1) updateTower(this, e, dt);
          break;
        case 'hero':
          if (e.alive) updateHero(this, e, dt);
          break;
        case 'pet':
          updatePet(this, e, dt);
          break;
        case 'villager':
          updateVillager(this, e, dt);
          break;
        case 'critter':
          this.updateCritter(e, dt);
          break;
        case 'pickup':
          this.updatePickup(e, dt);
          break;
        default:
          break;
      }
    }
    this.tickGround(dt);
    separate(this);
    updateProjectiles(this, dt);
    updateAreas(this, dt);
    let dead = false;
    for (const e of this.entities) if (!e.alive && e.kind !== 'hero') dead = true;
    if (dead) {
      this.entities = this.entities.filter((e) => e.alive || e.kind === 'hero');
      this.towers = this.towers.filter((t) => t.alive);
      this.pickups = this.pickups.filter((p) => p.alive);
    }
    this.dominionT -= dt;
    if (this.dominionT <= 0) {
      this.dominionT = 0.5;
      this.computeDominion();
    }
    this.updateFx(dt);
  }

  /** One pass over entities and structures for the per-frame counters. */
  countAll() {
    const c = (this.counts ||= [{}, {}]);
    for (const t of c) {
      t.villagers = 0;
      t.warriors = 0;
      t.house = 0;
      t.temple = 0;
      t.prayed = 0;
    }
    const homes = (this.barracksPop ||= new Map());
    homes.clear();
    for (const e of this.entities) {
      if (!e.alive || (e.team !== 0 && e.team !== 1)) continue;
      if (e.kind === 'villager') c[e.team].villagers++;
      else if (e.role === 'warrior') {
        c[e.team].warriors++;
        homes.set(e.home, (homes.get(e.home) || 0) + 1);
      }
    }
    for (const s of this.structures) {
      if (!s.alive || s.built < 1 || (s.team !== 0 && s.team !== 1)) continue;
      if (s.struct === 'house') c[s.team].house++;
      else if (s.struct === 'temple') {
        c[s.team].temple++;
        if (s.prayed > this.time - 1.5) c[s.team].prayed++;
      }
    }
  }

  tickPlayer(team, dt) {
    const p = this.players[team];
    if (!p) return;
    const c = this.counts[team];
    // population
    const villagers = c.villagers;
    p.villagers = villagers;
    p.warriors = c.warriors;
    p.pop = villagers + c.warriors;
    const houses = c.house;
    p.popCap = KEEP_POP + houses * HOUSE_POP + (p.perks.fertile || 0) * 4;
    // faith
    const temples = c.prayed;
    const shrine = this.shrine?.team === team ? FAITH_SHRINE : 0;
    let rate = FAITH_BASE + villagers * FAITH_PER_VILLAGER + temples * FAITH_PER_TEMPLE + shrine;
    if (p.perks.holy) rate *= 1.25;
    if (this.ageIdx >= 3) rate *= 2;
    p.faithRate = rate;
    p.elixir = Math.min(FAITH_MAX, p.elixir + rate * dt);
    // bricks
    p.brickT += dt;
    if (p.brickT >= BRICK_TRICKLE) {
      p.brickT -= BRICK_TRICKLE;
      p.bricks += 1;
      p.stats.bricks += 1;
    }
    // villagers from the keep
    const keep = p.keep;
    if (keep?.alive && p.pop < p.popCap) {
      p.villagerT -= dt;
      if (p.villagerT <= 0) {
        // bigger villages grow faster
        p.villagerT = VILLAGER_EVERY / (1 + houses * 0.15);
        const v = this.spawnVillager(team, keep.x + (Math.random() - 0.5) * 1.5, keep.y + (team === 0 ? -1.9 : 1.9));
        this.sparkle(v.x, v.y - 0.4, 0.5, '#ffe9a8', 6);
        this.emit('villagerBorn', { team, v });
      }
    } else p.villagerT = Math.max(p.villagerT, 1.5);
    // jobs
    p.jobT -= dt;
    if (p.jobT <= 0) {
      p.jobT = 1;
      assignJobs(this, team);
    }
    // hero respawn
    if (p.hero && !p.hero.alive) {
      p.heroRespawnT -= dt;
      if (p.heroRespawnT <= 0 && this.kingAlive(team)) this.respawnHero(team);
    }
  }

  respawnHero(team) {
    super.respawnHero(team);
    const h = this.players[team].hero;
    const k = this.players[team].keep;
    if (h && k) {
      h.x = k.x;
      h.y = k.y + (team === 0 ? 2.2 : -2.2);
      this.landSafely(h);
    }
    if (this.players[team]?.perks.might) h.dmgBoost = 1.2;
  }

  updateStructure(s, dt) {
    s.age += dt;
    if (s.struct === 'nest') {
      this.updateNest(s, dt);
      return;
    }
    if (s.built < 1 || s.team < 0) return;
    if (s.struct === 'barracks') {
      const p = this.players[s.team];
      if (!p) return;
      const mine = this.barracksPop.get(s.id) || 0;
      if (mine >= BARRACKS_MAX || p.pop >= p.popCap) {
        s.anim = 'idle';
        return;
      }
      s.trainT -= dt * (this.ageIdx >= 2 ? 2 : 1) * this.workMult(s.team);
      s.anim = 'train';
      if (s.trainT <= 0) {
        s.trainT = BARRACKS_EVERY;
        const u = this.spawnUnit(s.team, 'warrior', s.x + (Math.random() - 0.5), s.y + (s.team === 0 ? -1.4 : 1.4), p.kingLevel, { deployT: 0.3 });
        if (u) {
          u.role = 'warrior';
          u.home = s.id;
          p.stats.warriors++;
          this.puff(u.x, u.y, '#e8e2d0', 6);
          this.sfx('deploy', { volume: 0.4, pitch: 1.2 });
        }
      }
    }
  }

  updateNest(n, dt) {
    n.guards = n.guards.filter((g) => g.alive);
    n.spawnT -= dt;
    const want = NEST.keep + (this.ageIdx >= 2 ? 1 : 0);
    if (n.spawnT <= 0 && n.guards.length < want) {
      n.spawnT = NEST.every * (this.ageIdx >= 3 ? 0.6 : 1);
      const u = this.spawnMonster(n.nestKind, n.x + (Math.random() - 0.5) * 1.5, n.y + 1.1);
      if (u) {
        u.nest = n;
        n.guards.push(u);
      }
    }
  }

  /** Each nest sends a raid at the closest village when night falls. */
  launchRaids() {
    const size = [0, 2, 3, 4][this.ageIdx] || 4;
    for (const n of this.nests) {
      if (!n.alive) continue;
      let team = -1;
      let bd = Infinity;
      for (let t = 0; t < 2; t++) {
        const k = this.players[t]?.keep;
        if (!k?.alive) continue;
        const d = dist2(k.x, k.y, n.x, n.y);
        if (d < bd) {
          bd = d;
          team = t;
        }
      }
      if (team < 0) continue;
      for (let i = 0; i < size; i++) {
        const kind = this.ageIdx >= 3 && i % 2 ? 'skeleton' : n.nestKind;
        const u = this.spawnMonster(kind, n.x + (Math.random() - 0.5) * 2, n.y + 1.2);
        if (u) u.raid = { team };
      }
      this.puff(n.x, n.y, '#5b5068', 10);
    }
    if (this.nests.some((n) => n.alive)) this.emit('raid', {});
  }

  updateCritter(c, dt) {
    c.age += dt;
    c.wanderT -= dt;
    // flee from fire and fights
    const ti = Math.floor(c.y) * this.W + Math.floor(c.x);
    if (this.fireGrid[ti] > 0 && !c.flee) c.flee = { x: c.x + (Math.random() - 0.5) * 6, y: c.y + (Math.random() - 0.5) * 6 };
    if (c.wanderT <= 0) {
      c.wanderT = 3 + Math.random() * 5;
      const a = Math.random() * Math.PI * 2;
      c.goal = Math.random() < 0.4 ? null : { x: c.hx + Math.cos(a) * 3, y: c.hy + Math.sin(a) * 3 };
      c.flee = null;
    }
    const g = c.flee || c.goal;
    c.anim = 'idle';
    if (g) {
      const d = dist(c.x, c.y, g.x, g.y);
      if (d > 0.1) {
        const sp = c.speed * (c.flee ? 3 : 1) * dt;
        const nx = c.x + ((g.x - c.x) / d) * Math.min(sp, d);
        const ny = c.y + ((g.y - c.y) / d) * Math.min(sp, d);
        if (!this.blockedAt(Math.floor(nx), Math.floor(ny))) {
          c.x = nx;
          c.y = ny;
          c.facing = g.x < c.x ? -1 : 1;
          c.anim = 'walk';
        } else c.goal = c.flee = null;
      } else c.goal = c.flee = null;
    }
  }

  updatePickup(p, dt) {
    p.age += dt;
    for (let team = 0; team < 2; team++) {
      const h = this.players[team]?.hero;
      if (!h || !h.alive) continue;
      if (dist2(h.x, h.y, p.x, p.y) > 0.9 * 0.9) continue;
      p.alive = false;
      this.collect(team, p);
      return;
    }
    if (p.life != null) {
      p.life -= dt;
      if (p.life <= 0) p.alive = false;
    }
  }

  collect(team, p) {
    const pl = this.players[team];
    if (p.type === 'relic') {
      const owned = new Set(pl.relics);
      const pool = RELICS.filter((r) => !owned.has(r.id) || r.id === 'rain' || r.id === 'fertile' || r.id === 'gold');
      const r = pool[Math.floor(this.rng.next() * pool.length)];
      this.grantRelic(team, r.id);
      this.sparkle(p.x, p.y - 0.4, 1.4, '#ff4a3a', 24);
      this.flashRing(p.x, p.y, 1.6, '#ff6a5a');
      this.sfx('rarity_up');
      this.emit('relic', { team, relic: r });
    } else if (p.type === 'brick') {
      this.addBricks(team, p.amount || 10, p.x, p.y - 0.4);
      this.sfx('brick_collect', { volume: 0.6 });
    } else if (p.type === 'faith') {
      this.addElixir(team, p.amount || 1, p.x, p.y - 0.4);
      this.sfx('heal', { volume: 0.4, pitch: 1.4 });
    } else if (p.type === 'heart') {
      const h = pl.hero;
      if (h) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.35);
      this.sfx('heal', { volume: 0.5 });
    }
  }

  grantRelic(team, id) {
    const p = this.players[team];
    p.relics.push(id);
    p.stats.relics++;
    if (id === 'rain') this.addBricks(team, 120);
    else if (id === 'fertile') p.perks.fertile = (p.perks.fertile || 0) + 1;
    else if (id === 'gold') p.perks.gold = (p.perks.gold || 0) + 1;
    else p.perks[id] = true;
    if (id === 'might' && p.hero) p.hero.dmgBoost = 1.2;
    if (id === 'walls') {
      for (const s of this.structuresOf(team, null, false)) {
        s.maxHp *= 1.25;
        s.hp *= 1.25;
      }
    }
  }

  tickShrine(dt) {
    const s = this.shrine;
    if (!s) return;
    const near = [0, 0];
    for (const e of this.entities) {
      if (!e.alive || (e.team !== 0 && e.team !== 1)) continue;
      if (e.kind !== 'troop' && e.kind !== 'hero') continue;
      if (dist2(e.x, e.y, s.x, s.y) <= 3 * 3) near[e.team]++;
    }
    const contested = near[0] > 0 && near[1] > 0;
    const who = near[0] > 0 ? 0 : near[1] > 0 ? 1 : -1;
    if (contested || who < 0 || who === s.team) {
      if (!contested) s.capProg = Math.max(0, s.capProg - dt * 0.2);
      return;
    }
    if (s.capTeam !== who) {
      s.capTeam = who;
      s.capProg = 0;
    }
    s.capProg += dt / 5;
    if (s.capProg >= 1) {
      const prev = s.team;
      s.team = who;
      s.capProg = 0;
      s.capTeam = -1;
      this.territoryDirty = true;
      this.grid.setFootprint(s.fp.x0, s.fp.y0, s.fp.w, s.fp.h, who, s.id);
      this.flashRing(s.x, s.y, 3, who === 0 ? '#7fb8ff' : '#ff8a7f');
      this.sparkle(s.x, s.y - 1, 1.6, '#ffe9a8', 24);
      this.sfx('rarity_up', { pitch: 0.8 });
      this.players[who].stats.shrine++;
      this.emit('shrine', { team: who, prev });
    }
  }

  // ───────────────────────── wild world ─────────────────────────

  tickWild(dt) {
    // Chaos disasters
    if (this.ageIdx >= 3) {
      this.disasterT -= dt;
      if (this.disasterT <= 0) {
        this.disasterT = 11 + this.rng.next() * 7;
        this.disaster();
      }
    }
  }

  /** A random disaster near the contested middle or a village. */
  disaster() {
    const kinds = ['meteor', 'storm', 'quake'];
    const kind = kinds[Math.floor(this.rng.next() * kinds.length)];
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 30; tries++) {
      x = 3 + this.rng.next() * (this.W - 6);
      y = 8 + this.rng.next() * (this.H - 16);
      if (!this.blockedAt(Math.floor(x), Math.floor(y))) break;
    }
    this.emit('disaster', { kind, x, y });
    if (kind === 'meteor') {
      this.warnings.push({ x, y, r: 2.2, t: 1.4, max: 1.4 });
      this.pending.push({ t: 1.4, fn: () => this.meteorStrike(x, y) });
    } else if (kind === 'storm') {
      for (let i = 0; i < 6; i++) {
        const lx = x + (this.rng.next() - 0.5) * 6;
        const ly = y + (this.rng.next() - 0.5) * 6;
        this.warnings.push({ x: lx, y: ly, r: 1.2, t: 0.3 + i * 0.35, max: 0.3 + i * 0.35 });
        this.pending.push({ t: 0.3 + i * 0.35, fn: () => this.lightningStrike(lx, ly) });
      }
    } else {
      this.shake(1);
      this.sfx('earthquake');
      for (let i = 0; i < 3; i++) {
        const a = this.rng.next() * Math.PI * 2;
        this.crack(x, y, x + Math.cos(a) * 4, y + Math.sin(a) * 4);
      }
      for (const e of this.entities) {
        if (!e.alive || e.flying || e.untargetable) continue;
        if (dist2(e.x, e.y, x, y) <= 4.5 * 4.5) damage(this, e, isBuildingKind(e) ? 160 : 70, { effects: { stun: 0.8 } });
      }
    }
  }

  meteorStrike(x, y) {
    this.explosion(x, y, 2.2, '#ff7a2e');
    this.shake(0.9);
    this.sfx('meteor');
    this.decal(x, y, 1.8);
    this.igniteGround(x, y, 2, 5, 40, -1);
    for (const e of this.entities) {
      if (!e.alive || e.untargetable) continue;
      if (dist2(e.x, e.y, x, y) <= 2.2 * 2.2) damage(this, e, isBuildingKind(e) ? 320 : 260, { effects: { burn: { dps: 20, dur: 3 } } });
    }
  }

  lightningStrike(x, y) {
    this.bolt(x + 0.3, y - 7, x, y, '#fff7a8', 3);
    this.flashRing(x, y, 1.2, '#fff7a8');
    this.sfx('lightning', { volume: 0.6 });
    this.igniteGround(x, y, 0.8, 3, 20, -1);
    for (const e of this.entities) {
      if (!e.alive || e.untargetable) continue;
      if (dist2(e.x, e.y, x, y) <= 1.3 * 1.3) damage(this, e, 140, { effects: { stun: 0.5 } });
    }
  }

  /** Fire spreads through forest; burnt forest turns to ash, ash regrows to grass and grass back to forest. */
  tickGround(dt) {
    super.tickGround(dt);
    for (const w of this.warnings) w.t -= dt;
    if (this.warnings.length) this.warnings = this.warnings.filter((w) => w.t > 0);
    if (this.pending.length) {
      for (const p of this.pending) p.t -= dt;
      const due = this.pending.filter((p) => p.t <= 0);
      this.pending = this.pending.filter((p) => p.t > 0);
      for (const p of due) p.fn();
    }
    this.groundSpreadT = (this.groundSpreadT || 0) - dt;
    if (this.groundSpreadT > 0) return;
    this.groundSpreadT = 0.5;
    const W = this.W;
    const g = this.fireGrid;
    const tiles = this.tiles;
    for (let i = 0; i < g.length; i++) {
      if (g[i] > 0) {
        if (tiles[i] === T.FOREST || tiles[i] === T.GRASS && this.origForest[i]) {
          // spread to forest neighbours
          const x = i % W;
          const y = (i / W) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= this.H) continue;
            const ni = ny * W + nx;
            if (tiles[ni] === T.FOREST && g[ni] <= 0 && this.rng.next() < 0.22) {
              g[ni] = 4 + this.rng.next() * 3;
              this.fireDps[ni] = 18;
              this.fireTeam[ni] = -1;
            }
          }
          if (tiles[i] === T.FOREST && g[i] < 1.2) this.setTile(i, T.ASH, 35 + this.rng.next() * 25);
        }
      } else if (this.regrowT[i] > 0) {
        this.regrowT[i] -= 0.5;
        if (this.regrowT[i] <= 0) {
          if (tiles[i] === T.ASH) this.setTile(i, T.GRASS, this.origForest[i] ? 50 + this.rng.next() * 40 : 0);
          else if (tiles[i] === T.GRASS && this.origForest[i] && this.grid.occ[i] === 0) this.setTile(i, T.FOREST, 0);
        }
      }
    }
  }

  setTile(i, t, regrow = 0) {
    if (this.tiles[i] === t) return;
    this.tiles[i] = t;
    this.grid.refreshTile(i);
    this.regrowT[i] = regrow;
    this.tileChanges.push(i);
  }

  // ───────────────────────── territory & score ─────────────────────────

  recomputeTerritory() {
    const claims = [];
    for (const s of this.structures) {
      if (!s.alive || s.built < 1 || !s.claim || (s.team !== 0 && s.team !== 1)) continue;
      claims.push({ x: s.x, y: s.y, claim: s.claim, team: s.team });
    }
    this.owner = computeTerritory(this.W, this.H, claims, this.tiles, WATER_TILES);
    this.territoryDirty = false;
    this.territoryT = 0.4;
    this.territoryVersion++;
  }

  computeDominion() {
    const tilesOwned = [0, 0];
    for (let i = 0; i < this.owner.length; i++) {
      const o = this.owner[i];
      if (o === 0 || o === 1) tilesOwned[o]++;
    }
    for (let team = 0; team < 2; team++) {
      const p = this.players[team];
      if (!p) continue;
      const buildings = this.structures.filter((s) => s.alive && s.team === team && s.built >= 1 && !s.isWall).length;
      this.dominion[team] = Math.round(tilesOwned[team] * DOMINION.tile + buildings * DOMINION.building + p.pop * DOMINION.pop + (this.shrine?.team === team ? DOMINION.shrine : 0));
      p.dominion = this.dominion[team];
    }
  }

  // ───────────────────────── clock, ages, day/night ─────────────────────────

  get elapsed() {
    return this.matchLength - this.clock;
  }

  tickClock(dt) {
    this.clock -= dt;
    const el = this.elapsed;
    const idx = ageIndexAt(el);
    if (idx !== this.ageIdx) {
      this.ageIdx = idx;
      const age = AGES[idx];
      this.emit('age', { idx, age });
      this.emit('banner', { text: age.name.toUpperCase(), sub: age.blurb, kind: 'age' });
      this.sfx(idx === 3 ? 'overtime' : 'double_elixir');
      if (idx === 3) this.audio?.setIntensity?.(1);
      else if (idx === 2) this.audio?.setIntensity?.(0.5);
    }
    // day / night from the Age of Bricks on
    let night = false;
    if (el >= AGES[1].at) {
      const c = (el - AGES[1].at) % DAY_LENGTH;
      night = c >= DAY_LENGTH - NIGHT_LENGTH;
    }
    if (night !== this.night) {
      this.night = night;
      this.emit(night ? 'night' : 'day', {});
      if (night) {
        this.sfx('ufo', { volume: 0.3, pitch: 0.5 });
        this.launchRaids();
      }
    }
    this.nightK += ((night ? 1 : 0) - this.nightK) * Math.min(1, dt * 0.8);
    if (this.clock <= 0) this.finishByDominion();
  }

  finishByDominion() {
    this.computeDominion();
    const [a, b] = this.dominion;
    if (!this.players[1]) {
      this.finish(0, 'survived');
      return;
    }
    if (a === b) this.finish(-1, 'draw');
    else this.finish(a > b ? 0 : 1, 'dominion');
  }

  finish(winner, reason) {
    if (this.phase === 'ended') return;
    this.computeDominion();
    // crowns: keep kill 3; a dominion win 1 (+1 for 3+ buildings destroyed); anyone else 1 for 3+ buildings destroyed
    const crowns = [0, 0];
    for (let team = 0; team < 2; team++) {
      const p = this.players[team];
      if (!p) continue;
      const wrecker = p.destroyed >= 3 ? 1 : 0;
      if (winner === team) crowns[team] = reason === 'keep' ? 3 : 1 + wrecker;
      else crowns[team] = wrecker;
      p.crowns = crowns[team];
    }
    this.phase = 'ended';
    this.result = { winner, reason, crowns, dominion: this.dominion.slice(), age: this.ageIdx, time: this.elapsed, wave: this.horde?.night || 0 };
    this.audio?.setIntensity?.(0);
    this.emit('end', this.result);
  }

  summary(team = 0) {
    const p = this.players[team];
    return { ...p.stats, crowns: p.crowns, dominion: this.dominion[team], relics: p.relics.slice(), goldBonus: (p.perks.gold || 0) * 0.5 };
  }
}
