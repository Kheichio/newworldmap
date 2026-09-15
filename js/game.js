// Core game state and rules: nations, yields, one-action-per-turn, conquest, trade, AI.

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const SETTLEMENT_SPACING = 3; // min Chebyshev distance between settlements
const WORK_RADIUS = 2;        // tiles this close to a settlement produce yields

class Game {
  constructor(map, setup) {
    this.map = map;
    this.W = map.width; this.H = map.height; this.tiles = map.tiles;
    this.rng = new RNG(map.seed + ':game');
    this.turn = 1;
    this.maxTurns = setup.maxTurns || 150;
    this.winShare = 0.5; // domination: hold half of all claimed land
    this.nations = [];
    this.log = [];
    this.actionCounts = {};
    this.relations = {};
    this.over = false;
    this.winner = null;
    this.createNations(setup);
    this.placeNations();
    for (const n of this.nations) n.income = this.computeIncome(n);
  }

  // ---------- Grid helpers ----------
  idx(x, y) { return y * this.W + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  tileAt(x, y) { return this.inb(x, y) ? this.tiles[this.idx(x, y)] : null; }
  neighbors(t, dirs = DIRS8) {
    const out = [];
    for (const [dx, dy] of dirs) { const n = this.tileAt(t.x + dx, t.y + dy); if (n) out.push(n); }
    return out;
  }
  ring(t, r) {
    const out = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (!dx && !dy) continue;
      const n = this.tileAt(t.x + dx, t.y + dy); if (n) out.push(n);
    }
    return out;
  }
  dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
  nation(id) { return this.nations[id]; }
  addLog(msg, nation) { this.log.push({ turn: this.turn, msg, nation: nation ? nation.id : null }); if (this.log.length > 300) this.log.shift(); }

  // ---------- Setup ----------
  createNations(setup) {
    const p = setup.player;
    const used = new Set([p.colorId]);
    this.nations.push(this.makeNation(0, p.name, p.leaderName, p.colorId, p.leaderTrait, true));
    const traitKeys = Object.keys(LEADER_TRAITS);
    for (let i = 1; i <= setup.aiCount; i++) {
      const free = NATION_COLORS.filter(c => !used.has(c.id));
      if (!free.length) break;
      const col = this.rng.pick(free); used.add(col.id);
      this.nations.push(this.makeNation(i, genNationName(this.rng), genLeaderName(this.rng), col.id, this.rng.pick(traitKeys), false));
    }
    for (const a of this.nations) for (const b of this.nations) if (a.id < b.id) this.relations[`${a.id}|${b.id}`] = 0;
  }

  makeNation(id, name, leaderName, colorId, leaderTrait, isPlayer) {
    const col = NATION_COLORS.find(c => c.id === colorId) || NATION_COLORS[0];
    return {
      id, name, isPlayer, color: col.hex, colorId: col.id, colorName: col.name, trait: col.trait,
      leader: { name: leaderName, trait: leaderTrait },
      mat: 30, gold: 40, growth: 0, idle: 0,
      owned: new Set(), settlements: [], castles: [], trades: new Set(),
      capital: -1, alive: true, conquests: 0, lastAction: '—', income: null,
    };
  }

  placeNations() {
    const good = new Set(['grassland', 'plains', 'woods', 'savanna', 'forest', 'hills', 'beach']);
    const probe = { trait: 'none', leader: { trait: 'none' } };
    const cands = this.tiles.filter(t => {
      if (!good.has(t.terrain) || t.x < 3 || t.y < 3 || t.x >= this.W - 3 || t.y >= this.H - 3) return false;
      const r2 = this.ring(t, 2);
      if (r2.filter(n => !n.water && n.terrain !== 'mountains').length < 14) return false;
      let food = 0, mat = 0;
      for (const n of r2) { const y = this.tileYield(n, probe); food += y.food; mat += y.mat; }
      return food >= 16 && mat >= 6;
    });
    this.rng.shuffle(cands);
    const sample = cands.slice(0, 600);
    const placed = [];
    for (const n of this.nations) {
      let best = null, bestD = -1;
      for (const c of sample) {
        const d = placed.length ? Math.min(...placed.map(p => this.dist(p, c))) : this.rng.float() * 1000;
        if (d > bestD) { bestD = d; best = c; }
      }
      if (!best || placed.includes(best)) best = this.rng.pick(this.tiles.filter(t => !t.water && t.terrain !== 'mountains' && !placed.some(p => this.dist(p, t) < 4)));
      placed.push(best);
      this.foundSettlement(n, best, 'city', 3, true);
      for (const nb of this.ring(best, 1)) if (nb.terrain !== 'ocean' && nb.owner === null) this.claim(n, nb);
    }
  }

  claim(n, t) {
    if (t.owner !== null && t.owner !== n.id) {
      const prev = this.nation(t.owner);
      prev.owned.delete(t.i);
      if (t.settlement) prev.settlements = prev.settlements.filter(i => i !== t.i);
      if (t.castle) prev.castles = prev.castles.filter(i => i !== t.i);
    }
    t.owner = n.id;
    n.owned.add(t.i);
    if (t.settlement) { if (!n.settlements.includes(t.i)) n.settlements.push(t.i); t.settlement.owner = n.id; }
    if (t.castle && !n.castles.includes(t.i)) n.castles.push(t.i);
  }

  foundSettlement(n, t, type, pop, capital = false) {
    t.improvement = null;
    t.settlement = { type, pop, name: genTownName(this.rng), capital, owner: n.id };
    if (t.owner !== n.id) this.claim(n, t); else if (!n.settlements.includes(t.i)) n.settlements.push(t.i);
    if (capital) n.capital = t.i;
  }

  // ---------- Yields ----------
  tileYield(t, n) {
    const T = TERRAINS[t.terrain];
    let food = T.food, mat = T.mat, gold = T.gold;
    if (t.river && !t.water) food += 1;
    if (n.trait === 'maritime' && (t.terrain === 'coast' || t.terrain === 'lake')) food += 1;
    if (n.trait === 'miners' && (t.terrain === 'hills' || t.terrain === 'mountains')) mat += 1;
    if (n.trait === 'wanderers' && ['savanna', 'desert', 'tundra'].includes(t.terrain)) food += 1;
    const res = t.resource ? RESOURCE_BY_ID[t.resource] : null;
    if (t.improvement) {
      const imp = IMPROVEMENTS[t.improvement];
      food += imp.yield.food || 0; mat += imp.yield.mat || 0; gold += imp.yield.gold || 0;
      if (t.improvement === 'farm' && t.river) food += 1;
      if (n.trait === 'agrarian' && (t.improvement === 'farm' || t.improvement === 'pasture')) food += 1;
      if (n.trait === 'miners' && t.improvement === 'mine') mat += 2;
    }
    if (res) {
      if (t.improvement === res.imp) { food += res.yield.food || 0; mat += res.yield.mat || 0; gold += res.yield.gold || 0; }
      else { // unimproved: only a taste of the main yield
        const main = Object.entries(res.yield).sort((a, b) => b[1] - a[1])[0][0];
        if (main === 'food') food += 1; else if (main === 'mat') mat += 1; else gold += 1;
      }
    }
    if (t.castle && n.leader.trait === 'pious') gold += 1;
    return { food, mat, gold };
  }

  connectedSettlements(n) {
    // Settlements reachable from the capital over roads / settlement tiles owned by n.
    const connected = new Set();
    if (n.capital < 0) return connected;
    const stack = [n.capital];
    const seen = new Set(stack);
    while (stack.length) {
      const i = stack.pop();
      const t = this.tiles[i];
      if (t.settlement) connected.add(i);
      for (const nb of this.neighbors(t)) {
        if (seen.has(nb.i) || nb.owner !== n.id) continue;
        if (nb.road || nb.settlement) { seen.add(nb.i); stack.push(nb.i); }
      }
    }
    return connected;
  }

  tradeIncome(a, b) {
    let g = 3 + Math.min(a.settlements.length, b.settlements.length);
    if (a.trait === 'mercantile') g += 3;
    if (a.leader.trait === 'cunning') g += 2;
    return g;
  }

  // Tiles only produce when within WORK_RADIUS of one of the nation's settlements.
  workedTiles(n) {
    const worked = new Set();
    for (const i of n.settlements) {
      const s = this.tiles[i];
      worked.add(i);
      for (const nb of this.ring(s, WORK_RADIUS)) if (nb.owner === n.id) worked.add(nb.i);
    }
    return worked;
  }
  isWorked(t, n) { return n.settlements.some(i => this.dist(this.tiles[i], t) <= WORK_RADIUS); }
  // All tiles (any owner) within WORK_RADIUS of the nation's settlements.
  influenceTiles(n) {
    const near = new Set();
    for (const i of n.settlements) { near.add(i); for (const nb of this.ring(this.tiles[i], WORK_RADIUS)) near.add(nb.i); }
    return near;
  }

  computeIncome(n) {
    let food = 0, mat = 0, gold = 0, pop = 0;
    const worked = this.workedTiles(n);
    for (const i of worked) {
      const y = this.tileYield(this.tiles[i], n);
      food += y.food; mat += y.mat; gold += y.gold;
    }
    const connected = this.connectedSettlements(n);
    for (const i of n.settlements) {
      const t = this.tiles[i], s = t.settlement, S = SETTLEMENTS[s.type];
      gold += S.gold; mat += S.mat; pop += s.pop;
      if (s.capital) gold += 2;
      if (t.harbor) { gold += 2; food += 1; }
      if (n.trait === 'scholarly' && s.type !== 'village') gold += 2;
      if (n.leader.trait === 'wise' && s.type === 'city') mat += 3;
      if (connected.has(i) && !s.capital) gold += 2;
    }
    for (const id of n.trades) { const o = this.nation(id); if (o.alive) gold += this.tradeIncome(n, o); }
    if (n.trait === 'mercantile') gold = Math.round(gold * 1.25);
    if (n.leader.trait === 'frugal') gold = Math.round(gold * 1.15);
    if (n.leader.trait === 'industrious') mat = Math.round(mat * 1.15);
    if (n.leader.trait === 'bountiful') food = Math.round(food * 1.15);
    // Upkeep: settlements, castles, harbours and roads cost gold; improvements cost materials.
    let goldUp = 0, matUp = 0, roads = 0, imps = 0;
    for (const i of n.settlements) { const t = this.tiles[i]; goldUp += SETTLEMENTS[t.settlement.type].upkeep; if (t.harbor) goldUp += 1; }
    goldUp += n.castles.length * 3;
    for (const i of n.owned) { const t = this.tiles[i]; if (t.road) roads++; if (t.improvement) imps++; }
    goldUp += Math.round(roads * 0.25);
    matUp = Math.round(imps * 0.5);
    return { food, mat: mat - matUp, gold: gold - goldUp, pop, net: food - pop, goldGross: gold, matGross: mat, goldUp, matUp };
  }

  // ---------- Strength ----------
  totalPop(n) { let p = 0; for (const i of n.settlements) p += this.tiles[i].settlement.pop; return p; }
  attackStrength(n) {
    let a = 2 + n.castles.length * 2;
    for (const i of n.settlements) {
      const s = this.tiles[i].settlement;
      if (s.type === 'city') a += 2; else if (s.type === 'town') a += 1;
    }
    a += Math.floor(this.totalPop(n) / 15);
    if (n.trait === 'martial') a += 2;
    if (n.leader.trait === 'warlike') a += 2;
    return a;
  }
  defenseAt(n, t) {
    let d = 1 + Math.floor(this.totalPop(n) / 20);
    let castleD = 0;
    for (const i of n.castles) { const dd = this.dist(this.tiles[i], t); if (dd <= 1) castleD = Math.max(castleD, 6); else if (dd <= 2) castleD = Math.max(castleD, 4); }
    d += castleD;
    if (t.settlement) d += SETTLEMENTS[t.settlement.type].defense;
    if (t.conqueredTurn && this.turn - t.conqueredTurn < 6) d += 3; // fresh garrison
    if (n.leader.trait === 'stalwart') d += 3;
    if (n.trait === 'martial') d += 1;
    d += this.neighbors(t).filter(nb => nb.owner === n.id).length * 0.5;
    return d;
  }

  // ---------- Costs ----------
  // Building costs grow with the size of the nation (and how many of that thing it already has),
  // so a single action per turn stays meaningful as income grows.
  costMul(n, kind) {
    let m = 1 + n.owned.size / 100;
    const T = n.trait, L = n.leader.trait;
    if (kind === 'village') m *= 1 + 0.2 * n.settlements.length;
    if (kind === 'upgrade') m *= 1 + 0.2 * n.settlements.filter(i => this.tiles[i].settlement.type !== 'village').length;
    if (kind === 'castle') m *= 1 + 0.4 * n.castles.length;
    if (kind === 'improve') { let c = 0; for (const i of n.owned) if (this.tiles[i].improvement) c++; m *= 1 + 0.03 * c; }
    if (kind === 'expand') m = 1;
    if (kind === 'conquer') m = 1 + n.owned.size / 40;
    if (kind === 'expand') { if (T === 'wanderers') m *= 0.6; if (L === 'ambitious') m *= 0.8; }
    if (kind === 'castle') { if (T === 'martial') m *= 0.7; if (L === 'pious') m *= 0.75; }
    if (kind === 'conquer') { if (T === 'martial') m *= 0.7; if (L === 'reckless') m *= 0.5; }
    if ((kind === 'improve' || kind === 'road') && T === 'builders') m *= 0.6;
    if (kind === 'village' && T === 'builders') m *= 0.75;
    if (kind === 'upgrade' && T === 'scholarly') m *= 0.7;
    if (kind === 'harbor' && T === 'maritime') m *= 0.5;
    return m;
  }
  scaleCost(cost, m) {
    const out = {};
    for (const k in cost) out[k] = Math.max(1, Math.round(cost[k] * m));
    return out;
  }
  expandCost(n) { return this.scaleCost({ gold: 3 + Math.round(Math.pow(n.owned.size, 1.1)) }, this.costMul(n, 'expand')); }
  canAfford(n, c) { return (c.mat || 0) <= n.mat && (c.gold || 0) <= n.gold; }
  pay(n, c) { n.mat -= c.mat || 0; n.gold -= c.gold || 0; }
  costStr(c) { return Object.entries(c).map(([k, v]) => `${v} ${{ mat: 'materials', gold: 'gold' }[k]}`).join(', '); }

  isFrontier(n, t) { return t.owner !== n.id && this.neighbors(t).some(nb => nb.owner === n.id); }
  canPlaceSettlement(t) {
    return !t.water && t.terrain !== 'mountains' && !t.settlement && !t.castle
      && !this.ring(t, SETTLEMENT_SPACING - 1).some(nb => nb.settlement);
  }
  improvementAllowed(t, imp) {
    if (t.settlement || t.castle) return false;
    const I = IMPROVEMENTS[imp];
    const res = t.resource ? RESOURCE_BY_ID[t.resource] : null;
    if (res && res.cat === I.resCat) return true;
    if (I.terrains.includes(t.terrain)) return true;
    if (I.riverOk && t.river && !t.water && t.terrain !== 'mountains') return true;
    return false;
  }

  // ---------- Actions ----------
  // Returns { ok, why, cost, label } without executing. target = other nation id for trade.
  checkAction(n, id, t, target) {
    const r = (ok, why, cost, label) => ({ ok, why, cost, label });
    if (this.over && !this.continued) return r(false, 'The game is over.', {}, id);
    switch (id) {
      case 'wait': return r(true, '', {}, 'Wait & save');
      case 'expand': {
        const cost = this.expandCost(n);
        if (!t) return r(false, 'Select a tile.', cost, 'Expand border');
        if (t.owner === n.id) return r(false, 'Already yours.', cost, 'Expand border');
        if (t.owner !== null) return r(false, 'Owned by another nation — conquer it instead.', cost, 'Expand border');
        if (t.terrain === 'ocean') return r(false, 'Cannot claim open ocean.', cost, 'Expand border');
        if (!this.isFrontier(n, t)) return r(false, 'Must border your territory.', cost, 'Expand border');
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, 'Expand border');
        return r(true, '', cost, 'Expand border');
      }
      case 'conquer': {
        const cost = this.scaleCost(COSTS.conquer, this.costMul(n, 'conquer'));
        if (!t || t.owner === null || t.owner === n.id) return r(false, 'Select an enemy tile bordering you.', cost, 'Conquer');
        if (!this.isFrontier(n, t)) return r(false, 'Must border your territory.', cost, 'Conquer');
        const o = this.nation(t.owner);
        const atk = this.attackStrength(n), def = this.defenseAt(o, t);
        const label = `Conquer (${atk} vs ${def.toFixed(1)})`;
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, label);
        if (atk <= def) return r(false, `Too well defended (your attack ${atk} vs defence ${def.toFixed(1)}).`, cost, label);
        return r(true, '', cost, label);
      }
      case 'farm': case 'mine': case 'lumber': case 'pasture': case 'fishery': {
        const I = IMPROVEMENTS[id];
        const cost = this.scaleCost(I.cost, this.costMul(n, 'improve'));
        const label = `Build ${I.name}`;
        if (!t || t.owner !== n.id) return r(false, 'Must be your tile.', cost, label);
        if (t.improvement === id) return r(false, 'Already built here.', cost, label);
        if (!this.improvementAllowed(t, id)) return r(false, 'Not possible on this tile.', cost, label);
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, label);
        return r(true, t.improvement ? `Replaces ${IMPROVEMENTS[t.improvement].name}.` : '', cost, label);
      }
      case 'road': {
        const cost = this.scaleCost(COSTS.road, this.costMul(n, 'road'));
        if (!t || t.owner !== n.id) return r(false, 'Must be your tile.', cost, 'Build road');
        if (t.water || t.terrain === 'mountains') return r(false, 'Cannot build a road here.', cost, 'Build road');
        if (t.road || t.settlement) return r(false, 'Already connected.', cost, 'Build road');
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, 'Build road');
        return r(true, '', cost, 'Build road');
      }
      case 'village': {
        const cost = this.scaleCost(COSTS.village, this.costMul(n, 'village'));
        if (!t || (t.owner !== n.id && !(t.owner === null && this.isFrontier(n, t)))) return r(false, 'Must be your tile, or free land bordering your territory.', cost, 'Found village');
        if (!this.canPlaceSettlement(t)) return r(false, `Needs dry, non-mountain land at least ${SETTLEMENT_SPACING} tiles from other settlements.`, cost, 'Found village');
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, 'Found village');
        return r(true, '', cost, 'Found village');
      }
      case 'upgrade': {
        if (!t || !t.settlement || t.owner !== n.id) return r(false, 'Select one of your settlements.', {}, 'Upgrade settlement');
        const S = SETTLEMENTS[t.settlement.type];
        if (!S.next) return r(false, 'Cities cannot be upgraded further.', {}, 'Upgrade settlement');
        const cost = this.scaleCost(S.upgradeCost, this.costMul(n, 'upgrade'));
        const label = `Upgrade to ${SETTLEMENTS[S.next].name}`;
        if (t.settlement.pop < S.upgradePop) return r(false, `Needs population ${S.upgradePop} (has ${t.settlement.pop}).`, cost, label);
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, label);
        return r(true, '', cost, label);
      }
      case 'castle': {
        const cost = this.scaleCost(COSTS.castle, this.costMul(n, 'castle'));
        if (!t || t.owner !== n.id) return r(false, 'Must be your tile.', cost, 'Build castle');
        if (t.water || t.terrain === 'mountains' || t.settlement) return r(false, 'Needs open land without a settlement.', cost, 'Build castle');
        if (t.castle) return r(false, 'Already a castle here.', cost, 'Build castle');
        if (this.ring(t, 2).some(nb => nb.castle && nb.owner === n.id)) return r(false, 'Too close to another castle.', cost, 'Build castle');
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, 'Build castle');
        return r(true, '', cost, 'Build castle');
      }
      case 'harbor': {
        const cost = this.scaleCost(COSTS.harbor, this.costMul(n, 'harbor'));
        if (!t || !t.settlement || t.owner !== n.id) return r(false, 'Select one of your settlements.', cost, 'Build harbour');
        if (!t.coastal) return r(false, 'Settlement must be next to water.', cost, 'Build harbour');
        if (t.harbor) return r(false, 'Already has a harbour.', cost, 'Build harbour');
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, 'Build harbour');
        return r(true, '', cost, 'Build harbour');
      }
      case 'trade': {
        const cost = COSTS.trade;
        const o = this.nation(target);
        if (!o || o.id === n.id || !o.alive) return r(false, 'Choose a nation.', cost, 'Open trade route');
        if (n.trades.has(o.id)) return r(false, 'Already trading.', cost, 'Open trade route');
        if (this.rel(n, o) < -10) return r(false, 'Relations are too poor.', cost, 'Open trade route');
        if (!this.canReach(n, o)) return r(false, 'Need a shared border, or harbours on both sides.', cost, 'Open trade route');
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, 'Open trade route');
        return r(true, '', cost, 'Open trade route');
      }
    }
    return r(false, 'Unknown action.', {}, id);
  }

  // Border adjacency between nations, computed in one pass. Refreshed once per nation-turn
  // (see aiTurn / updateRelations) rather than after every claim.
  refreshBorders() {
    const b = new Set(), W = this.W, H = this.H, tiles = this.tiles;
    // Only look E, S, SE, SW from each tile — every adjacent pair is seen exactly once.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = tiles[y * W + x].owner;
      if (o === null) continue;
      const right = x + 1 < W, down = y + 1 < H;
      const check = (i) => { const p = tiles[i].owner; if (p !== null && p !== o) { b.add(`${o}|${p}`); b.add(`${p}|${o}`); } };
      if (right) check(y * W + x + 1);
      if (down) { check((y + 1) * W + x); if (right) check((y + 1) * W + x + 1); if (x > 0) check((y + 1) * W + x - 1); }
    }
    this.borders = b;
  }
  bordersNation(a, b) {
    if (!this.borders) this.refreshBorders();
    return this.borders.has(`${a.id}|${b.id}`);
  }
  hasHarbor(n) { return n.settlements.some(i => this.tiles[i].harbor); }
  canReach(a, b) {
    if (this.bordersNation(a, b)) return true;
    if (a.trait === 'maritime' && this.hasHarbor(a)) return true;
    return this.hasHarbor(a) && this.hasHarbor(b);
  }

  // Executes an action. Returns { ok, why, msg }.
  doAction(n, id, t, target) {
    const c = this.checkAction(n, id, t, target);
    if (!c.ok) return { ok: false, why: c.why };
    this.pay(n, c.cost);
    let msg = '';
    switch (id) {
      case 'wait': msg = 'waits and saves resources.'; break;
      case 'expand': this.claim(n, t); msg = `expands its border to ${TERRAINS[t.terrain].name.toLowerCase()} at (${t.x}, ${t.y}).`; break;
      case 'farm': case 'mine': case 'lumber': case 'pasture': case 'fishery':
        t.improvement = id; msg = `builds a ${IMPROVEMENTS[id].name.toLowerCase()} at (${t.x}, ${t.y}).`; break;
      case 'road': t.road = true; msg = `lays a road at (${t.x}, ${t.y}).`; break;
      case 'village': this.foundSettlement(n, t, 'village', 1); msg = `founds the village of ${t.settlement.name}.`; break;
      case 'upgrade': {
        const S = SETTLEMENTS[t.settlement.type];
        t.settlement.type = S.next;
        msg = `raises ${t.settlement.name} to a ${SETTLEMENTS[S.next].name.toLowerCase()}.`; break;
      }
      case 'castle': {
        t.castle = true; t.improvement = null; n.castles.push(t.i);
        let grabbed = 0;
        for (const nb of this.neighbors(t)) if (nb.owner === null && nb.terrain !== 'ocean') { this.claim(n, nb); grabbed++; }
        msg = `raises a castle at (${t.x}, ${t.y})${grabbed ? ` and claims ${grabbed} nearby tiles` : ''}.`; break;
      }
      case 'harbor': t.harbor = true; msg = `builds a harbour at ${t.settlement.name}.`; break;
      case 'trade': {
        const o = this.nation(target);
        n.trades.add(o.id); o.trades.add(n.id);
        this.shiftRel(n, o, 15);
        msg = `opens a trade route with ${o.name}.`; break;
      }
      case 'conquer': msg = this.resolveConquest(n, t); break;
    }
    n.lastAction = c.label;
    n.idle = id === 'wait' ? n.idle + 1 : 0;
    this.actionCounts[id] = (this.actionCounts[id] || 0) + 1;
    this.addLog(`${n.name} ${msg}`, n);
    return { ok: true, msg };
  }

  resolveConquest(n, t) {
    const o = this.nation(t.owner);
    const wasSettlement = t.settlement ? `${SETTLEMENTS[t.settlement.type].name.toLowerCase()} of ${t.settlement.name}` : null;
    const wasCapital = t.settlement && t.settlement.capital;
    this.claim(n, t);
    t.conqueredTurn = this.turn;
    if (t.settlement) t.settlement.capital = false;
    n.conquests++;
    if (n.trades.has(o.id)) { n.trades.delete(o.id); o.trades.delete(n.id); }
    this.shiftRel(n, o, -30);
    // Third parties who border or trade with the victim take offence.
    const anger = n.leader.trait === 'reckless' ? -8 : -4;
    for (const x of this.nations) {
      if (x === n || x === o || !x.alive) continue;
      if (x.trades.has(o.id) || this.bordersNation(x, o)) this.shiftRel(n, x, anger);
    }
    let msg = wasSettlement ? `conquers the ${wasSettlement} from ${o.name}!` : `seizes land at (${t.x}, ${t.y}) from ${o.name}.`;
    if (wasCapital) {
      if (o.settlements.length) {
        o.capital = o.settlements[0]; this.tiles[o.capital].settlement.capital = true;
        msg += ` ${o.name} moves its capital to ${this.tiles[o.capital].settlement.name}.`;
      } else o.capital = -1;
    }
    if (!o.settlements.length) {
      o.alive = false;
      for (const i of Array.from(o.owned)) this.claim(n, this.tiles[i]);
      msg += ` ${o.name} has fallen and its lands pass to ${n.name}.`;
    }
    return msg;
  }

  // ---------- Relations ----------
  relKey(a, b) { return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`; }
  rel(a, b) { return this.relations[this.relKey(a, b)] || 0; }
  shiftRel(a, b, d) {
    const k = this.relKey(a, b);
    this.relations[k] = Math.max(-100, Math.min(100, (this.relations[k] || 0) + d));
  }
  relLabel(v) {
    if (v >= 40) return 'Friendly'; if (v >= 10) return 'Warm'; if (v > -10) return 'Neutral';
    if (v > -40) return 'Cold'; return 'Hostile';
  }

  // ---------- Turn processing ----------
  endTurn() {
    for (const n of this.nations) {
      if (!n.alive) continue;
      const inc = this.computeIncome(n);
      n.mat = Math.max(0, n.mat + inc.mat); n.gold = Math.max(0, n.gold + inc.gold);
      // Food is a flow: surplus fills the growth pool, deficit drains it and eventually starves a settlement.
      let gm = 1;
      if (n.trait === 'agrarian') gm *= 1.25;
      if (n.leader.trait === 'beloved') gm *= 1.3;
      n.growth += inc.net > 0 ? inc.net * gm : inc.net;
      if (n.growth < 0) {
        n.growth = 0;
        const hungry = n.settlements.map(i => this.tiles[i].settlement).filter(s => s.pop > 1);
        if (hungry.length) { const s = this.rng.pick(hungry); s.pop--; this.addLog(`Famine in ${s.name} (${n.name}): population falls to ${s.pop}.`, n); }
      }
      this.naturalGrowth(n);
      const need = this.growthNeed(inc.pop);
      if (n.growth >= need) {
        const room = n.settlements.map(i => this.tiles[i].settlement).filter(s => s.pop < SETTLEMENTS[s.type].maxPop);
        if (room.length) {
          room.sort((a, b) => (a.pop / SETTLEMENTS[a.type].maxPop) - (b.pop / SETTLEMENTS[b.type].maxPop));
          room[0].pop++; n.growth -= need;
          if (n.isPlayer) this.addLog(`${room[0].name} grows to ${room[0].pop} people.`, n);
        } else {
          n.growth = need; // capped until there is room
          if (n.isPlayer && !n.growthWarned) { this.addLog(`Your settlements are full — upgrade one or found a village so your people can grow.`, n); n.growthWarned = true; }
        }
      }
    }
    this.updateRelations();
    for (const n of this.nations) n.income = this.computeIncome(n);
    this.turn++;
    this.checkEnd();
  }

  // Unowned, claimable tiles bordering a nation — few of them means it is boxed in.
  frontierTiles(n) {
    const seen = new Set(), out = [], W = this.W, H = this.H, tiles = this.tiles;
    for (const i of n.owned) {
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W || (!dx && !dy)) continue;
          const nb = tiles[yy * W + xx];
          if (nb.owner === null && nb.terrain !== 'ocean' && !seen.has(nb.i)) { seen.add(nb.i); out.push(nb); }
        }
      }
    }
    return out;
  }
  frontierSize(n) { return this.frontierTiles(n).filter(t => !t.water).length; }
  isAggressive(n) { return n.trait === 'martial' || n.leader.trait === 'warlike' || n.leader.trait === 'reckless'; }

  // Relations: trade and charisma warm them (up to a point); shared borders, land hunger and warlike
  // leaders create friction; otherwise they drift slowly back toward neutral.
  updateRelations() {
    this.refreshBorders();
    const alive = this.nations.filter(n => n.alive);
    const frontier = new Map(alive.map(n => [n.id, this.frontierSize(n)]));
    for (const n of alive) for (const o of alive) {
      if (o.id <= n.id) continue;
      const k = this.relKey(n, o);
      let v = this.relations[k] || 0;
      const trading = n.trades.has(o.id);
      if (trading && v < 60) v += 2;
      if (n.leader.trait === 'charismatic' || o.leader.trait === 'charismatic') v += 1.5;
      if (this.turn > 12 && this.bordersNation(n, o)) {
        let friction = trading ? 0 : 0.75;
        if (this.isAggressive(n) || this.isAggressive(o)) friction += trading ? 0.5 : 1;
        if (frontier.get(n.id) < 4 || frontier.get(o.id) < 4) friction += trading ? 0.5 : 1; // land hunger
        v -= friction;
      }
      v += v > 0 ? -0.5 : v < 0 ? 0.5 : 0;
      this.relations[k] = Math.max(-100, Math.min(100, v));
    }
  }

  growthNeed(pop) { return 10 + pop * 2; }

  // Borders creep outward around settlements each turn: each settlement has a chance to claim
  // one free tile within its influence radius that touches existing territory.
  naturalGrowth(n) {
    const chance = 0.5 + (n.trait === 'wanderers' ? 0.2 : 0);
    let grabbed = 0;
    for (const i of n.settlements) {
      if (!this.rng.chance(chance)) continue;
      const s = this.tiles[i];
      const radius = SETTLEMENTS[s.settlement.type].influence;
      let best = null, bv = -Infinity;
      for (const t of this.ring(s, radius)) {
        if (t.owner !== null || t.terrain === 'ocean' || !this.isFrontier(n, t)) continue;
        if (t.water && !t.resource && n.trait !== 'maritime') continue; // don't sprawl over empty water
        const v = this.tileValue(t, n) - this.dist(s, t) * 0.8 + this.rng.float() * 0.5;
        if (v > bv) { bv = v; best = t; }
      }
      if (best) { this.claim(n, best); grabbed++; }
    }
    if (grabbed && n.isPlayer) this.addLog(`Your borders spread naturally over ${grabbed} tile${grabbed === 1 ? '' : 's'}.`, n);
  }
  landCount(n) { let c = 0; for (const i of n.owned) if (!this.tiles[i].water) c++; return c; }
  landShare(n) { return this.landCount(n) / this.map.landCount; }
  // Share of all land currently claimed by any nation.
  claimedShare(n) {
    let total = 0;
    for (const o of this.nations) total += this.landCount(o);
    return total ? this.landCount(n) / total : 0;
  }
  score(n) {
    let s = n.owned.size;
    for (const i of n.settlements) { const st = this.tiles[i].settlement; s += SETTLEMENTS[st.type].score + st.pop; }
    s += n.castles.length * 8 + n.trades.size * 4 + Math.floor(n.gold / 20);
    return Math.round(s);
  }
  checkEnd() {
    if (this.over) return;
    const alive = this.nations.filter(n => n.alive);
    const player = this.nations.find(n => n.isPlayer);
    if (player && !player.alive) {
      this.over = true;
      this.winner = alive.slice().sort((a, b) => this.score(b) - this.score(a))[0] || player;
      this.reason = `${player.name} has fallen.`;
      return;
    }
    const dom = this.turn > 20 && this.nations.length > 1 ? alive.find(n => this.claimedShare(n) >= this.winShare) : null;
    if (dom) { this.over = true; this.winner = dom; this.reason = `${dom.name} holds ${Math.round(this.claimedShare(dom) * 100)}% of all claimed land.`; return; }
    if (alive.length === 1) { this.over = true; this.winner = alive[0]; this.reason = `${alive[0].name} is the last nation standing.`; return; }
    if (this.turn > this.maxTurns) {
      this.over = true;
      this.winner = alive.slice().sort((a, b) => this.score(b) - this.score(a))[0];
      this.reason = `Turn limit reached — highest score wins.`;
    }
  }

  // ---------- AI ----------
  tileValue(t, n) {
    const y = this.tileYield(t, n);
    let v = y.food * 1.2 + y.mat + y.gold * 1.3;
    if (t.resource) v += 2.5;
    if (t.river) v += 0.5;
    if (t.terrain === 'mountains') v -= 0.5;
    return v;
  }

  // Value of founding a settlement here: mostly the tiles it would newly bring into production.
  siteValue(t, n, near = this.influenceTiles(n)) {
    let v = 0;
    for (const nb of this.ring(t, WORK_RADIUS)) {
      if (nb.owner !== null && nb.owner !== n.id) continue;
      let w = nb.owner === n.id ? 1 : 0.6;
      if (near.has(nb.i)) w *= 0.2;
      v += this.tileValue(nb, n) * w;
    }
    return v;
  }

  // Tiles too close to an existing settlement to found another.
  settlementBlocked() {
    const blocked = new Set();
    for (const t of this.tiles) if (t.settlement) { blocked.add(t.i); for (const nb of this.ring(t, SETTLEMENT_SPACING - 1)) blocked.add(nb.i); }
    return blocked;
  }

  // Road-building helper: next road tile on the shortest path from the connected network to an unconnected settlement.
  nextRoadTile(n) {
    if (n.settlements.length < 2 || n.capital < 0) return null;
    const connected = this.connectedSettlements(n);
    const targets = n.settlements.filter(i => !connected.has(i));
    if (!targets.length) return null;
    const passable = t => t.owner === n.id && !t.water && t.terrain !== 'mountains';
    // BFS from all connected network tiles.
    const start = [];
    const seen = new Map();
    const stack = [n.capital]; seen.set(n.capital, null);
    while (stack.length) {
      const i = stack.pop(); start.push(i);
      for (const nb of this.neighbors(this.tiles[i])) {
        if (seen.has(nb.i) || nb.owner !== n.id || !(nb.road || nb.settlement)) continue;
        seen.set(nb.i, null); stack.push(nb.i);
      }
    }
    const queue = start.slice();
    const parent = new Map(start.map(i => [i, null]));
    while (queue.length) {
      const i = queue.shift(); const t = this.tiles[i];
      if (targets.includes(i)) {
        // walk back to first non-network tile
        let cur = i, first = null;
        while (cur !== null && parent.get(cur) !== null) { if (!this.tiles[cur].road && !this.tiles[cur].settlement) first = cur; cur = parent.get(cur); }
        return first !== null ? this.tiles[first] : null;
      }
      for (const nb of this.neighbors(t)) {
        if (parent.has(nb.i) || !passable(nb)) continue;
        parent.set(nb.i, i); queue.push(nb.i);
      }
    }
    return null;
  }

  aiTurn(n) {
    const cands = []; // { score, id, tile, target }
    const jitter = () => 0.85 + this.rng.float() * 0.3;
    const T = n.trait, L = n.leader.trait;
    const aggressive = T === 'martial' || L === 'warlike' || L === 'reckless';
    const add = (score, id, tile, target) => cands.push({ score: score * jitter(), id, tile, target });
    this.refreshBorders();
    const worked = this.workedTiles(n);
    const near = this.influenceTiles(n);
    const frontier = this.frontierTiles(n);
    const landFrontier = frontier.filter(t => !t.water).length;

    // Expansion
    if (frontier.length) {
      let best = null, bv = -1;
      for (const t of frontier) {
        let v = this.tileValue(t, n);
        if (t.water) v -= T === 'maritime' ? 0 : 1.5;
        if (!near.has(t.i)) v = v * 0.4 + (t.water ? 0 : 1); // unworked land is only worth it as future village ground
        if (v > bv) { bv = v; best = t; }
      }
      let s = 3 + bv * 0.6 + (n.owned.size < 16 ? 2 : 0) + (T === 'wanderers' ? 1.5 : 0) + (L === 'ambitious' ? 0.5 : 0);
      add(s, 'expand', best);
    }

    // Improvements
    for (const i of worked) {
      const t = this.tiles[i];
      if (t.improvement || t.settlement || t.castle) continue;
      for (const id in IMPROVEMENTS) {
        if (!this.improvementAllowed(t, id)) continue;
        const before = this.tileValue(t, n);
        t.improvement = id; const after = this.tileValue(t, n); t.improvement = null;
        const gain = after - before;
        const res = t.resource && RESOURCE_BY_ID[t.resource];
        let s = 1.5 + gain * 1.4 + (res && res.imp === id ? 1.5 : 0) + (T === 'builders' ? 1 : 0);
        if (T === 'agrarian' && (id === 'farm' || id === 'pasture')) s += 1;
        if (T === 'miners' && id === 'mine') s += 1;
        if (T === 'maritime' && id === 'fishery') s += 1;
        add(s, id, t);
      }
    }

    // Village sites
    {
      let best = null, bv = -1;
      const blocked = this.settlementBlocked();
      const sites = Array.from(n.owned, i => this.tiles[i]).concat(frontier.filter(t => !t.water));
      for (const t of sites) {
        if (blocked.has(t.i) || t.water || t.terrain === 'mountains' || t.castle) continue;
        const v = this.siteValue(t, n, near);
        if (v > bv) { bv = v; best = t; }
      }
      if (best && bv > 8) add(5 + bv / 6, 'village', best);
    }

    // Upgrades
    for (const i of n.settlements) {
      const t = this.tiles[i], S = SETTLEMENTS[t.settlement.type];
      if (S.next && t.settlement.pop >= S.upgradePop) add(8 + (T === 'scholarly' ? 2 : 0), 'upgrade', t);
    }

    // Roads
    const roadTile = this.nextRoadTile(n);
    if (roadTile) add(5 + (T === 'builders' ? 1 : 0), 'road', roadTile);

    // Harbours
    for (const i of n.settlements) {
      const t = this.tiles[i];
      if (t.coastal && !t.harbor) add(4.5 + (T === 'maritime' ? 3 : 0), 'harbor', t);
    }

    // Trade
    for (const o of this.nations) {
      if (o === n || !o.alive || n.trades.has(o.id)) continue;
      if (this.rel(n, o) >= -10 && this.canReach(n, o)) add(6.5 + (T === 'mercantile' ? 3 : 0) + (L === 'cunning' ? 1 : 0) - (aggressive ? 2 : 0), 'trade', null, o.id);
    }

    // Castles
    const threatened = this.nations.some(o => o !== n && o.alive && this.rel(n, o) < -10 && this.bordersNation(n, o));
    if (n.owned.size > 14 && n.castles.length < 1 + Math.floor(n.owned.size / 30)) {
      let best = null, bv = -1;
      const castleZone = new Set();
      for (const i of n.castles) for (const nb of this.ring(this.tiles[i], 2)) castleZone.add(nb.i);
      for (const i of n.owned) {
        const t = this.tiles[i];
        if (t.water || t.terrain === 'mountains' || t.settlement || t.castle || castleZone.has(i)) continue;
        let free = 0, enemy = 0;
        for (const nb of this.neighbors(t)) {
          if (nb.owner === null) { if (nb.terrain !== 'ocean') free++; }
          else if (nb.owner !== n.id) enemy++;
        }
        if (!free && !enemy) continue; // interior tile
        const v = free + enemy * 2.5;
        if (v > bv) { bv = v; best = t; }
      }
      if (best) add(2.5 + (threatened ? 4 : 0) + (T === 'martial' ? 1.5 : 0) + bv * 0.3, 'castle', best);
    }

    // Conquest
    const atk = this.attackStrength(n);
    const conquerCost = this.scaleCost(COSTS.conquer, this.costMul(n, 'conquer'));
    const landHungry = this.expandCost(n).gold > conquerCost.gold * 1.5 || landFrontier < 4;
    const seenEnemy = new Set();
    for (const i of n.owned) for (const nb of this.neighbors(this.tiles[i])) {
      if (nb.owner === null || nb.owner === n.id || seenEnemy.has(nb.i)) continue;
      seenEnemy.add(nb.i);
      const o = this.nation(nb.owner);
      const relv = this.rel(n, o);
      if (relv >= 30 && L !== 'reckless') continue;
      if (relv > -15 && !aggressive) continue;
      const def = this.defenseAt(o, nb);
      if (atk <= def) continue;
      let s = (relv < -20 ? 6 : 2.5) + this.tileValue(nb, n) * 0.4 + (nb.settlement ? 5 : 0) + (aggressive ? 1.5 : 0) + (landHungry ? 2.5 : 0);
      if (atk - def < 2) s -= 1;
      add(s, 'conquer', nb);
    }

    // Choose: best affordable, unless something much better is worth saving for.
    cands.sort((a, b) => b.score - a.score);
    const worthSaving = new Set(['village', 'upgrade', 'castle', 'harbor']);
    let choice = null, bestUnaffordable = null;
    for (const c of cands) {
      const chk = this.checkAction(n, c.id, c.tile, c.target);
      if (chk.ok) { if (!choice) choice = c; }
      else if (!bestUnaffordable && worthSaving.has(c.id) && chk.why.startsWith('Cannot afford')) bestUnaffordable = c;
      if (choice && bestUnaffordable) break;
    }
    if (bestUnaffordable && n.idle < 2 && (!choice || bestUnaffordable.score > choice.score * 1.6)) {
      const r = this.doAction(n, 'wait');
      n.lastAction = 'Saving up';
      return r;
    }
    if (!choice) return this.doAction(n, 'wait');
    return this.doAction(n, choice.id, choice.tile, choice.target);
  }

  runAITurns() {
    for (const n of this.nations) if (!n.isPlayer && n.alive) this.aiTurn(n);
  }
}
