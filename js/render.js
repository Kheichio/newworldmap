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

class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
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
      if (t.resource && !t.settlement && !t.castle) this.drawResource(t, px, py, s);
      if (t.improvement) this.drawImprovement(t, px, py, s);
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
    if (s < 14) {
      ctx.font = `700 13px Cinzel, "Trajan Pro", Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const n of game.nations) {
        if (!n.alive || n.capital < 0) continue;
        const t = game.tiles[n.capital];
        this.outlinedText(n.name, cx(t.x), cy(t.y) - 12, n.color, 'rgba(0,0,0,0.85)');
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

  drawRuins(t, px, py, s) {
    const ctx = this.ctx;
    if (s >= 12) { ctx.font = this.emojiFont(s * 0.6); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🏺', px + s / 2, py + s / 2 + 1); }
    else { ctx.fillStyle = '#d9b36c'; ctx.fillRect(px + s * 0.3, py + s * 0.3, s * 0.4, s * 0.4); }
  }

  drawResource(t, px, py, s) {
    const res = RESOURCE_BY_ID[t.resource];
    const ctx = this.ctx;
    if (s >= 12) {
      ctx.font = this.emojiFont(s * 0.55); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(res.icon, px + s / 2, py + s / 2 + 1);
    } else {
      ctx.fillStyle = { animal: '#f4d35e', sea: '#8ecae6', ore: '#c0c0c0', wood: '#8b5a2b', crop: '#e9c46a' }[res.cat];
      ctx.beginPath(); ctx.arc(px + s / 2, py + s / 2, Math.max(1.5, s * 0.18), 0, Math.PI * 2); ctx.fill();
    }
  }

  drawImprovement(t, px, py, s) {
    const ctx = this.ctx;
    const imp = IMPROVEMENTS[t.improvement];
    const r = Math.max(2.5, s * 0.2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px + s - r * 2 - 1, py + 1, r * 2, r * 2);
    if (s >= 16) {
      ctx.font = this.emojiFont(r * 1.5); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(imp.icon, px + s - r - 1, py + r + 1.5);
    } else {
      ctx.fillStyle = { farm: '#e9c46a', mine: '#bbb', lumber: '#a0522d', pasture: '#f4a261', fishery: '#8ecae6' }[t.improvement];
      ctx.fillRect(px + s - r * 2, py + 2, r * 2 - 2, r * 2 - 2);
    }
  }

  drawCastle(t, px, py, s) {
    const ctx = this.ctx;
    const n = this.game.nations[t.owner];
    const w = s * 0.6, h = s * 0.55, x = px + (s - w) / 2, y = py + s * 0.35;
    ctx.fillStyle = '#5d5d66'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#8d8d99';
    const bw = w / 5;
    for (let i = 0; i < 5; i += 2) ctx.fillRect(x + i * bw, y - bw * 0.9, bw, bw);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = n.color; ctx.fillRect(x + w / 2 - 1, y - h * 0.5, 2, h * 0.5);
  }

  drawSettlement(t, px, py, s) {
    const ctx = this.ctx;
    const n = this.game.nations[t.owner];
    const st = t.settlement;
    const size = { village: 0.42, town: 0.58, city: 0.74 }[st.type] * s;
    const x = px + (s - size) / 2, y = py + (s - size) / 2;
    ctx.fillStyle = '#1b1b1f';
    ctx.fillRect(x - 1, y - 1, size + 2, size + 2);
    ctx.fillStyle = n.color;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = isLight(n.color) ? '#333' : '#fff';
    if (st.type === 'village') {
      ctx.fillRect(x + size * 0.3, y + size * 0.3, size * 0.4, size * 0.4);
    } else if (st.type === 'town') {
      ctx.fillRect(x + size * 0.18, y + size * 0.4, size * 0.25, size * 0.42);
      ctx.fillRect(x + size * 0.57, y + size * 0.25, size * 0.25, size * 0.57);
    } else {
      ctx.fillRect(x + size * 0.12, y + size * 0.45, size * 0.2, size * 0.43);
      ctx.fillRect(x + size * 0.4, y + size * 0.15, size * 0.2, size * 0.73);
      ctx.fillRect(x + size * 0.68, y + size * 0.35, size * 0.2, size * 0.53);
    }
    if (st.capital) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = Math.max(1, s * 0.08); ctx.strokeRect(x - 1, y - 1, size + 2, size + 2); }
    if (t.harbor) { ctx.fillStyle = '#8ecae6'; ctx.fillRect(px + 1, py + s - s * 0.28, s * 0.28, s * 0.26); }
  }
}
