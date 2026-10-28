// Minimal event emitter.

export class Emitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.handlers = new Map();
  }

  /** Subscribe; returns an unsubscribe function. */
  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.handlers.get(name)?.delete(fn);
  }

  emit(name, payload) {
    const set = this.handlers.get(name);
    if (set) for (const fn of [...set]) fn(payload);
    const any = this.handlers.get('*');
    if (any) for (const fn of [...any]) fn(name, payload);
  }

  clear() {
    this.handlers.clear();
  }
}
