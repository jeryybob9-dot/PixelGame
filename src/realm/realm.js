// Realm Clash: two castles on a small island. Destroy theirs before they destroy yours.
// Villagers mine bricks; bricks pay for troop and spell cards and for three buildings (House, Tower, Barracks).
// Extends the battle simulation so all combat, hero, spell and card code is shared. See docs/DESIGN.md.

import { Battle, STEP } from '../battle/battle.js';
import { clamp, dist, dist2 } from '../core/util.js';
import { CARDS, EXTRA_UNITS, levelMult } from '../data/cards.js';
import { kingMult } from '../data/progression.js';
import { tickStatus, kill, updateProjectiles, updateAreas, isBuildingKind } from '../battle/combat.js';
import { updateTroop, updateBuilding, updateTower, separate } from '../battle/units.js';
import { updateHero, updatePet, upgradeForm, formUpgradeCost, gadgetReady, useGadget } from '../battle/hero.js';
import {
  T, BLOCKING, BUILDABLE, TILE_SPEED, WILD, MATCH_LENGTH, RUSH_AT, BRICKS_START, BRICK_INCOME, CARD_BRICKS, cardBricks,
  START_VILLAGERS, HOUSE_VILLAGERS, VILLAGER_RESPAWN, HERO_RESPAWN, HERO_KILL_BRICKS, SUMMON_HERO_RADIUS, VILLAGER, SOLDIER,
  STRUCTURES, BARRACKS_EVERY, BARRACKS_MAX, MONSTERS, TROOP_HP, TROOP_DMG, TROOP_SPEED, troopCount, SPELL_VS_TROOPS,
  SPELL_VS_BUILDINGS, HERO_VS_TROOPS, HERO_XP, HERO_XP_PER_SEC, HOME_HEAL, HP_PER_COST, TROOP_VS_BUILDINGS,
} from './constants.js';
import { generateRealm } from './worldgen.js';
import { Grid } from './grid.js';
import { updateVillager, assignJobs } from './village.js';

// realm-only unit types join the shared unit table so spawnUnit() can build them
Object.assign(EXTRA_UNITS, {
  soldier: SOLDIER,
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
    this.tileChanges = [];
    this.piles = [];
    this.deposits = this.map.deposits.map((d, i) => ({ id: i + 1, ...d, max: d.amount }));
    this.structures = [];
    this.pickups = [];
    this.warnings = [];
    this.pending = [];
    this.nests = [];
    this.shrine = null;
    this.ageIdx = 0;
    this.rush = false;
    this.night = false;
    this.nightK = 0; // 0 day .. 1 night: the sun sets as the clock runs down
    this.matchLength = opts.matchTime ?? MATCH_LENGTH;
    this.pathBudget = 0;
    // your half of the island is the river's side your castle is on
    this.owner = new Int8Array(this.W * this.H).fill(-1);
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const i = y * this.W + x;
        if (WATER_TILES.has(this.tiles[i])) continue;
        this.owner[i] = y >= this.H / 2 ? 0 : 1;
      }
    }
    this.territoryVersion = 1;
  }

  makePlayer(team, setup) {
    const p = super.makePlayer(team, setup);
    p.bricks = BRICKS_START;
    p.elixir = 0; // unused here: cards cost bricks
    p.keep = null;
    p.income = BRICK_INCOME;
    p.villagers = 0;
    p.villagerGoal = START_VILLAGERS;
    p.villagerT = 0;
    p.soldiers = 0;
    p.destroyed = 0;
    p.jobT = 0;
    p.perks = {};
    p.relics = [];
    p.heroXp = 0;
    Object.assign(p.stats, { built: 0, relics: 0, nests: 0, destroyed: 0, villagers: 0, warriors: 0 });
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
    for (const c of m.critters) this.spawnCritter(c.x, c.y);
  }

  // ───────────────────────── buildings ─────────────────────────

  /** Can `team` place structure `id` with its footprint's top-left at (x0, y0)? Returns a reason string or null. */
  placementProblem(team, id, x0, y0) {
    const def = STRUCTURES[id];
    if (!def || id === 'keep') return 'unknown';
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
    // keep the bridges and the road next to them open
    for (const b of this.map.bridges || []) {
      if (Math.abs(b.x - (x0 + def.w / 2)) < def.w / 2 + 1.2 && Math.abs(b.y - (y0 + def.h / 2)) < def.h / 2 + 2) return 'bridge';
    }
    return null;
  }

  /** Spend bricks and put down a building site (villagers build it). */
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
    const def = STRUCTURES[id];
    const hp = def.hp;
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
      r: Math.max(def.w, def.h) * 0.5 * 0.78,
      h: id === 'keep' ? 2.6 : id === 'tower' ? 2.4 : 1.5,
      fp: { x0, y0, w: def.w, h: def.h },
      hp: instant ? hp : Math.max(1, hp * 0.15),
      maxHp: hp,
      built: instant ? 1 : 0,
      buildTime: def.build,
      claim: def.claim,
      dmg: def.dmg || 0,
      hs: def.hs || 1,
      range: def.range || 0,
      targets: def.dmg ? 'both' : 'none',
      proj: id === 'keep' ? 'brick' : 'arrow',
      splash: def.splash || 0,
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
      isWall: false,
      age: 0,
      costShare: (def.cost || 20) / 10,
      trainT: BARRACKS_EVERY * 0.4,
    };
    this.entities.push(e);
    if (tower) this.towers.push(e);
    this.structures.push(e);
    this.grid.setFootprint(x0, y0, def.w, def.h, team, e.id, false);
    return e;
  }

  /** Called by villagers as they build. */
  advanceBuild(s, amount) {
    if (s.built >= 1 || !s.alive) return;
    const before = s.built;
    s.built = Math.min(1, s.built + amount);
    s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.85 * (s.built - before));
    if (s.built >= 1) {
      s.hp = Math.max(s.hp, s.maxHp * 0.95);
      this.puff(s.x, s.y, '#e8dcc0', 10);
      this.sparkle(s.x, s.y - 0.6, 1.2, '#ffe9a8', 12);
      this.sfx('built', { volume: s.team === 0 ? 0.8 : 0.35 });
      const p = this.players[s.team];
      if (p) {
        p.stats.built++;
        if (s.struct === 'house') {
          p.villagerGoal += HOUSE_VILLAGERS;
          for (let i = 0; i < HOUSE_VILLAGERS; i++) this.spawnVillager(s.team, s.x + (i ? 0.8 : -0.8), s.y + s.fp.h / 2 + 0.4);
        }
      }
      this.emit('built', { team: s.team, s });
    }
  }

  freeStructure(s) {
    this.grid.setFootprint(s.fp.x0, s.fp.y0, s.fp.w, s.fp.h, null, s.id);
    this.structures = this.structures.filter((o) => o !== s);
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

  spawnMonster(kind, x, y, extra = {}) {
    const id = kind === 'skeleton' ? 'wild_skeleton' : kind;
    const lvl = this.horde ? this.horde.level : 1;
    const u = this.spawnUnit(WILD, id, x, y, lvl, { deployT: 0.4, ...extra });
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

  /** Card buildings and spell walls also block tiles in the realm. */
  spawnBuilding(team, cardOrId, x, y, level = 1, extra = {}) {
    const b = super.spawnBuilding(team, cardOrId, x, y, level, extra);
    if (!b) return b;
    if (team === 0 || team === 1) {
      b.hp *= 1.6;
      b.maxHp *= 1.6;
    }
    const tx = Math.floor(b.x);
    const ty = Math.floor(b.y);
    if (this.grid.inside(tx, ty) && this.grid.occ[ty * this.W + tx] === 0) {
      b.fp = { x0: tx, y0: ty, w: 1, h: 1 };
      this.grid.setFootprint(tx, ty, 1, 1, team, b.id, !!b.isWall);
    }
    return b;
  }

  /** Troops in the realm are sturdier and quicker than in the lane arena, so armies matter. */
  spawnUnit(team, cardOrUnitId, x, y, level = 1, extra = {}) {
    const u = super.spawnUnit(team, cardOrUnitId, x, y, level, extra);
    if (!u) return u;
    if (team === 0 || team === 1) {
      const k = (extra.countBoost || 1) * TROOP_HP;
      u.hp *= k;
      u.maxHp *= k;
      const floor = (extra.hpFloor || 0) * levelMult(level);
      if (u.maxHp < floor) u.hp = u.maxHp = floor;
      u.buildingBonus = TROOP_VS_BUILDINGS;
      u.dmg *= TROOP_DMG * (extra.countBoost ? Math.sqrt(extra.countBoost) : 1);
      u.speed *= TROOP_SPEED;
    }
    this.landSafely(u);
    return u;
  }

  spawnHero(team) {
    const h = super.spawnHero(team);
    this.setupHero(h);
    return h;
  }

  /** One Power button: the first spell is ready from the start, the second replaces it at level 3. */
  setupHero(h) {
    if (!h) return;
    const s = h.def.spells;
    h.def = { ...h.def, spells: [{ ...s[0], form: 1 }, { ...s[1], form: 3 }] };
    h.vsTroops = HERO_VS_TROOPS;
  }

  // ───────────────────────── cards ─────────────────────────

  tileOwner(x, y) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return -1;
    return this.owner[ty * this.W + tx];
  }

  /** Is (x, y) a legal summon spot for `team`? Your half of the island, or right next to your hero. */
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

  /** Cards cost bricks in Realm Clash. */
  playCard(team, slot, x, y) {
    if (this.phase !== 'play') return { ok: false, reason: 'not-started' };
    const p = this.players[team];
    const cardId = p.hand[slot];
    const card = CARDS[cardId];
    if (!card) return { ok: false, reason: 'no-card' };
    const cost = cardBricks(card);
    if (p.bricks < cost) return { ok: false, reason: 'bricks' };
    const pt = this.previewPlacement(team, cardId, x, y);
    if (!pt) return { ok: false, reason: 'placement' };
    p.bricks -= cost;
    p.hand[slot] = p.queue.shift();
    p.queue.push(cardId);
    p.lastPlayed = cardId;
    p.stats.cardsPlayed++;
    const level = p.setup.cardLevels?.[cardId] ?? 1;
    this.deploy(team, card, pt.x, pt.y, level);
    this.emit('play', { team, cardId, x: pt.x, y: pt.y });
    return { ok: true };
  }

  deploy(team, card, x, y, level) {
    if (card.type === 'troop' && card.unit.special?.builder) {
      const p = this.players[team];
      if (p) p.villagerGoal += 2;
      for (let i = 0; i < 2; i++) this.spawnVillager(team, x + (i - 0.5) * 0.7, y);
      this.sparkle(x, y - 0.4, 1, '#ffe9a8', 12);
      this.sfx('deploy');
      return;
    }
    if (card.type === 'troop') {
      // swarms arrive as a few sturdy units instead of many fragile ones
      const u = card.unit;
      const printed = u.count || 1;
      const n = troopCount(printed);
      const boost = printed / n;
      const spread = n === 1 ? 0 : 0.6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (team === 0 ? -Math.PI / 2 : Math.PI / 2);
        const e = this.spawnUnit(team, card.id, x + Math.cos(a) * spread, y + Math.sin(a) * spread * 0.8, level, { deployT: 1 + i * 0.05, countBoost: boost, hpFloor: (card.cost * HP_PER_COST) / n });
        if (e) e.summoned = true;
      }
      this.sfx('deploy');
      this.dust(x, y, 0.8);
      return;
    }
    super.deploy(team, card, x, y, level);
  }

  /** How hard a spell hits this target. */
  spellMult(e) {
    if (isBuildingKind(e)) return SPELL_VS_BUILDINGS;
    if (e.kind === 'troop' || e.kind === 'hero' || e.kind === 'pet') return SPELL_VS_TROOPS;
    return 1;
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

  /** The Power button: the best ability that is ready. */
  heroPower(team) {
    const h = this.players[team]?.hero;
    if (!h || !h.alive) return false;
    if (h.form >= 3 && this.heroSpell(team, 1)) return true;
    return this.heroSpell(team, 0);
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
    while (p.i < p.pts.length - 1 && dist2(e.x, e.y, p.pts[p.i].x, p.pts[p.i].y) < 0.36 * 0.36) p.i++;
    const wp = p.pts[Math.min(p.i, p.pts.length - 1)];
    if (p.i >= p.pts.length - 1) return { x: tx, y: ty };
    return wp;
  }

  /** Where units go when nothing is in sight (re-decided twice a second). */
  unitGoal(e) {
    if (e.goalCache && this.time < e.goalT && (!e.goalCache.kind || e.goalCache.alive)) return e.goalCache;
    e.goalCache = this.decideGoal(e);
    e.goalT = this.time + 0.5 + Math.random() * 0.2;
    return e.goalCache;
  }

  /** Troops and soldiers march on the enemy castle; buildings-only troops take the closest building on the way. */
  decideGoal(e) {
    if (e.team === WILD) {
      // Horde monsters go for the nearest building of the village
      let best = null;
      let bd = Infinity;
      for (const s of this.structures) {
        if (!s.alive || s.team !== 0) continue;
        const d = dist2(s.x, s.y, e.x, e.y);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best || { x: e.x, y: e.y };
    }
    const ek = this.players[1 - e.team]?.keep;
    if (e.targets === 'buildings') {
      const b = this.nearestEnemyBuilding(e.team, e.x, e.y);
      if (b) return b;
    }
    return ek && ek.alive ? ek : { x: e.x, y: e.y };
  }

  /** Closest building of the other side. */
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

  canBurn(tx, ty) {
    const t = this.tiles[ty * this.W + tx];
    return !WATER_TILES.has(t) && t !== T.MOUNTAIN && t !== T.CRYSTAL;
  }

  // ───────────────────────── economy ─────────────────────────

  /** Card effects that would give Faith (the Brick Well) give bricks here. */
  addElixir(team, n, x, y) {
    this.addBricks(team, Math.round(n * CARD_BRICKS), x, y);
  }

  dropOffs(team) {
    return this.structures.filter((s) => s.alive && s.team === team && s.built >= 1 && s.struct === 'keep');
  }

  workMult() {
    return 1;
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
      if (t.struct !== 'keep') this.addBricks(enemy, 40, t.x, t.y - 1.5);
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
      this.heroXp(enemy, 6);
    }
    this.emit('heroDeath', { team: h.team });
  }

  kingAlive(team) {
    return !!this.players[team]?.keep?.alive;
  }

  onKill(e, src) {
    const killer = src?.team;
    if (e.kind === 'villager') {
      if ((killer === 0 || killer === 1) && killer !== e.team) this.addBricks(killer, 5, e.x, e.y);
      this.emit('villagerLost', { team: e.team });
    }
    if (src?.kind === 'hero' && e.team !== src.team) this.heroXp(src.team, isBuildingKind(e) ? 4 : e.kind === 'troop' ? Math.max(1, e.costShare || 1) : 1);
    if (e.struct) {
      this.freeStructure(e);
      if ((killer === 0 || killer === 1) && killer !== e.team && e.built >= 1) {
        const p = this.players[killer];
        p.destroyed++;
        p.stats.destroyed++;
        this.addBricks(killer, Math.round((STRUCTURES[e.struct]?.cost || 10) * 0.5), e.x, e.y - 1);
      }
      this.emit('structureLost', { team: e.team, s: e });
      return;
    }
    if (e.kind === 'building' && e.fp) this.grid.setFootprint(e.fp.x0, e.fp.y0, 1, 1, null, e.id);
  }

  /** Heroes level up by fighting: level 2 and 3 make them tougher and unlock a stronger Power. */
  heroXp(team, n) {
    const p = this.players[team];
    if (!p) return;
    p.heroXp += n;
    const h = p.hero;
    if (!h || !h.alive || h.form >= 3) return;
    if (p.heroXp >= HERO_XP[h.form]) {
      // upgradeForm charges the arena's brick price; levels are free here
      const cost = formUpgradeCost(h) || 0;
      p.bricks += cost;
      if (upgradeForm(this, h)) this.emit('heroLevel', { team, level: h.form });
      else p.bricks -= cost;
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
        this.emit('start', {});
        if (this.horde) this.emit('banner', { text: 'SURVIVE THE NIGHTS!', sub: 'Build by day. Monsters come at night', kind: 'fight' });
        else this.emit('banner', { text: 'DESTROY THE RED CASTLE!', sub: 'Protect your blue castle', kind: 'fight' });
        this.sfx('fight');
      }
      this.updateFx(dt);
      return;
    }
    this.time += dt;
    this.pathBudget = 10;
    this.tickClock(dt);
    if (this.phase === 'ended') return;
    this.countAll();
    for (let team = 0; team < 2; team++) this.tickPlayer(team, dt);
    this.ai?.forEach((a) => a?.update(dt));
    this.horde?.update(dt);
    this.tutorial?.update(dt);

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
    }
    this.updateFx(dt);
  }

  /** One pass over entities for the per-frame counters. */
  countAll() {
    const c = (this.counts ||= [{}, {}]);
    for (const t of c) {
      t.villagers = 0;
      t.soldiers = 0;
    }
    const homes = (this.barracksPop ||= new Map());
    homes.clear();
    for (const e of this.entities) {
      if (!e.alive || (e.team !== 0 && e.team !== 1)) continue;
      if (e.kind === 'villager') c[e.team].villagers++;
      else if (e.role === 'soldier') {
        c[e.team].soldiers++;
        homes.set(e.home, (homes.get(e.home) || 0) + 1);
      }
    }
  }

  tickPlayer(team, dt) {
    const p = this.players[team];
    if (!p) return;
    const c = this.counts[team];
    p.villagers = c.villagers;
    p.soldiers = c.soldiers;
    p.warriors = c.soldiers;
    p.pop = c.villagers;
    p.popCap = p.villagerGoal;
    // bricks trickle in (twice as fast in the Brick Rush)
    p.income = BRICK_INCOME * (this.rush ? 2 : 1);
    p.brickT += p.income * dt;
    if (p.brickT >= 1) {
      const n = Math.floor(p.brickT);
      p.brickT -= n;
      p.bricks += n;
      p.stats.bricks += n;
    }
    // lost villagers are replaced at the castle
    const keep = p.keep;
    if (keep?.alive && p.villagers < p.villagerGoal) {
      p.villagerT -= dt;
      if (p.villagerT <= 0) {
        p.villagerT = VILLAGER_RESPAWN;
        const v = this.spawnVillager(team, keep.x + (Math.random() - 0.5) * 1.5, keep.y + (team === 0 ? -1.9 : 1.9));
        this.sparkle(v.x, v.y - 0.4, 0.5, '#ffe9a8', 6);
        if (team === 0) this.sfx('villager', { volume: 0.5 });
      }
    } else p.villagerT = VILLAGER_RESPAWN;
    // alert the owner when a building is under attack (once every 10 s per building)
    p.alertT = (p.alertT || 0) - dt;
    if (p.alertT <= 0) {
      p.alertT = 0.5;
      for (const s of this.structures) {
        if (!s.alive || s.team !== team || !s.lastHitT || this.time - s.lastHitT > 0.6) continue;
        if (s.alertedT && this.time - s.alertedT < 10) continue;
        s.alertedT = this.time;
        this.emit('underAttack', { team, s });
        break;
      }
    }
    p.jobT -= dt;
    if (p.jobT <= 0) {
      p.jobT = 1;
      assignJobs(this, team);
    }
    // the hero levels slowly over time too, and heals beside its own castle
    const h = p.hero;
    if (h?.alive) {
      this.heroXp(team, HERO_XP_PER_SEC * dt);
      if (keep?.alive && dist2(h.x, h.y, keep.x, keep.y) < 4.5 * 4.5 && (!h.lastHitT || this.time - h.lastHitT > 2) && h.hp < h.maxHp) {
        h.hp = Math.min(h.maxHp, h.hp + h.maxHp * HOME_HEAL * dt);
        h.healing = true;
      } else h.healing = false;
      // the gadget fires by itself when the hero is hurt in a fight
      if (gadgetReady(h) && h.hp < h.maxHp * 0.5 && h.lastHitT && this.time - h.lastHitT < 0.5) this.autoGadget(h);
    }
    if (p.hero && !p.hero.alive) {
      p.heroRespawnT -= dt;
      if (p.heroRespawnT <= 0 && this.kingAlive(team)) this.respawnHero(team);
    }
  }

  autoGadget(h) {
    const keep = this.players[h.team].keep;
    const jet = h.gadget === 'jetpack' && keep;
    const prev = h.moveTo;
    // the jetpack hops toward home
    if (jet) h.moveTo = { x: keep.x, y: keep.y + (h.team === 0 ? -2.5 : 2.5) };
    useGadget(this, h);
    if (jet) h.moveTo = prev;
  }

  respawnHero(team) {
    super.respawnHero(team);
    const h = this.players[team].hero;
    const k = this.players[team].keep;
    this.setupHero(h);
    if (h && k) {
      h.x = k.x;
      h.y = k.y + (team === 0 ? -2.4 : 2.4);
      this.landSafely(h);
    }
  }

  updateStructure(s, dt) {
    s.age += dt;
    if (s.built < 1 || s.team < 0) return;
    if (s.struct === 'barracks') {
      const p = this.players[s.team];
      if (!p) return;
      const mine = this.barracksPop.get(s.id) || 0;
      if (mine >= BARRACKS_MAX) {
        s.anim = 'idle';
        return;
      }
      s.trainT -= dt * (this.rush ? 1.5 : 1);
      s.anim = 'train';
      if (s.trainT <= 0) {
        s.trainT = BARRACKS_EVERY;
        const u = this.spawnUnit(s.team, 'soldier', s.x + (Math.random() - 0.5), s.y + (s.team === 0 ? -1.4 : 1.4), p.kingLevel, { deployT: 0.3 });
        if (u) {
          u.role = 'soldier';
          u.home = s.id;
          p.stats.warriors++;
          this.puff(u.x, u.y, '#e8e2d0', 6);
          if (s.team === 0) this.sfx('deploy', { volume: 0.4, pitch: 1.2 });
        }
      }
    }
  }

  updateCritter(c, dt) {
    c.age += dt;
    c.wanderT -= dt;
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

  /** Fire spreads through forest; burnt forest turns to ash, ash regrows to grass and grass back to forest. */
  tickGround(dt) {
    super.tickGround(dt);
    this.groundSpreadT = (this.groundSpreadT || 0) - dt;
    if (this.groundSpreadT > 0) return;
    this.groundSpreadT = 0.5;
    const W = this.W;
    const g = this.fireGrid;
    const tiles = this.tiles;
    for (let i = 0; i < g.length; i++) {
      if (g[i] > 0) {
        if (tiles[i] === T.FOREST) {
          const x = i % W;
          const y = (i / W) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= this.H) continue;
            const ni = ny * W + nx;
            if (tiles[ni] === T.FOREST && g[ni] <= 0 && this.rng.next() < 0.18) {
              g[ni] = 4 + this.rng.next() * 3;
              this.fireDps[ni] = 18;
              this.fireTeam[ni] = -1;
            }
          }
          if (g[i] < 1.2) this.setTile(i, T.ASH, 30 + this.rng.next() * 20);
        }
      } else if (this.regrowT[i] > 0) {
        this.regrowT[i] -= 0.5;
        if (this.regrowT[i] <= 0) {
          if (tiles[i] === T.ASH) this.setTile(i, T.GRASS, this.origForest[i] ? 40 + this.rng.next() * 30 : 0);
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

  // ───────────────────────── clock ─────────────────────────

  get elapsed() {
    return this.matchLength - this.clock;
  }

  /** Castle health as a fraction (for the HUD and the time-up rule). */
  castleHealth(team) {
    const k = this.players[team]?.keep;
    return k && k.alive ? k.hp / k.maxHp : 0;
  }

  tickClock(dt) {
    this.clock -= dt;
    if (this.horde) {
      // Horde Nights runs its own day and night
      const night = this.horde.isNight(this.elapsed);
      if (night !== this.night) {
        this.night = night;
        this.sfx(night ? 'night' : 'dawn', { volume: 0.7 });
        if (night) this.horde.onNight();
        else this.horde.onDay();
        this.emit(night ? 'night' : 'day', {});
      }
      this.nightK += ((night ? 1 : 0) - this.nightK) * Math.min(1, dt * 0.8);
      return;
    }
    // the sun sets as time runs out; the last minute is the Brick Rush
    const left = this.clock;
    const target = left > RUSH_AT + 30 ? 0 : left > RUSH_AT ? (RUSH_AT + 30 - left) / 30 * 0.45 : 0.45 + (1 - left / RUSH_AT) * 0.3;
    this.nightK += (target - this.nightK) * Math.min(1, dt * 0.6);
    if (!this.rush && left <= RUSH_AT) {
      this.rush = true;
      this.emit('banner', { text: 'BRICK RUSH!', sub: 'Double bricks for the last minute', kind: 'elixir' });
      this.sfx('age_up');
      this.audio?.setIntensity?.(1);
    }
    if (left <= 0) this.finishOnTime();
  }

  /** Time is up: the castle with more health wins. */
  finishOnTime() {
    const a = this.castleHealth(0);
    const b = this.castleHealth(1);
    if (!this.players[1]) {
      this.finish(0, 'survived');
      return;
    }
    if (Math.abs(a - b) < 0.005) this.finish(-1, 'draw');
    else this.finish(a > b ? 0 : 1, 'time');
  }

  finish(winner, reason) {
    if (this.phase === 'ended') return;
    // crowns: castle destroyed 3; a win on time 1 (+1 if their castle is below half health)
    const crowns = [0, 0];
    for (let team = 0; team < 2; team++) {
      const p = this.players[team];
      if (!p) continue;
      if (winner === team) crowns[team] = reason === 'keep' ? 3 : 1 + (this.castleHealth(1 - team) < 0.5 ? 1 : 0);
      p.crowns = crowns[team];
    }
    this.phase = 'ended';
    this.result = { winner, reason, crowns, health: [this.castleHealth(0), this.castleHealth(1)], time: this.elapsed, wave: this.horde?.night || 0 };
    this.audio?.setIntensity?.(0);
    this.emit('end', this.result);
  }

  summary(team = 0) {
    const p = this.players[team];
    return { ...p.stats, crowns: p.crowns, relics: [], goldBonus: 0 };
  }
}
