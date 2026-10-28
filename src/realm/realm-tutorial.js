// Training: a coach walks a new player through one gentle Realm Clash match.

export class RealmTutorial {
  /**
   * @param {import('./realm.js').Realm} R
   * @param {import('./realm-ai.js').RealmAI} ai
   */
  constructor(R, ai) {
    this.R = R;
    this.ai = ai;
    this.step = -1;
    this.t = 0;
    this.start = null;
    // a sleepy rival with a softer castle
    const k = R.players[1]?.keep;
    if (k) {
      k.maxHp *= 0.45;
      k.hp = k.maxHp;
      k.dmg *= 0.5;
    }
    const p = R.players[0];
    this.usedPower = false;
    R.on('heroSpell', ({ team }) => team === 0 && (this.usedPower = true));
    this.steps = [
      { text: 'Your goal: knock down the RED castle across the river. Keep your BLUE castle standing!', focus: 'castle', done: () => this.t > 6 },
      { text: 'Drag on the LEFT side of the island to walk your hero. It attacks enemies by itself.', focus: 'map', done: () => this.moved() > 3 },
      { text: 'Your villagers mine bricks. Bricks pay for everything: troops, spells and buildings.', focus: 'bricks', done: () => this.t > 6 },
      { text: 'Drag a card onto your side of the river. Troops march to the red castle on their own.', focus: 'cards', done: () => p.stats.cardsPlayed > 0 },
      { text: 'Tap BUILD and place a House. More villagers means more bricks.', focus: 'build', done: () => this.ordered('house') },
      { text: 'Tap POWER for your hero\'s special attack. Your hero levels up by fighting.', focus: 'power', done: () => this.usedPower || this.t > 20 },
      { text: 'Send a few troops together, follow the red arrow and knock the red castle down!', focus: 'goal', done: () => this.t > 10 },
    ];
  }

  moved() {
    const h = this.R.players[0].hero;
    if (!h) return 0;
    if (!this.start) this.start = { x: h.x, y: h.y };
    return Math.hypot(h.x - this.start.x, h.y - this.start.y);
  }

  ordered(id) {
    return this.R.structures.some((s) => s.alive && s.team === 0 && s.struct === id);
  }

  update(dt) {
    const R = this.R;
    if (R.phase !== 'play') return;
    if (this.step < 0) {
      this.step = 0;
      this.show();
      return;
    }
    this.t += dt;
    const s = this.steps[this.step];
    if (s && s.done()) {
      this.step++;
      this.t = 0;
      this.show();
    }
  }

  show() {
    const s = this.steps[this.step];
    this.R.emit('coach', s ? { step: this.step, total: this.steps.length, text: s.text, focus: s.focus } : null);
  }
}
