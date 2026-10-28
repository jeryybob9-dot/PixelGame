// Wraps the God Box sandbox mode as a screen.

import { mountGodBox } from '../sandbox/godbox.js';
import { storage } from '../core/storage.js';
import { bumpStat, commit } from '../core/profile.js';

export const godboxScreen = {
  mount(root, app) {
    app.music('godbox');
    bumpStat('godboxVisits', 1);
    commit();
    const handle = mountGodBox(root, { audio: app.audio, storage, onExit: () => app.go('home') });
    return () => handle?.destroy?.();
  },
};
