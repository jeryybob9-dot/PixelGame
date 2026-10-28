// App shell: screen router, modals, toasts, in-page confirms, audio unlock.

import { el, clear } from '../core/util.js';
import { audio } from '../core/audio.js';
import { getProfile, saveNow, events as profileEvents } from '../core/profile.js';

/** @typedef {{ mount: (root: HTMLElement, app: App, params?: any) => (void | (() => void)) }} Screen */

export class App {
  constructor(root) {
    this.root = root;
    this.root.classList.add('bbr');
    this.layer = el('div.screen-layer');
    this.modals = el('div.modal-layer');
    this.toasts = el('div.toast-layer', { 'aria-live': 'polite' });
    root.append(this.layer, this.modals, this.toasts);
    /** @type {Record<string, Screen>} */
    this.screens = {};
    this.cleanup = null;
    this.current = null;
    this.audio = audio;
    this.unlocked = false;
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      try {
        audio.unlock();
        this.applyAudioSettings();
        if (this.pendingMusic !== undefined) audio.music(this.pendingMusic);
      } catch {
        /* no audio */
      }
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        saveNow();
        this.onHidden?.();
      }
    });
    window.addEventListener('pagehide', () => saveNow());
    profileEvents.on('change', () => this.applyAudioSettings());
  }

  applyAudioSettings() {
    const s = getProfile().settings;
    try {
      audio.setMusicVolume(s.music);
      audio.setSfxVolume(s.sfx);
      audio.setMuted(!!s.muted);
    } catch {
      /* ignore */
    }
  }

  register(name, screen) {
    this.screens[name] = screen;
  }

  /** Switch to a screen. */
  go(name, params) {
    const screen = this.screens[name];
    if (!screen) throw new Error(`Unknown screen ${name}`);
    this.closeAllModals();
    if (typeof this.cleanup === 'function') {
      try {
        this.cleanup();
      } catch (err) {
        console.error(err);
      }
    }
    clear(this.layer);
    const root = el('div.screen', { 'data-screen': name });
    this.layer.appendChild(root);
    this.current = name;
    this.cleanup = screen.mount(root, this, params) || null;
    root.classList.add('screen-in');
  }

  music(theme) {
    this.pendingMusic = theme;
    if (this.unlocked) {
      try {
        audio.music(theme);
      } catch {
        /* ignore */
      }
    }
  }

  sfx(name, opts) {
    try {
      audio.sfx(name, opts);
    } catch {
      /* ignore */
    }
  }

  /**
   * Show a modal sheet. Returns a close function.
   * @param {HTMLElement} content
   * @param {{ title?: string, onClose?: () => void, className?: string, dismissable?: boolean }} [opts]
   */
  modal(content, opts = {}) {
    const close = () => {
      if (!wrap.isConnected) return;
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 160);
      opts.onClose?.();
    };
    const head = opts.title
      ? el('div.modal-head', null, el('h2.modal-title', { text: opts.title }), opts.dismissable === false ? null : el('button.icon-btn.modal-x', { 'aria-label': 'Close', onclick: () => { this.sfx('ui_back'); close(); } }, '✕'))
      : null;
    const sheet = el(`div.modal-sheet${opts.className ? '.' + opts.className.split(' ').join('.') : ''}`, { role: 'dialog', 'aria-modal': 'true' }, head, content);
    const wrap = el('div.modal-wrap', null, el('div.modal-backdrop', { onclick: () => opts.dismissable !== false && close() }), sheet);
    this.modals.appendChild(wrap);
    return close;
  }

  closeAllModals() {
    clear(this.modals);
  }

  toast(text, kind = 'info', ms = 2200) {
    const t = el(`div.toast.toast-${kind}`, { text });
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  /** In-page confirmation (window.confirm is unavailable in some hosts). */
  confirm({ title = 'Are you sure?', text = '', yes = 'Yes', no = 'Cancel', danger = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        close();
        resolve(v);
      };
      const body = el('div.confirm', null,
        text ? el('p.confirm-text', { text }) : null,
        el('div.row.gap', null,
          el('button.btn.btn-ghost', { onclick: () => finish(false) }, no),
          el(`button.btn${danger ? '.btn-red' : '.btn-gold'}`, { onclick: () => finish(true) }, yes)));
      const close = this.modal(body, { title, onClose: () => finish(false) });
    });
  }
}
