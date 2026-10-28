// Arena geometry and deploy rules. Units are tiles; team 0 (blue) defends the bottom.

export const TILE = 16;
export const ARENA_W = 18;
export const ARENA_H = 32;
export const PX_W = ARENA_W * TILE; // 288
export const PX_H = ARENA_H * TILE; // 512

export const RIVER_TOP = 15;
export const RIVER_BOTTOM = 17;
export const BRIDGES = [
  { x0: 2, x1: 5, cx: 3.5 },
  { x0: 13, x1: 16, cx: 14.5 },
];

export const MATCH_TIME = 180;
export const DOUBLE_ELIXIR_AT = 60; // seconds remaining
export const OVERTIME = 60;
export const ELIXIR_MAX = 10;
export const ELIXIR_START = 5;
export const ELIXIR_SECONDS = 2.8; // per elixir at 1x

export const BRICKS_START = 20;
export const BRICK_TRICKLE = 1.6; // seconds per passive brick
export const TOWER_ELEMENT_COST = 80;
export const HERO_KILL_BRICKS = 20;
export const TOWER_KILL_BRICKS = 50;

/** Tower layout per team. */
export function towerLayout(team) {
  const top = team === 1;
  const y = (v) => (top ? ARENA_H - v : v);
  return [
    { type: 'princess', side: 'left', x: 3.5, y: y(25.5) },
    { type: 'princess', side: 'right', x: 14.5, y: y(25.5) },
    { type: 'king', side: 'center', x: 9, y: y(29) },
  ];
}

/** Brick piles each team's builders can mine. */
export function brickPiles() {
  return [
    { team: 0, x: 1.4, y: 20.6 },
    { team: 0, x: 16.6, y: 20.6 },
    { team: 1, x: 1.4, y: ARENA_H - 20.6 },
    { team: 1, x: 16.6, y: ARENA_H - 20.6 },
  ];
}

export const inRiver = (y) => y > RIVER_TOP && y < RIVER_BOTTOM;
export function onBridge(x) {
  for (const b of BRIDGES) if (x >= b.x0 + 0.15 && x <= b.x1 - 0.15) return b;
  return null;
}
/** Which half a y position is on: 0 bottom (team 0), 1 top (team 1), -1 river. */
export function sideOf(y) {
  if (y >= RIVER_BOTTOM) return 0;
  if (y <= RIVER_TOP) return 1;
  return -1;
}

/**
 * Valid deploy rectangle(s) for a team, given which enemy princess towers are down.
 * @param {number} team
 * @param {{left: boolean, right: boolean}} pockets enemy towers destroyed on each side
 * @returns {{x0:number,x1:number,y0:number,y1:number}[]}
 */
export function deployZones(team, pockets) {
  const zones = [];
  if (team === 0) {
    zones.push({ x0: 0.5, x1: ARENA_W - 0.5, y0: RIVER_BOTTOM + 0.5, y1: ARENA_H - 0.5 });
    if (pockets.left) zones.push({ x0: 0.5, x1: 8.5, y0: 11.5, y1: RIVER_TOP + 0.01 });
    if (pockets.right) zones.push({ x0: 9.5, x1: ARENA_W - 0.5, y0: 11.5, y1: RIVER_TOP + 0.01 });
  } else {
    zones.push({ x0: 0.5, x1: ARENA_W - 0.5, y0: 0.5, y1: RIVER_TOP - 0.5 });
    if (pockets.left) zones.push({ x0: 0.5, x1: 8.5, y0: RIVER_BOTTOM - 0.01, y1: ARENA_H - 11.5 });
    if (pockets.right) zones.push({ x0: 9.5, x1: ARENA_W - 0.5, y0: RIVER_BOTTOM - 0.01, y1: ARENA_H - 11.5 });
  }
  return zones;
}

export function inZones(zones, x, y) {
  return zones.some((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1);
}

/** Nearest point inside any zone. */
export function clampToZones(zones, x, y) {
  let best = null;
  let bd = Infinity;
  for (const z of zones) {
    const cx = Math.min(z.x1, Math.max(z.x0, x));
    const cy = Math.min(z.y1, Math.max(z.y0, y));
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bd) {
      bd = d;
      best = { x: cx, y: cy };
    }
  }
  return best;
}
