// Canvas renderer. Tiles are drawn as irregular quadrilaterals: every grid vertex is displaced by
// seeded noise, so the world reads as an organic mosaic instead of a rigid grid.
// A terrain layer is cached once; borders, settlements, icons and highlights are drawn per frame.

const BASE_TILE = 16;   // pixels per tile at zoom 1
const CACHE_PX = 24;    // resolution of the cached terrain layer, per tile
const JITTER = 0.34;    // max vertex displacement, in tile units

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function shadeColor(hex, amt) {
  const [r, g, b] = hexToRgb(hex).map(c => Math.max(0, Math.min(255, Math.round(c + amt))));
  return `rgb(${r},${g},${b})`;
}
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function isLight(hex) { const [r, g, b] = hexToRgb(hex); return (r * 299 + g * 587 + b * 114) / 1000 > 160; }

// ---------- Sprites ----------
// Small vector drawings rendered once into offscreen canvases (SPRITE_PX square, transparent
// background) and scaled onto tiles. Settlement/castle sprites are tinted per nation colour.
const SPRITE_PX = 64;

class Sprites {
  constructor() { this.cache = new Map(); }
  get(name, color = '') {
    const key = name + '|' + color;
    let c = this.cache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = SPRITE_PX;
      const g = c.getContext('2d');
      g.lineCap = 'round'; g.lineJoin = 'round';
      this['draw_' + name](g, SPRITE_PX, color);
      this.cache.set(key, c);
    }
    return c;
  }

  // helpers
  rect(g, x, y, w, h, fill, stroke) { g.fillStyle = fill; g.fillRect(x, y, w, h); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.strokeRect(x, y, w, h); } }
  poly(g, pts, fill, stroke) {
    g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
  }
  circle(g, x, y, r, fill, stroke) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); } }
  line(g, x1, y1, x2, y2, color, w) { g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
  house(g, x, y, w, h, roof, wall = '#e8dcc3') {
    this.rect(g, x, y, w, h, wall, '#2b2118');
    this.poly(g, [x - 2, y, x + w / 2, y - h * 0.7, x + w + 2, y], roof, '#2b2118');
    this.rect(g, x + w * 0.38, y + h * 0.45, w * 0.24, h * 0.55, '#3b2a1a');
  }

  draw_farm(g, S) {
    // ploughed field with furrows and a wheat row
    this.poly(g, [6, 22, 58, 22, 58, 58, 6, 58], '#a9743d', '#5b3a1c');
    for (let i = 0; i < 5; i++) this.line(g, 9, 28 + i * 6.5, 55, 28 + i * 6.5, '#7c522a', 2);
    for (let i = 0; i < 6; i++) {
      const x = 10 + i * 8.6;
      this.line(g, x, 22, x, 9, '#c9a227', 2.2);
      this.circle(g, x, 8, 3, '#e9c85a', '#8a6a12');
      this.circle(g, x - 2.5, 12, 2.2, '#e9c85a');
      this.circle(g, x + 2.5, 12, 2.2, '#e9c85a');
    }
  }
  draw_mine(g, S) {
    // rock mound, timber-framed shaft, ore cart
    this.poly(g, [4, 52, 14, 22, 32, 10, 50, 22, 60, 52], '#8d8a83', '#4a4842');
    this.poly(g, [22, 52, 22, 34, 32, 26, 42, 34, 42, 52], '#1d1a17');
    this.line(g, 20, 52, 20, 33, '#7a4e22', 4); this.line(g, 44, 52, 44, 33, '#7a4e22', 4); this.line(g, 18, 33, 46, 33, '#7a4e22', 4);
    this.rect(g, 6, 44, 16, 9, '#4b3b2a', '#221a12');
    this.circle(g, 10, 55, 2.8, '#2a2a2a'); this.circle(g, 18, 55, 2.8, '#2a2a2a');
    this.circle(g, 11, 43, 2.2, '#d8b23a'); this.circle(g, 16, 42, 2, '#d8b23a');
    this.line(g, 48, 20, 56, 12, '#5b3a1c', 3); this.line(g, 52, 10, 60, 14, '#9aa0aa', 4);
  }
  draw_lumber(g, S) {
    // stumps, a log pile and an axe
    for (const [x, y] of [[14, 20], [46, 16]]) {
      this.rect(g, x - 5, y, 10, 9, '#6b4423', '#3a2410');
      this.circle(g, x, y, 6, '#c9a06a', '#5b3a1c'); this.circle(g, x, y, 3, null, '#8a6540');
    }
    const logs = [[20, 48], [32, 48], [44, 48], [26, 39], [38, 39], [32, 30]];
    for (const [x, y] of logs) { this.line(g, x - 10, y, x + 10, y, '#7a4e22', 9); this.circle(g, x + 10, y, 4.5, '#d6b27a', '#5b3a1c'); }
    this.line(g, 52, 56, 60, 34, '#5b3a1c', 3);
    this.poly(g, [56, 30, 64, 34, 60, 42, 54, 38], '#b9bec7', '#4a4f58');
  }
  draw_pasture(g, S) {
    // fenced meadow with grazing animals
    this.poly(g, [4, 30, 60, 30, 60, 60, 4, 60], '#7fb36a');
    for (let i = 0; i < 6; i++) this.line(g, 8 + i * 9.5, 30, 8 + i * 9.5, 22, '#8a5a2b', 3);
    this.line(g, 6, 24, 58, 24, '#8a5a2b', 3);
    for (const [x, y, s] of [[22, 46, 1], [44, 40, 0.8]]) {
      g.save(); g.translate(x, y); g.scale(s, s);
      this.circle(g, 0, 0, 9, '#f5f2e8', '#3a3a3a');
      this.circle(g, 10, -4, 4.5, '#2f2a26');
      this.line(g, -5, 8, -5, 14, '#2f2a26', 2.5); this.line(g, 5, 8, 5, 14, '#2f2a26', 2.5);
      g.restore();
    }
  }
  draw_fishery(g, S) {
    // wooden pier with posts, a boat and a hanging net
    this.rect(g, 4, 30, 40, 8, '#a67c52', '#5b3a1c');
    for (const x of [8, 20, 32, 42]) this.line(g, x, 38, x, 50, '#5b3a1c', 3);
    this.poly(g, [30, 52, 62, 52, 56, 60, 34, 60], '#6b4423', '#2b2118');
    this.line(g, 46, 52, 46, 34, '#3a2410', 2);
    this.poly(g, [47, 35, 60, 48, 47, 48], '#f4f1e6', '#7d828c');
    g.strokeStyle = '#d7c8a0'; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(6 + i * 5, 10); g.lineTo(6 + i * 5, 28); g.stroke(); g.beginPath(); g.moveTo(4, 12 + i * 5); g.lineTo(24, 12 + i * 5); g.stroke(); }
    this.circle(g, 14, 20, 3, '#8ecae6');
  }
  draw_ruins(g, S) {
    this.poly(g, [6, 58, 58, 58, 52, 48, 12, 48], '#c9b88a', '#8a7a52');
    this.rect(g, 14, 22, 8, 26, '#d9d5c8', '#6e6a60'); this.rect(g, 12, 18, 12, 5, '#d9d5c8', '#6e6a60');
    this.rect(g, 40, 32, 8, 16, '#d9d5c8', '#6e6a60'); this.poly(g, [40, 32, 48, 32, 46, 26, 42, 28], '#d9d5c8', '#6e6a60');
    this.poly(g, [26, 48, 36, 48, 34, 40, 28, 42], '#bfbbae', '#6e6a60');
    this.line(g, 52, 24, 58, 12, '#d9d5c8', 6);
  }
  draw_village(g, S, color) {
    this.house(g, 10, 30, 18, 16, color);
    this.house(g, 36, 34, 18, 14, color);
    this.rect(g, 4, 50, 56, 5, '#8a6a3a');
  }
  draw_town(g, S, color) {
    this.house(g, 6, 34, 16, 16, color);
    this.house(g, 24, 28, 18, 20, color);
    this.house(g, 44, 36, 16, 14, color);
    this.rect(g, 28, 8, 10, 22, '#d9d0bb', '#2b2118');
    this.poly(g, [26, 10, 33, 0, 40, 10], color, '#2b2118');
    this.rect(g, 2, 52, 60, 5, '#8a6a3a');
  }
  draw_city(g, S, color) {
    this.rect(g, 2, 40, 60, 16, '#b9b3a2', '#2b2118');
    for (let i = 0; i < 6; i++) this.rect(g, 4 + i * 10, 36, 6, 5, '#b9b3a2', '#2b2118');
    this.house(g, 6, 22, 14, 16, color);
    this.house(g, 44, 24, 14, 14, color);
    this.rect(g, 24, 10, 16, 30, '#d9d0bb', '#2b2118');
    for (let i = 0; i < 3; i++) this.rect(g, 24 + i * 6, 6, 4, 5, '#d9d0bb', '#2b2118');
    this.rect(g, 30, 30, 4, 10, '#3b2a1a');
    this.line(g, 32, 6, 32, -2 + 8, color, 2);
    this.poly(g, [32, 2, 44, 5, 32, 9], color);
    this.rect(g, 29, 46, 6, 10, '#3b2a1a');
  }
  draw_castle(g, S, color) {
    this.rect(g, 8, 26, 48, 30, '#7d7f86', '#2a2b2f');
    for (let i = 0; i < 7; i++) this.rect(g, 8 + i * 7.2, 21, 4.5, 6, '#7d7f86', '#2a2b2f');
    this.rect(g, 4, 14, 14, 42, '#8e9098', '#2a2b2f'); this.rect(g, 46, 14, 14, 42, '#8e9098', '#2a2b2f');
    for (const x of [4, 46]) for (let i = 0; i < 3; i++) this.rect(g, x + i * 5, 9, 3.5, 6, '#8e9098', '#2a2b2f');
    this.poly(g, [26, 56, 26, 40, 32, 34, 38, 40, 38, 56], '#2b2118');
    this.line(g, 32, 34, 32, 12, '#3a2410', 2);
    this.poly(g, [32, 12, 46, 16, 32, 21], color, '#2a2b2f');
    for (const [x, y] of [[9, 24], [51, 24], [9, 40], [51, 40]]) this.rect(g, x, y, 3, 6, '#1d1a17');
  }
  draw_harbor(g, S) {
    this.circle(g, 32, 32, 28, '#2e6f9e', '#12324a');
    this.line(g, 32, 12, 32, 50, '#f4f1e6', 5);
    this.line(g, 20, 22, 44, 22, '#f4f1e6', 5);
    g.strokeStyle = '#f4f1e6'; g.lineWidth = 5; g.beginPath(); g.arc(32, 36, 14, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    this.circle(g, 32, 10, 4, null, '#f4f1e6');
  }
}

class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sprites = new Sprites();
    this.cam = { x: 0, y: 0, zoom: 1.5 };
    this.hover = null;
    this.selected = null;
    this.highlight = null; // Set of tile indices that are valid targets in targeting mode
    this.player = null;    // nation whose idle land gets hatched
    this.showGrid = false;
    this.setGame(game);
  }

  setGame(game) {
    this.game = game;
    this.buildGeometry();
    this.buildTerrainCache();
  }

  // ---------- Geometry ----------
  buildGeometry() {
    const { W, H } = this.game;
    const noise = new SimplexNoise(new RNG(this.game.map.seed + ':shape'));
    const vx = new Float32Array((W + 1) * (H + 1)), vy = new Float32Array((W + 1) * (H + 1));
    for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) {
      const k = j * (W + 1) + i;
      const edge = i === 0 || j === 0 || i === W || j === H;
      vx[k] = i + (edge ? 0 : noise.noise2D(i * 0.9, j * 0.9) * JITTER);
      vy[k] = j + (edge ? 0 : noise.noise2D(i * 0.9 + 300, j * 0.9 + 300) * JITTER);
    }
    // Per-tile polygon: TL, TR, BR, BL (x0,y0,x1,y1,...) in tile units.
    const polys = new Float32Array(W * H * 8);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 8;
      const tl = y * (W + 1) + x, tr = tl + 1, bl = tl + W + 1, br = bl + 1;
      polys[o] = vx[tl]; polys[o + 1] = vy[tl];
      polys[o + 2] = vx[tr]; polys[o + 3] = vy[tr];
      polys[o + 4] = vx[br]; polys[o + 5] = vy[br];
      polys[o + 6] = vx[bl]; polys[o + 7] = vy[bl];
    }
    this.polys = polys;
  }

  // Trace tile polygon into the current path, in screen space.
  tracePoly(ctx, i, s, ox = this.cam.x, oy = this.cam.y) {
    const p = this.polys, o = i * 8;
    ctx.moveTo(ox + p[o] * s, oy + p[o + 1] * s);
    ctx.lineTo(ox + p[o + 2] * s, oy + p[o + 3] * s);
    ctx.lineTo(ox + p[o + 4] * s, oy + p[o + 5] * s);
    ctx.lineTo(ox + p[o + 6] * s, oy + p[o + 7] * s);
    ctx.closePath();
  }
  // Edge k of tile i (0 = north, 1 = east, 2 = south, 3 = west) as a line in the current path.
  traceEdge(ctx, i, k, s) {
    const p = this.polys, o = i * 8, a = k * 2, b = ((k + 1) % 4) * 2;
    ctx.moveTo(this.cam.x + p[o + a] * s, this.cam.y + p[o + a + 1] * s);
    ctx.lineTo(this.cam.x + p[o + b] * s, this.cam.y + p[o + b + 1] * s);
  }
  pointInTile(i, tx, ty) {
    const p = this.polys, o = i * 8;
    let inside = false;
    for (let a = 0, b = 3; a < 4; b = a++) {
      const xa = p[o + a * 2], ya = p[o + a * 2 + 1], xb = p[o + b * 2], yb = p[o + b * 2 + 1];
      if ((ya > ty) !== (yb > ty) && tx < (xb - xa) * (ty - ya) / (yb - ya) + xa) inside = !inside;
    }
    return inside;
  }

  tilePx() { return BASE_TILE * this.cam.zoom; }
  screenToTile(sx, sy) {
    const s = this.tilePx();
    const tx = (sx - this.cam.x) / s, ty = (sy - this.cam.y) / s;
    const cx = Math.floor(tx), cy = Math.floor(ty);
    const g = this.game;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = g.tileAt(cx + dx, cy + dy);
      if (t && this.pointInTile(t.i, tx, ty)) return t;
    }
    return g.tileAt(cx, cy);
  }
  centerOn(t) {
    const s = this.tilePx();
    this.cam.x = this.canvas.width / 2 - (t.x + 0.5) * s;
    this.cam.y = this.canvas.height / 2 - (t.y + 0.5) * s;
  }
  zoomAt(sx, sy, factor) {
    const before = this.tilePx();
    this.cam.zoom = Math.max(0.4, Math.min(5, this.cam.zoom * factor));
    const after = this.tilePx();
    this.cam.x = sx - (sx - this.cam.x) * (after / before);
    this.cam.y = sy - (sy - this.cam.y) * (after / before);
  }
  clampCamera() {
    const s = this.tilePx();
    const mapW = this.game.W * s, mapH = this.game.H * s;
    const pad = 200;
    this.cam.x = Math.min(pad, Math.max(this.canvas.width - mapW - pad, this.cam.x));
    this.cam.y = Math.min(pad, Math.max(this.canvas.height - mapH - pad, this.cam.y));
  }

  // ---------- Terrain cache ----------
  buildTerrainCache() {
    const { W, H, tiles } = this.game;
    const S = CACHE_PX;
    const c = document.createElement('canvas');
    c.width = W * S; c.height = H * S;
    const g = c.getContext('2d');
    g.fillStyle = TERRAINS.ocean.color; g.fillRect(0, 0, c.width, c.height);
    const rng = new RNG(this.game.map.seed + ':art');
    for (const t of tiles) {
      const T = TERRAINS[t.terrain];
      g.save();
      g.beginPath(); this.tracePoly(g, t.i, S, 0, 0); g.clip();
      g.fillStyle = shadeColor(T.color, t.shade * 10);
      g.fillRect(t.x * S - S, t.y * S - S, S * 3, S * 3);
      this.drawTerrainDetail(g, t, t.x * S, t.y * S, S, rng);
      g.restore();
      // soft seam between tiles for a mosaic feel
      g.beginPath(); this.tracePoly(g, t.i, S, 0, 0);
      g.strokeStyle = t.water ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.13)'; g.lineWidth = 1; g.stroke();
    }
    // Rivers
    g.strokeStyle = '#4fa3d8'; g.lineWidth = S * 0.16; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const t of tiles) {
      if (!t.river || t.water) continue;
      const cx = t.x * S + S / 2, cy = t.y * S + S / 2;
      if (t.riverTo >= 0) {
        const n = tiles[t.riverTo];
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(n.x * S + S / 2, n.y * S + S / 2); g.stroke();
      }
      g.fillStyle = '#4fa3d8'; g.beginPath(); g.arc(cx, cy, S * 0.1, 0, Math.PI * 2); g.fill();
    }
    this.cache = c;
  }

  drawTerrainDetail(g, t, px, py, S, rng) {
    const T = TERRAINS[t.terrain];
    const dark = shadeColor(T.color, -35), light = shadeColor(T.color, 30);
    const r = () => rng.float();
    const k = S / 16; // detail scale relative to the original 16px designs
    switch (t.terrain) {
      case 'forest': case 'jungle': case 'woods': {
        const n = t.terrain === 'woods' ? 3 : 5;
        for (let i = 0; i < n; i++) {
          const x = px + (2 + r() * (S / k - 4)) * k, y = py + (2 + r() * (S / k - 4)) * k;
          g.fillStyle = dark; g.beginPath(); g.arc(x, y, (t.terrain === 'jungle' ? 2.4 : 2) * k, 0, Math.PI * 2); g.fill();
          g.fillStyle = light; g.beginPath(); g.arc(x - 0.6 * k, y - 0.6 * k, 0.8 * k, 0, Math.PI * 2); g.fill();
        }
        break;
      }
      case 'hills':
        g.strokeStyle = dark; g.lineWidth = 1.2 * k;
        for (let i = 0; i < 2; i++) {
          const x = px + (3 + r() * 8) * k, y = py + (5 + r() * 9) * k;
          g.beginPath(); g.arc(x, y, 3 * k, Math.PI, 0); g.stroke();
        }
        break;
      case 'mountains': {
        const x = px + S / 2 + (r() - 0.5) * 4 * k, y = py + S - 3 * k;
        const h = (8 + r() * 4) * k;
        g.fillStyle = dark; g.beginPath(); g.moveTo(x - 6 * k, y); g.lineTo(x, y - h); g.lineTo(x + 6 * k, y); g.closePath(); g.fill();
        g.fillStyle = t.t < 0.45 ? '#f4f6f7' : light; g.beginPath(); g.moveTo(x - 2 * k, y - h + 3.5 * k); g.lineTo(x, y - h); g.lineTo(x + 2 * k, y - h + 3.5 * k); g.closePath(); g.fill();
        break;
      }
      case 'marsh':
        g.strokeStyle = '#3b6fa0'; g.lineWidth = 1 * k;
        for (let i = 0; i < 3; i++) { const x = px + (2 + r() * 8) * k, y = py + (3 + r() * 11) * k; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 5 * k, y); g.stroke(); }
        g.strokeStyle = dark;
        for (let i = 0; i < 2; i++) { const x = px + (3 + r() * 10) * k, y = py + (4 + r() * 10) * k; g.beginPath(); g.moveTo(x, y + 3 * k); g.lineTo(x, y - 2 * k); g.stroke(); }
        break;
      case 'desert': case 'beach': case 'savanna':
        g.fillStyle = dark;
        for (let i = 0; i < (t.terrain === 'savanna' ? 4 : 3); i++) g.fillRect(px + (2 + r() * 12) * k, py + (2 + r() * 12) * k, 1.2 * k, (t.terrain === 'savanna' ? 2.5 : 1.2) * k);
        break;
      case 'grassland': case 'plains':
        g.fillStyle = dark;
        for (let i = 0; i < 3; i++) g.fillRect(px + (2 + r() * 12) * k, py + (2 + r() * 12) * k, 1 * k, 2 * k);
        break;
      case 'tundra':
        g.fillStyle = light;
        for (let i = 0; i < 3; i++) g.fillRect(px + (2 + r() * 12) * k, py + (2 + r() * 12) * k, 2 * k, 1 * k);
        break;
      case 'ocean': case 'coast': case 'lake':
        if (r() < 0.35) {
          g.strokeStyle = light; g.lineWidth = 1 * k;
          const x = px + (2 + r() * 6) * k, y = py + (3 + r() * 10) * k;
          g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 2 * k, y - 2 * k, x + 4 * k, y); g.quadraticCurveTo(x + 6 * k, y + 2 * k, x + 8 * k, y); g.stroke();
        }
        break;
    }
  }

  // ---------- Frame ----------
  draw() {
    const { ctx, canvas, game } = this;
    const s = this.tilePx();
    ctx.fillStyle = '#0b1119';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.cache, this.cam.x, this.cam.y, game.W * s, game.H * s);

    // visible range (one extra tile each side because jittered polygons overlap cells)
    const x0 = Math.max(0, Math.floor(-this.cam.x / s) - 1), y0 = Math.max(0, Math.floor(-this.cam.y / s) - 1);
    const x1 = Math.min(game.W - 1, Math.ceil((canvas.width - this.cam.x) / s) + 1), y1 = Math.min(game.H - 1, Math.ceil((canvas.height - this.cam.y) / s) + 1);
    const cx = x => this.cam.x + (x + 0.5) * s, cy = y => this.cam.y + (y + 0.5) * s;

    // Territory tint, grouped by nation so each colour is a single fill
    for (const n of game.nations) {
      ctx.beginPath();
      let any = false;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = game.tiles[y * game.W + x];
        if (t.owner !== n.id || t.water) continue;
        this.tracePoly(ctx, t.i, s); any = true;
      }
      if (any) { ctx.fillStyle = rgba(n.color, 0.32); ctx.fill(); }
      ctx.beginPath(); any = false;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = game.tiles[y * game.W + x];
        if (t.owner !== n.id || !t.water) continue;
        this.tracePoly(ctx, t.i, s); any = true;
      }
      if (any) { ctx.fillStyle = rgba(n.color, 0.2); ctx.fill(); }
    }
    // Hatch the player's idle land
    if (this.player && s >= 8) {
      const worked = game.workedTiles(this.player);
      ctx.save();
      ctx.beginPath();
      let any = false;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = game.tiles[y * game.W + x];
        if (t.owner !== this.player.id || t.water || worked.has(t.i)) continue;
        this.tracePoly(ctx, t.i, s); any = true;
      }
      if (any) {
        ctx.clip();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
        ctx.beginPath();
        const step = s * 0.5;
        const left = this.cam.x + x0 * s, top = this.cam.y + y0 * s, right = this.cam.x + (x1 + 1) * s, bottom = this.cam.y + (y1 + 1) * s;
        for (let d = left - (bottom - top); d < right; d += step) { ctx.moveTo(d, bottom); ctx.lineTo(d + (bottom - top), top); }
        ctx.stroke();
      }
      ctx.restore();
    }
    // Grid
    if (this.showGrid && s >= 10) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.tracePoly(ctx, y * game.W + x, s);
      ctx.stroke();
    }
    // Borders: each nation's outline as one stroke
    ctx.lineWidth = Math.max(1.5, s * 0.13); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const n of game.nations) {
      ctx.beginPath();
      let any = false;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = game.tiles[y * game.W + x];
        if (t.owner !== n.id) continue;
        const nb = [game.tileAt(x, y - 1), game.tileAt(x + 1, y), game.tileAt(x, y + 1), game.tileAt(x - 1, y)];
        for (let k = 0; k < 4; k++) if (!nb[k] || nb[k].owner !== t.owner) { this.traceEdge(ctx, t.i, k, s); any = true; }
      }
      if (any) { ctx.strokeStyle = n.color; ctx.stroke(); }
    }
    // Roads
    ctx.strokeStyle = '#7a5230'; ctx.lineWidth = Math.max(1, s * 0.14);
    ctx.beginPath();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = game.tiles[y * game.W + x];
      if (!t.road && !t.settlement) continue;
      for (const [dx, dy] of DIRS8) {
        if (dy < 0 || (dy === 0 && dx < 0)) continue;
        const nb = game.tileAt(x + dx, y + dy);
        if (!nb || !(nb.road || nb.settlement) || nb.owner !== t.owner) continue;
        ctx.moveTo(cx(x), cy(y)); ctx.lineTo(cx(nb.x), cy(nb.y));
      }
    }
    ctx.stroke();
    // Icons, castles, settlements
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = game.tiles[y * game.W + x];
      const px = this.cam.x + x * s, py = this.cam.y + y * s;
      if (t.ruins) this.drawRuins(t, px, py, s);
      if (t.improvement) this.drawImprovement(t, px, py, s);
      if (t.resource && !t.settlement && !t.castle) this.drawResource(t, px, py, s, !!t.improvement);
      if (t.castle) this.drawCastle(t, px, py, s);
      if (t.settlement) this.drawSettlement(t, px, py, s);
    }
    // Labels
    if (s >= 14) {
      ctx.font = `700 ${Math.max(10, s * 0.5)}px Cinzel, "Trajan Pro", Georgia, serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = game.tiles[y * game.W + x];
        if (!t.settlement) continue;
        if (t.settlement.type === 'village' && s < 22) continue;
        this.outlinedText(t.settlement.name + (t.settlement.capital ? ' ★' : ''), cx(x), this.cam.y + y * s + s * 0.9, '#fff', 'rgba(0,0,0,0.85)');
      }
    }
    // Flags fly over capitals; when zoomed out the nation name sits beside the flag.
    for (const n of game.nations) {
      if (!n.alive || n.capital < 0 || !n.flag) continue;
      const t = game.tiles[n.capital];
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
      if (s >= 14) {
        const fw = Math.max(14, s * 0.7), fh = fw * 0.66;
        const fx = cx(t.x) + s * 0.15, fy = this.cam.y + t.y * s - fh * 0.7;
        ctx.strokeStyle = '#1b1e24'; ctx.lineWidth = Math.max(1, s * 0.06);
        ctx.beginPath(); ctx.moveTo(fx, fy + fh + s * 0.2); ctx.lineTo(fx, fy - 2); ctx.stroke();
        ctx.drawImage(n.flag, fx, fy, fw, fh);
      } else {
        ctx.font = `700 13px Cinzel, "Trajan Pro", Georgia, serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const w = ctx.measureText(n.name).width;
        const left = cx(t.x) - (w + 26) / 2;
        ctx.drawImage(n.flag, left, cy(t.y) - 20, 22, 15);
        this.outlinedText(n.name, left + 26, cy(t.y) - 12, n.color, 'rgba(0,0,0,0.85)');
      }
    }
    // Targeting mode
    if (this.highlight) {
      ctx.beginPath();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!this.highlight.has(y * game.W + x)) this.tracePoly(ctx, y * game.W + x, s);
      ctx.fillStyle = 'rgba(5,8,14,0.55)'; ctx.fill();
      ctx.beginPath();
      for (const i of this.highlight) { const t = game.tiles[i]; if (t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1) this.tracePoly(ctx, i, s); }
      ctx.fillStyle = 'rgba(241,215,122,0.2)'; ctx.fill();
      ctx.strokeStyle = '#f1d77a'; ctx.lineWidth = Math.max(1.5, s * 0.1); ctx.stroke();
    }
    if (this.hover) {
      ctx.beginPath(); this.tracePoly(ctx, this.hover.i, s);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
    }
    if (this.selected) {
      ctx.beginPath(); this.tracePoly(ctx, this.selected.i, s);
      ctx.strokeStyle = '#1b1e24'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = '#f1d77a'; ctx.lineWidth = 3; ctx.stroke();
    }
  }

  outlinedText(text, x, y, fill, stroke) {
    const ctx = this.ctx;
    ctx.lineWidth = 3; ctx.strokeStyle = stroke; ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }

  emojiFont(px) { return `${Math.floor(px)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`; }

  // Draw a sprite centred in the tile at `frac` of the tile size.
  sprite(name, color, px, py, s, frac) {
    const d = s * frac;
    this.ctx.drawImage(this.sprites.get(name, color), px + (s - d) / 2, py + (s - d) / 2, d, d);
  }

  drawRuins(t, px, py, s) {
    if (s >= 9) this.sprite('ruins', '', px, py, s, 0.85);
    else { this.ctx.fillStyle = '#d9b36c'; this.ctx.fillRect(px + s * 0.3, py + s * 0.3, s * 0.4, s * 0.4); }
  }

  // Resources: centred emoji on a plain tile; a small badge in the corner once the tile is improved.
  drawResource(t, px, py, s, improved) {
    const res = RESOURCE_BY_ID[t.resource];
    const ctx = this.ctx;
    if (s < 12) {
      ctx.fillStyle = { animal: '#f4d35e', sea: '#8ecae6', ore: '#c0c0c0', wood: '#8b5a2b', crop: '#e9c46a' }[res.cat];
      ctx.beginPath(); ctx.arc(px + s * 0.25, py + s * 0.25, Math.max(1.5, s * 0.15), 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (improved) {
      const b = s * 0.34;
      ctx.fillStyle = 'rgba(20,22,26,0.75)';
      ctx.beginPath(); ctx.arc(px + b * 0.6, py + b * 0.6, b * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.font = this.emojiFont(b * 0.8); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(res.icon, px + b * 0.6, py + b * 0.65);
    } else {
      ctx.font = this.emojiFont(s * 0.5); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(res.icon, px + s / 2, py + s / 2 + 1);
    }
  }

  drawImprovement(t, px, py, s) {
    if (s >= 10) this.sprite(t.improvement, '', px, py, s, 0.88);
    else {
      this.ctx.fillStyle = { farm: '#e9c46a', mine: '#bbb', lumber: '#a0522d', pasture: '#f4a261', fishery: '#8ecae6' }[t.improvement];
      this.ctx.fillRect(px + s * 0.25, py + s * 0.25, s * 0.5, s * 0.5);
    }
  }

  drawCastle(t, px, py, s) {
    const n = this.game.nations[t.owner];
    if (s >= 9) this.sprite('castle', n.color, px, py, s, 0.92);
    else { this.ctx.fillStyle = '#7d7f86'; this.ctx.fillRect(px + s * 0.2, py + s * 0.25, s * 0.6, s * 0.55); }
  }

  drawSettlement(t, px, py, s) {
    const ctx = this.ctx;
    const n = this.game.nations[t.owner];
    const st = t.settlement;
    const frac = { village: 0.72, town: 0.9, city: 1.05 }[st.type];
    if (s >= 9) {
      if (st.capital) {
        ctx.beginPath(); ctx.arc(px + s / 2, py + s / 2, s * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#1b1e24'; ctx.lineWidth = Math.max(2, s * 0.16); ctx.stroke();
        ctx.strokeStyle = '#f1d77a'; ctx.lineWidth = Math.max(1, s * 0.09); ctx.stroke();
      }
      this.sprite(st.type, n.color, px, py, s, frac);
    } else {
      const size = { village: 0.45, town: 0.6, city: 0.75 }[st.type] * s;
      ctx.fillStyle = '#1b1b1f'; ctx.fillRect(px + (s - size) / 2 - 1, py + (s - size) / 2 - 1, size + 2, size + 2);
      ctx.fillStyle = n.color; ctx.fillRect(px + (s - size) / 2, py + (s - size) / 2, size, size);
      if (st.capital) { ctx.strokeStyle = '#f1d77a'; ctx.lineWidth = 1.5; ctx.strokeRect(px + (s - size) / 2 - 1, py + (s - size) / 2 - 1, size + 2, size + 2); }
    }
    if (t.harbor && s >= 12) {
      const d = s * 0.36;
      ctx.drawImage(this.sprites.get('harbor'), px + s - d - 1, py + s - d - 1, d, d);
    }
  }
}
