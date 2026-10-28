// Guided first battle. Emits 'coach' events the HUD shows as speech bubbles.

const STEPS = [
  { text: 'Welcome to Brickbox Royale! Drag a card from your hand onto YOUR side of the arena (the bottom half).', focus: 'cards', wait: 'play' },
  { text: 'Cards cost elixir. The purple bar refills by itself, faster in the last minute of a battle.', focus: 'elixir', wait: 5 },
  { text: 'Tap the ground to walk your hero there. Your hero shoots nearby enemies automatically. Tap an enemy to focus it.', focus: 'arena', wait: 'heroMove' },
  { text: 'Bricks (orange) come from builders, defeated enemies and over time. Tap the FORM button to upgrade your hero for 60 bricks!', focus: 'form', wait: 'form', give: { bricks: 60 } },
  { text: 'Form 2 unlocked a hero spell. Tap the glowing spell button to unleash it!', focus: 'spell', wait: 'heroSpell' },
  { text: 'Tap one of your Princess towers to give it an element for 80 bricks: fire burns, ice slows, lightning chains, earth adds HP.', focus: 'tower', wait: 'element', give: { bricks: 80 }, timeout: 20 },
  { text: 'Now break through! Destroy a Princess tower, then the King tower in the middle. The King is worth 3 crowns and wins instantly.', focus: null, wait: 'end' },
];

export class Tutorial {
  /** @param {import('./battle.js').Battle} B */
  constructor(B, ai) {
    this.B = B;
    this.ai = ai;
    this.i = -1;
    this.t = 0;
    if (ai) ai.enabled = false;
    const off = [
      B.on('play', (e) => e.team === 0 && this.signal('play')),
      B.on('form', (e) => e.team === 0 && this.signal('form')),
      B.on('heroSpell', (e) => e.team === 0 && this.signal('heroSpell')),
      B.on('element', (e) => e.team === 0 && this.signal('element')),
      B.on('heroMoveCmd', () => this.signal('heroMove')),
      B.on('end', () => this.signal('end')),
    ];
    this.off = () => off.forEach((f) => f());
    this.started = false;
  }

  get step() {
    return STEPS[this.i];
  }

  signal(name) {
    if (this.step && this.step.wait === name) this.next();
  }

  next() {
    this.i++;
    this.t = 0;
    const s = this.step;
    if (!s) {
      this.B.emit('coach', null);
      return;
    }
    if (s.give?.bricks) {
      const p = this.B.players[0];
      p.bricks = Math.max(p.bricks, s.give.bricks);
    }
    if (this.i >= 6 && this.ai) this.ai.enabled = true;
    this.B.emit('coach', { text: s.text, focus: s.focus, step: this.i, total: STEPS.length });
  }

  update(dt) {
    if (!this.started) {
      this.started = true;
      this.next();
    }
    const s = this.step;
    if (!s) return;
    this.t += dt;
    if (typeof s.wait === 'number' && this.t >= s.wait) this.next();
    else if (s.timeout && this.t >= s.timeout) this.next();
    // keep the enemy princess towers from dying too early so the lesson reaches the end
  }
}
