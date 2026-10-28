// The battle simulation. Pure state + rules; rendering and input live elsewhere.

import { Emitter } from '../core/events.js';
import { createRng } from '../core/rng.js';
import { dist2, clamp } from '../core/util.js';
import {
  ARENA_W, ARENA_H, MATCH_TIME, DOUBLE_ELIXIR_AT, OVERTIME, ELIXIR_MAX, ELIXIR_START, ELIXIR_SECONDS,
  BRICKS_START, BRICK_TRICKLE, TOWER_ELEMENT_COST, HERO_KILL_BRICKS, TOWER_KILL_BRICKS,
  towerLayout, brickPiles, deployZones, inZones, clampToZones, inRiver, onBridge, RIVER_TOP, RIVER_BOTTOM,
} from './constants.js';
import { CARDS, unitDef, levelMult, EXTRA_UNITS } from '../data/cards.js';
import { TOWERS, kingMult } from '../data/progression.js';
import { ELEMENTS } from '../data/heroes.js';
import { updateProjectiles, updateAreas, tickStatus, castSpell, kill, activateKing, damage } from './combat.js';
import { updateTroop, updateBuilding, updateTower, separate } from './units.js';
import { createHero, updateHero, createPet, updatePet, upgradeForm, castHeroSpell, useGadget } from './hero.js';

export const STEP = 1 / 60;

/**
 * @typedef {object} PlayerSetup
 * @property {string} name
 * @property {string[]} deck 8 card ids
 * @property {Record<string, number>} cardLevels
 * @property {number} kingLevel
 * @property {string} heroId
 * @property {string} weaponId
 * @property {number} weaponLevel
 * @property {string|null} gadgetId
 * @property {string|null} petId
 * @property {string[]|null} skin
 * @property {boolean} [isAI]
 * @property {number} [trophies]
 */

export class Battle {
  /**
   * @param {{ mode: 'duel'|'waves'|'tutorial', arena: object, players: [PlayerSetup, PlayerSetup|null], seed?: number,
   *   audio?: any, settings?: object, matchTime?: number }} opts
   */
  constructor(opts) {
    this.mode = opts.mode;
    this.arena = opts.arena;
    this.rng = createRng(opts.seed ?? (Date.now() >>> 0));
    this.audio = opts.audio;
    this.settings = { dmgNumbers: true, particles: 'high', ...(opts.settings || {}) };
    this.ev = new Emitter();
    this.time = 0;
    this.clock = opts.matchTime ?? MATCH_TIME;
    this.phase = 'countdown';
    this.countdown = 3.2;
    this.overtime = false;
    this.elixirMult = 1;
    this.result = null;
    this.nextId = 1;
    this.entities = [];
    this.towers = [];
    this.projectiles = [];
    this.areas = [];
    this.fx = [];
    this.beams = [];
    this.bolts = [];
    this.rings = [];
    this.texts = [];
    this.decals = [];
    this.trails = [];
    this.cracks = [];
    this.emotes = [];
    this.shakeT = 0;
    this.whiteFlash = 0;
    this.initWorld(opts);
    this.fireGrid = new Float32Array(this.W * this.H);
    this.fireDps = new Float32Array(this.W * this.H);
    this.fireTeam = new Int8Array(this.W * this.H);
    this.wasteGrid = new Float32Array(this.W * this.H);
    this.players = opts.players.map((s, team) => (s ? this.makePlayer(team, s) : null));
    this.setupSides(opts);
  }

  /** Map size and static map objects (subclasses build other worlds). */
  initWorld() {
    this.W = ARENA_W;
    this.H = ARENA_H;
    this.piles = brickPiles().filter((p) => this.mode !== 'waves' || p.team === 0);
  }

  /** Towers and heroes for both sides. */
  setupSides() {
    for (let team = 0; team < 2; team++) {
      const p = this.players[team];
      if (!p) continue;
      if (this.mode === 'waves' && team === 1) continue;
      for (const t of towerLayout(team)) this.addTower(team, t, p.kingLevel);
    }
    for (let team = 0; team < 2; team++) {
      const p = this.players[team];
      if (!p || !p.setup.heroId) continue;
      if (this.mode === 'waves' && team === 1) continue;
      this.spawnHero(team);
    }
  }

  // ───────────────────────── setup ─────────────────────────

  makePlayer(team, setup) {
    const order = this.rng.shuffle(setup.deck.slice());
    return {
      team,
      setup,
      name: setup.name,
      isAI: !!setup.isAI,
      kingLevel: setup.kingLevel || 1,
      hand: order.slice(0, 4),
      queue: order.slice(4),
      elixir: ELIXIR_START,
      bricks: BRICKS_START,
      brickT: 0,
      crowns: 0,
      hero: null,
      pet: null,
      heroRespawnT: 0,
      stats: { cardsPlayed: 0, spellsCast: 0, kills: 0, heroKills: 0, towers: 0, bricks: 0, forms: 0, elements: 0 },
      pockets: { left: false, right: false },
      lastPlayed: null,
    };
  }

  addTower(team, layout, kingLevel) {
    const def = TOWERS[layout.type];
    const km = kingMult(kingLevel);
    const t = {
      id: this.nextId++,
      kind: 'tower',
      type: layout.type,
      side: layout.side,
      team,
      x: layout.x,
      y: layout.y,
      r: def.radius,
      h: layout.type === 'king' ? 3 : 2.5,
      hp: def.hp * km,
      maxHp: def.hp * km,
      dmg: def.dmg * km,
      hs: def.hs,
      range: def.range,
      targets: 'both',
      alive: true,
      active: layout.type !== 'king',
      activateT: 0,
      deployT: 0,
      status: {},
      flash: 0,
      attackCd: 0,
      shield: 0,
      element: null,
      level: kingLevel,
      anim: 'idle',
      mass: 999,
    };
    this.towers.push(t);
    this.entities.push(t);
    return t;
  }

  spawnHero(team) {
    const p = this.players[team];
    const h = createHero(this, team, { ...p.setup, kingLevel: p.kingLevel });
    p.hero = h;
    this.entities.push(h);
    if (p.setup.petId) {
      const pet = createPet(this, h, p.setup.petId);
      if (pet) {
        p.pet = pet;
        this.entities.push(pet);
      }
    }
    return h;
  }

  // ───────────────────────── spawning ─────────────────────────

  /**
   * Spawn one unit of a card (or extra unit id).
   * @returns the entity or null
   */
  spawnUnit(team, cardOrUnitId, x, y, level = 1, extra = {}) {
    const card = CARDS[cardOrUnitId];
    const u = card?.unit ?? unitDef(cardOrUnitId);
    if (!u) return null;
    const m = levelMult(level) * (this.mode === 'waves' && team === 1 ? this.waveMult || 1 : 1);
    const count = u.count || 1;
    const hp = u.hp * m * (extra.hpMult || 1);
    const sp = { ...(u.special || {}) };
    if (extra.noRebirth) delete sp.rebirth;
    const e = {
      id: this.nextId++,
      kind: 'troop',
      cardId: card ? cardOrUnitId : extra.cardId || cardOrUnitId,
      sprite: u.sprite,
      team,
      x: clamp(x, 0.4, this.W - 0.4),
      y: clamp(y, 0.4, this.H - 0.4),
      r: u.radius || 0.4,
      h: (u.radius || 0.4) * 2.2,
      big: (u.radius || 0.4) >= 0.7,
      hp,
      maxHp: hp,
      dmg: (u.dmg || 0) * m,
      hs: u.hs || 1,
      speed: u.speed || 1,
      range: u.range || 0.5,
      targets: u.targets || 'ground',
      flying: !!u.flying,
      splash: u.splash || 0,
      proj: u.proj ?? null,
      effects: u.effects || null,
      special: sp,
      mass: u.mass || 2,
      level,
      lvlMult: m,
      costShare: card ? card.cost / count : u.costShare || 1,
      alive: true,
      deployT: extra.deployT ?? 1,
      status: {},
      flash: 0,
      facing: team === 0 ? 1 : -1,
      anim: 'idle',
      age: 0,
      attackCd: 0,
      firstHit: Math.min(0.5, (u.hs || 1) * 0.5),
      retargetT: 0,
      target: null,
      hatchCard: extra.hatchCard,
      shield: 0,
    };
    if (sp.stealth) {
      e.status.invisible = 999;
      e.untargetable = true;
    }
    this.entities.push(e);
    return e;
  }

  spawnBuilding(team, cardOrId, x, y, level = 1, extra = {}) {
    const card = CARDS[cardOrId];
    const b = card?.building || EXTRA_UNITS[cardOrId] || (cardOrId === 'wall' ? { sprite: 'wall', hp: 700, radius: 0.5 } : null);
    if (!b) return null;
    const m = levelMult(level);
    const hp = extra.hp ?? b.hp * m;
    const e = {
      id: this.nextId++,
      kind: 'building',
      cardId: cardOrId,
      sprite: b.sprite || cardOrId,
      team,
      x: clamp(x, 0.6, this.W - 0.6),
      y: clamp(y, 0.6, this.H - 0.6),
      r: b.radius || 0.5,
      h: cardOrId === 'bricktower' ? 1.5 : 1.1,
      hp,
      maxHp: hp,
      dmg: extra.dmg ?? (b.dmg || 0) * m,
      hs: b.hs || 1,
      range: b.range || 0,
      targets: b.targets || 'none',
      proj: b.proj ?? null,
      splash: b.splash || 0,
      effects: b.effects || null,
      special: b.special || {},
      spawn: b.spawn || null,
      lifetime: extra.lifetime ?? b.lifetime ?? 0,
      isWall: !!extra.isWall,
      hidden: !!b.special?.hidden,
      level,
      lvlMult: m,
      alive: true,
      deployT: extra.deployT ?? 1,
      status: {},
      flash: 0,
      anim: 'idle',
      age: 0,
      attackCd: 0.5,
      shield: 0,
      mass: 999,
      costShare: card?.cost || 1,
    };
    this.entities.push(e);
    return e;
  }

  // ───────────────────────── card play ─────────────────────────

  zonesFor(team) {
    return deployZones(team, this.players[team].pockets);
  }

  /** Where a card would land if released at (x, y); null if it cannot be placed there. */
  previewPlacement(team, cardId, x, y) {
    const card = CARDS[cardId];
    if (!card) return null;
    if (card.type === 'spell' && !card.spell.ownSideOnly) {
      return { x: clamp(x, 0.5, this.W - 0.5), y: clamp(y, 0.5, this.H - 0.5) };
    }
    const zones = this.zonesFor(team);
    let pt = inZones(zones, x, y) ? { x, y } : clampToZones(zones, x, y);
    if (!pt) return null;
    // keep off towers
    for (const t of this.towers) {
      if (!t.alive) continue;
      const rr = t.r + 0.45;
      const d2 = dist2(pt.x, pt.y, t.x, t.y);
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 0.01;
        pt = { x: t.x + ((pt.x - t.x) / d) * rr, y: t.y + ((pt.y - t.y) / d) * rr };
      }
    }
    if (!inZones(zones, pt.x, pt.y)) pt = clampToZones(zones, pt.x, pt.y);
    if (this.isWasteland(pt.x, pt.y)) return null;
    if (inRiver(pt.y) && !onBridge(pt.x)) return null;
    return pt;
  }

  isWasteland(x, y) {
    const i = Math.floor(y) * this.W + Math.floor(x);
    return this.wasteGrid[i] > 0;
  }

  /**
   * Play the card at hand slot `slot`.
   * @returns {{ ok: boolean, reason?: string }}
   */
  playCard(team, slot, x, y) {
    if (this.phase !== 'play' && this.phase !== 'overtime') return { ok: false, reason: 'not-started' };
    const p = this.players[team];
    const cardId = p.hand[slot];
    const card = CARDS[cardId];
    if (!card) return { ok: false, reason: 'no-card' };
    if (p.elixir < card.cost) return { ok: false, reason: 'elixir' };
    const pt = this.previewPlacement(team, cardId, x, y);
    if (!pt) return { ok: false, reason: 'placement' };
    p.elixir -= card.cost;
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
    if (card.type === 'spell') {
      castSpell(this, team, card, x, y, level);
      this.players[team] && (this.players[team].stats.spellsCast += 1);
      this.rings.push({ x, y, r: card.spell.radius || 1, color: team === 0 ? '#7fb8ff' : '#ff8a7f', t: 0.35, max: 0.35 });
      return;
    }
    if (card.type === 'building') {
      this.spawnBuilding(team, card.id, x, y, level);
      this.sfx('build');
      this.puff(x, y, '#d9c7a8', 8);
      return;
    }
    const u = card.unit;
    const n = u.count || 1;
    const spread = n === 1 ? 0 : n <= 3 ? 0.55 : 0.8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (team === 0 ? -Math.PI / 2 : Math.PI / 2);
      this.spawnUnit(team, card.id, x + Math.cos(a) * spread, y + Math.sin(a) * spread * 0.8, level, { deployT: 1 + i * 0.05 });
    }
    this.sfx('deploy');
    this.dust(x, y, 0.8);
  }

  // ───────────────────────── commands ─────────────────────────

  heroMove(team, x, y) {
    const h = this.players[team]?.hero;
    if (!h || !h.alive) return;
    h.moveTo = { x: clamp(x, 0.5, this.W - 0.5), y: clamp(y, 0.5, this.H - 0.5) };
    h.focus = null;
    if (!this.players[team].isAI) this.emit('heroMoveCmd', { team });
  }
  heroFocus(team, target) {
    const h = this.players[team]?.hero;
    if (!h || !h.alive) return;
    h.focus = target;
    h.moveTo = null;
    if (!this.players[team].isAI) this.emit('heroMoveCmd', { team });
  }
  heroUpgrade(team) {
    const h = this.players[team]?.hero;
    return h ? upgradeForm(this, h) : false;
  }
  heroSpell(team, i) {
    const h = this.players[team]?.hero;
    return h ? castHeroSpell(this, h, i) : false;
  }
  heroGadget(team) {
    const h = this.players[team]?.hero;
    return h ? useGadget(this, h) : false;
  }
  canElementTower(team, tower) {
    return tower && tower.alive && tower.team === team && tower.type === 'princess' && !tower.element && this.players[team].bricks >= TOWER_ELEMENT_COST;
  }
  elementTower(team, tower, element) {
    if (!this.canElementTower(team, tower) || !ELEMENTS[element]) return false;
    this.players[team].bricks -= TOWER_ELEMENT_COST;
    tower.element = element;
    if (element === 'earth') {
      tower.maxHp *= 1.3;
      tower.hp = Math.min(tower.maxHp, tower.hp + tower.maxHp * 0.3);
    }
    this.flashRing(tower.x, tower.y - 1, 2, this.elementColor(element));
    this.sparkle(tower.x, tower.y - 1.2, 1.5, this.elementColor(element), 20);
    this.sfx('form_upgrade', { pitch: 0.8 });
    this.players[team].stats.elements++;
    this.emit('element', { team, tower, element });
    return true;
  }
  emote(team, id) {
    const king = this.towers.find((t) => t.team === team && t.type === 'king');
    const x = king ? king.x : 9;
    const y = king ? king.y - 3.2 : team === 0 ? 27 : 5;
    this.emotes = this.emotes.filter((e) => e.team !== team);
    this.emotes.push({ team, id, x, y, t: 2.2, max: 2.2 });
    this.sfx(id === 'baa' ? 'sheep' : 'emote', { volume: 0.6 });
  }

  // ───────────────────────── economy helpers ─────────────────────────

  addElixir(team, n, x, y) {
    const p = this.players[team];
    if (!p) return;
    p.elixir = Math.min(ELIXIR_MAX, p.elixir + n);
    if (x != null) this.floatText(x, y, `+${n}`, '#e07bff', 1.1);
  }
  addBricks(team, n, x, y, quiet = false) {
    const p = this.players[team];
    if (!p || n <= 0) return;
    p.bricks += n;
    p.stats.bricks += n;
    if (x != null && !quiet) this.floatText(x, y, `+${n}`, '#ff9b5a', 0.9);
    if (x != null) this.fx.push({ x, y, vx: 0, vy: -1.2, life: 0.6, max: 0.6, color: '#e8743b', size: 2, kind: 'brick' });
  }
  stat(team, key, n = 1) {
    const p = this.players[team];
    if (p && p.stats[key] !== undefined) p.stats[key] += n;
  }

  // ───────────────────────── events from combat ─────────────────────────

  onTowerDestroyed(t, src) {
    const enemy = 1 - t.team;
    this.puff(t.x, t.y - 1, '#d9c7a8', 30);
    this.explosion(t.x, t.y - 1, 2.2, '#ffb347');
    this.shake(0.8);
    this.sfx('tower_destroy');
    const scorer = this.players[enemy];
    if (scorer) {
      scorer.crowns += t.type === 'king' ? 3 - scorer.crowns : 1;
      scorer.crowns = Math.min(3, scorer.crowns);
      scorer.stats.towers++;
      this.addBricks(enemy, TOWER_KILL_BRICKS, t.x, t.y - 1.5);
      if (t.type === 'princess') scorer.pockets[t.side] = true;
    }
    this.emit('crown', { team: enemy, tower: t });
    if (t.type === 'princess') {
      const king = this.towers.find((k) => k.team === t.team && k.type === 'king' && k.alive);
      if (king) activateKing(this, king);
    }
    if (t.type === 'king') {
      // the whole side falls
      for (const o of this.towers) if (o.team === t.team && o.alive) {
        o.alive = false;
        o.hp = 0;
      }
      this.finish(enemy, 'king');
    } else if (this.overtime) {
      this.finish(enemy, 'overtime');
    }
    if (this.mode === 'waves') {
      // in siege mode the defender loses when the king falls; princess losses just hurt
    }
  }

  onHeroDeath(h, src) {
    const p = this.players[h.team];
    this.puff(h.x, h.y - 0.4, '#ffffff', 16);
    this.sfx('hero_die');
    p.heroRespawnT = this.mode === 'waves' ? 5 : 6;
    h.channel = null;
    if (p.pet) p.pet.alive = false;
    const enemy = 1 - h.team;
    this.addBricks(enemy, HERO_KILL_BRICKS, h.x, h.y - 1);
    if (src) this.stat(enemy, 'kills', 1);
    this.emit('heroDeath', { team: h.team });
  }

  respawnHero(team) {
    const p = this.players[team];
    const old = p.hero;
    const h = createHero(this, team, { ...p.setup, kingLevel: p.kingLevel });
    // keep form, cooldowns and gadget timer
    if (old) {
      h.form = old.form;
      h.maxHp = h.baseHp * [1, 1.25, 1.55][h.form - 1];
      h.hp = h.maxHp;
      h.armor = h.maxArmor = h.maxArmor * [1, 1.25, 1.55][h.form - 1];
      h.spellCd = old.spellCd.slice();
      h.gadgetCd = Math.max(0, old.gadgetCd);
    }
    h.status.invuln = 1.5;
    this.entities = this.entities.filter((e) => e !== old);
    p.hero = h;
    this.entities.push(h);
    if (p.setup.petId) {
      const pet = createPet(this, h, p.setup.petId);
      if (pet) {
        p.pet = pet;
        this.entities.push(pet);
      }
    }
    this.sparkle(h.x, h.y - 0.5, 1, '#ffffff', 14);
    this.sfx('hero_respawn');
    this.emit('heroRespawn', { team });
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
        this.emit('banner', { text: this.mode === 'waves' ? 'DEFEND!' : 'FIGHT!', kind: 'fight' });
        this.sfx('fight');
      }
      this.updateFx(dt);
      return;
    }
    this.time += dt;
    this.tickClock(dt);
    for (let team = 0; team < 2; team++) {
      const p = this.players[team];
      if (!p) continue;
      p.elixir = Math.min(ELIXIR_MAX, p.elixir + (dt / ELIXIR_SECONDS) * this.elixirMult * (p.elixirBoost || 1));
      p.brickT += dt;
      if (p.brickT >= BRICK_TRICKLE) {
        p.brickT -= BRICK_TRICKLE;
        p.bricks += 1;
        p.stats.bricks += 1;
      }
      if (p.hero && !p.hero.alive) {
        p.heroRespawnT -= dt;
        if (p.heroRespawnT <= 0 && this.kingAlive(team)) this.respawnHero(team);
      }
    }
    this.ai?.forEach((a) => a.update(dt));
    this.waves?.update(dt);
    this.tutorial?.update(dt);

    for (const e of this.entities) {
      if (!e.alive) continue;
      tickStatus(this, e, dt);
      if (!e.alive) continue;
      switch (e.kind) {
        case 'troop':
          updateTroop(this, e, dt);
          break;
        case 'building':
          updateBuilding(this, e, dt);
          break;
        case 'tower':
          updateTower(this, e, dt);
          break;
        case 'hero':
          updateHero(this, e, dt);
          break;
        case 'pet':
          updatePet(this, e, dt);
          break;
        default:
          break;
      }
    }
    this.tickGround(dt);
    separate(this);
    updateProjectiles(this, dt);
    updateAreas(this, dt);
    // keep dead heroes in the list until respawn (HUD reads them); drop everything else
    this.entities = this.entities.filter((e) => e.alive || e.kind === 'hero');
    this.updateFx(dt);
    this.checkEnd();
  }

  /** Put a hero that landed from a dash or jump back on solid ground. */
  landSafely(h) {
    if (inRiver(h.y) && !onBridge(h.x)) h.y = h.y < (RIVER_TOP + RIVER_BOTTOM) / 2 ? RIVER_TOP - 0.1 : RIVER_BOTTOM + 0.1;
  }

  kingAlive(team) {
    return this.towers.some((t) => t.team === team && t.type === 'king' && t.alive);
  }

  tickClock(dt) {
    if (this.mode === 'waves' || this.mode === 'tutorial') {
      this.clock += dt; // counts up for display
      return;
    }
    const before = this.clock;
    this.clock -= dt;
    if (!this.overtime && before > DOUBLE_ELIXIR_AT && this.clock <= DOUBLE_ELIXIR_AT) {
      this.elixirMult = 2;
      this.emit('banner', { text: 'DOUBLE FAITH!', kind: 'elixir' });
      this.sfx('double_elixir');
    }
    if (!this.overtime && this.clock <= 0) {
      const [a, b] = [this.players[0].crowns, this.players[1].crowns];
      if (a !== b) {
        this.finish(a > b ? 0 : 1, 'time');
        return;
      }
      this.overtime = true;
      this.clock = OVERTIME;
      this.elixirMult = 3;
      this.phase = 'overtime';
      this.emit('banner', { text: 'OVERTIME!', kind: 'overtime' });
      this.sfx('overtime');
      this.audio?.setIntensity?.(1);
    } else if (this.overtime && this.clock <= 0) {
      // tiebreaker: the side whose weakest tower has less HP loses
      const minHp = (team) => Math.min(...this.towers.filter((t) => t.team === team && t.alive).map((t) => t.hp / t.maxHp));
      const h0 = minHp(0);
      const h1 = minHp(1);
      if (Math.abs(h0 - h1) < 1e-6) this.finish(-1, 'draw');
      else this.finish(h0 > h1 ? 0 : 1, 'tiebreak');
    }
  }

  /** Burning ground and wasteland. */
  tickGround(dt) {
    const g = this.fireGrid;
    let any = false;
    for (let i = 0; i < g.length; i++) {
      if (this.wasteGrid[i] > 0) this.wasteGrid[i] -= dt;
      if (g[i] <= 0) continue;
      any = true;
      g[i] -= dt;
      if (this.settings.particles !== 'low' && Math.random() < dt * 5) {
        const x = (i % this.W) + Math.random();
        const y = Math.floor(i / this.W) + Math.random();
        this.fx.push({ x, y, vx: (Math.random() - 0.5) * 0.4, vy: -1.5 - Math.random(), life: 0.5, max: 0.5, color: Math.random() < 0.5 ? '#ff7a2e' : '#ffd166', size: 2, kind: 'fire' });
      }
    }
    if (!any) return;
    this.groundTick = (this.groundTick || 0) - dt;
    if (this.groundTick > 0) return;
    this.groundTick = 0.25;
    for (const e of this.entities) {
      if (!e.alive || e.flying || e.kind === 'tower') continue;
      const i = Math.floor(e.y) * this.W + Math.floor(e.x);
      if (g[i] > 0 && this.fireTeam[i] !== e.team) damage(this, e, this.fireDps[i] * 0.25, { effects: { burn: { dps: 8, dur: 1 } } });
    }
  }

  igniteGround(x, y, r, dur, dps, team) {
    for (let ty = Math.floor(y - r); ty <= Math.ceil(y + r); ty++) {
      for (let tx = Math.floor(x - r); tx <= Math.ceil(x + r); tx++) {
        if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) continue;
        if ((tx + 0.5 - x) ** 2 + (ty + 0.5 - y) ** 2 > r * r) continue;
        if (!this.canBurn(tx, ty)) continue;
        const i = ty * this.W + tx;
        this.fireGrid[i] = Math.max(this.fireGrid[i], dur * (0.7 + Math.random() * 0.5));
        this.fireDps[i] = dps;
        this.fireTeam[i] = team;
      }
    }
  }

  canBurn(tx, ty) {
    return !inRiver(ty + 0.5);
  }

  wasteland(x, y, r, dur) {
    for (let ty = Math.floor(y - r); ty <= Math.ceil(y + r); ty++) {
      for (let tx = Math.floor(x - r); tx <= Math.ceil(x + r); tx++) {
        if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) continue;
        if ((tx + 0.5 - x) ** 2 + (ty + 0.5 - y) ** 2 > r * r) continue;
        this.wasteGrid[ty * this.W + tx] = dur;
      }
    }
  }

  checkEnd() {
    if (this.phase === 'ended') return;
    if (this.mode === 'waves') {
      if (!this.kingAlive(0)) this.finish(1, 'king');
    }
  }

  finish(winner, reason) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    const crowns = this.players.map((p) => (p ? p.crowns : 0));
    this.result = { winner, reason, crowns, wave: this.waves?.wave || 0 };
    this.audio?.setIntensity?.(0);
    for (const t of this.towers) {
      if (t.alive && winner >= 0 && t.team === winner && t.type === 'king') t.cheer = true;
    }
    this.emit('end', this.result);
  }

  pause(on) {
    this.paused = on;
  }

  // ───────────────────────── fx (read by the renderer) ─────────────────────────

  emit(name, payload) {
    this.ev.emit(name, payload);
  }
  on(name, fn) {
    return this.ev.on(name, fn);
  }
  sfx(name, opts) {
    if (this.silent) return;
    this.audio?.sfx?.(name, opts);
  }
  elementColor(el) {
    return ELEMENTS[el]?.color || '#ffffff';
  }
  low() {
    return this.settings.particles === 'low';
  }
  floatText(x, y, text, color = '#fff', scale = 1) {
    if (this.texts.length > 60) this.texts.shift();
    this.texts.push({ x: x + (Math.random() - 0.5) * 0.3, y, text, color, scale, t: 0.8, max: 0.8 });
  }
  puff(x, y, color, n = 8) {
    const k = this.low() ? Math.ceil(n / 3) : n;
    for (let i = 0; i < k; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 1.6;
      this.fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.6, life: 0.4 + Math.random() * 0.4, max: 0.8, color, size: 2 + (Math.random() < 0.3 ? 1 : 0), drag: 3 });
    }
  }
  spark(x, y, color, n = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.fx.push({ x, y, vx: Math.cos(a) * 2.5, vy: Math.sin(a) * 2.5, life: 0.18, max: 0.18, color, size: 1 });
    }
  }
  sparkle(x, y, r, color, n = 10) {
    const k = this.low() ? Math.ceil(n / 3) : n;
    for (let i = 0; i < k; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      this.fx.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: 0, vy: -0.8 - Math.random(), life: 0.6 + Math.random() * 0.5, max: 1.1, color, size: 1, kind: 'twinkle' });
    }
  }
  explosion(x, y, r, color) {
    this.rings.push({ x, y, r, color, t: 0.3, max: 0.3, fill: true });
    const n = this.low() ? 6 : Math.round(10 + r * 8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * r * 3;
      this.fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7 - 1, life: 0.3 + Math.random() * 0.35, max: 0.65, color: Math.random() < 0.5 ? color : '#fff2b0', size: 2 + (Math.random() < 0.4 ? 1 : 0), drag: 2.5 });
    }
    for (let i = 0; i < (this.low() ? 2 : 6); i++) this.fx.push({ x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r * 0.6, vx: 0, vy: -0.6, life: 0.9, max: 0.9, color: '#5b5068', size: 3, kind: 'smoke' });
  }
  flashRing(x, y, r, color) {
    this.rings.push({ x, y, r, color, t: 0.45, max: 0.45 });
  }
  dust(x, y, r) {
    for (let i = 0; i < (this.low() ? 3 : 8); i++) {
      const a = Math.random() * Math.PI * 2;
      this.fx.push({ x: x + Math.cos(a) * r * 0.5, y: y + Math.sin(a) * r * 0.3, vx: Math.cos(a) * 1.2, vy: Math.sin(a) * 0.5 - 0.3, life: 0.4, max: 0.4, color: '#e8dcc0', size: 2, drag: 4 });
    }
  }
  bolt(x0, y0, x1, y1, color = '#fffbe0', w = 2) {
    const pts = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const j = i === 0 || i === n ? 0 : (Math.random() - 0.5) * 0.7;
      pts.push({ x: x0 + (x1 - x0) * t + j, y: y0 + (y1 - y0) * t + j * 0.3 });
    }
    this.bolts.push({ pts, color, w, t: 0.18, max: 0.18 });
  }
  beam(x0, y0, x1, y1, color, t = 0.12, w = 1) {
    this.beams.push({ x0, y0, x1, y1, color, t, max: t, w });
  }
  trail(x0, y0, x1, y1, color) {
    this.trails.push({ x0, y0, x1, y1, color, t: 0.25, max: 0.25 });
  }
  muzzle(x, y, a, s = 1) {
    if (this.low()) return;
    this.fx.push({ x: x + Math.cos(a) * 0.25, y: y + Math.sin(a) * 0.25, vx: 0, vy: 0, life: 0.06, max: 0.06, color: '#fff2a8', size: 2 * s });
  }
  flame(x, y, a, range, n = 3) {
    const k = this.low() ? 1 : n;
    for (let i = 0; i < k; i++) {
      const aa = a + (Math.random() - 0.5) * 0.6;
      const s = range * (1.8 + Math.random());
      this.fx.push({ x, y, vx: Math.cos(aa) * s, vy: Math.sin(aa) * s, life: 0.32, max: 0.32, color: Math.random() < 0.5 ? '#ff7a2e' : '#ffd166', size: 2 + (Math.random() < 0.5 ? 1 : 0), kind: 'fire', drag: 1.5 });
    }
  }
  spray(x, y, a, range, color) {
    for (let i = 0; i < (this.low() ? 1 : 3); i++) {
      const aa = a + (Math.random() - 0.5) * 0.5;
      const s = range * (1.6 + Math.random());
      this.fx.push({ x, y, vx: Math.cos(aa) * s, vy: Math.sin(aa) * s, life: 0.35, max: 0.35, color, size: 2, drag: 1.5 });
    }
  }
  slash(x, y, a, r, arc) {
    this.rings.push({ x, y, r, color: '#ffffff', t: 0.15, max: 0.15, arc: { a, w: arc } });
  }
  crack(x0, y0, x1, y1) {
    this.cracks.push({ x0, y0, x1, y1, t: 2.5, max: 2.5, seed: Math.random() });
    this.dust((x0 + x1) / 2, (y0 + y1) / 2, 2);
  }
  ringFire(x, y, r) {
    for (let i = 0; i < (this.low() ? 3 : 10); i++) {
      const a = Math.random() * Math.PI * 2;
      this.fx.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.7, vx: -Math.sin(a) * 2, vy: Math.cos(a) * 1.4 - 1, life: 0.3, max: 0.3, color: Math.random() < 0.5 ? '#ff7a2e' : '#ffd166', size: 2, kind: 'fire' });
    }
  }
  decal(x, y, r) {
    this.decals.push({ x, y, r, t: 14, max: 14 });
    if (this.decals.length > 20) this.decals.shift();
  }
  shake(s) {
    this.shakeT = Math.max(this.shakeT, s);
  }

  updateFx(dt) {
    for (const p of this.fx) {
      p.life -= dt;
      const drag = p.drag ? Math.max(0, 1 - p.drag * dt) : 1;
      p.vx *= drag;
      p.vy *= drag;
      if (p.kind === 'brick') p.vy += 0;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.fx = this.fx.filter((p) => p.life > 0);
    if (this.fx.length > 900) this.fx.splice(0, this.fx.length - 900);
    for (const list of [this.beams, this.bolts, this.rings, this.texts, this.trails, this.cracks, this.emotes, this.decals]) for (const b of list) b.t -= dt;
    this.beams = this.beams.filter((b) => b.t > 0);
    this.bolts = this.bolts.filter((b) => b.t > 0);
    this.rings = this.rings.filter((b) => b.t > 0);
    this.texts = this.texts.filter((b) => b.t > 0);
    this.trails = this.trails.filter((b) => b.t > 0);
    this.cracks = this.cracks.filter((b) => b.t > 0);
    this.emotes = this.emotes.filter((b) => b.t > 0);
    this.decals = this.decals.filter((b) => b.t > 0);
    for (const t of this.texts) t.y -= dt * 1.4;
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt * 2.2);
    if (this.whiteFlash > 0) this.whiteFlash = Math.max(0, this.whiteFlash - dt * 1.5);
  }

  /** Summary for the results screen and profile. */
  summary(team = 0) {
    const p = this.players[team];
    return { ...p.stats, crowns: p.crowns };
  }
}

export { kill };
