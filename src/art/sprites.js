/**
 * Brickbox Royale — sprite data.
 *
 * SPRITES[key] = { w, h, fps, anims: { [anim]: frames } }   (frames = array of frames; frame = h strings of w chars)
 * Extra optional fields: `fly` (hovering unit, drawn without feet), `grip` ([x, y] hand pivot of a weapon),
 * `kind` ('troop' | 'building' | 'tower' | 'hero' | 'pet' | 'weapon' | 'icon' | 'projectile' | 'map' | 'chest').
 *
 * Art is authored as fill colours (see palette.js) and the toolkit in icons.js adds outlines and
 * builds animation frames (leg steps, flaps, recoil...) so every frame keeps the same style.
 * Light comes from the top-left. Team colours use T (main) / t (dark) / L (light).
 */

import {
  px, blank, stamp, stampAll, outline, flipX, shift, recolor, sym, fit, rect, dots, raiseLeg, place, vbounds,
  ICON_SPRITES,
} from './icons.js';

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

const O = (rows, opts) => outline(rows, opts);

/** Head-bob idle frame: the top `headRows` rows of content sink by 1px. */
function breathe(rows, headRows) {
  const [top] = vbounds(rows);
  const head = rows.slice(top, top + headRows);
  let out = rows.slice();
  out = rect(out, 0, top, rows[0].length, 1, '.');
  return stamp(out, head.map((r) => r), 0, top + 1);
}

/**
 * Ground troop from a fill-space base.
 * @param {object} o
 * @param {number} o.w @param {number} o.h @param {string[]} o.base fill rows (no outline)
 * @param {Array} [o.attack] each = full fill rows or a list of [part, x, y] patches on base
 * @param {number} [o.legRows] @param {number} [o.cx] leg split column
 * @param {number} [o.head] rows that bob in the idle breathing frame (0 = single idle frame)
 * @param {object} [o.more] extra anims as fill frames (outlined automatically)
 */
function troop(o) {
  const { w, h, base } = o;
  check(base, w, h, o.name);
  const mk = (a) => (typeof a[0] === 'string' ? a : stampAll(base, a));
  const idle = o.head ? [O(base), O(breathe(base, o.head))] : [O(base)];
  const walk = o.walk
    ? o.walk.map((f) => O(mk(f)))
    : [O(base), O(raiseLeg(base, { legRows: o.legRows ?? 2, cx: o.cx, legs: o.legs, side: 'L' })), O(base), O(raiseLeg(base, { legRows: o.legRows ?? 2, cx: o.cx, legs: o.legs, side: 'R' }))];
  const anims = { idle, walk };
  if (o.attack) anims.attack = o.attack.map((a) => O(mk(a)));
  for (const [k, frames] of Object.entries(o.more ?? {})) anims[k] = frames.map((a) => O(mk(a)));
  return { w, h, fps: o.fps ?? 6, kind: o.kind ?? 'troop', ...(o.fly ? { fly: true } : {}), anims };
}

/** Flying troop: frames given as fill rows; idle = walk = flap cycle. */
function flyer(o) {
  const frames = o.frames.map((f) => (typeof f[0] === 'string' ? f : stampAll(o.frames[0], f)));
  frames.forEach((f) => check(f, o.w, o.h, o.name));
  const flap = frames.map((f) => O(f));
  const anims = { idle: flap, walk: flap };
  if (o.attack) anims.attack = o.attack.map((a) => O(typeof a[0] === 'string' ? a : stampAll(frames[0], a)));
  return { w: o.w, h: o.h, fps: o.fps ?? 8, kind: o.kind ?? 'troop', fly: true, anims };
}

/** Static or animated object authored with full frames (outline added). */
function still(w, h, frames, extra = {}, opts) {
  const list = typeof frames[0] === 'string' ? [frames] : frames;
  list.forEach((f) => check(f, w, h, extra.name));
  const { name, ...rest } = extra;
  return { w, h, fps: rest.fps ?? 4, kind: rest.kind ?? 'map', ...rest, anims: { idle: list.map((f) => O(f, opts)) } };
}

const problems = [];
function check(rows, w, h, name = '?') {
  if (rows.length !== h || rows.some((r) => r.length !== w)) {
    problems.push(`${name}: expected ${w}x${h}, got ${rows[0]?.length}x${rows.length} [${rows.map((r) => r.length).join(',')}]`);
  }
}
/** Authoring problems found while building (tests assert this is empty). */
export const SPRITE_PROBLEMS = problems;

// =============================================================================================
// TROOPS
// =============================================================================================

const knightBase = px(`
  ..............
  ......Lt...w..
  .....LTt...w..
  ....gggggd.w..
  ....gGGGGd.w..
  ....gossod.w..
  ....gsssSdyYy.
  .gGgdgTTTGsn..
  .gLTdTTLTtG...
  .gyTdTTTTtd...
  .gTtdyyyyYd...
  ..gd.Gd.Gd....
  .....kk.kk....
  ..............
`);
const knight = troop({
  name: 'knight', w: 14, h: 14, base: knightBase, cx: 7, legs: [5, 9],
  attack: [
    // wind-up: sword lifted
    [[px(`
      ...
      ___
      ___
      ___
      ___
      ___
      ___
      ___
    `), 10, 0], [px(`
      .w.
      .w.
      .w.
      .w.
      .w.
      yYy
      sn.
    `), 10, 0]],
    // strike: blade swung down in front
    [[px(`
      ___
      ___
      ___
      ___
      ___
      ___
      ___
      ___
    `), 10, 0], [px(`
      ...
      ...
      ...
      ...
      ...
      ...
      sY.
      .yw
      ..w
      ..g
    `), 10, 1]],
  ],
});

const archerBase = px(`
  ............
  .....Lt.....
  ....LTTt....
  ...LTTTTtb..
  ...TssssT.b.
  ...sossoS.b.
  ...TsSSST.B.
  ..LLTTTTttB.
  ..TLTTTTttB.
  ..sTTTTttsb.
  ...nnynnnb..
  ...VVmVVm...
  ...kkkkkk...
  ............
`);
const archer = troop({
  name: 'archer', w: 12, h: 14, base: archerBase, cx: 6,
  attack: [
    [[px(`
      .b..
      w.b.
      wwBg
      w.b.
      .b..
    `), 7, 5]],
    [[px(`
      ..b.
      ...b
      ...B
      ...B
      ...B
      ..b.
    `), 7, 4]],
  ],
});

const skeletonBase = px(`
  ..........
  ..uuuuuU..
  ..uouuoU..
  ..uuuuUU..
  ...ukukU..
  ..LTTTTt..
  .u.uUuU.u.
  .U.uUuU.U.
  ...tTTt...
  ...u..u...
  ...U..U...
  ..........
`);
const skeleton = troop({
  name: 'skeleton', w: 10, h: 12, base: skeletonBase, cx: 5, head: 0,
  attack: [
    [[px(`
      .g
      .g
      .g
      un
    `), 7, 3]],
    [[px(`
      ...
      ...
      u..
      Unggg
    `), 6, 5]],
  ],
});

// "Blaster Goblins": green goblins with big ears, team caps and toy pistols
const gunnerBase = px(`
  ..........
  ...LTTt...
  ..LTTTTt..
  .vvvvvvvV.
  ..vovvoV..
  ..vwVwVV..
  .LTTTTtGg.
  .vTTTtvdd.
  ..nnnnn...
  ..BB.BB...
  ..kk.kk...
  ..........
`);
const gunner = troop({
  name: 'gunner', w: 10, h: 12, base: gunnerBase, cx: 4, legs: [2, 6],
  attack: [
    [[px(`
      .y
      Gh
      .y
    `), 7, 5]],
    [[px(`
      Gg_
      dd_
    `), 6, 6]],
  ],
});

// "Bomb Bot": a dome-headed robot that lobs fizzing bombs
const bomberBase = px(`
  ............
  ...h......h.
  ...d......y.
  ..ggGd...n..
  .gGGGGd.kk..
  .gccicdkdkk.
  .gGGGGdkkkk.
  .LTTTTtGkk..
  .TTyTTt.....
  .dGGGGd.....
  ..Gd.Gd.....
  ............
`);
const bomber = troop({
  name: 'bomber', w: 12, h: 12, base: bomberBase, cx: 4, legRows: 1, legs: [2, 6],
  attack: [
    // bomb hoisted overhead
    [[px(`
      ____
      ____
      ____
      ____
      ____
      ____
      ____
      ____
    `), 7, 0], [px(`
      ...h
      ..y.
      .kk.
      kdkk
      kkkk
      Gkk.
      G...
    `), 7, 0]],
    // thrown: empty claw forward
    [[px(`
      ____
      ____
      ____
      ____
      ____
      ____
      ____
      ____
    `), 7, 0], [px(`
      GG
    `), 7, 7]],
  ],
});

const batFrames = [
  px(`
    ..........
    .P......P.
    .PP.kk.PP.
    .PPPkkPPP.
    ..PPkkPP..
    ...rkkr...
    ....kk....
    ..........
  `),
  px(`
    ..........
    ..........
    ....kk....
    ...PkkP...
    .PPPkkPPP.
    .PP.rr.PP.
    .P..kk..P.
    ..........
  `),
];
const bat = {
  ...flyer({ name: 'bat', w: 10, h: 8, frames: batFrames, fps: 10 }),
};
// team colour on bats: little ear tips
bat.anims.idle = bat.anims.walk = batFrames.map((f) => O(recolor(f, {}))).map((f, i) =>
  i === 0 ? dots(f, [[4, 1, 'T'], [5, 1, 'T']]) : dots(f, [[4, 1, 'T'], [5, 1, 'T']]),
);
bat.anims.attack = [O(stamp(batFrames[0], px(`wkkw`), 3, 5)), O(batFrames[1])];

const builderBase = px(`
  ............
  ....yyyy....
  ...yhyyyY...
  ..YYYYYYYY..
  ...ssssSS...
  ...sossoS...
  ...ssbbSS...
  ..LTTyTTtt..
  ..TTTyTTtt..
  ..sTTTTtts..
  ...nnnnnn...
  ...CCxCCx...
  ...nnnnnn...
  ............
`);
const builderPick = px(`
  ..gG.
  .gn.G
  ..n..
  .n...
`);
const builder = troop({
  name: 'builder', w: 12, h: 14, base: builderBase, cx: 6,
  attack: [
    [[px(`
      .gGG
      gn..
      .n..
      .n..
    `), 8, 4]],
    [[px(`
      .....
      .....
      .....
      n....
      ngGG.
      ...g.
    `), 8, 7]],
  ],
  more: {
    mine: [
      [[px(`
        ...gGG
        ....n.
        ....n.
        ...n..
      `), 6, 3]],
      [[px(`
        .......
        .......
        .......
        .......
        ....n..
        ....nGg
        .....gG
      `), 6, 5]],
    ],
  },
});

const sheepBase = px(`
  ............
  ...w.ww.w...
  ..wwwwwwww..
  .wwwwwwwkkk.
  .wwwwwwkkwk.
  .gwwwwwwkkk.
  ..ggggggTk..
  ...kk..kk...
  ...kk..kk...
  ............
`);
// "Boom Sheep": a firework strapped to the woolly back
const boomSheepBase = stamp(sheepBase, px(`
  .h
  rR
  ry
`), 3, 0);
const sheep = troop({
  name: 'sheep', w: 12, h: 10, base: boomSheepBase, cx: 6, legRows: 2, legs: [2, 9],
  attack: [
    // head down
    [[px(`
      ___
      ___
      kkk
      kwk
      kkk
    `), 8, 2]],
    [[px(`
      ...
      .kk
      kkw
      kkk
    `), 8, 3]],
  ],
});

// "Stone Giant": a lumbering boulder of a fellow with a moss beard and a team bandana
const giantBase = px(`
  ......................
  .......LTTTTTt........
  .....tLTTTTTTTt.......
  ....t.gggGGGGdd.......
  ......gmmGGGmmd.......
  ......GoGGGGodd.......
  ......gGGGdGGdd.......
  ......GvVVVVVVd.......
  ....LLLVmVkVmVTtt.....
  ...LLTTTVVVVVTTTtt....
  ..gLTTTnTTTTTTTTttd...
  ..gGTTTTnTTTTTTTtdd...
  ..GGdTTTTnTTTTTttddd..
  ..LLt.nnnnnynnnn.LLt..
  ..ggG.gGGLTTtGGd.gGd..
  ..GGd.gGGTTTtGdd.Gdd..
  ......gGGGTtGGGd......
  ......gGGGGdGGGd......
  ......gGGG..GGGd......
  ......gGGd..gGdd......
  .....dGGGd..gGGdd.....
  .....ddddd..ddddd.....
  ......................
  ......................
`);
const giant = troop({
  name: 'giant', w: 22, h: 24, base: shift(giantBase, 0, 1), cx: 11, legRows: 7, legs: [5, 16], fps: 5, head: 8,
  attack: [
    // fist raised
    [[px(`
      ___
      ___
      ___
    `), 17, 14], [px(`
      .ggG
      ggGd
      GGdd
      LLt.
    `), 16, 7]],
    // ground slam
    [[px(`
      ___
      ___
      ___
    `), 17, 14], [px(`
      .LLt.
      ggGGd
      gGGdd
      .ddd.
    `), 16, 14]],
  ],
});

const boarBase = px(`
  ..................
  ......LTt.........
  .....LTTTt..g.....
  .....sossS.gG.....
  .....ssSSS.n......
  ....LTTTTtsn......
  ...nBnTTtnBn......
  ..nBBBBBBBBBBnn...
  .nBbbbbbbbbBBBbn..
  .BbbbbbbbbbbBbobB.
  .BbbbbbbbbbbBbbbq.
  .nBbbbbbbbbBBnBwq.
  ..nBBBBBBBBn.nn...
  ..nn.nn..nn.nn....
  ..kk.kk..kk.kk....
  ..................
`);
const boarGallop = stampAll(boarBase, [[px(`
  _nn___nn_nn___nn__
  _kk___kk_kk___kk__
`), 0, 13]]);
const boarrider = troop({
  name: 'boarrider', w: 18, h: 16, base: boarBase, fps: 8,
  walk: [boarBase, shift(boarGallop, 0, 0), boarBase, stampAll(boarBase, [[px(`
    ___nn_nn__nn_nn___
    ___kk_kk__kk_kk___
  `), 0, 13]])],
  attack: [
    // hammer raised high
    [[px(`
      ___
      ___
      ___
      ___
    `), 10, 2], [px(`
      .gG
      .gd
      n..
      n..
    `), 10, 0]],
    // hammer smashes forward, boar lowers its tusks
    [[px(`
      ___
      ___
      ___
      ___
    `), 10, 2], [px(`
      ss.
      .nn
      ..gG
      ..gd
    `), 10, 4], [px(`
      bbbq
      nBwq
    `), 13, 10]],
  ],
});

const minigunnerBase = px(`
  ..............
  ....kkkkkk....
  ...kTTTTTTk...
  ...ssssssS....
  ...ossossS....
  ...sssSSSS....
  ..LTTTTTTtt...
  .LLTTTTTTttG..
  .sTTTTTTttdGgg
  ..ddGGGGGGdgdg
  ..dnnnnnnndGgg
  ...BBBnBBB....
  ...kkk.kkk....
  ..............
`);
const minigunner = troop({
  name: 'minigunner', w: 14, h: 14, base: minigunnerBase, cx: 7,
  attack: [
    [[px(`
      .y.
      hyh
      .y.
    `), 11, 8]],
    [[px(`
      ...
      .gg
      .gd
      .gg
    `), 11, 7]],
  ],
});

// "Healer Monk": calm, bonks foes with a wooden staff
const monkBase = px(`
  ............
  .....n....b.
  ....ssss..b.
  ...ssssSS.B.
  ...sossoS.B.
  ...ssssSS.B.
  ..yyTTTTyYB.
  ..yTTTTTTYB.
  ..sTRyRTtsB.
  ...TTTTTt.B.
  ...TTTTTt.B.
  ...ttt.tt.B.
  ...nn..nn.n.
  ............
`);
const monkStaffClear = [px(`
  _
  _
  _
  _
  _
  _
  _
  _
  _
  _
  _
  _
`), 10, 1];
const monk = troop({
  name: 'monk', w: 12, h: 14, base: monkBase, cx: 6, legs: [3, 8],
  attack: [
    // staff lifted, hand up
    [monkStaffClear, [px(`
      b
      b
      B
      B
      B
      B
      B
      B
      B
      B
      B
      n
    `), 10, 0], [px(`s`), 9, 7], [px(`.`), 9, 8]],
    // bonk: the staff head flares with healing light
    [[px(`
      .h.
      hyh
      .h.
    `), 9, 0]],
  ],
});

const icemageBase = px(`
  ............
  .....ii.....
  ....icci....
  ...icTTci...
  ..ccTTTTcC..
  ...ssssSS..i
  ...ossoSS.ic
  ...wwwwww.n.
  ..TwTTTTwtn.
  ..sTTTTTtsn.
  ...TTTTTt.n.
  ...TTTTtt.n.
  ...ttttttn..
  ............
`);
const icemage = troop({
  name: 'icemage', w: 12, h: 14, base: icemageBase, cx: 6, legRows: 1,
  walk: [icemageBase, shift(icemageBase, 0, 0)].map((f, i) => (i === 1 ? stampAll(f, [[px(`.ttt.tt.`), 2, 12]]) : f)),
  attack: [
    [[px(`
      .ih
      icc
      .c.
    `), 9, 3]],
    [[px(`
      hih
      iwi
      hih
    `), 9, 3]],
  ],
});

const flamerBase = px(`
  ..............
  ....GGGGG.....
  ...GgggggG....
  ...GkcckcG....
  ...GkcckcG....
  ...GGGGGGd....
  .aaTTTTTTt....
  .aRTTTTTtdGGg.
  .aRsTTTTdddGd.
  .aRtnnnnndn...
  ..R.BBnBB.....
  ....kk.kk.....
  ..............
  ..............
`);
const flamer = troop({
  name: 'flamer', w: 14, h: 14, base: shift(flamerBase, 0, 1), cx: 6,
  attack: [
    [[px(`
      .y
      ya
      .y
    `), 12, 7]],
    [[px(`
      .h
      yr
      .h
    `), 12, 7]],
  ],
});

const sniperBase = px(`
  ............
  ....VVVV....
  ...VmVVVm...
  ..mVVVVVVm..
  ...ssssSS...
  ...okoSoo...
  ...ssssSS...
  ..mVTTTTVm..
  ..VTTTTTtmGd
  ..sVVVVmmnGG
  ...nnnnnn...
  ...mmVmmV...
  ...kkkkkk...
  ............
`);
const sniper = troop({
  name: 'sniper', w: 12, h: 14, base: sniperBase, cx: 6,
  attack: [
    [[px(`
      GGGd
      .nG.
    `), 8, 7], [px(`__\n__`), 10, 8]],
    [[px(`
      .GGG
      nG..
    `), 8, 7], [px(`__\n__`), 10, 8]],
  ],
});

const dragonFrames = [
  px(`
    ......................
    ..rr..............rr..
    ..rRr............rRr..
    ..rRRr..........rRRr..
    ..rRRRr..yy....rRRRr..
    ...rRRRr.yy...rRRRr...
    ...rRRRRraarrRRRRr....
    ....rRRraaaarRRRr.....
    .....rrraaoaarrr......
    .......aayaaaa........
    ......aayyyaaaa.......
    ......ayyyyyaaa.......
    .....aayyyyaaaa.......
    .....aaayyaaaa........
    ......aaaaaaa.........
    .......aa..aa.........
    .......Ya..Ya.........
    ......................
    ......................
    ......................
  `),
];
// author the dragon properly below (TL-lit red/orange wyrm with team-coloured saddle)
const dragonBody = px(`
  ......................
  ......................
  ......................
  ..........yh..........
  .........aaaa.........
  ........aaaaaA..y.....
  ........aowaaA.ya.....
  ........aaaaaAaa......
  .........ARRAaA.......
  .........aaaaA........
  ........aTTTtaA.......
  .......aaLTTtaAA......
  .......ayyyyyaAA......
  .......ayyyyyaAA......
  ........yyyyaAA.......
  .........aaAAA........
  .........aA.aA.....a..
  ..........A..A....aA..
  ..............AaaaA...
  ......................
`);
const dragonWingsUp = px(`
  ..R..............R....
  .RrR............RrR...
  .RrrR..........RrrR...
  .RrrrR........RrrrR...
  ..RrrrR......RrrrR....
  ..RrrrrR....RrrrrR....
  ...RrrrrR..RrrrrR.....
  ....RRRRR..RRRRR......
`);
const dragonWingsDown = px(`
  ......................
  ......................
  ......................
  ......................
  ......................
  ......................
  RRRRRRRR....RRRRRRRR..
  RrrrrrrR....RrrrrrrR..
  .RrrrrrR....RrrrrrR...
  ..RrrrR......RrrrR....
  ...RrR........RrR.....
  ....R..........R......
`);
const dragon = flyer({
  name: 'dragon', w: 22, h: 20, fps: 6,
  frames: [
    stamp(stamp(blank(22, 20), dragonWingsUp, 0, 3), dragonBody, 0, 0),
    stamp(stamp(blank(22, 20), dragonWingsDown, 0, 1), dragonBody, 0, 0),
  ],
  attack: [
    [[px(`
      .yh
      yay
      .y.
    `), 9, 6]],
    [[px(`
      .rar
      raya
      .ara
    `), 8, 6]],
  ],
});
void dragonFrames;

const necroBase = px(`
  ..............
  ......PP...q..
  .....PpPP.qeq.
  ....PpPPPP.e..
  ...PpPkkkkPn..
  ...PpkuuuUPn..
  ...PpkeueUPn..
  ...PPkuuUUPn..
  ..PPPPukuPPn..
  ..PpPPTTTPPs..
  ..uPpPTTPPPn..
  ...PpPPPPPPn..
  ...PpPPPPPPn..
  ...PpPPPPPPn..
  ...PPPPPPPPn..
  ..............
`);
const necro = troop({
  name: 'necro', w: 14, h: 16, base: necroBase, cx: 7, legRows: 1,
  walk: [necroBase, stampAll(necroBase, [[px(`PPP_PPPP`), 3, 14]]), necroBase, stampAll(necroBase, [[px(`PPPP_PPP`), 3, 14]])],
  attack: [
    [[px(`
      .q.q.
      q.e.q
      .eqe.
      q.e.q
    `), 9, 0]],
    [[px(`
      h...h
      .qeq.
      .ehe.
      .qeq.
      h...h
    `), 9, 0], [px(`uu`), 0, 9]],
  ],
});

// "Giant Crab": orange claws and legs, team-coloured shell
const crabBase = px(`
  ..........................
  ..aa..................aa..
  .ayAa................ayAa.
  .aA.aa..............aa.Aa.
  .aA..a..............a..Aa.
  .aAaaA...w....w....AaaAa..
  ..aAAA...o....o....AAAa...
  ...aAA...a....a....AAa....
  ....aAaaaLLTTTTTTTtaAa....
  ....aaLTTTLTTTTLTTTtta....
  ...aaLTTTTTTTTTTTTTTtAA...
  ...aaTTTLTTTTTTTLTTttAA...
  ...AaatttttttttttttaAAA...
  ....AAAAAAAAAAAAAAAAA.....
  ...A.A.A.A.....A.A.A.A....
  ..A.A.A.A.......A.A.A.A...
  ..A.A.A...........A.A.A...
  ..........................
  ..........................
  ..........................
`);
const crabDown = shift(crabBase, 0, 2);
const crab = troop({
  name: 'crab', w: 26, h: 20, base: crabDown, fps: 6,
  walk: [
    crabDown,
    stampAll(crabDown, [[px(`
      __________________________
      .A.A.A.A.........A.A.A.A..
      A.A.A.A...........A.A.A.A.
      .A.A.A.............A.A.A..
    `), 0, 15]]),
  ],
  attack: [
    // claw raised
    [[px(`
      .aa.
      ayAa
      aA.A
      aAAa
    `), 0, 0]],
    // pinch: claw snaps shut
    [[px(`
      ____
      ____
      _aa_
      ayAa
      aAAa
    `), 0, 1]],
  ],
});

const babycrabBase = px(`
  ..........
  .a......a.
  aA.w..w.Aa
  .aao..oaa.
  .aLTTTtaA.
  ..AtttAA..
  .A.A..A.A.
  ..........
`);
const babycrab = troop({
  name: 'babycrab', w: 10, h: 8, base: babycrabBase, fps: 8,
  walk: [babycrabBase, stampAll(babycrabBase, [[px(`_A_A__A_A_`), 0, 6], [px(`A.A....A.A`), 0, 6]])],
  attack: [[[px(`aa\nAa`), 0, 0]], [[px(`a.\nA.`), 0, 1]]],
});

const ufoFrames = [0, 1, 2].map((ph) => {
  let r = px(`
    ....................
    .......cciic........
    ......cciwwic.......
    ......ccivicc.......
    ....ggggggggggd.....
    ..ggLLTTTTTTTTttd...
    .gGgygGgygGgygGgyd..
    ..dGGGGGGGGGGGGdd...
    ....dddddddddd......
    .......y.y.y........
    ......y.y.y.y.......
    ....................
  `);
  const lights = [6, 10, 14];
  r = stamp(r, px('.'), 0, 0);
  // chase lights
  r = dots(r, [[2 + ph * 4 + 1, 6, 'h']]);
  return ph === 0 ? r : ph === 1 ? dots(r, [[lights[0], 6, 'h']]) : dots(r, [[lights[2], 6, 'h']]);
});
const ufo = flyer({
  name: 'ufo', w: 20, h: 12, fps: 6,
  frames: ufoFrames,
  attack: [
    [[px(`
      ..cc..
      .cccc.
      .icci.
    `), 7, 9]],
    [[px(`
      .cicc.
      cciicc
      ciiiic
    `), 7, 9]],
  ],
});

const rocketeerBase = px(`
  ..............
  ....ggggg.....
  ...gcccccG....
  ...gciccCG....
  ...GGGGGGd....
  ...ssssSS.....
  ..LTTTTTtt....
  .GLTTTTTtt....
  .GgsTTTTtsGGgr.
  .GG.nnnnn.ddd.
  .dd.BBnBB.....
  .ya.kk.kk.....
  ..............
  ..............
`.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.slice(0, 14)).join('\n'));
const rocketeer = troop({
  name: 'rocketeer', w: 14, h: 14, base: shift(rocketeerBase, 0, 1), cx: 6,
  attack: [
    [[px(`
      ..y
      ayh
      ..y
    `), 11, 8]],
    [[px(`
      ...
      ..G
      ...
    `), 11, 8]],
  ],
});

const ninjaBase = px(`
  ............
  ............
  ...kkkkkk...
  ..kkkkkkkk..
  ...TTTTTTtt.
  ...kossokk.t
  ...kkkkkkk..
  ..kkkTTkkkg.
  ..kkkkkkkkg.
  ..skTTTTksg.
  ...kkkkkk...
  ...kkkkkk...
  ...kk..kk...
  ............
`);
const ninja = troop({
  name: 'ninja', w: 12, h: 14, base: ninjaBase, cx: 6,
  attack: [
    [[px(`
      ...w
      ..wg
      .wg.
      sg..
    `), 7, 4], [px(`__\n__\n__`), 10, 7]],
    [[px(`
      ..ww
      sgg.
    `), 7, 9], [px(`__\n__\n__`), 10, 7]],
  ],
});

const zombieBase = px(`
  ............
  ............
  ...vvvvvV...
  ...vvvVVV...
  ...okvvoV...
  ...vvVVVm...
  ...vRvRVm...
  ..TLTTtTtt..
  .vvTTTTtTvVV
  ...LTtTTtt..
  ...nnnnnn...
  ...BB.BBB...
  ...kk..kk...
  ............
`);
const zombie = troop({
  name: 'zombie', w: 12, h: 14, base: zombieBase, cx: 6, fps: 4,
  attack: [
    [[px(`
      vvVV
      ....
    `), 8, 7], [px(`____`), 8, 8]],
    [[px(`
      .vvVV
    `), 7, 9], [px(`____`), 8, 8]],
  ],
});

const mechBase = px(`
  ........................
  ........................
  ........gggggggd........
  .......gGGGGGGGGd.......
  .......gGcccccGGd.......
  .......gGciiccGGd.......
  .......gGGGGGGGGd.......
  ...gggggdddddddddggggg..
  ..gGGGGGLLTTTTTTtGGGGGd.
  ..gGdddGLTTTTTTTtGdddGd.
  ..gGdGdGTTTyyTTTtGdGdGd.
  ..gGdddGTTTyyTTTtGdddGd.
  ..dGGGGGtTTTTTTttGGGGGd.
  ..dddGddttttttttdddGddd.
  ...gGGd.dGGGGGGd..gGGd..
  ...gddd.ddddddd...gddd..
  ...ggg...gGd.gGd..ggg...
  ...ddd...gGd.gGd..ddd...
  .........gGd.gGd........
  ........ggGd.ggGd.......
  ........gGGd.gGGd.......
  .......gGGGd.gGGGd......
  .......dddd...dddd......
  ........................
  ........................
  ........................
`);
// "Brick Mech": brick-built shoulder pods with studs, metal head and legs
const mechBricked = (() => {
  let r = toCellsLocal(mechBase);
  for (let y = 7; y <= 13; y++) {
    for (let x = 0; x < 24; x++) {
      if (!(x <= 7 || x >= 17)) continue;
      if (r[y][x] === '.') continue;
      const ry = y - 7;
      const x0 = x <= 7 ? 2 : 17;
      if (ry === 2 || ry === 5 || ry === 6) r[y][x] = 'A';
      else {
        const course = ry < 2 ? 0 : 1;
        r[y][x] = (x - x0 + course * 2) % 4 === 3 ? 'A' : 'a';
      }
    }
  }
  r = r.map((row) => row.join(''));
  return dots(r, [[3, 6, 'a'], [5, 6, 'a'], [18, 6, 'a'], [20, 6, 'a'], [2, 7, 'y'], [17, 7, 'y']]);
})();
function toCellsLocal(rows) {
  return rows.map((row) => row.split(''));
}
const mech = troop({
  name: 'mech', w: 24, h: 26, base: shift(mechBricked, 0, 3), cx: 12, legRows: 6, fps: 4,
  attack: [
    [[px(`
      .h.
      hyh
      .h.
    `), 1, 19], [px(`
      .h.
      hyh
      .h.
    `), 19, 19]],
    [[px(`
      .y.
      yay
      .y.
    `), 1, 19], [px(`
      .y.
      yay
      .y.
    `), 19, 19]],
  ],
});

const bonedragonBody = px(`
  ........................
  ........................
  ..........u...u.........
  .........uU...uU........
  .........uuuuuuU........
  ........uuuuuuuUU.......
  ........ueuuueuUU.......
  ........uuuuuuUUU.......
  .........kukukuU........
  ..........kkkkk.........
  ...........uU...........
  ..........LTTt..........
  .........uLTTtU.........
  .........ukuukU.........
  .........uuuUUU.........
  ..........ukuU..........
  ...........uU.....u.....
  ............uU...uU.....
  .............uUuUU......
  ........................
`);
// left halves (12 wide) mirrored into 24-wide wings
const bonedragonWingsUp = sym(px(`
  ............
  .u..........
  .uU.........
  .uPu........
  .uPPu.......
  .uPkPu......
  .uPkPPu.....
  ..PkPPPu....
  ..P.PkPPuu..
  ......P..uuu
`));
const bonedragonWingsDown = sym(px(`
  ............
  ............
  ............
  ............
  ............
  ............
  ............
  ....uuuuuuuu
  .uuuPPPkPPPu
  ..PPkPPkPPu.
  ...PkP.PkP..
  ....P...P...
`));
const bonedragon = flyer({
  name: 'bonedragon', w: 24, h: 20, fps: 6,
  frames: [
    stamp(stamp(blank(24, 20), bonedragonWingsUp, 0, 2), bonedragonBody, 0, 0),
    stamp(stamp(blank(24, 20), bonedragonWingsDown, 0, 2), bonedragonBody, 0, 0),
  ],
  attack: [
    // jaws open, soul fire gathering
    [[px(`
      kukuku
      .qeeq.
      ..qq..
    `), 9, 8]],
    [[px(`
      kukuku
      qehheq
      .qeeq.
      ..qq..
    `), 9, 8]],
  ],
});

const titanBase = px(`
  ......................
  ........yyyyyy........
  .......yhyyyyyY.......
  .......gggggggd.......
  .......gGGGGGGd.......
  .......gGccccGd.......
  .......gGGGGGGd.......
  ...yyyyyGGGGGGyyyyy...
  ..yhyyyLTTTTTTtyyyyY..
  ..yyyYgLTTyyTTtgYyyY..
  ..YYYYgTTyhyyTtgYYYY..
  ...gGdgTTTyyTTtgdGd...
  ...gGddtTTTTTttddGd...
  ...gGd.yyyyyyyy.dGd...
  ...ccc.gGGGGGGd.ccc...
  ...ccc.gGGd.GGd.ccc...
  .......gGGd.GGd.......
  .......gGGd.GGd.......
  .......gGGd.GGd.......
  ......yyyyd.yyyy......
  ......YYYYY.YYYYY.....
  ......................
  ......................
  ......................
  ......................
  ......................
`);
const titan = troop({
  name: 'titan', w: 22, h: 26, base: shift(titanBase, 0, 4), cx: 11, legRows: 7, fps: 4,
  attack: [
    [[px(`
      .ccc
      cccj
      chcc
      .cc.
    `), 2, 7], [px(`___\n___`), 3, 18]],
    [[px(`
      ....
      .ccc
      chcc
      ccc.
    `), 1, 19], [px(`___\n___`), 3, 18]],
  ],
});

const phoenixWingsUp = px(`
  .y................y.
  .ay..............ya.
  .aay............yaa.
  .raay..........yaar.
  ..raay........yaar..
  ...raayy....yyaar...
  ....rraa....aarr....
`);
const phoenixWingsDown = px(`
  ....................
  ....................
  ....................
  ....................
  ..raaayy....yyaaar..
  .rraaay......yaaarr.
  rraay..........yaarr
  .ry..............yr.
`);
const phoenixBody = px(`
  ....................
  .........yy.........
  ........yhyy........
  .......yayyy........
  .......awyya........
  .......ayyaYY.......
  ........aayaa.......
  ........aLTta.......
  ........ayyya.......
  .........ayya.......
  .........aaa........
  ........ry.yr.......
  .......ra.y.ar......
  ......r..yry..r.....
  .........r.r........
  ....................
  ....................
  ....................
`);
const phoenix = flyer({
  name: 'phoenix', w: 20, h: 18, fps: 8,
  frames: [
    stamp(stamp(blank(20, 18), phoenixWingsUp, 0, 2), phoenixBody, 0, 0),
    stamp(stamp(blank(20, 18), phoenixWingsDown, 0, 2), phoenixBody, 0, 0),
  ],
  attack: [
    [[px(`
      hy
      ya
    `), 6, 3]],
    [[px(`
      .h.
      hyh
      .h.
    `), 5, 3]],
  ],
});

const phoenixEgg = still(10, 12, [
  px(`
    ..........
    ....yy....
    ...yhya...
    ..yhyyaa..
    ..yyyyaa..
    ..yaayaR..
    ..ayyaaR..
    ..aaaaRR..
    ...aaRR...
    ..RRRRRR..
    ..........
    ..........
  `),
  px(`
    ..........
    ....yy....
    ...yhya...
    ..yhyyaa..
    ..yyhyaa..
    ..yayhaR..
    ..ayhaaR..
    ..aaaaRR..
    ...aaRR...
    ..RRRRRR..
    ..........
    ..........
  `),
].map((f) => shift(f, 0, 1)), { name: 'phoenix_egg', kind: 'troop', fps: 3 });

const turretUnit = still(10, 10, [
  px(`
    ..........
    ..........
    ..gGGGd...
    ..GTLTGggg
    ..GTTtGddd
    ..dGGGd...
    ...dGd....
    ..dd.dd...
    .dd...dd..
    ..........
  `).map((r) => r.slice(0, 10)),
], { name: 'turret', kind: 'troop', fps: 6 });
turretUnit.anims.walk = turretUnit.anims.idle;
turretUnit.anims.attack = [
  O(px(`
    ..........
    ..........
    ..gGGGd...
    ..GTLTGgyh
    ..GTTtGdy.
    ..dGGGd...
    ...dGd....
    ..dd.dd...
    .dd...dd..
    ..........
  `)),
  turretUnit.anims.idle[0],
];

// =============================================================================================
// BUILDINGS
// =============================================================================================

const bricktowerBase = px(`
  ................
  ..a.a.aA..a.aA..
  ..aaaaaAaaaaaA..
  ..AAAAAAAAAAAA..
  ...aaAaaaAaaA...
  ...aaAaaaAaaA...
  ...AAAAAAAAAA...
  ...aaaAaaaAaA...
  ...aaaAkkkAaA...
  ...AAAAkkkAAA...
  ...aaAaaaAaaA...
  ...aaAaaaAaaA...
  ...AAAAAAAAAA...
  ...LTTTTTTTTt...
  ...LTTTyyTTTt...
  ...TTTTyyTTtt...
  ...ttttttttttt..
  ..aaaAaaaAaaaA..
  ..aaaAaaaAaaaA..
  ..AAAAAAAAAAAA..
  ..aAaaaAaaaAaA..
  ..aAaaaAaaaAaA..
  ..AAAAAAAAAAAA..
  ................
`).map((r) => r.slice(0, 16));
const bricktower = {
  w: 16, h: 24, fps: 6, kind: 'building',
  anims: {
    idle: [O(bricktowerBase)],
    attack: [
      O(stamp(bricktowerBase, px(`
        ...
        .y.
        yhy
        .y.
      `), 6, 6)),
      O(bricktowerBase),
    ],
  },
};

const teslaUp = px(`
  ..............
  .....hyyh.....
  ....yhwwhy....
  ....yhwwhY....
  .....yyyY.....
  ......Gd......
  .....gGGd.....
  ....gGcGGd....
  .....dGGd.....
  ....gGcGGd....
  .....dGGd.....
  ....gGGGGd....
  ...gGTLTTGd...
  ...gTTTTtGd...
  ..gGGGGGGGGd..
  ..dddddddddd..
  ..............
  ..............
  ..............
  ..............
`);
const teslaHidden = px(`
  ..............
  ..............
  ..............
  ..............
  ..............
  ..............
  ..............
  ..............
  ..............
  ..............
  ..............
  ..............
  ..............
  ..............
  ..............
  ...gggggggd...
  ..gGGGLTGGGd..
  ..gGGGTtGGGd..
  ..dddddddddd..
  ..............
`);
const tesla = {
  w: 14, h: 20, fps: 8, kind: 'building',
  anims: {
    hidden: [O(teslaHidden)],
    idle: [O(shift(teslaUp, 0, 3)), O(stamp(shift(teslaUp, 0, 3), px(`.hyyh\nyh..hy`), 4, 4))],
    attack: [
      O(stamp(shift(teslaUp, 0, 3), px(`
        h..h..h
        .c.c.c.
        ..ccc..
      `), 3, 0), { skip: 'hc' }),
      O(stamp(shift(teslaUp, 0, 3), px(`
        .c..c.c
        c.hc...
        ..chc..
      `), 3, 0), { skip: 'hc' }),
    ],
  },
};

const cryptBase = px(`
  ..................
  ........uU........
  .......uuuU.......
  ........uU........
  ....gggggggggd....
  ...gGGGGGGGGGGd...
  ..gGGgGGGGGgGGGd..
  ..gGdddddddddGGd..
  ..gGdkkkkkkkdGGd..
  ..gGdkkkkkkkdGGd..
  ..gGdkkpPpkkdGGd..
  ..gGdkkPPPkkdGGd..
  ..gGdkkkkkkkdGGd..
  ..ddddddddddddddd.
  ..TTLTTTTTTTTTTt..
  ..................
`);
const crypt = {
  w: 18, h: 16, fps: 4, kind: 'building',
  anims: {
    idle: [O(cryptBase), O(stamp(cryptBase, px(`pqp\nPpP`), 7, 9))],
    attack: [O(stamp(cryptBase, px(`.u.\nuUu\n.U.`), 7, 8)), O(cryptBase)],
  },
};

// "Elixir Mine": a glass tank of bubbling elixir on a brick-and-timber base
const mineBase = px(`
  ..................
  ..................
  .......nBBBn......
  .....ggggggGd.....
  ....gwqeeeeepd....
  ....gweeeeeePd....
  ....gqeeeeepPd....
  ....geeeeeepPd....
  ....geeepeepPd....
  ....gepeeeppPd....
  ....gGGGGGGGGd....
  ...bBLTTTTTTtBn...
  ..aaABTTTyTTtBaaA.
  ..aaAbTTTTTTtbaaA.
  ..AAAbbbbbbbbbAAA.
  ..BnBBnBBnBBnBBnB.
  ..................
  ..................
`);
const mineBubbles = [[], [[7, 9, 'w']], [[7, 7, 'w'], [10, 9, 'q']], [[7, 5, 'w'], [10, 7, 'q'], [9, 1, 'h']]];
const mine = {
  w: 18, h: 18, fps: 4, kind: 'building',
  anims: {
    idle: mineBubbles.map((d) => O(shift(dots(mineBase, d), 0, 1), { skip: 'h' })),
  },
};

// "Brick Cannon": iron barrel on a brick plinth
const cannonBase = px(`
  ................
  ................
  ................
  .....kdddddkG...
  ....kddGGddkGk..
  ....kkdddddkGk..
  .....kkkkkkkG...
  ...aaAkkkaaA....
  ..aaaaAaaaaaA...
  ..AAAAAAAAAAA...
  ..LTTTTTTTTTt...
  ..aAaaaAaaaAa...
  ..AAAAAAAAAAA...
  ................
`);
const cannon = {
  w: 16, h: 14, fps: 8, kind: 'building',
  anims: {
    idle: [O(cannonBase)],
    attack: [
      O(stamp(stampAll(cannonBase, [[shift(px(`
        .kdddddkG.
        kddGGddkGk
        kkdddddkGk
        .kkkkkkkG.
      `), -1, 0), 4, 3]]), px(`
        y
        h
        h
        y
      `), 14, 3), { skip: 'hy' }),
      O(stamp(cannonBase, px(`
        g
        gG
        .g
      `), 13, 1)),
    ],
  },
};

const wallBase = px(`
  ................
  ..gGg.gGg.gGg...
  .aaaaAaaaaAaaaA.
  .aaaaAaaaaAaaaA.
  .AAAAAAAAAAAAAA.
  .aaAaaaaAaaaaAA.
  .aaAaaaaAaaaaAA.
  .AAAAAAAAAAAAAA.
  .aaaaAaaaaAaaaA.
  .aaaaAaaaaAaaaA.
  .AAAAAAAAAAAAAA.
  .aaAaaaaAaaaaAA.
  .aaAaaaaAaaaaAA.
  .AAAAAAAAAAAAAA.
  .LTTTTTTTTTTTTt.
  ................
`);
const wall = { w: 16, h: 16, fps: 1, kind: 'building', anims: { idle: [O(wallBase)] } };

// =============================================================================================
// TOWERS
// =============================================================================================

/** Procedural brick masonry rows. */
function masonry(w, h, opts = {}) {
  const light = opts.light ?? 'a';
  const dark = opts.dark ?? 'A';
  const mortar = opts.mortar ?? 'A';
  const bw = opts.bw ?? 4;
  const out = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    const course = Math.floor(y / 2);
    for (let x = 0; x < w; x++) {
      if (y % 2 === 1 && (opts.mortarRows ?? true)) r += mortar;
      else {
        const off = course % 2 ? bw / 2 : 0;
        const bx = (x + off) % bw;
        r += bx === bw - 1 ? dark : light;
      }
    }
    out.push(r);
  }
  return out;
}

const TURRET_ROOF = px(`
  .....L.....
  ....LTt....
  ....LTt....
  ...LTTTt...
  ...LTTTt...
  ..LTTTTtt..
  ..LTTTTTt..
  .LTTTTTTtt.
  LTTTTTTTTtt
  nnnnnnnnnnn
`);

/** King tower (48x48). The king stands on the deck: feet ~6px below the top edge. */
function kingTowerRows(fx = null) {
  const W = 48;
  const H = 48;
  let r = blank(W, H);
  // stone plinth
  r = stamp(r, masonry(46, 8, { light: 'G', dark: 'd', mortar: 'd', bw: 6 }), 1, 39);
  r = rect(r, 1, 39, 46, 1, 'g');
  // keep
  r = stamp(r, masonry(32, 26, { bw: 4 }), 8, 13);
  // deck floor seen from above
  r = rect(r, 11, 2, 26, 10, 'G');
  for (let y = 4; y < 11; y += 3) r = rect(r, 11, y, 26, 1, 'd');
  for (let x = 15; x < 37; x += 6) for (let y = 2; y < 11; y++) if (y % 3 !== 1) r = dots(r, [[x + (Math.floor(y / 3) % 2) * 3, y, 'd']]);
  r = rect(r, 10, 1, 28, 1, 'g');
  r = rect(r, 10, 1, 1, 11, 'g');
  r = rect(r, 37, 1, 1, 11, 'd');
  // front battlements
  r = rect(r, 8, 11, 32, 3, 'G');
  r = rect(r, 8, 13, 32, 1, 'd');
  for (let x = 9; x < 39; x += 5) r = stamp(r, px(`
    ggg
    gGd
  `), x, 9);
  r = rect(r, 8, 11, 32, 1, 'g');
  // little deck cannon
  r = stamp(r, px(`
    .dd.
    dkkd
    .kk.
  `), 22, 10);
  // corner turrets with team roofs
  for (const tx of [1, 36]) {
    r = stamp(r, masonry(11, 29, { bw: 4 }), tx, 10);
    r = rect(r, tx, 10, 1, 29, 'a');
    r = rect(r, tx + 10, 10, 1, 29, 'A');
    r = rect(r, tx, 10, 11, 1, 'A');
    r = stamp(r, px(`
      gGd
      kkk
      kkk
      kkk
    `), tx + 4, 18);
    r = stamp(r, px(`
      gGd
      kkk
      kkk
    `), tx + 4, 28);
    r = stamp(r, TURRET_ROOF, tx, 1);
  }
  // team banners
  for (const bx of [13, 33]) {
    r = stamp(r, px(`
      nn
      LT
      TT
      Tt
      Tt
      T.
    `), bx, 16);
  }
  // crest
  r = stamp(r, px(`
    .yyyyyy.
    yhyyyyyY
    yyLTTtyY
    yyTyytyY
    yyTTTtyY
    .yyTtyY.
    ..yyYY..
  `), 20, 16);
  // gate
  r = stamp(r, px(`
    ...gggggg...
    ..gGGGGGGd..
    .gGkkkkkkGd.
    .gGkkkkkkGd.
    .gGknkknkGd.
    .gGknkknkGd.
    .gGknkknkGd.
    .gGknkknkGd.
    .gGknkknkGd.
    .gGknkknkGd.
  `), 18, 29);
  if (fx) r = stamp(r, fx, 21, 12);
  return r.map((row) => row.slice(0, W));
}
const king_tower = {
  w: 48, h: 48, fps: 8, kind: 'tower',
  anims: {
    idle: [O(kingTowerRows())],
    attack: [
      O(kingTowerRows(px(`
        ..yy..
        .yhhy.
        yhwwhy
        .yhhy.
      `)), { skip: 'hwy' }),
      O(kingTowerRows(px(`
        ..gg..
        .gGGg.
        ..gg..
      `))),
    ],
  },
};

/** Princess tower (32x40) with a crossbow guard on the deck. */
function princessTowerRows(pose = 0) {
  const W = 32;
  const H = 40;
  let r = blank(W, H);
  r = stamp(r, masonry(28, 6, { light: 'G', dark: 'd', mortar: 'd', bw: 5 }), 2, 33);
  r = rect(r, 2, 33, 28, 1, 'g');
  r = stamp(r, masonry(22, 23, { bw: 4 }), 5, 10);
  r = rect(r, 5, 10, 1, 23, 'a');
  r = rect(r, 26, 10, 1, 23, 'A');
  // deck
  r = rect(r, 6, 3, 20, 7, 'G');
  r = rect(r, 6, 3, 20, 1, 'g');
  r = rect(r, 6, 6, 20, 1, 'd');
  // guard (behind the battlements)
  r = stamp(r, px(`
    ..Lt...
    .gggGd.
    .gsosd.
    .gsSSd.
    LTTTTtt
    TTTTTtt
  `), 12, 1);
  if (pose === 1) {
    r = stamp(r, px(`
      nBBBg
      .s...
    `), 17, 5);
  } else if (pose === 2) {
    r = stamp(r, px(`
      nBBBgy
      .s...h
    `), 17, 5);
  }
  // corner flags
  r = stamp(r, px(`
    LT.
    Tt.
    n..
    n..
  `), 5, 2);
  r = stamp(r, px(`
    LT.
    Tt.
    n..
    n..
  `), 25, 2);
  // battlements
  for (let x = 4; x < 28; x += 5) r = stamp(r, px(`
    ggg
    GGd
  `), x, 7);
  r = rect(r, 4, 9, 24, 1, 'G');
  r = rect(r, 4, 10, 24, 1, 'd');
  // door
  r = stamp(r, px(`
    ..gggggg..
    .gGkkkkGd.
    .gGknknGd.
    .gGknknGd.
    .gGknknGd.
  `), 11, 28);
  // team shield
  r = stamp(r, px(`
    LTTTTTTt
    TTTyyTTt
    TTyhyyTt
    TTTyyTTt
    .TTTTTt.
    ..TTtt..
    ...tt...
  `), 12, 16);
  // windows
  r = stamp(r, px(`
    gGd
    kkk
    kkk
  `), 7, 13);
  r = stamp(r, px(`
    gGd
    kkk
    kkk
  `), 22, 13);
  return r.map((row) => row.slice(0, W));
}
const princess_tower = {
  w: 32, h: 40, fps: 6, kind: 'tower',
  anims: {
    idle: [O(princessTowerRows(0))],
    attack: [O(princessTowerRows(1)), O(princessTowerRows(2), { skip: 'hy' })],
  },
};

function ruinRows() {
  let r = blank(32, 24);
  r = stamp(r, masonry(28, 6, { light: 'G', dark: 'd', mortar: 'd', bw: 5 }), 2, 17);
  r = rect(r, 2, 17, 28, 1, 'g');
  r = stamp(r, px(`
    ......aA..............
    .....aaAa.......a.....
    ....aaaAaa.....aaA....
    ....AAAAAA....aAAAA...
    ...aaAaaaAa..aaAaaa...
    ...aaAaaaAaaaaaAaaaA..
    ..AAAAAAAAAAAAAAAAAAA.
    ..aaaaAkkkkkkkkAaaaaA.
    ..aaaaAknnkknnkAaaaaA.
    ..AAAAAknnkknnkAAAAAA.
  `), 4, 7);
  r = stamp(r, px(`
    dG
    Gd
  `), 3, 15);
  r = stamp(r, px(`
    aA.
    AA.
  `), 25, 14);
  r = stamp(r, px(`Gd`), 13, 16);
  return r;
}
const tower_ruin = { w: 32, h: 24, fps: 1, kind: 'tower', anims: { idle: [O(ruinRows())] } };

const kingBase = px(`
  ............
  ...y.yy.y...
  ...yyyyyy...
  ...yryyyY...
  ...ssssSS...
  ...ossoSS...
  ...wwwwwS...
  ..LTwwwwTt..
  ..sTTyyTts..
  ...TTTTtt...
  ...nn..nn...
  ............
`);
const king = {
  w: 12, h: 12, fps: 4, kind: 'tower',
  anims: {
    idle: [O(kingBase), O(breathe(kingBase, 6))],
    angry: [
      O(stamp(kingBase, px(`
        oo.oo
        sossS
        rwwrS
      `), 3, 4)),
      O(stamp(shift(kingBase, 0, 0), px(`
        .oo.oo.
        .sossS.
        .rrrrS.
        s......
      `), 2, 4)),
    ],
    cheer: [
      O(stamp(kingBase, px(`
        s......s
        T......t
      `), 2, 6)),
      O(stamp(shift(kingBase, 0, -1), px(`
        s......s
        T......t
        ..........
      `), 2, 4)),
    ],
  },
};
// cheer frames: raised hands + open mouth
king.anims.cheer = king.anims.cheer.map((f) => dots(f, [[5, 6, 'o']]));

function gem(main, dark, light) {
  return O(px(`
    ........
    ..${light}${light}${main}${main}..
    .${light}${light}${main}${main}${main}${dark}.
    .${light}${main}${main}${main}${dark}${dark}.
    ..${main}${main}${dark}${dark}..
    ...${main}${dark}...
    ........
    ........
  `.replace(/\$\{(\w+)\}/g, '')));
}
const ELEM_GEMS = {
  elem_fire: { m: 'a', d: 'R', l: 'y' },
  elem_ice: { m: 'c', d: 'C', l: 'i' },
  elem_lightning: { m: 'y', d: 'Y', l: 'h' },
  elem_earth: { m: 'V', d: 'm', l: 'v' },
};
function gemRows({ m, d, l }) {
  return O(shift(px(`
    ........
    ..${'LLMM'}..
    .LLMMMD.
    .LMMMDD.
    ..MMDD..
    ...MD...
    ........
    ........
  `).map((r) => r.replace(/L/g, l).replace(/M/g, m).replace(/D/g, d)), 0, 1).map((r) => r.replace(/w/g, 'w')));
}
void gem;

// =============================================================================================
// PETS
// =============================================================================================

const catBase = px(`
  ..........
  .b.b......
  .bbbb...b.
  .owbo...b.
  .bbbbbbbB.
  ..bBbbbbB.
  ..Bn.B.n..
  ..........
`);
const cat = troop({ name: 'cat', w: 10, h: 8, base: catBase, cx: 5, legRows: 1, kind: 'pet', fps: 8,
  walk: [catBase, stamp(catBase, px(`.n.B.Bn.`), 1, 6)] });

const dragonpupFrames = [
  px(`
    ............
    ...v.....V..
    ...vvv..VV..
    ..vvwov.Vv..
    ..vvvvvVVv..
    ...vvvVvv...
    ...yyyvVV...
    ...vyyvVV...
    ....v..v....
    ............
  `),
  px(`
    ............
    ...v........
    ...vvv......
    ..vvwov.....
    ..vvvvvvVV..
    ...vvvVVvVV.
    ...yyyvVV...
    ...vyyvVV...
    ....v..v....
    ............
  `),
];
const dragonpup = flyer({ name: 'dragonpup', w: 12, h: 10, frames: dragonpupFrames, kind: 'pet' });

const droneFrames = [
  px(`
    ..........
    .gggggggg.
    ....dd....
    ..gGGGGd..
    .GGcTcGGd.
    ..dGGGGd..
    ...y..y...
    ..........
  `),
  px(`
    ..........
    ..gg..gg..
    ....dd....
    ..gGGGGd..
    .GGcTcGGd.
    ..dGGGGd..
    ...h..h...
    ..........
  `),
];
const drone = flyer({ name: 'drone', w: 10, h: 8, frames: droneFrames, kind: 'pet', fps: 12 });

const slimeFrames = [
  px(`
    ..........
    ..........
    ...vvvv...
    ..vhvvvV..
    .vvoVvoVV.
    .vvvvvvVV.
    .VVVVVVVm.
    ..........
  `),
  px(`
    ..........
    ..........
    ..........
    ...vvvvV..
    .vhvvvvVV.
    vvoVvvoVVm
    VVVVVVVVmm
    ..........
  `),
];
const slime = { w: 10, h: 8, fps: 4, kind: 'pet', anims: { idle: slimeFrames.map((f) => O(f)), walk: slimeFrames.map((f) => O(f)) } };

const luckysheepBase = recolor(sheepBase, { w: 'y', g: 'Y', k: 'n', T: 'r' });
const luckysheep = troop({ name: 'luckysheep', w: 12, h: 10, base: luckysheepBase, cx: 6, legs: [2, 9], kind: 'pet' });
luckysheep.anims.idle = [
  O(stamp(luckysheepBase, px(`h`), 3, 2), { skip: 'h' }),
  O(stamp(luckysheepBase, px(`.h.\nhwh\n.h.`), 4, 0), { skip: 'hw' }),
];

const minigolemBase = px(`
  ............
  ....GGGG....
  ...GgGGGd...
  ...GjGGjd...
  ...GGGGdd...
  .GGgGGGGdGd.
  .GdgGjGGddd.
  .Gd.GGGd.dd.
  ....GGdd....
  ...Gd..Gd...
  ...dd..dd...
  ............
`);
const minigolem = troop({ name: 'minigolem', w: 12, h: 12, base: minigolemBase, cx: 6, kind: 'pet', fps: 5 });

// =============================================================================================
// WEAPONS (pointing right; `grip` = where the hero's hand holds it)
// =============================================================================================

function weapon(w, h, rows, grip) {
  const r = px(rows);
  check(r, w, h, 'weapon');
  return { w, h, fps: 1, kind: 'weapon', grip, anims: { idle: [O(r)] } };
}

const WEAPONS = {
  rifle: weapon(14, 6, `
    ..............
    .....dd.......
    .bbbGgggggggg.
    .nBBGddddd....
    ...nn..dd.....
    ..............
  `, [4, 4]),
  brickblaster: weapon(12, 7, `
    ............
    ..a.a.a.....
    ..aaaaaGGgg.
    .aAAaAAdd...
    ..nn........
    ..nn........
    ............
  `, [3, 4]),
  pistols: weapon(9, 7, `
    .........
    ...ddddd.
    .ggggggd.
    .GddddG..
    .nn.dd...
    .nn......
    .........
  `, [2, 4]),
  shotgun: weapon(14, 6, `
    ..............
    .bbbGGGGGGGGd.
    .nBBdbbbbdddd.
    ..nn..........
    ..............
    ..............
  `, [4, 3]),
  katana: weapon(14, 5, `
    ..............
    .kykYgggggggw.
    .kkkYGGGGGGg..
    ..............
    ..............
  `, [2, 2]),
  hammer: weapon(12, 8, `
    ............
    ........ggG.
    ........gGd.
    .nbbbbbbgGd.
    .nBBBBBBGGd.
    ........gGd.
    ........dd..
    ............
  `, [3, 4]),
  flameblaster: weapon(13, 7, `
    .............
    ..rr.........
    ..RrGGGGGd...
    .nRRGddGGdy..
    .n.Rdddddd...
    .n...........
    .............
  `, [2, 4]),
  frostray: weapon(13, 7, `
    .............
    ....ccc......
    ..gGGGGGGiic.
    .nGcciGGGGd..
    .n.dddd......
    .............
    .............
  `, [3, 4]),
  zapper: weapon(12, 7, `
    ............
    ......y.....
    ..gGGGyGGh..
    .nGyGGGGy...
    .n.ddd......
    ............
    ............
  `, [3, 4]),
  toxicsprayer: weapon(13, 7, `
    .............
    ...vVv.......
    ..gvvVgGGGd..
    .ngVVmGGGGdv.
    .n.ggg.......
    .............
    .............
  `, [3, 4]),
  leechgun: weapon(12, 7, `
    ............
    ...rRr......
    ..gPPPPPPPd.
    .nPrrRPPd...
    .n..PPP.....
    ............
    ............
  `, [3, 4]),
  unicorngun: weapon(14, 7, `
    ..............
    ......qpq...y.
    ..wwwwwwqwwy..
    .nwgwwwwwwow..
    .n..www..ww...
    ..............
    ..............
  `, [2, 4]),
  railsniper: weapon(14, 5, `
    ..............
    ...dGGd.......
    .bbbGGcgcgGGG.
    .nB.dddddd....
    ..............
  `, [3, 3]),
  minigun: weapon(14, 7, `
    ..............
    ..GGGd.gggggg.
    .nGyGGdGGGGGd.
    .nGGGGddddddd.
    .n..dd........
    ..............
    ..............
  `, [2, 4]),
  rocketlauncher: weapon(14, 7, `
    ..............
    ...GGGGGGGGGd.
    .LTTTTTTTTTar.
    .nTttttttttd..
    .n..dd........
    ..............
    ..............
  `, [4, 3]),
  singularity: weapon(13, 7, `
    .............
    ......pPP....
    ..gGGpkkkPGd.
    .nGGGpkoPPGd.
    .n.dd.pPP....
    .............
    .............
  `, [3, 4]),
  sheeplauncher: weapon(14, 8, `
    ..............
    .........ww...
    ..GGGGGGwwww..
    .nGTTTTwwwwww.
    .nGGGGGGkowk..
    .n.dd.....kk..
    ..............
    ..............
  `, [3, 4]),
};

// =============================================================================================
// HEROES (12x16 skins incl. outline; drawHero composes them)
// =============================================================================================

export const HERO_W = 12;
export const HERO_H = 16;
/** Hand pixel (where the weapon grip goes) for a right-facing hero. */
export const HERO_HAND = Object.freeze({ x: 9, y: 10 });

/** Build a skin from fill rows (outline added). */
function skin(rows) {
  const r = px(rows);
  check(r, HERO_W, HERO_H, 'hero skin');
  return O(r);
}

export const HEROES = Object.freeze({
  ember: Object.freeze({
    name: 'Ember', element: 'fire',
    skin: skin(`
      ............
      ...a.a.y....
      ..aayaayay..
      ..raayaaaR..
      ..rssssssR..
      ..sossosSS..
      ..ssssssSS..
      ...SrrrSS...
      ..LTTaaTTt..
      .sLTTaaTTts.
      .sTTTTTTtts.
      ..kkkyykkk..
      ..RRRRRRRR..
      ..RRR..RRR..
      ..nnn..nnn..
      ............
    `),
  }),
  terra: Object.freeze({
    name: 'Terra', element: 'earth',
    skin: skin(`
      ............
      ...VVVVVV...
      ..VvVVVVVm..
      ..bbbbbbbB..
      ..bsssssSB..
      ..bsossoSB..
      ..sssssSSS..
      ...BsSSSB...
      ..LTVVVVTt..
      .sLTVbbVTts.
      .sTTVVVVtts.
      ..nnnbbnnn..
      ..BBBBBBBB..
      ..BBB..BBn..
      ..nnn..nnn..
      ............
    `),
  }),
  volt: Object.freeze({
    name: 'Volt', element: 'lightning',
    skin: skin(`
      ............
      ...y..y.y...
      ..yyyyyyyy..
      ..yhyyyyyY..
      ..xcwxxcwx..
      ..sossosSS..
      ..ssssssSS..
      ...sSSSSS...
      ..LTxxxxTt..
      .sLTxyyxTts.
      .sTTxxxxtts.
      ..kkkyykkk..
      ..xxxxxxxx..
      ..xxx..xxx..
      ..kkk..kkk..
      ............
    `),
  }),
  frost: Object.freeze({
    name: 'Frost', element: 'ice',
    skin: skin(`
      ............
      ...iiiiii...
      ..iiwwiiic..
      ..iwiiiicc..
      ..issssssc..
      ..ssossosS..
      ..ssssssSS..
      ...ccccSS...
      ..LTccccTt..
      .sLTiwwiTts.
      .sTTccccCts.
      ..CCCiiCCC..
      ..ggggggGG..
      ..ggg..ggG..
      ..CCC..CCC..
      ............
    `),
  }),
  grim: Object.freeze({
    name: 'Grim', element: 'shadow',
    skin: skin(`
      ............
      ...PPPPPP...
      ..PpppppPP..
      ..PpkkkkPP..
      ..PuuuuuUP..
      ..PukuukUP..
      ..PuuuuUUP..
      ...ukukuU...
      ..LTkkkkTt..
      .uLTkpPkTtu.
      .uTTkkkktUu.
      ..PPPppPPP..
      ..kkkkkkkk..
      ..kkk..kkk..
      ..PPP..PPP..
      ............
    `),
  }),
});

/**
 * Form overlay for a hero skin. `over` paints only on existing body pixels, `add` paints anywhere
 * ('_' erases). Element chars: E main, D dark, H light (replaced by the element's palette chars).
 * @param {number} form 2 or 3
 * @param {string} element fire | ice | lightning | earth | shadow
 * @returns {{over:string[], add:string[]}}
 */
export function heroOverlay(form, element) {
  const ch = ELEMENT_CHARS[element] ?? ELEMENT_CHARS.fire;
  const sub = (rows) => rows.map((r) => r.replace(/E/g, ch.main).replace(/D/g, ch.dark).replace(/H/g, ch.light));
  if (form === 2) {
    return {
      over: sub(px(`
        ............
        ..DDDDDDDD..
        ..DDDDDDDD..
        ..DEEEEEEE..
        ..D.......D.
        ............
        ..DDDDDDDD..
        ............
        ............
        ............
        ............
        ..EEEHEEEE..
        ............
        ............
        ..DD....DD..
        ............
      `)),
      add: sub(px(`
        ............
        ...oooooo...
        ............
        ..........oo
        ..........DE
        ...........o
        ............
        ............
        ............
        ............
        ............
        ............
        .....D......
        .....o......
        ............
        ............
      `)),
    };
  }
  return {
    over: sub(px(`
      ............
      ............
      ............
      ..yyyhyyyY..
      ............
      ............
      ............
      ............
      ............
      .....hy.....
      ............
      ..yyyhhyyY..
      ............
      ............
      ..yyY..yyY..
      ............
    `)),
    add: sub(px(`
      ............
      ............
      ............
      ............
      ............
      ............
      ............
      .ohy....yYo.
      oyhy....yyYo
      ............
      ............
      ............
      ............
      ............
      ............
      ............
    `)),
  };
}
const ELEMENT_CHARS = {
  fire: { main: 'a', dark: 'R', light: 'y' },
  ice: { main: 'c', dark: 'C', light: 'i' },
  lightning: { main: 'y', dark: 'Y', light: 'h' },
  earth: { main: 'V', dark: 'm', light: 'v' },
  shadow: { main: 'p', dark: 'P', light: 'q' },
};

// =============================================================================================
// PROJECTILES, MAP OBJECTS, CHESTS
// =============================================================================================

const PROJECTILES = {
  arrow: still(7, 3, px(`
    .......
    nbbbbgw
    .......
  `), { kind: 'projectile' }, { ch: 'o' }),
  bullet: { w: 3, h: 2, fps: 1, kind: 'projectile', anims: { idle: [px(`
    hyY
    yYo
  `)] } },
  brick: still(5, 4, px(`
    .....
    .aaA.
    .AAA.
    .....
  `), { kind: 'projectile' }),
  rocket: still(7, 4, px(`
    .......
    yaGGGr.
    .aTTTR.
    .......
  `), { kind: 'projectile' }),
  fireball: still(6, 6, [px(`
    ......
    .yyh..
    .ayyy.
    .raya.
    ..rar.
    ......
  `), px(`
    ......
    ..hyy.
    .yyya.
    .ayar.
    .rar..
    ......
  `)], { kind: 'projectile', fps: 10 }, { skip: 'h' }),
  bomb: still(7, 7, [px(`
    .......
    .....h.
    ....y..
    ..kkn..
    .kdkkk.
    .kkkkk.
    ..kkk..
  `), px(`
    .......
    .....y.
    ....h..
    ..kkn..
    .kdkkk.
    .kkkkk.
    ..kkk..
  `)], { kind: 'projectile', fps: 12 }, { skip: 'hy' }),
  iceshard: still(6, 4, px(`
    ......
    .Cciw.
    ..Cc..
    ......
  `), { kind: 'projectile' }),
  bone: still(6, 4, px(`
    ......
    .uUUu.
    .u..u.
    ......
  `.replace('.u..u.', 'u....u').replace('.uUUu.', 'uUuuUu')), { kind: 'projectile' }),
};

const brickpileBase = px(`
  ................
  ................
  ................
  ................
  ......aaaA......
  .....aaaaAA.....
  ....AAAAAAAA....
  ...aAaaaAaaaA...
  ...aAaaaAaaaA...
  ..AAAAAAAAAAAA..
  ..aaaAaaaaAaaA..
  .aaaaAaaaaAaaaA.
  .AAAAAAAAAAAAAA.
  ................
  ................
  ................
`);
const brickpile = still(16, 16, [
  shift(brickpileBase, 0, 2),
  stamp(shift(brickpileBase, 0, 2), px(`
    .h.
    hwh
    .h.
  `), 5, 4),
  stamp(shift(brickpileBase, 0, 2), px(`
    .h.
    hwh
    .h.
  `), 10, 8),
  shift(brickpileBase, 0, 2),
], { kind: 'map', fps: 4 }, { skip: 'hw' });

// scorch decal: dithered toward the edges so the ground shows through
const scorch = (() => {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let r = '';
    for (let x = 0; x < 16; x++) {
      const dx = (x - 7.5) / 7.5;
      const dy = (y - 7.5) / 6.5;
      const d = Math.sqrt(dx * dx + dy * dy) + Math.sin(x * 2.1 + y * 1.3) * 0.12;
      if (d < 0.35) r += (x + y) % 3 === 0 ? 'o' : 'k';
      else if (d < 0.6) r += (x * 7 + y * 3) % 5 === 0 ? 'd' : 'k';
      else if (d < 0.85) r += (x + y) % 2 === 0 ? 'k' : '.';
      else if (d < 1.0) r += (x + 2 * y) % 4 === 0 ? 'k' : '.';
      else r += '.';
    }
    rows.push(r);
  }
  // a few dying embers
  const frames = [dots(rows, [[6, 7, 'a'], [9, 9, 'R']]), dots(rows, [[6, 7, 'R'], [10, 6, 'a']])];
  return { w: 16, h: 16, fps: 2, kind: 'map', anims: { idle: frames } };
})();

function chestRows(c, open) {
  // c = { m: main, d: dark, l: light, trim, trimD }
  const body = px(open ? `
    ........................
    ....h.....h......h......
    ......h.....h.......h...
    ....HHHHHHHHHHHHHHHH....
    ...HddddddddddddddddH...
    ...HdkkkkkkkkkkkkkkdH...
    ..HHHHHHHHHHHHHHHHHHHH..
    ..lyhyyhyhyyhyyhyyhyyd..
    ..lmmmmmmmmmmmmmmmmmmd..
    ..TTTTTTTTTTTTTTTTTTTt..
    ..lmmmmmmmHHHHmmmmmmmd..
    ..lmmmmmmmHkkHmmmmmmmd..
    ..lmmmmmmmmHHmmmmmmmmd..
    ..lmmmmmmmmmmmmmmmmmmd..
    ..ddddddddddddddddddddd.
    ........................
  ` : `
    ........................
    ........................
    ........................
    ....HHHHHHHHHHHHHHHH....
    ...HllllllllllllllllH...
    ..HlmmmmmmmmmmmmmmmmdH..
    ..HlmmmmmmmmmmmmmmmmdH..
    ..HmmmmmmmmmmmmmmmmmdH..
    ..TTTTTTTTTHHHTTTTTTTt..
    ..lmmmmmmmHHkHHmmmmmmd..
    ..lmmmmmmmHHHHHmmmmmmd..
    ..lmmmmmmmmHHHmmmmmmmd..
    ..lmmmmmmmmmmmmmmmmmmd..
    ..lmmmmmmmmmmmmmmmmmmd..
    ..ddddddddddddddddddddd.
    ........................
  `);
  const rows = body.map((r) =>
    r.replace(/m/g, c.m).replace(/d/g, c.d).replace(/l/g, c.l).replace(/H/g, c.trim).replace(/T/g, c.band),
  );
  return O(fit(rows, 24, 20), { skip: 'h' });
}
const CHESTS = {
  common: { m: 'b', d: 'B', l: 'h', trim: 'G', band: 'G' },
  rare: { m: 'a', d: 'A', l: 'y', trim: 'y', band: 'Y' },
  epic: { m: 'p', d: 'P', l: 'q', trim: 'y', band: 'Y' },
  legendary: { m: 'j', d: 'C', l: 'i', trim: 'y', band: 'w' },
  mythic: { m: 'e', d: 'P', l: 'q', trim: 'h', band: 'j' },
};

// =============================================================================================
// ASSEMBLY
// =============================================================================================

export const SPRITES = {
  // troops
  knight, archer, skeleton, gunner, bomber, bat, builder, sheep, giant, boarrider, minigunner, monk, icemage,
  flamer, sniper, dragon, necro, crab, babycrab, ufo, rocketeer, ninja, zombie, mech, bonedragon, titan, phoenix,
  phoenix_egg: phoenixEgg,
  turret: turretUnit,
  // buildings
  bricktower, tesla, crypt, mine, cannon, wall,
  // towers
  king_tower, princess_tower, tower_ruin, king,
  // pets
  cat, dragonpup, drone, slime, luckysheep, minigolem,
  // map objects
  brickpile, scorch,
};
for (const [k, g] of Object.entries(ELEM_GEMS)) SPRITES[k] = { w: 8, h: 8, fps: 1, kind: 'icon', anims: { idle: [gemRows(g)] } };
for (const [k, v] of Object.entries(WEAPONS)) SPRITES[k] = v;
for (const [k, v] of Object.entries(PROJECTILES)) SPRITES[k] = v;
for (const [k, c] of Object.entries(CHESTS)) {
  SPRITES['chest_' + k] = { w: 24, h: 20, fps: 1, kind: 'chest', anims: { closed: [chestRows(c, false)], open: [chestRows(c, true)] } };
  SPRITES['chest_' + k].anims.idle = SPRITES['chest_' + k].anims.closed;
}
for (const [k, v] of Object.entries(ICON_SPRITES)) SPRITES[k] = { kind: 'icon', ...v };

// final size check of every frame
for (const [k, s] of Object.entries(SPRITES)) {
  for (const [a, frames] of Object.entries(s.anims)) {
    const list = typeof frames[0] === 'string' ? [frames] : frames;
    list.forEach((f, i) => check(f, s.w, s.h, `${k}.${a}[${i}]`));
  }
}

/** Keys required by the art contract (docs/ARCHITECTURE.md). */
export const REQUIRED_KEYS = Object.freeze([
  'knight', 'archer', 'skeleton', 'gunner', 'bomber', 'bat', 'builder', 'sheep', 'giant', 'boarrider', 'minigunner', 'monk',
  'icemage', 'flamer', 'sniper', 'dragon', 'necro', 'crab', 'babycrab', 'ufo', 'rocketeer', 'ninja', 'zombie', 'mech',
  'bonedragon', 'titan', 'phoenix', 'phoenix_egg', 'turret',
  'bricktower', 'tesla', 'crypt', 'mine', 'cannon', 'wall',
  'king_tower', 'princess_tower', 'tower_ruin', 'king', 'elem_fire', 'elem_ice', 'elem_lightning', 'elem_earth',
  'cat', 'dragonpup', 'drone', 'slime', 'luckysheep', 'minigolem',
  'rifle', 'brickblaster', 'pistols', 'shotgun', 'katana', 'hammer', 'flameblaster', 'frostray', 'zapper', 'toxicsprayer',
  'leechgun', 'unicorngun', 'railsniper', 'minigun', 'rocketlauncher', 'singularity', 'sheeplauncher',
  'spell_volley', 'spell_spark', 'spell_wall', 'spell_meteor', 'spell_quake', 'spell_bless', 'spell_lightning', 'spell_acid',
  'spell_blizzard', 'spell_plague', 'spell_blackhole', 'spell_nuke',
  'gadget_medkit', 'gadget_jetpack', 'gadget_frostgrenade', 'gadget_turret', 'gadget_shield', 'gadget_blackhole',
  'emote_laugh', 'emote_thumbs', 'emote_cry', 'emote_angry', 'emote_gg', 'emote_baa',
  'ui_elixir', 'ui_brick', 'ui_gold', 'ui_gem', 'ui_trophy', 'ui_crown', 'ui_xp', 'ui_heart', 'ui_armor', 'ui_sword', 'ui_clock', 'ui_lock',
  'arrow', 'bullet', 'brick', 'rocket', 'fireball', 'iceshard', 'bone',
  'brickpile', 'scorch',
  'chest_common', 'chest_rare', 'chest_epic', 'chest_legendary', 'chest_mythic',
]);

/** Hero ids with art. */
export const HERO_IDS = Object.freeze(Object.keys(HEROES));
/** Weapon ids with art. */
export const WEAPON_IDS = Object.freeze(Object.keys(WEAPONS));

void flipX; void sym; void place;
