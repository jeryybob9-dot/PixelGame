// Training: a coach walks a new god through one gentle Realm Clash match.

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
    // a sleepy rival with a softer keep
    const k = R.players[1]?.keep;
    if (k) {
      k.maxHp *= 0.45;
      k.hp = k.maxHp;
      k.dmg *= 0.5;
    }
    this.steps = [
      { text: 'Welcome, tiny god! Drag on the LEFT side of the island to walk your hero around.', focus: 'map', done: () => this.moved() > 3 },
      { text: 'Your hero fires at enemies in range all by itself. Your villagers mine bricks and carry them home.', focus: 'map', done: () => this.t > 7 },
      { text: 'Tap BUILD, pick a House and tap inside your blue borders. Houses let your tribe grow.', focus: 'build', done: () => this.ordered('house') },
      { text: 'Faith fills up from your worshippers. Drag a card onto your land (or near your hero) to summon it.', focus: 'cards', done: () => this.R.players[0].stats.cardsPlayed > 0 },
      { text: 'Build a Barracks. Warriors guard your borders. Tap the horn to send them to CHARGE!', focus: 'horn', done: () => this.ordered('barracks') || this.t > 30 },
      { text: 'Bricks also power up your hero. Tap FORM when you have enough to transform!', focus: 'form', done: () => this.R.players[0].hero?.form >= 2 || this.t > 25 },
      { text: 'Walk over Red Bricks from monster nests for powers, and capture the Shrine in the middle.', focus: 'minimap', done: () => this.t > 10 },
      { text: 'Win by toppling the rival Keep at the top, or by ruling more land when the Age of Chaos ends. Good luck!', focus: 'minimap', done: () => this.t > 9 },
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
