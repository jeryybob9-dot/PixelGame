// God Box — pixel icons for the toolbar, drawn from code (needs a DOM canvas).
import { SP, TRIBES } from './constants.js';
import { paint, iconSprite } from './sprites.js';
import { BIOME_SWATCH } from './palette.js';

const PAL = {
  y: '#ffe066', Y: '#fff6b0', o: '#ff8a2e', r: '#e8433b', R: '#9a2a1f', d: '#5a3a2a', k: '#22202c', w: '#ffffff',
  b: '#3a64a8', B: '#1d3b73', l: '#7fc0ec', L: '#2f6fb0', g: '#5fd35f', G: '#2f8a2f', p: '#b45be8', P: '#5a2a8a',
  s: '#9a9690', S: '#6a6660', n: '#c89a5a', N: '#8a6438', c: '#8cff3a', C: '#4fae20', e: '#d8dee8', E: '#8a94a8',
  a: '#e2cf8a', A: '#c4ac66', m: '#7d7570', M: '#57504c', h: '#7f9a4f', H: '#5d7a38', t: '#2f7a32', T: '#1f5a24',
  i: '#f2f5fa', j: '#b8c8dc', v: '#ff5a1f', V: '#b0301a', q: '#5aa843', Q: '#3f8a32',
};

const ICONS = {
  deep: ['BBBBBBBBBBBB', 'BBBBBBBBBBBB', 'BBbbBBBBBBBB', 'BbBBbBBBBbbB', 'BBBBBBBBbBBb', 'BBBBBBBBBBBB', 'BBBBBbbBBBBB', 'BBBBbBBbBBBB', 'BBBBBBBBBBBB', 'BbbBBBBBBbbB', 'bBBbBBBBbBBb', 'BBBBBBBBBBBB'],
  shallow: ['LLLLLLLLLLLL', 'LLLLLLLLLLLL', 'LLllLLLLLLLL', 'LlLLlLLLLllL', 'LLLLLLLLlLLl', 'LLLLLLLLLLLL', 'LLLLLllLLLLL', 'LLLLlLLlLLLL', 'LLLLLLLLLLLL', 'LllLLLLLLllL', 'lLLlLLLLlLLl', 'LLLLLLLLLLLL'],
  sand: ['aaaaaaaaaaaa', 'aaAaaaaaaAaa', 'aaaaaaAaaaaa', 'aaaaaaaaaaaa', 'aAaaaaaaaaAa', 'aaaaaAaaaaaa', 'aaaaaaaaaaaa', 'aaaAaaaaAaaa', 'aaaaaaaaaaaa', 'Aaaaaaaaaaaa', 'aaaaaAaaaaAa', 'aaaaaaaaaaaa'],
  grass: ['qqqqqqqqqqqq', 'qqQqqqqqqQqq', 'qQqQqqqqQqQq', 'qqqqqqQqqqqq', 'qqqqqQqQqqqq', 'qqQqqqqqqqqq', 'qQqQqqqqqQqq', 'qqqqqqqqQqQq', 'qqqqqQqqqqqq', 'qqqqQqQqqqqq', 'qQqqqqqqqqQq', 'qqqqqqqqqqqq'],
  forest: ['....tt......', '...tttt..t..', '..ttTtTt.tt.', '..tttttt.ttt', '...tTtt.tTtt', '....dd..tttt', '.t..dd...dd.', 'ttt.......dd', 'tTtt..tt....', 'tttt.tttt...', '.dd..tTttt..', '.dd....dd...'],
  hills: ['............', '............', '............', '...hhh......', '..hhhhh.....', '.hhhhhhhh...', 'hhhhhhhHhhh.', 'hhhhhhHHhhhh', 'hhhhhhhhhhhh', 'HhhhhhhhhhhH', 'HHhhhhhhhhHH', 'HHHHHHHHHHHH'],
  mountain: ['............', '.....ii.....', '....iiij....', '....mimj....', '...mmmmMM...', '...mmmmMM...', '..mmmmmMMM..', '..mmmmmmMM..', '.mmmmmmmMMM.', '.mmmmmmmMMM.', 'mmmmmmmmmMMM', 'mmmmmmmmmMMM'],
  snow: ['.....i......', '..i..i..i...', '...i.i.i....', '....iii.....', 'iiiiijiiiii.', '....iii.....', '...i.i.i....', '..i..i..i...', '.....i......', '............', 'jjjjjjjjjjjj', 'iiiiiiiiiiii'],
  lava: ['vvvvvvvvvvvv', 'vvyvvvVvvvvv', 'vyyyvvvvvyvv', 'vvyvvvvvyyyv', 'vvvvVvvvvyvv', 'vvvvvvvVvvvv', 'vVvvvyvvvvvv', 'vvvvyyyvvvVv', 'vvvvvyvvvvvv', 'vvvVvvvvvyvv', 'vvvvvvvvyyyv', 'vvvvvvvvvvvv'],
  raise: ['.....ww.....', '....wwww....', '...wwwwww...', '..www..www..', '.....ww.....', '.....ww.....', '.....ww.....', '............', '....nnnn....', '..nnnnnnnn..', 'nnnnnnnnnnnn', 'NNNNNNNNNNNN'],
  lower: ['.....ww.....', '.....ww.....', '.....ww.....', '..www..www..', '...wwwwww...', '....wwww....', '.....ww.....', '............', 'nnnn....nnnn', 'nnnnn..nnnnn', 'nnnnnnnnnnnn', 'NNNNNNNNNNNN'],
  seed: ['.....GG.....', '....GggG.GG.', '.....GGGgG..', '......GG....', '......d.....', '......d.....', '....XXXX....', '..XXXXXXXX..', '.XXXxXXXxXX.', 'XXXXXXXXXXXX', 'XXxXXXXXxXXX', '.XXXXXXXXXX.'],
  meteor: ['...........y', '........y.o.', '.......o.o..', '.....yo.o...', '....ooro....', '...orrrro...', '..orrRrrro..', '..orRrrRro..', '..orrrrrro..', '...orrRro...', '....oooo....', '............'],
  lightning: ['......yyyy..', '.....yyyy...', '....yyyy....', '...yyyy.....', '..yyyyyyyy..', '......yyy...', '.....yyy....', '....yyy.....', '...yy.......', '..yy........', '.y..........', '............'],
  fire: ['.....r......', '....rr......', '....rro..r..', '...rroo.rr..', '..rrooo.rr..', '..rrooyorrr.', '.rrooyyyorr.', '.rroyyyyyor.', '.rroyyYyyor.', '..rooyyyor..', '...rooooor..', '....rrrrr...'],
  rain: ['....eeee....', '..eewwwwe...', '.ewwwwwwwee.', 'ewwwwwwwwwwe', 'eEEEEEEEEEEe', '.EEEEEEEEEE.', '............', '..l...l...l.', '.l...l...l..', '............', '...l...l....', '..l...l.....'],
  quake: ['............', '..n.....n...', '.nnn...nnn..', 'nnnnnnnnnnnn', 'nnnNnnnnnnnn', 'nnnNNnnnnnnn', 'nnnnnkNnnnnn', 'NNNNnnkNNnnn', 'nnnnnnnkkNnn', 'nnnnnnnnNkNN', 'nnnnnnnnnkNn', 'NNNNNNNNNNNN'],
  plague: ['..gggggg....', '.gggggggggg.', 'ggggeeeegggg', 'gggeeeeeeggg', 'ggge..e..egg', 'gggeeeeeeggg', '.gggeeeeggg.', '..ggeeeegg..', '...G.G.G....', '..G.G.G.....', '...G.G......', '............'],
  bless: ['.....y......', '.....y......', '..y..y..y...', '...yyyyy....', '..yyyYyyy...', 'yyyyYwYyyyy.', '..yyyYyyy...', '...yyyyy....', '..y..y..y...', '.....y......', '.....y......', '............'],
  bomb: ['.......y.o..', '......o.y...', '.....dd.....', '....kkk.....', '..kkkkkkk...', '.kkkkkkwkk..', '.kkkkkkkwk..', '.kkkkkkkkk..', '.kkkkkkkkk..', '..kkkkkkk...', '...kkkkk....', '............'],
  nuke: ['..oooooooo..', '.oyyyyyyyyo.', 'oyyyYYYyyyyo', '.ooyyyyyyoo.', '...ooyyoo...', '.....yy.....', '.....oo.....', '.....yy.....', '....oyyo....', '..ooyyyyoo..', '.oooooooooo.', '............'],
  blackhole: ['....pppp....', '..ppPPPPpp..', '.pPPkkkkPPp.', '.pPkkkkkkPp.', 'pPkkkkkkkkPp', 'pPkkkkkkkwPp', 'pPkkkkkkkkPp', 'pPkkkkkkkkPp', '.pPkkkkkkPp.', '.pPPkkkkPPp.', '..ppPPPPpp..', '....pppp....'],
  acid: ['.....c......', '.....c......', '....ccc.....', '....ccc.....', '...ccccc....', '..cccwccc...', '..ccwcccc...', '.ccccccccc..', '.ccccccccC..', '..cccccCC...', '...CCCCC....', '............'],
  inspect: ['...eeee.....', '..e....e....', '.e.llll.e...', '.e.lwll.e...', '.e.llll.e...', '.e.llll.e...', '..e....e....', '...eeeen....', '.......nn...', '........nn..', '.........nn.', '..........n.'],
  borders: ['.k..........', '.krrrrrr....', '.krrrrrrr...', '.krrrrrrr...', '.krrrr......', '.k..........', '.k..........', '.k..........', '.k..........', '.k..........', 'kkk.........', '............'],
  names: ['............', '............', '.eeeeeeeeee.', 'eewwwwwwwwee', 'ewkkwkwkkwwe', 'ewwwwwwwwwwe', 'ewkwkkwkwkwe', 'eewwwwwwwwee', '.eeeeeeeeee.', '.....dd.....', '.....dd.....', '............'],
  menu: ['............', '............', '.wwwwwwwwww.', '.wwwwwwwwww.', '............', '.wwwwwwwwww.', '.wwwwwwwwww.', '............', '.wwwwwwwwww.', '.wwwwwwwwww.', '............', '............'],
  pause: ['............', '..www..www..', '..www..www..', '..www..www..', '..www..www..', '..www..www..', '..www..www..', '..www..www..', '..www..www..', '..www..www..', '..www..www..', '............'],
  close: ['............', '.ww......ww.', '.www....www.', '..www..www..', '...wwwwww...', '....wwww....', '....wwww....', '...wwwwww...', '..www..www..', '.www....www.', '.ww......ww.', '............'],
  dice: ['............', '.wwwwwwwwww.', '.wkwwwwwwkw.', '.wwwwwwwwww.', '.wwwwwwwwww.', '.wwwwkkwwww.', '.wwwwkkwwww.', '.wwwwwwwwww.', '.wwwwwwwwww.', '.wkwwwwwwkw.', '.wwwwwwwwww.', '............'],
  follow: ['............', '............', '....eeee....', '..eewwwwee..', '.ewwwkkwwwe.', 'ewwwkkkkwwwe', 'ewwwkkkkwwwe', '.ewwwkkwwwe.', '..eewwwwee..', '....eeee....', '............', '............'],
};

const cache = new Map();

/**
 * A 16x16 icon canvas for a key. Tool keys for life use creature sprites.
 * @param {string} key
 * @param {{biome?:number}} [o]
 */
export function iconCanvas(key, o = {}) {
  const ck = key + '|' + (o.biome ?? '');
  const hit = cache.get(ck);
  if (hit) return cloneCanvas(hit);
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 16;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const life = LIFE_ICONS[key];
  if (life) {
    const spr = iconSprite(life.sp, life.tribe ?? 0);
    const scale = Math.max(1, Math.floor(13 / Math.max(spr.width, spr.height)));
    const w = spr.width * scale;
    const h = spr.height * scale;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(Math.round(8 - w / 2) + 1, 14, Math.max(2, w - 2), 1);
    ctx.drawImage(spr, Math.round(8 - w / 2), Math.round(14 - h), w, h);
  } else if (key.startsWith('b_')) {
    const pal = { ...PAL, X: BIOME_SWATCH.grass[o.biome ?? 0], x: BIOME_SWATCH.forest[o.biome ?? 0] };
    ctx.drawImage(paint(ICONS.seed, pal), 2, 2);
  } else {
    const art = ICONS[key];
    if (art) ctx.drawImage(paint(art, PAL), 2, 2);
  }
  cache.set(ck, cv);
  return cloneCanvas(cv);
}

function cloneCanvas(src) {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  cv.getContext('2d').drawImage(src, 0, 0);
  return cv;
}

export const LIFE_ICONS = {
  brick: { sp: SP.VILLAGER, tribe: 0 },
  ember: { sp: SP.VILLAGER, tribe: 1 },
  leaf: { sp: SP.VILLAGER, tribe: 2 },
  stone: { sp: SP.VILLAGER, tribe: 3 },
  sheep: { sp: SP.SHEEP },
  wolf: { sp: SP.WOLF },
  crab: { sp: SP.CRAB },
  fish: { sp: SP.FISH },
  zombie: { sp: SP.ZOMBIE },
  skeleton: { sp: SP.SKELETON },
  dragon: { sp: SP.DRAGON },
  ufo: { sp: SP.UFO },
};

export { TRIBES };
