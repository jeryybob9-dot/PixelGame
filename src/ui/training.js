// Training: a scripted first match. Foreman Bo walks the player through every part of the match screen, one touch at
// a time: the game waits while a new idea is shown, only the right button works, and a hand shows what to do.

import { CARDS } from '../data/cards.js';
import { cardBricks } from '../realm/constants.js';
import { Guide } from './guide.js';
import { cardArtURL } from './components.js';

const HAND = ['knight', 'archers', 'volley', 'giant'];
const QUEUE = ['skeletons', 'gunners', 'builder', 'bricktower'];

export class TrainingCoach {
  /**
   * @param {{ app: any, R: any, api: any, ai: any, onSkip?: () => void }} o
   */
  constructor({ app, R, api, ai, onSkip }) {
    this.app = app;
    this.R = R;
    this.api = api;
    this.ai = ai;
    this.frozen = false; // the first step freezes the match once the countdown is over
    this.final = false;
    this.started = false;
    this.idleT = 0;
    this.usedPower = false;
    this.ordered = false;
    this.shieldCastle = true;

    // a gentle, scripted rival: it only moves when the lesson says so
    R.clockFrozen = true;
    R.quietStart = true;
    R.countdown = Math.min(R.countdown, 0.6);
    if (ai) ai.enabled = false;
    const [me, them] = R.players;
    const k = them.keep;
    k.maxHp *= 0.4;
    k.hp = k.maxHp;
    k.dmg *= 0.5;
    if (them.hero) {
      them.hero.maxHp *= 0.6;
      them.hero.hp = them.hero.maxHp;
      them.hero.dmgBoost = 0.5;
    }
    me.hand = HAND.slice();
    me.queue = QUEUE.slice();
    R.on('heroSpell', ({ team }) => team === 0 && (this.usedPower = true));
    R.on('order', ({ team, id }) => team === 0 && id === 'house' && (this.ordered = true));
    R.on('play', ({ team }) => team === 0 && (this.idleT = 0));

    this.guide = new Guide(app);
    this.onSkip = onSkip;
  }

  update(dt) {
    const R = this.R;
    if (!this.started && R.phase === 'play') {
      this.started = true;
      this.guide.run(this.steps(), { onSkip: this.onSkip });
    }
    // the red castle holds until the lesson reaches the final push
    const k = R.players[1].keep;
    if (this.shieldCastle && k.alive) k.hp = Math.max(k.hp, k.maxHp * 0.85);
    // final push: if the player stalls, the hand suggests a card
    if (this.final && R.phase === 'play') {
      this.idleT += dt;
      const p = R.players[0];
      const slot = p.hand.findIndex((id) => CARDS[id].type === 'troop' && p.bricks >= cardBricks(CARDS[id]));
      if (this.idleT > 7 && slot >= 0) {
        const id = p.hand[slot];
        this.guide.hint({ type: 'drag', from: () => this.api.els.cards[slot], to: () => this.api.worldBox(this.bridge.x - 0.5, this.bridge.y + 3, this.bridge.x + 0.5, this.bridge.y + 4), ghost: cardArtURL(id) });
      } else this.guide.hint(null);
    } else this.guide.hint(null);
  }

  destroy() {
    this.guide.destroy();
  }

  // ───────────── helpers ─────────────

  get me() {
    return this.R.players[0];
  }

  get bridge() {
    const R = this.R;
    const list = R.map.bridges || [];
    const b = list.slice().sort((a, c) => Math.abs(a.x - R.W / 2) - Math.abs(c.x - R.W / 2))[0];
    return b ? { x: b.x, y: (R.H - 1) / 2 } : { x: R.W / 2, y: (R.H - 1) / 2 };
  }

  /** The nearest open, walkable tile centre. */
  free(x, y) {
    const R = this.R;
    for (let r = 0; r < 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = Math.floor(x) + dx;
          const ty = Math.floor(y) + dy;
          if (!R.grid.inside(tx, ty) || R.blockedAt(tx, ty) || R.grid.occ[ty * R.W + tx] !== 0) continue;
          return { x: tx + 0.5, y: ty + 0.5 };
        }
      }
    }
    return { x, y };
  }

  troops(team) {
    return this.R.entities.filter((e) => e.alive && e.kind === 'troop' && e.team === team);
  }

  /** Weak wild monsters for the hero to practise on. */
  monsters(n, cx, cy, radius, hp) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const s = this.free(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      const m = this.R.spawnMonster('skeleton', s.x, s.y);
      if (m) {
        m.hp = m.maxHp = hp;
        m.dmg *= 0.4;
        out.push(m);
      }
    }
    return out;
  }

  enemyCard(id, x, y) {
    const R = this.R;
    const before = new Set(R.entities.map((e) => e.id));
    const at = this.free(x, y);
    R.deploy(1, CARDS[id], at.x, at.y, 1);
    return R.entities.filter((e) => !before.has(e.id) && e.kind === 'troop');
  }

  /** Make sure the card is in the hand (slot) and affordable. */
  ready(id) {
    const p = this.me;
    let slot = p.hand.indexOf(id);
    if (slot < 0) {
      slot = 0;
      p.queue.push(p.hand[0]);
      p.hand[0] = id;
      const qi = p.queue.indexOf(id);
      if (qi >= 0) p.queue.splice(qi, 1);
    }
    p.bricks = Math.max(p.bricks, cardBricks(CARDS[id]));
    return slot;
  }

  slotEl(id) {
    const i = this.me.hand.indexOf(id);
    return i >= 0 ? this.api.els.cards[i] : null;
  }

  groupBox(list, pad = 0.9) {
    const live = list.filter((e) => e.alive);
    if (!live.length) return null;
    const xs = live.map((e) => e.x);
    const ys = live.map((e) => e.y);
    return this.api.worldBox(Math.min(...xs) - pad, Math.min(...ys) - pad - 0.8, Math.max(...xs) + pad, Math.max(...ys) + pad);
  }

  castleBox(k) {
    return this.api.worldBox(k.x - 2, k.y - 3.4, k.x + 2, k.y + 1.8);
  }

  // ───────────── the lesson ─────────────

  steps() {
    const R = this.R;
    const api = this.api;
    const els = api.els;
    const me = this.me;
    const k0 = me.keep;
    const k1 = R.players[1].keep;
    const riverY = (R.H - 1) / 2;
    const hero = () => me.hero;
    const freeze = (on) => () => {
      this.frozen = on;
    };
    let start = null;
    let foes = [];
    let knight = null;
    let attackers = [];
    let pack = [];
    let dropKnight = null;
    let dropArchers = null;
    let houseSpot = null;
    let base = 0;
    let knightSlot = 0;
    const played = () => me.stats.cardsPlayed > base;
    const moved = () => {
      const h = hero();
      if (!h) return 0;
      if (!start) start = { x: h.x, y: h.y };
      return Math.hypot(h.x - start.x, h.y - start.y);
    };
    const leftMap = () => {
      const r = api.mapRect();
      return { x: r.x, y: r.y, w: r.w * 0.55, h: r.h };
    };
    const dropAt = (get) => () => {
      const pt = get();
      return pt ? api.worldBox(pt.x - 1.2, pt.y - 1.2, pt.x + 1.2, pt.y + 1.2) : null;
    };

    return [
      // ── the goal ──
      { text: 'Hi, I\'m Foreman Bo! Welcome to Brickbox. I\'ll show you how to win. It only takes a minute!', next: 'tap', bubble: 'mid', enter: freeze(true) },
      {
        text: 'See that RED castle across the river? That\'s your enemy. Knock it down to WIN!',
        enter: () => api.look(k1.x, k1.y + 2.5),
        target: () => this.castleBox(k1),
        delay: 0.9,
        next: 'tap',
      },
      {
        text: 'And this BLUE castle is yours. If it falls, you lose. Protect it!',
        enter: () => api.look(k0.x, k0.y - 1),
        target: () => this.castleBox(k0),
        delay: 0.9,
        next: 'tap',
      },
      { text: 'These bars show both castles\' health. Destroy theirs before they destroy yours!', target: () => els.castles, next: 'tap' },

      // ── the hero ──
      {
        text: 'This is your HERO. Drag on the LEFT side of the screen to walk around.',
        enter: () => {
          api.follow();
          this.frozen = false;
          start = null;
        },
        target: () => [{ at: leftMap(), pass: true, ring: false, pad: 0 }],
        hand: { type: 'joy', at: () => {
          const r = leftMap();
          return { x: r.x + r.w * 0.45, y: r.y + r.h * 0.72 };
        } },
        dim: false,
        next: () => moved() > 3,
      },
      {
        text: 'Monsters! Your hero attacks by itself when enemies are close. Walk over and beat them!',
        enter: () => {
          const h = hero();
          const ty = Math.max(riverY + 4, h.y - 5);
          foes = this.monsters(2, h.x, ty, 0.8, 200);
        },
        target: () => [{ at: leftMap(), pass: true, ring: false, pad: 0 }, { at: () => this.groupBox(foes) }],
        dim: false,
        minTime: 3,
        next: () => foes.every((f) => !f.alive),
        timeout: 30,
        onTimeout: () => foes.forEach((f) => f.alive && (f.hp = 0)),
      },
      {
        text: 'A whole gang! Tap POWER to use your hero\'s special attack.',
        enter: () => {
          this.frozen = true;
          const h = hero();
          if (h) {
            h.spellCd[0] = 0;
            h.spellCd[1] = 0;
            foes = this.monsters(4, h.x, h.y, 1.3, 60);
          }
          this.usedPower = false;
        },
        target: () => [{ at: els.powerBtn, pass: true }, { at: () => this.groupBox(foes), ring: false }],
        hand: { type: 'tap', at: () => els.powerBtn },
        next: () => this.usedPower,
      },
      { overlay: false, enter: freeze(false), next: () => foes.every((f) => !f.alive), timeout: 5, onTimeout: () => foes.forEach((f) => f.alive && (f.hp = 0)) },
      {
        text: 'Boom! POWER takes a few seconds to recharge. Your hero levels up as it fights. Watch the LV badge.',
        target: () => [els.heroBox, els.powerBtn],
        next: 'tap',
        enter: freeze(true),
      },

      // ── bricks and villagers ──
      { text: 'These are your BRICKS. Bricks pay for everything: troops, spells and buildings.', target: () => els.brickBar, next: 'tap' },
      {
        text: 'Your villagers mine brick piles and carry the bricks home. More villagers means more bricks!',
        enter: () => api.look(k0.x, k0.y - 1),
        target: () => {
          const v = R.entities.find((e) => e.alive && e.kind === 'villager' && e.team === 0);
          return [els.villagerChip, v ? api.worldBox(v.x - 0.7, v.y - 1.6, v.x + 0.7, v.y + 0.4) : null];
        },
        delay: 0.6,
        next: 'tap',
      },

      // ── cards ──
      { text: 'These are your CARDS. The number on each card is its price in bricks.', target: () => els.hand, next: 'tap', enter: () => api.follow() },
      {
        text: 'Drag the KNIGHT onto your side of the river. It\'s on the house!',
        enter: () => {
          knightSlot = this.ready('knight');
          base = me.stats.cardsPlayed;
          dropKnight = this.free(k0.x, k0.y - 6);
          api.look(k0.x, k0.y - 4);
        },
        target: () => [{ at: () => this.slotEl('knight'), pass: true }, { at: dropAt(() => dropKnight), pass: true }],
        hand: { type: 'drag', from: () => this.slotEl('knight'), to: dropAt(() => dropKnight), ghost: cardArtURL('knight') },
        next: played,
      },
      {
        text: 'Nice! After you play a card, the NEXT card slides into your hand.',
        target: () => [els.nextBox, els.cards[knightSlot]],
        next: 'tap',
      },
      {
        text: 'Troops march to the red castle all by themselves. Let\'s follow your Knight!',
        enter: () => {
          this.frozen = false;
          knight = R.entities.find((e) => e.alive && e.team === 0 && e.kind === 'troop' && e.cardId === 'knight') || this.troops(0)[0];
          if (knight) api.track(knight);
        },
        overlay: false,
        bubble: 'top',
        next: () => !knight || !knight.alive || knight.y < riverY - 2,
        timeout: 18,
      },
      {
        text: 'Uh-oh, the enemy defends! Troops fight whatever they meet on the way.',
        enter: () => {
          const b = this.bridge;
          const x = knight?.alive ? knight.x : b.x;
          const y = Math.max(4, (knight?.alive ? knight.y : riverY) - 5);
          attackers = [...this.enemyCard('knight', x, y), ...this.enemyCard('archers', x + 0.8, y - 1.2)];
        },
        overlay: false,
        bubble: 'top',
        next: () => !knight || !knight.alive,
        timeout: 25,
        onTimeout: () => knight?.alive && (knight.hp = 0),
      },
      {
        // wait for the counter-attack to cross the river (send one if the defenders all fell)
        overlay: false,
        enter: () => {
          attackers = this.troops(1);
          if (!attackers.length) {
            const b = this.bridge;
            attackers = [...this.enemyCard('knight', b.x, riverY - 3), ...this.enemyCard('skeletons', b.x + 0.6, riverY - 4)];
          }
          for (const a of attackers) a.speed *= 1.3;
          api.track(attackers[0]);
        },
        next: () => attackers.some((a) => a.alive && a.y > riverY + 3) || attackers.every((a) => !a.alive),
        timeout: 25,
      },
      {
        text: 'They\'re coming for your castle! Drag the ARCHERS in front of it to defend.',
        skipIf: () => attackers.every((a) => !a.alive),
        enter: () => {
          this.frozen = true;
          this.ready('archers');
          base = me.stats.cardsPlayed;
          dropArchers = this.free(k0.x, k0.y - 4.5);
          api.look(k0.x, k0.y - 5);
        },
        target: () => [{ at: () => this.slotEl('archers'), pass: true }, { at: dropAt(() => dropArchers), pass: true }, { at: () => this.groupBox(attackers), ring: false }],
        hand: { type: 'drag', from: () => this.slotEl('archers'), to: dropAt(() => dropArchers), ghost: cardArtURL('archers') },
        next: played,
      },
      {
        overlay: false,
        enter: () => {
          this.frozen = false;
          api.look(k0.x, k0.y - 5);
        },
        next: () => attackers.every((a) => !a.alive),
        timeout: 30,
        onTimeout: () => attackers.forEach((a) => a.alive && (a.hp = 0)),
      },
      { text: 'Great defending! Your castle shoots at enemies too.', target: () => this.castleBox(k0), next: 'tap', enter: freeze(true) },

      // ── spells ──
      {
        text: 'A big group of skeletons! Drag the VOLLEY spell onto them. Spells hit everything in an area.',
        enter: () => {
          this.ready('volley');
          base = me.stats.cardsPlayed;
          pack = this.monsters(4, k0.x + 3, k0.y - 8, 0.9, 70);
          api.look(k0.x + 1, k0.y - 6);
        },
        target: () => [{ at: () => this.slotEl('volley'), pass: true }, { at: () => this.groupBox(pack, 1.2), pass: true }],
        hand: { type: 'drag', from: () => this.slotEl('volley'), to: () => this.groupBox(pack), ghost: cardArtURL('volley') },
        delay: 0.5,
        next: played,
      },
      {
        overlay: false,
        enter: freeze(false),
        next: () => pack.every((m) => !m.alive),
        timeout: 4,
        onTimeout: () => pack.forEach((m) => m.alive && (m.hp = 0)),
      },
      { text: 'Spells are perfect for groups. Big troops like a Knight can take a hit, though!', next: 'tap', bubble: 'mid', enter: freeze(true) },

      // ── building ──
      {
        text: 'Time to build! Tap BUILD.',
        enter: () => {
          me.bricks = Math.max(me.bricks, 60);
          api.look(k0.x, k0.y - 1);
        },
        target: () => [{ at: els.buildBtn, pass: true }],
        hand: { type: 'tap', at: () => els.buildBtn },
        next: () => api.buildMode(),
      },
      {
        text: 'A HOUSE gives you 2 more villagers, so you get more bricks. Tap HOUSE.',
        target: () => [{ at: () => els.buildItem('house'), pass: true }, els.buildItem('tower'), els.buildItem('barracks')],
        hand: { type: 'tap', at: () => els.buildItem('house') },
        next: () => api.buildSel() === 'house',
        skipIf: () => this.ordered,
      },
      {
        text: 'Now tap the glowing spot to place it.',
        enter: () => {
          houseSpot = api.houseSpot();
        },
        target: () => [{ at: dropAt(() => houseSpot), pass: true }],
        hand: { type: 'tap', at: () => houseSpot && api.worldBox(houseSpot.x - 0.3, houseSpot.y - 0.3, houseSpot.x + 0.3, houseSpot.y + 0.3) },
        next: () => this.ordered || (api.buildGhost()?.valid && api.buildGhost()?.id === 'house'),
        skipIf: () => this.ordered,
      },
      {
        text: 'Tap the button to build it!',
        target: () => [{ at: els.confirmBtn, pass: true }],
        hand: { type: 'tap', at: () => els.confirmBtn },
        next: () => this.ordered,
        skipIf: () => this.ordered,
      },
      {
        text: 'Your villagers will build it. Later, try a TOWER to shoot enemies and a BARRACKS to send soldiers.',
        enter: freeze(false),
        target: () => els.buildBtn,
        next: 'tap',
      },

      // ── finding your way ──
      { text: 'The MINIMAP shows the whole island. Tap it any time to look around.', target: () => els.minimap, next: 'tap', enter: freeze(true) },
      {
        text: 'When the red castle is off screen, this arrow points to it. Follow it to attack!',
        enter: () => api.follow(),
        skipIf: () => els.goalArrow.hidden,
        target: () => {
          const b = els.goalArrow.getBoundingClientRect();
          return { x: b.left - 28, y: b.top - 28, w: 56, h: 64 };
        },
        delay: 0.3,
        next: 'tap',
      },
      { text: 'Real matches last 5 minutes. If time runs out, the castle with more health wins.', target: () => els.clock, next: 'tap' },

      // ── your turn ──
      {
        text: 'The last minute is a BRICK RUSH: double bricks! Here\'s one now. Send troops over the bridge and knock down the red castle!',
        enter: () => {
          R.rush = true;
          me.bricks = Math.max(me.bricks, 150);
          R.emit('banner', { text: 'BRICK RUSH!', sub: 'Double bricks', kind: 'elixir' });
        },
        target: () => [els.brickBar, els.hand],
        next: 'tap',
        delay: 0.4,
      },
      {
        overlay: false,
        enter: () => {
          this.frozen = false;
          this.final = true;
          this.shieldCastle = false;
          this.idleT = 5;
          api.follow();
          if (this.ai) {
            this.ai.enabled = true;
            this.ai.t = 25;
          }
        },
        next: () => R.phase === 'ended',
      },
      {
        text: 'You did it! You knocked down the red castle. Let\'s open your reward!',
        enter: () => {
          this.final = false;
        },
        skipIf: () => R.result?.winner !== 0,
        delay: 2.4,
        target: () => [{ at: () => document.querySelector('.results .res-actions .btn-gold'), pass: true }],
        hand: { type: 'tap', at: () => document.querySelector('.results .res-actions .btn-gold') },
        next: () => false,
      },
    ];
  }
}
