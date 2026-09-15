// Procedural map generation: elevation / moisture / temperature -> biomes, rivers, lakes, coasts, resources.

// land = target fraction of the map that is land; falloff pushes sea toward the map edges.
const MAP_TYPES = {
  continents:  { name: 'Continents',  scale: 0.030, falloff: 0.45, land: 0.38 },
  pangaea:     { name: 'Pangaea',     scale: 0.020, falloff: 0.60, land: 0.44 },
  archipelago: { name: 'Archipelago', scale: 0.055, falloff: 0.30, land: 0.28 },
};

const MAP_SIZES = {
  small:  { name: 'Small (72×48)',   w: 72,  h: 48 },
  medium: { name: 'Medium (96×64)',  w: 96,  h: 64 },
  large:  { name: 'Large (128×84)',  w: 128, h: 84 },
};

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function generateMap({ width: W, height: H, seed, type = 'continents' }) {
  const rng = new RNG(seed);
  const P = MAP_TYPES[type] || MAP_TYPES.continents;
  const elevN = new SimplexNoise(rng), ridgeN = new SimplexNoise(rng);
  const moistN = new SimplexNoise(rng), tempN = new SimplexNoise(rng), detailN = new SimplexNoise(rng);

  const tiles = new Array(W * H);
  const idx = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const at = (x, y) => (inb(x, y) ? tiles[idx(x, y)] : null);

  // --- 1. Raw fields ---
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x / W) * 2 - 1, ny = (y / H) * 2 - 1;
      const d = 0.55 * Math.max(Math.abs(nx), Math.abs(ny)) + 0.45 * Math.sqrt(nx * nx + ny * ny);
      let e = (elevN.fbm(x * P.scale, y * P.scale, 6, 2.0, 0.5) + 1) / 2;
      const ridge = 1 - Math.abs(ridgeN.fbm(x * P.scale * 2.2 + 50, y * P.scale * 2.2, 3, 2.1, 0.5));
      e = e * 0.8 + ridge * 0.2;
      e -= P.falloff * Math.pow(d, 2.2);
      const m = clamp01(0.5 + moistN.fbm(x * 0.045 + 200, y * 0.045, 4) * 1.5);
      const t = 1 - Math.abs(ny) * 1.1 + tempN.fbm(x * 0.05 + 400, y * 0.05, 3) * 0.3;
      tiles[idx(x, y)] = {
        i: idx(x, y), x, y, e, m, t, h: 0,
        terrain: 'ocean', river: false, riverTo: -1, resource: null, ruins: false,
        owner: null, improvement: null, settlement: null, castle: false, road: false, harbor: false,
        shade: detailN.noise2D(x * 0.9, y * 0.9),
      };
    }
  }

  // --- 2. Sea level (by percentile, so the land fraction matches the map type) & land height ---
  const es = tiles.map(t => t.e).sort((a, b) => a - b);
  const sea = es[Math.floor(es.length * (1 - P.land))];
  const eMax = es[es.length - 1];
  const land = tiles.filter(t => t.e > sea);
  for (const t of land) t.h = (t.e - sea) / (eMax - sea);
  const hs = land.map(t => t.h).sort((a, b) => a - b);
  const pct = p => hs[Math.min(hs.length - 1, Math.floor(hs.length * p))] || 1;
  const mountT = pct(0.94), hillT = pct(0.80);
  const isWater = t => t.e <= sea;

  // --- 3. Rivers (flow downhill along 4-neighbours, form lakes when stuck) ---
  const sources = rng.shuffle(land.filter(t => t.h >= hillT * 0.8 && t.m > 0.35));
  const riverCount = Math.floor((W * H) / 330);
  for (let r = 0; r < riverCount && r < sources.length; r++) {
    let cur = sources[r];
    if (cur.river) continue;
    const visited = new Set();
    for (let step = 0; step < 400; step++) {
      visited.add(cur.i);
      cur.river = true;
      let next = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = at(cur.x + dx, cur.y + dy);
        if (!n || visited.has(n.i)) continue;
        if (!next || n.e < next.e) next = n;
      }
      if (!next) break;
      cur.riverTo = next.i;
      if (isWater(next)) break;
      if (next.river) break;                 // joined another river
      if (next.e > cur.e + 0.012) {          // stuck in a basin -> lake
        cur.riverTo = -1;
        cur.terrain = 'lake';
        cur.lake = true;
        break;
      }
      cur = next;
    }
  }

  // --- 4. Biomes ---
  const coastal8 = t => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const n = at(t.x + dx, t.y + dy);
      if (n && n !== t && (isWater(n) || n.lake)) return true;
    }
    return false;
  };
  for (const t of tiles) {
    if (t.lake) continue;
    if (isWater(t)) { t.terrain = 'ocean'; continue; }
    const coastal = coastal8(t);
    t.t -= t.h * 0.5;
    let m = t.m + (t.river ? 0.15 : 0) + (coastal ? 0.05 : 0);
    const temp = t.t;
    if (t.h > mountT) t.terrain = 'mountains';
    else if (t.h > hillT) t.terrain = 'hills';
    else if (temp < 0.10) t.terrain = 'snow';
    else if (temp < 0.27) t.terrain = 'tundra';
    else if (temp < 0.66) {
      if (m < 0.30) t.terrain = 'plains';
      else if (m < 0.52) t.terrain = 'grassland';
      else if (m < 0.70) t.terrain = 'woods';
      else if (m < 0.85) t.terrain = 'forest';
      else t.terrain = t.h < 0.12 ? 'marsh' : 'forest';
    } else {
      if (m < 0.24) t.terrain = 'desert';
      else if (m < 0.46) t.terrain = 'savanna';
      else if (m < 0.60) t.terrain = 'woods';
      else if (m < 0.85) t.terrain = 'jungle';
      else t.terrain = t.h < 0.12 ? 'marsh' : 'jungle';
    }
    // Beaches: low, open land next to the sea.
    if (coastal && t.h < 0.06 && ['grassland', 'plains', 'savanna', 'desert', 'tundra'].includes(t.terrain)) t.terrain = 'beach';
  }

  // --- 5. Coast (shallow water within 2 tiles of land) ---
  for (const t of tiles) {
    if (t.terrain !== 'ocean') continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
      const n = at(t.x + dx, t.y + dy);
      if (n && !isWater(n)) { near = true; break; }
    }
    if (near) t.terrain = 'coast';
  }
  for (const t of tiles) t.water = !!TERRAINS[t.terrain].water;
  for (const t of tiles) {
    t.coastal = false;
    if (t.water) continue;
    for (let dy = -1; dy <= 1 && !t.coastal; dy++) for (let dx = -1; dx <= 1; dx++) {
      const n = at(t.x + dx, t.y + dy);
      if (n && n.water) { t.coastal = true; break; }
    }
  }

  // --- 6. Resources ---
  for (const t of tiles) {
    if (t.terrain === 'ocean') continue;
    const p = t.water ? 0.10 : 0.14;
    if (!rng.chance(p)) continue;
    const opts = RESOURCES.filter(r =>
      r.terrains.includes(t.terrain) && (!r.river || t.river) && (!r.coastal || t.coastal));
    if (opts.length) t.resource = rng.pick(opts).id;
  }

  // --- 7. Ancient ruins: a one-off reward for whoever claims the tile ---
  for (const t of tiles) {
    if (t.water || t.terrain === 'mountains' || t.terrain === 'snow') continue;
    if (rng.chance(0.012)) { t.ruins = true; t.resource = null; }
  }

  // Cleanup temp fields
  for (const t of tiles) { delete t.lake; }

  const ruins = new Set(tiles.filter(t => t.ruins).map(t => t.i));
  return { width: W, height: H, seed, type, tiles, landCount: tiles.filter(t => !t.water).length, ruinsAt: i => ruins.has(i) };
}
