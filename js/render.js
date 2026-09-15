// Canvas renderer: cached terrain layer + dynamic overlays (borders, settlements, improvements, resources).

const BASE_TILE = 16;

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
    this.game = game;
    this.cam = { x: 0, y: 0, zoom: 1.5 };
    this.hover = null;
    this.selected = null;
    this.highlight = null; // Set of tile indices to highlight (e.g. valid targets)
    this.showGrid = false;
    this.buildTerrainCache();
  }

  tilePx() { return BASE_TILE * this.cam.zoom; }
  screenToTile(sx, sy) {
    const s = this.tilePx();
    const x = Math.floor((sx - this.cam.x) / s), y = Math.floor((sy - this.cam.y) / s);
    return this.game.tileAt(x, y);
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
    const S = BASE_TILE;
    const c = document.createElement('canvas');
    c.width = W * S; c.height = H * S;
    const g = c.getContext('2d');
    const rng = new RNG(this.game.map.seed + ':art');
    for (const t of tiles) {
      const T = TERRAINS[t.terrain];
      const px = t.x * S, py = t.y * S;
      g.fillStyle = shadeColor(T.color, t.shade * 10);
      g.fillRect(px, py, S, S);
      this.drawTerrainDetail(g, t, px, py, S, rng);
    }
    // Rivers
    g.strokeStyle = '#4fa3d8'; g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const t of tiles) {
      if (!t.river || t.water) continue;
      const cx = t.x * S + S / 2, cy = t.y * S + S / 2;
      if (t.riverTo >= 0) {
        const n = tiles[t.riverTo];
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(n.x * S + S / 2, n.y * S + S / 2); g.stroke();
      }
      // source dot so short rivers are visible
      g.fillStyle = '#4fa3d8'; g.beginPath(); g.arc(cx, cy, 1.4, 0, Math.PI * 2); g.fill();
    }
    this.cache = c;
  }

  drawTerrainDetail(g, t, px, py, S, rng) {
    const T = TERRAINS[t.terrain];
    const dark = shadeColor(T.color, -35), light = shadeColor(T.color, 30);
    const r = () => rng.float();
    switch (t.terrain) {
      case 'forest': case 'jungle': case 'woods': {
        const n = t.terrain === 'woods' ? 3 : 5;
        for (let i = 0; i < n; i++) {
          const x = px + 2 + r() * (S - 4), y = py + 2 + r() * (S - 4);
          g.fillStyle = dark; g.beginPath(); g.arc(x, y, t.terrain === 'jungle' ? 2.4 : 2, 0, Math.PI * 2); g.fill();
          g.fillStyle = light; g.beginPath(); g.arc(x - 0.6, y - 0.6, 0.8, 0, Math.PI * 2); g.fill();
        }
        break;
      }
      case 'hills':
        g.strokeStyle = dark; g.lineWidth = 1.2;
        for (let i = 0; i < 2; i++) {
          const x = px + 3 + r() * (S - 8), y = py + 5 + r() * (S - 7);
          g.beginPath(); g.arc(x, y, 3, Math.PI, 0); g.stroke();
        }
        break;
      case 'mountains': {
        const x = px + S / 2 + (r() - 0.5) * 4, y = py + S - 3;
        const h = 8 + r() * 4;
        g.fillStyle = dark; g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x, y - h); g.lineTo(x + 6, y); g.closePath(); g.fill();
        g.fillStyle = t.t < 0.45 ? '#f4f6f7' : light; g.beginPath(); g.moveTo(x - 2, y - h + 3.5); g.lineTo(x, y - h); g.lineTo(x + 2, y - h + 3.5); g.closePath(); g.fill();
        break;
      }
      case 'marsh':
        g.strokeStyle = '#3b6fa0'; g.lineWidth = 1;
        for (let i = 0; i < 3; i++) { const x = px + 2 + r() * (S - 8), y = py + 3 + r() * (S - 5); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 5, y); g.stroke(); }
        g.strokeStyle = dark;
        for (let i = 0; i < 2; i++) { const x = px + 3 + r() * (S - 6), y = py + 4 + r() * (S - 6); g.beginPath(); g.moveTo(x, y + 3); g.lineTo(x, y - 2); g.stroke(); }
        break;
      case 'desert': case 'beach': case 'savanna':
        g.fillStyle = dark;
        for (let i = 0; i < (t.terrain === 'savanna' ? 4 : 3); i++) { g.fillRect(px + 2 + r() * (S - 4), py + 2 + r() * (S - 4), 1.2, t.terrain === 'savanna' ? 2.5 : 1.2); }
        break;
      case 'grassland': case 'plains':
        g.fillStyle = dark;
        for (let i = 0; i < 3; i++) { g.fillRect(px + 2 + r() * (S - 4), py + 2 + r() * (S - 4), 1, 2); }
        break;
      case 'tundra':
        g.fillStyle = light;
        for (let i = 0; i < 3; i++) { g.fillRect(px + 2 + r() * (S - 4), py + 2 + r() * (S - 4), 2, 1); }
        break;
      case 'ocean': case 'coast': case 'lake':
        if (r() < 0.35) {
          g.strokeStyle = light; g.lineWidth = 1;
          const x = px + 2 + r() * (S - 10), y = py + 3 + r() * (S - 6);
          g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 2, y - 2, x + 4, y); g.quadraticCurveTo(x + 6, y + 2, x + 8, y); g.stroke();
        }
        break;
    }
  }

  // ---------- Frame ----------
  draw() {
    const { ctx, canvas, game } = this;
    const s = this.tilePx();
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = s < BASE_TILE;
    ctx.drawImage(this.cache, this.cam.x, this.cam.y, game.W * s, game.H * s);

    const x0 = Math.max(0, Math.floor(-this.cam.x / s)), y0 = Math.max(0, Math.floor(-this.cam.y / s));
    const x1 = Math.min(game.W - 1, Math.ceil((canvas.width - this.cam.x) / s)), y1 = Math.min(game.H - 1, Math.ceil((canvas.height - this.cam.y) / s));
    const sx = x => this.cam.x + x * s, sy = y => this.cam.y + y * s;

    // Territory tint
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = game.tiles[y * game.W + x];
      if (t.owner === null) continue;
      ctx.fillStyle = rgba(game.nations[t.owner].color, t.water ? 0.22 : 0.3);
      ctx.fillRect(sx(x), sy(y), s + 0.5, s + 0.5);
    }
    // Grid
    if (this.showGrid && s >= 10) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
      for (let x = x0; x <= x1 + 1; x++) { ctx.beginPath(); ctx.moveTo(sx(x), sy(y0)); ctx.lineTo(sx(x), sy(y1 + 1)); ctx.stroke(); }
      for (let y = y0; y <= y1 + 1; y++) { ctx.beginPath(); ctx.moveTo(sx(x0), sy(y)); ctx.lineTo(sx(x1 + 1), sy(y)); ctx.stroke(); }
    }
    // Borders
    ctx.lineWidth = Math.max(1.5, s * 0.12);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = game.tiles[y * game.W + x];
      if (t.owner === null) continue;
      ctx.strokeStyle = game.nations[t.owner].color;
      const px = sx(x), py = sy(y), inset = ctx.lineWidth / 2;
      const n = game.tileAt(x, y - 1), sth = game.tileAt(x, y + 1), w = game.tileAt(x - 1, y), e = game.tileAt(x + 1, y);
      ctx.beginPath();
      if (!n || n.owner !== t.owner) { ctx.moveTo(px, py + inset); ctx.lineTo(px + s, py + inset); }
      if (!sth || sth.owner !== t.owner) { ctx.moveTo(px, py + s - inset); ctx.lineTo(px + s, py + s - inset); }
      if (!w || w.owner !== t.owner) { ctx.moveTo(px + inset, py); ctx.lineTo(px + inset, py + s); }
      if (!e || e.owner !== t.owner) { ctx.moveTo(px + s - inset, py); ctx.lineTo(px + s - inset, py + s); }
      ctx.stroke();
    }
    // Roads
    ctx.strokeStyle = '#7a5230'; ctx.lineWidth = Math.max(1, s * 0.14); ctx.lineCap = 'round';
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = game.tiles[y * game.W + x];
      if (!t.road && !t.settlement) continue;
      const cx = sx(x) + s / 2, cy = sy(y) + s / 2;
      for (const [dx, dy] of DIRS8) {
        if (dy < 0 || (dy === 0 && dx < 0)) continue; // each pair once
        const nb = game.tileAt(x + dx, y + dy);
        if (!nb || !(nb.road || nb.settlement) || nb.owner !== t.owner) continue;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sx(nb.x) + s / 2, sy(nb.y) + s / 2); ctx.stroke();
      }
    }
    // Improvements, resources, castles, settlements
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = game.tiles[y * game.W + x];
      const px = sx(x), py = sy(y);
      if (t.resource && !t.settlement && !t.castle) this.drawResource(t, px, py, s);
      if (t.improvement) this.drawImprovement(t, px, py, s);
      if (t.castle) this.drawCastle(t, px, py, s);
      if (t.settlement) this.drawSettlement(t, px, py, s);
    }
    // Labels
    if (s >= 14) {
      ctx.font = `bold ${Math.max(10, s * 0.55)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = game.tiles[y * game.W + x];
        if (!t.settlement) continue;
        if (t.settlement.type === 'village' && s < 22) continue;
        const label = t.settlement.name + (t.settlement.capital ? ' ★' : '');
        this.outlinedText(label, sx(x) + s / 2, sy(y) + s + 1, '#fff', 'rgba(0,0,0,0.8)');
      }
    }
    // Nation names at capitals when zoomed out
    if (s < 14) {
      ctx.font = `bold 13px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const n of game.nations) {
        if (!n.alive || n.capital < 0) continue;
        const t = game.tiles[n.capital];
        this.outlinedText(n.name, sx(t.x) + s / 2, sy(t.y) - 10, n.color, 'rgba(0,0,0,0.85)');
      }
    }
    // Highlights
    if (this.highlight) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
      for (const i of this.highlight) {
        const t = game.tiles[i];
        if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
        ctx.fillRect(sx(t.x), sy(t.y), s, s); ctx.strokeRect(sx(t.x) + 0.5, sy(t.y) + 0.5, s - 1, s - 1);
      }
    }
    if (this.hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
      ctx.strokeRect(sx(this.hover.x) + 1, sy(this.hover.y) + 1, s - 2, s - 2);
    }
    if (this.selected) {
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3;
      ctx.strokeRect(sx(this.selected.x) + 1.5, sy(this.selected.y) + 1.5, s - 3, s - 3);
    }
  }

  outlinedText(text, x, y, fill, stroke) {
    const ctx = this.ctx;
    ctx.lineWidth = 3; ctx.strokeStyle = stroke; ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }

  drawResource(t, px, py, s) {
    const res = RESOURCE_BY_ID[t.resource];
    const ctx = this.ctx;
    if (s >= 12) {
      ctx.font = `${Math.floor(s * 0.55)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
      ctx.font = `${Math.floor(r * 1.5)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
