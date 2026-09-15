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
    this.wars = new Set();   // "a|b" keys (a < b) of nations at war
    this.truces = {};        // "a|b" -> turn until which no war may be declared
    this.alliances = new Set();
    this.tributes = [];      // { from, to, amount, until }
    this.wondersBuilt = {};  // wonder id -> nation id
    this.over = false;
    this.winner = null;
    // Cards available in this game: everything without an unlock, plus unlocked ones.
    this.pool = new Set(Object.keys(CARDS).filter(id => !CARDS[id].unlock || (setup.unlocked || []).includes(CARDS[id].unlock)));
    if (setup.skipInit) return; // deserialize() fills the rest in
    this.createNations(setup);
    this.placeNations();
    for (const n of this.nations) { n.income = this.computeIncome(n); this.resetActions(n); }
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
  addLog(msg, nation) {
    this.logSeq = (this.logSeq || 0) + 1;
    this.log.push({ seq: this.logSeq, turn: this.turn, msg, nation: nation ? nation.id : null });
    if (this.log.length > 600) this.log.shift();
  }
  logSince(seq) { return this.log.filter(e => e.seq > seq); }

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
      ap: 1, apMax: 1,                 // actions per turn
      edict: null, edictUntil: 0,      // active policy
      relics: 0,                       // score from explored ruins
      peaceOffers: new Set(),          // nations offering peace to this one
      lostTiles: 0,                    // tiles lost in current wars (for AI peace decisions)
      hand: [], flagSeed: 0,
      mastery: {}, armed: [], marketBuys: 0, tempAttack: 0,
      contentment: 50, unrest: 0,
      wonderId: null, wonderProgress: 0, wonders: [],
      vassalOf: null, vassalUntil: 0, settlementsTaken: 0, harborsBuilt: 0,
    };
  }

  // ---------- Mastery ----------
  masteryTier(n, cardId) {
    const plays = (n.mastery && n.mastery[cardId]) || 0;
    return plays >= MASTERY_TIERS[1] ? 2 : plays >= MASTERY_TIERS[0] ? 1 : 0;
  }
  masteryOf(n, action) { const id = CARD_FOR_ACTION[action]; return id ? this.masteryTier(n, id) : 0; }
  handMax(n) { return HAND_MAX + (n.wonders.includes('library') ? 1 : 0); }

  // ---------- Actions per turn ----------
  // 1 action per turn, +1 for every two cities, up to 3.
  actionsPerTurn(n) {
    let cities = 0;
    for (const i of n.settlements) if (this.tiles[i].settlement.type === 'city') cities++;
    return Math.min(3, 1 + Math.floor(cities / 2));
  }
  resetActions(n) {
    n.apMax = this.actionsPerTurn(n); n.ap = n.apMax;
    n.marketBuys = 0; n.tempAttack = 0;
    n.newCards = this.refillHand(n);
  }

  // ---------- Settlement cap ----------
  // Villages need administration: the capital supports 3, each town 1 more, each city 2 more.
  settlementCap(n) {
    let cap = 3;
    for (const i of n.settlements) { const t = this.tiles[i].settlement.type; if (t === 'city') cap += 2; else if (t === 'town') cap += 1; }
    if (n.trait === 'scholarly') cap += 1;
    return cap;
  }

  // ---------- Cards ----------
  // How useful a card is right now (0..1). Cards with nothing to do are drawn far less often.
  cardUsefulness(n, id, ctx) {
    const c = CARDS[id];
    if (c.reaction) {
      if (id === 'militia' || id === 'ambush') return ctx.atWar || ctx.threatened ? 1 : 0.25;
      if (id === 'bribe') return ctx.threatened ? 1 : 0.25;
      return 0.5;
    }
    if (!c.action) return id === 'mercenaries' ? (ctx.atWar ? 1 : 0.15) : 1;
    switch (c.action) {
      case 'alliance': return ctx.allyTargets ? 1 : 0.05;
      case 'marriage': return ctx.tradeable || ctx.allyTargets ? 1 : 0.2;
      case 'greatwork': return (n.wonderId || Object.keys(WONDERS).some(w => !this.wondersBuilt[w])) && n.capital >= 0 ? 1 : 0.05;
      case 'colonize': return ctx.hasHarbor && n.settlements.length < this.settlementCap(n) ? 1 : 0.05;
      case 'raid': return ctx.hasHarbor && ctx.atWar ? 1 : 0.05;
      case 'expand': return ctx.frontier > 0 ? 1 : 0;
      case 'village': return n.settlements.length < this.settlementCap(n) ? 1 : 0.1;
      case 'upgrade': return ctx.upgradable ? 1 : 0.1;
      case 'farm': case 'mine': case 'lumber': case 'pasture': case 'fishery': return ctx.improvable[c.action] ? 1 : 0.05;
      case 'road': return n.settlements.length >= 2 ? 1 : 0.1;
      case 'castle': return n.owned.size > 14 && n.castles.length < 1 + Math.floor(n.owned.size / 30) ? 1 : 0.1;
      case 'harbor': return ctx.harborable ? 1 : 0.05;
      case 'trade': return ctx.tradeable ? 1 : 0.1;
      case 'declare_war': return ctx.warTargets ? (this.isAggressive(n) ? 1.5 : 0.8) : 0.05;
      case 'conquer': return ctx.atWar ? 1.2 : 0.05;
      case 'peace': return ctx.atWar ? 1 : 0.05;
      case 'edict': return n.edict ? 0.4 : 1;
    }
    return 1;
  }
  cardContext(n) {
    const stamp = `${this.turn}:${n.settlements.length}:${n.owned.size}:${this.wars.size}`;
    if (n._ctx && n._ctx.stamp === stamp) return n._ctx.value;
    const value = this.computeCardContext(n);
    n._ctx = { stamp, value };
    return value;
  }
  computeCardContext(n) {
    const worked = this.workedTiles(n);
    const improvable = {};
    for (const i of worked) {
      const t = this.tiles[i];
      if (t.settlement || t.castle) continue;
      for (const id in IMPROVEMENTS) if (!improvable[id] && t.improvement !== id && this.improvementAllowed(t, id)) improvable[id] = true;
    }
    const frontier = this.frontierSize(n);
    return {
      frontier,
      upgradable: n.settlements.some(i => { const s = this.tiles[i].settlement; const S = SETTLEMENTS[s.type]; return S.next && s.pop >= S.upgradePop; }),
      improvable,
      harborable: n.settlements.some(i => this.tiles[i].coastal && !this.tiles[i].harbor),
      tradeable: this.nations.some(o => o !== n && o.alive && !n.trades.has(o.id) && this.rel(n, o) >= -10 && this.canReach(n, o)),
      warTargets: this.nations.some(o => o !== n && o.alive && !this.atWar(n, o) && !this.truceActive(n, o) && !this.allied(n, o) && !this.isVassalOf(n, o)
        && (this.rel(n, o) < -10 || (this.isAggressive(n) && this.rel(n, o) < 55) || (frontier < 4 && this.rel(n, o) < 50))
        && (this.bordersNation(n, o) || (this.hasHarbor(n) && this.hasHarbor(o)))),
      atWar: this.enemies(n).length > 0,
      threatened: this.nations.some(o => o !== n && o.alive && !this.atWar(n, o) && this.rel(n, o) < -25 && this.bordersNation(n, o)),
      allyTargets: this.nations.some(o => o !== n && o.alive && !this.allied(n, o) && !this.atWar(n, o) && this.rel(n, o) >= 25),
      hasHarbor: this.hasHarbor(n),
    };
  }
  cardWeight(n, id, ctx) {
    const c = CARDS[id];
    let w = c.weight || 1;
    if (c.nation.includes(n.trait)) w += 1.5;
    if (c.leader.includes(n.leader.trait)) w += 1.5;
    return w * this.cardUsefulness(n, id, ctx);
  }
  drawCard(n, ctx = this.cardContext(n), ids = Array.from(this.pool)) {
    const weights = ids.map(id => {
      const w = this.cardWeight(n, id, ctx);
      const copies = n.hand.filter(x => x === id).length + n.armed.filter(x => x === id).length; // duplicates get rarer
      return w / (1 + copies * 1.5);
    });
    let total = 0; for (const w of weights) total += w;
    let r = this.rng.float() * total;
    for (let i = 0; i < ids.length; i++) { r -= weights[i]; if (r <= 0) return ids[i]; }
    return ids[ids.length - 1];
  }
  refillHand(n) {
    const ctx = this.cardContext(n);
    const drawn = [];
    const max = this.handMax(n);
    while (n.hand.length < max) { const id = this.drawCard(n, ctx); n.hand.push(id); drawn.push(id); }
    return drawn;
  }

  // Market: buy a random card from a category for gold (no action point).
  marketCost(n) { return Math.round(MARKET_BASE_COST * (1 + n.owned.size / 100)) + 10 * n.marketBuys; }
  buyCard(n, category) {
    const cat = MARKET[category];
    if (!cat) return { ok: false, why: 'No such stall.' };
    if (n.marketBuys >= MARKET_PER_TURN) return { ok: false, why: `The market allows ${MARKET_PER_TURN} purchases per turn.` };
    if (n.hand.length >= this.handMax(n)) return { ok: false, why: 'Your hand is full — discard a card first.' };
    const cost = this.marketCost(n);
    if (n.gold < cost) return { ok: false, why: `Cannot afford: ${cost} gold.` };
    const ids = cat.ids.filter(id => this.pool.has(id));
    if (!ids.length) return { ok: false, why: 'Nothing for sale here.' };
    n.gold -= cost; n.marketBuys++;
    const id = this.drawCard(n, this.cardContext(n), ids);
    n.hand.push(id);
    this.addLog(`${n.name} buys ${CARDS[id].name} at the ${cat.name.toLowerCase()} for ${cost} gold.`, n);
    return { ok: true, id, cost };
  }

  // Reaction cards: arm on your turn (free); they trigger during the rivals' phase or come back.
  armCard(n, idx) {
    const id = n.hand[idx];
    if (!id || !CARDS[id].reaction) return { ok: false, why: 'Only reaction cards can be armed.' };
    if (n.armed.includes(id)) return { ok: false, why: `${CARDS[id].name} is already armed.` };
    n.hand.splice(idx, 1); n.armed.push(id);
    this.addLog(`${n.name} arms ${CARDS[id].name}.`, n);
    return { ok: true, id };
  }
  // Consume an armed reaction if present. Returns true when it fired.
  fireReaction(n, id, why) {
    const i = n.armed.indexOf(id);
    if (i < 0) return false;
    n.armed.splice(i, 1);
    n.mastery[id] = (n.mastery[id] || 0) + 1;
    this.addLog(`${CARDS[id].icon} ${n.name}'s ${CARDS[id].name} ${why}`, n);
    return true;
  }
  returnArmed(n) {
    // unused reactions return to the hand (if there is room), otherwise they are lost
    while (n.armed.length) {
      const id = n.armed.pop();
      if (n.hand.length < this.handMax(n)) n.hand.push(id);
    }
  }
  discardCard(n, idx) {
    if (idx < 0 || idx >= n.hand.length) return { ok: false, why: 'No such card.' };
    const [id] = n.hand.splice(idx, 1);
    return { ok: true, id };
  }

  // Play the card at hand index `idx`. Action cards run the underlying action (rules, costs and an
  // action point apply); bonus cards are instant and free. The card leaves the hand only on success.
  playCard(n, idx, tile, target, extra) {
    if (this.over && !this.continued) return { ok: false, why: 'The game is over.' };
    const id = n.hand[idx];
    if (!id) return { ok: false, why: 'No such card.' };
    const c = CARDS[id];
    if (c.reaction) return this.armCard(n, idx);
    const done = () => { n.hand.splice(idx, 1); n.mastery[id] = (n.mastery[id] || 0) + 1; this.actionCounts['card:' + id] = (this.actionCounts['card:' + id] || 0) + 1; };
    if (c.action) {
      if (n.ap <= 0) return { ok: false, why: 'No actions left this turn.' };
      const r = this.doAction(n, c.action, tile, target, extra);
      if (!r.ok) return r;
      done();
      return r;
    }
    const boost = 1 + 0.25 * this.masteryTier(n, id); // mastered bonus cards pay more
    let msg = `plays ${c.name}`;
    const setts = n.settlements.length;
    switch (id) {
      case 'caravan': { const g = Math.round((15 + 2 * setts) * boost); n.gold += g; msg += ` and gains ${g} gold.`; break; }
      case 'taxes': { const g = Math.round(3 * setts * boost); n.gold += g; msg += ` and gains ${g} gold.`; break; }
      case 'prospectors': { const m = Math.round((20 + 2 * setts) * boost); n.mat += m; msg += ` and gains ${m} materials.`; break; }
      case 'bumper': { const gr = Math.round(15 * boost); n.growth += gr; msg += `: +${gr} growth.`; break; }
      case 'migrants': {
        const room = n.settlements.map(i => this.tiles[i].settlement).filter(s => s.pop < SETTLEMENTS[s.type].maxPop).sort((a, b) => a.pop - b.pop);
        if (room.length) { room[0].pop++; msg += `: ${room[0].name} grows to ${room[0].pop}.`; } else { n.growth += 10; msg += ': +10 growth.'; }
        break;
      }
      case 'envoys': for (const o of this.nations) if (o !== n && o.alive && this.rel(n, o) < 50) this.shiftRel(n, o, Math.round(6 * boost)); msg += ': relations improve everywhere.'; break;
      case 'festival': if (n.edict) { n.edictUntil += 4; msg += `: the ${EDICTS[n.edict].name} continues 4 more turns.`; } else { n.growth += 8; msg += ': +8 growth.'; } break;
      case 'rally': n.ap++; n.apMax = Math.max(n.apMax, n.ap); msg += ': an extra action this turn!'; break;
      case 'mercenaries': {
        if (n.gold < 30) return { ok: false, why: 'Mercenaries want 30 gold.' };
        n.gold -= 30; n.tempAttack += 5; msg += ': +5 attack this turn.'; break;
      }
    }
    done();
    this.addLog(`${n.name} ${msg}`, n);
    return { ok: true, msg };
  }
  hasCardFor(n, action) { return n.hand.includes(CARD_FOR_ACTION[action]); }
  handIndexFor(n, action) { return n.hand.indexOf(CARD_FOR_ACTION[action]); }

  // ---------- War & peace ----------
  warKey(a, b) { return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`; }
  atWar(a, b) { return this.wars.has(this.warKey(a, b)); }
  enemies(n) { return this.nations.filter(o => o !== n && o.alive && this.atWar(n, o)); }
  truceActive(a, b) { return (this.truces[this.warKey(a, b)] || 0) > this.turn; }
  // Returns false if the declaration was cancelled by a Bribe.
  declareWar(a, b) {
    if (this.fireReaction(b, 'bribe', `buys off ${a.name} — the war is cancelled before it begins.`)) return false;
    this.wars.add(this.warKey(a, b));
    if (a.trades.has(b.id)) { a.trades.delete(b.id); b.trades.delete(a.id); }
    this.breakAlliance(a, b, 'war');
    a.peaceOffers.delete(b.id); b.peaceOffers.delete(a.id);
    a.lostTiles = 0; b.lostTiles = 0;
    this.shiftRel(a, b, -30);
    for (const x of this.nations) {
      if (x === a || x === b || !x.alive) continue;
      if (x.trades.has(b.id) || this.bordersNation(x, b)) this.shiftRel(a, x, -5);
    }
    // Allies of the victim answer the call: a free Casus Belli and a grudge against the aggressor.
    for (const x of this.allies(b)) {
      if (x === a || this.atWar(x, a)) continue;
      this.shiftRel(a, x, -20);
      if (!this.truceActive(x, a) && !this.allied(x, a)) { x.hand.push('war'); this.addLog(`${x.name} answers ${b.name}'s call and prepares for war against ${a.name}.`, x); }
    }
    return true;
  }
  makePeace(a, b) {
    this.wars.delete(this.warKey(a, b));
    this.truces[this.warKey(a, b)] = this.turn + TRUCE_TURNS;
    a.peaceOffers.delete(b.id); b.peaceOffers.delete(a.id);
    this.shiftRel(a, b, 15);
  }
  // Would `o` accept peace from `n`? Weaker, weary or not-so-hostile nations do.
  acceptsPeace(o, n) {
    if (o.isPlayer) return false; // the player answers offers through the UI
    const rel = this.rel(o, n);
    if (rel > -35) return true;
    if (o.lostTiles >= 3) return true;
    if (this.attackStrength(n) > this.attackStrength(o) + 3) return true;
    return this.rng.chance(0.15);
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
    if (t.ruins) this.exploreRuins(n, t);
  }

  // Ancient ruins give a one-off reward to whoever claims them.
  exploreRuins(n, t) {
    t.ruins = false;
    const size = 1 + n.owned.size / 40;
    const roll = this.rng.float();
    let msg;
    if (roll < 0.3) { const g = Math.round((30 + this.rng.int(0, 30)) * size); n.gold += g; msg = `a forgotten treasury: +${g} gold`; }
    else if (roll < 0.55) { const m = Math.round((40 + this.rng.int(0, 30)) * size); n.mat += m; msg = `cut stone and timber: +${m} materials`; }
    else if (roll < 0.75) { n.growth += 20; msg = `survivors who join your people (+20 growth)`; }
    else if (roll < 0.9) { n.relics++; msg = `a sacred relic (+15 score)`; }
    else { for (const nb of this.neighbors(t)) if (nb.owner === null && nb.terrain !== 'ocean') this.claim(n, nb); msg = `old boundary stones — the surrounding land is yours`; }
    this.addLog(`${n.name} explores ancient ruins at (${t.x}, ${t.y}) and finds ${msg}.`, n);
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
      // mastery: nations that build the same thing often get better at it
      const tier = n.mastery ? this.masteryOf(n, t.improvement) : 0;
      if (tier) { if (t.improvement === 'mine' || t.improvement === 'lumber') mat += tier; else food += tier; }
    }
    if (t.siege && t.settlement) { food = Math.floor(food / 2); mat = Math.floor(mat / 2); gold = Math.floor(gold / 2); }
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
    if (this.allied(a, b)) g += 1;
    g += this.masteryOf(a, 'trade');
    return g;
  }

  // ---------- Contentment (luxuries, wonders, sprawl, war) ----------
  luxuries(n) {
    const stamp = `${this.turn}:${n.owned.size}:${n.settlements.length}`;
    if (n._lux && n._lux.stamp === stamp) return n._lux.set;
    const set = new Set();
    for (const i of this.workedTiles(n)) {
      const t = this.tiles[i];
      if (!t.resource) continue;
      const r = RESOURCE_BY_ID[t.resource];
      if (r.luxury && t.improvement === r.imp) set.add(r.id);
    }
    n._lux = { stamp, set };
    return set;
  }
  contentmentOf(n, own = this.luxuries(n)) {
    let c = 50 + own.size * LUXURY_BONUS;
    const shared = new Set();
    for (const id of n.trades) { const o = this.nation(id); if (o.alive) for (const l of this.luxuries(o)) if (!own.has(l)) shared.add(l); }
    c += shared.size * (LUXURY_BONUS / 2);
    if (n.wonders.includes('temple')) c += 12;
    if (n.edict === 'harvest') c += 5;
    c -= Math.max(0, n.settlements.length - 4) * 3;
    c -= this.enemies(n).length * 6;
    if (n.vassalOf !== null) c -= 8;
    return Math.max(0, Math.min(100, Math.round(c)));
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
    const royalroad = n.wonders.includes('royalroad'), lighthouse = n.wonders.includes('lighthouse');
    for (const i of n.settlements) {
      const t = this.tiles[i], s = t.settlement, S = SETTLEMENTS[s.type];
      if (t.siege) { pop += s.pop; continue; } // a besieged settlement yields nothing
      gold += S.gold; mat += S.mat; pop += s.pop;
      if (s.capital) gold += 2;
      if (t.harbor) { gold += 2 + (lighthouse ? 2 : 0); food += 1; }
      if (n.trait === 'scholarly' && s.type !== 'village') gold += 2;
      if (n.leader.trait === 'wise' && s.type === 'city') mat += 3;
      if (connected.has(i) && !s.capital) gold += royalroad ? 4 : 2;
    }
    for (const id of n.trades) { const o = this.nation(id); if (o.alive) gold += this.tradeIncome(n, o); }
    if (n.edict === 'fairs') gold += n.trades.size * 3;
    // tribute paid and received
    let tributeIn = 0, tributeOut = 0;
    for (const tr of this.tributes) { if (tr.to === n.id) tributeIn += tr.amount; if (tr.from === n.id) tributeOut += tr.amount; }
    gold += tributeIn - tributeOut;
    if (n.trait === 'mercantile') gold = Math.round(gold * 1.25);
    if (n.leader.trait === 'frugal') gold = Math.round(gold * 1.15);
    if (n.leader.trait === 'industrious') mat = Math.round(mat * 1.15);
    if (n.leader.trait === 'bountiful') food = Math.round(food * 1.15);
    if (n.edict === 'harvest') food = Math.round(food * 1.2);
    if (n.edict === 'corvee') food = Math.round(food * 0.9);
    if (n.edict === 'levy') gold = Math.round(gold * 0.8);
    // Upkeep: settlements, castles, harbours and roads cost gold; improvements cost materials.
    let goldUp = 0, matUp = 0, roads = 0, imps = 0;
    for (const i of n.settlements) { const t = this.tiles[i]; goldUp += SETTLEMENTS[t.settlement.type].upkeep; if (t.harbor) goldUp += 1; }
    goldUp += n.castles.length * 3;
    for (const i of n.owned) { const t = this.tiles[i]; if (t.road) roads++; if (t.improvement) imps++; }
    goldUp += Math.round(roads * 0.25);
    matUp = Math.round(imps * 0.5);
    return { food, mat: mat - matUp, gold: gold - goldUp, pop, net: food - pop, goldGross: gold, matGross: mat, goldUp, matUp, tributeIn, tributeOut };
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
    if (n.edict === 'levy') a += 3;
    if (n.wonders.includes('colossus')) a += 3;
    a += (n.tempAttack || 0) + this.masteryOf(n, 'conquer') + this.masteryOf(n, 'declare_war');
    return a;
  }
  defenseAt(n, t) {
    let d = 1 + Math.floor(this.totalPop(n) / 20);
    if (n.wonders.includes('colossus')) d += 2;
    if (n.armed.includes('militia')) d += 4;
    let castleD = 0;
    for (const i of n.castles) { const dd = this.dist(this.tiles[i], t); if (dd <= 1) castleD = Math.max(castleD, 6); else if (dd <= 2) castleD = Math.max(castleD, 4); }
    d += castleD;
    if (t.settlement) d += SETTLEMENTS[t.settlement.type].defense;
    if (t.conqueredTurn && this.turn - t.conqueredTurn < 6) d += 3; // fresh garrison
    if (n.leader.trait === 'stalwart') d += 3;
    if (n.trait === 'martial') d += 1;
    if (n.edict === 'levy') d += 2;
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
    if (n.edict === 'corvee' && ['improve', 'road', 'castle', 'village'].includes(kind)) m *= 0.75;
    if (kind === 'road' && n.wonders.includes('royalroad')) m = 0;
    // mastery discount: 12% per tier of the matching card
    const cardKind = { expand: 'expand', village: 'settle', upgrade: 'charter', road: 'road', castle: 'castle', harbor: 'harbor', conquer: 'march' }[kind];
    if (cardKind && n.mastery) m *= 1 - 0.12 * this.masteryTier(n, cardKind);
    return m;
  }
  scaleCost(cost, m) {
    const out = {};
    for (const k in cost) out[k] = m === 0 ? 0 : Math.max(1, Math.round(cost[k] * m));
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
  nearHarbor(n, t, range) {
    for (const i of n.settlements) {
      const h = this.tiles[i];
      if (h.harbor && Math.abs(h.x - t.x) <= range && Math.abs(h.y - t.y) <= range) return true;
    }
    return false;
  }

  checkAction(n, id, t, target, extra) {
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
        const siege = this.needsSiege(n, t);
        const label = `${siege ? 'Besiege' : t.settlement ? 'Storm' : 'Conquer'} (attack ${atk} vs defence ${def.toFixed(1)})`;
        if (!this.atWar(n, o)) return r(false, `You are not at war with ${o.name}. Play Casus Belli first.`, cost, label);
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, label);
        if (atk <= def) return r(false, `Too well defended (your attack ${atk} vs defence ${def.toFixed(1)}).`, cost, label);
        return r(true, siege ? 'A settlement must be besieged first; a second March within 4 turns takes it.' : '', cost, label);
      }
      case 'raid': {
        const cost = this.scaleCost(COSTS.conquer, this.costMul(n, 'conquer') * 0.6);
        if (!this.hasHarbor(n)) return r(false, 'Needs a harbour.', cost, 'Sea raid');
        if (!t || t.owner === null || t.owner === n.id) return r(false, 'Select an enemy coastal tile.', cost, 'Sea raid');
        if (!t.coastal && !t.water) return r(false, 'Only coastal tiles can be raided from the sea.', cost, 'Sea raid');
        if (!this.nearHarbor(n, t, 6)) return r(false, 'Too far from your harbours (6 tiles).', cost, 'Sea raid');
        const o = this.nation(t.owner);
        const atk = this.attackStrength(n), def = this.defenseAt(o, t);
        const label = `Sea raid (attack ${atk} vs defence ${def.toFixed(1)})`;
        if (!this.atWar(n, o)) return r(false, `You are not at war with ${o.name}.`, cost, label);
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, label);
        if (atk <= def) return r(false, `Too well defended (attack ${atk} vs defence ${def.toFixed(1)}).`, cost, label);
        return r(true, '', cost, label);
      }
      case 'declare_war': {
        const o = this.nation(target);
        if (!o || o.id === n.id || !o.alive) return r(false, 'Choose a nation.', {}, 'Declare war');
        if (this.atWar(n, o)) return r(false, 'Already at war.', {}, 'Declare war');
        if (this.allied(n, o)) return r(false, 'You are allied — break the pact first.', {}, 'Declare war');
        if (this.isVassalOf(n, o)) return r(false, `You pay tribute to ${o.name} until turn ${n.vassalUntil}.`, {}, 'Declare war');
        if (this.truceActive(n, o)) return r(false, `A truce holds until turn ${this.truces[this.warKey(n, o)]}.`, {}, 'Declare war');
        if (!this.bordersNation(n, o) && !(this.hasHarbor(n) && this.hasHarbor(o))) return r(false, 'You need a shared border, or harbours on both sides, to reach them.', {}, 'Declare war');
        return r(true, 'Relations will sour and trade with them ends.', {}, 'Declare war');
      }
      case 'peace': {
        const cost = COSTS.peace;
        const o = this.nation(target);
        if (!o || o.id === n.id || !o.alive) return r(false, 'Choose a nation.', cost, 'Offer peace');
        if (!this.atWar(n, o)) return r(false, 'Not at war.', cost, 'Offer peace');
        if (n.peaceOffers.has(o.id)) return r(true, 'They have already offered peace — accepting is free.', {}, 'Accept peace');
        if (extra === 'tribute') {
          if (!this.canDemandTribute(n, o)) return r(false, 'You can only demand tribute when clearly winning (attack +3 and they have lost 3+ tiles).', cost, 'Demand tribute');
          if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, 'Demand tribute');
          return r(true, 'Peace, and they pay you part of their income for 20 turns.', cost, 'Demand tribute');
        }
        if (o.peaceOffers.has(n.id)) return r(false, 'Your offer already stands; they have not answered.', cost, 'Offer peace');
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, 'Offer peace');
        return r(true, 'They may refuse if they feel they are winning.', cost, 'Offer peace');
      }
      case 'alliance': {
        const o = this.nation(target);
        if (!o || o.id === n.id || !o.alive) return r(false, 'Choose a nation.', {}, 'Propose pact');
        if (this.allied(n, o)) return r(false, 'Already allied.', {}, 'Propose pact');
        if (this.atWar(n, o)) return r(false, 'You are at war.', {}, 'Propose pact');
        if (this.rel(n, o) < 25 && !(n.marriedTo && n.marriedTo.has(o.id))) return r(false, `Relations must be at least 25 (now ${Math.round(this.rel(n, o))}).`, {}, 'Propose pact');
        if (!this.canReach(n, o)) return r(false, 'Need a shared border or harbours on both sides.', {}, 'Propose pact');
        return r(true, 'Allies cannot attack each other and answer calls to war.', {}, 'Propose pact');
      }
      case 'marriage': {
        const o = this.nation(target);
        if (!o || o.id === n.id || !o.alive) return r(false, 'Choose a nation.', {}, 'Royal marriage');
        if (this.atWar(n, o)) return r(false, 'Not while at war.', {}, 'Royal marriage');
        if (n.marriedTo && n.marriedTo.has(o.id)) return r(false, 'Your houses are already joined.', {}, 'Royal marriage');
        return r(true, '+25 relations; they will accept a pact.', {}, 'Royal marriage');
      }
      case 'greatwork': {
        const cost = this.scaleCost({ mat: 50 }, 1 + n.owned.size / 100);
        if (n.capital < 0) return r(false, 'You need a capital.', cost, 'Great work');
        const w = WONDERS[target];
        if (!w) return r(false, 'Choose a wonder.', cost, 'Great work');
        if (this.wondersBuilt[target] !== undefined) return r(false, `${w.name} already stands in ${this.nation(this.wondersBuilt[target]).name}.`, cost, w.name);
        if (n.wonderId && n.wonderId !== target) return r(false, `Finish the ${WONDERS[n.wonderId].name} first (${n.wonderProgress}/${WONDER_STEPS}).`, cost, w.name);
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, w.name);
        return r(true, `Contribution ${(n.wonderId === target ? n.wonderProgress : 0) + 1} of ${WONDER_STEPS}.`, cost, w.name);
      }
      case 'colonize': {
        const cost = this.scaleCost(COSTS.village, this.costMul(n, 'village') * 1.25);
        if (!this.hasHarbor(n)) return r(false, 'Needs a harbour.', cost, 'Colonise');
        if (!t || t.owner !== null) return r(false, 'Select free coastal land.', cost, 'Colonise');
        if (t.water || !t.coastal) return r(false, 'Colonists land on free coastal land.', cost, 'Colonise');
        if (!this.nearHarbor(n, t, 6)) return r(false, 'Too far from your harbours (6 tiles).', cost, 'Colonise');
        const cap = this.settlementCap(n);
        if (n.settlements.length >= cap) return r(false, `Settlement limit reached (${n.settlements.length}/${cap}).`, cost, 'Colonise');
        if (!this.canPlaceSettlement(t)) return r(false, `Needs dry land at least ${SETTLEMENT_SPACING} tiles from other settlements.`, cost, 'Colonise');
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, 'Colonise');
        return r(true, '', cost, 'Colonise');
      }
      case 'edict': {
        const cost = this.scaleCost(COSTS.edict, 1 + n.owned.size / 100);
        const E = EDICTS[target];
        if (!E) return r(false, 'Choose an edict.', cost, 'Proclaim edict');
        if (n.edict === target) return r(false, 'Already in force.', cost, E.name);
        if (!this.canAfford(n, cost)) return r(false, 'Cannot afford: ' + this.costStr(cost), cost, E.name);
        return r(true, `${EDICT_TURNS} turns.`, cost, E.name);
      }
      case 'farm': case 'mine': case 'lumber': case 'pasture': case 'fishery': {
        const I = IMPROVEMENTS[id];
        const cost = this.scaleCost(I.cost, this.costMul(n, 'improve') * (1 - 0.12 * this.masteryTier(n, id)));
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
        const cap = this.settlementCap(n);
        if (n.settlements.length >= cap) return r(false, `Settlement limit reached (${n.settlements.length}/${cap}). Grow a village into a town (+1) or city (+2) first.`, cost, 'Found village');
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
    const N = this.nations.length, W = this.W, H = this.H, tiles = this.tiles;
    const m = new Uint8Array(N * N);
    // Only look E, S, SE, SW from each tile — every adjacent pair is seen exactly once.
    for (let y = 0; y < H; y++) {
      const row = y * W, down = y + 1 < H;
      for (let x = 0; x < W; x++) {
        const o = tiles[row + x].owner;
        if (o === null) continue;
        const right = x + 1 < W;
        let p;
        if (right) { p = tiles[row + x + 1].owner; if (p !== null && p !== o) { m[o * N + p] = 1; m[p * N + o] = 1; } }
        if (down) {
          p = tiles[row + W + x].owner; if (p !== null && p !== o) { m[o * N + p] = 1; m[p * N + o] = 1; }
          if (right) { p = tiles[row + W + x + 1].owner; if (p !== null && p !== o) { m[o * N + p] = 1; m[p * N + o] = 1; } }
          if (x > 0) { p = tiles[row + W + x - 1].owner; if (p !== null && p !== o) { m[o * N + p] = 1; m[p * N + o] = 1; } }
        }
      }
    }
    this.borders = m;
  }
  bordersNation(a, b) {
    if (!this.borders) this.refreshBorders();
    return this.borders[a.id * this.nations.length + b.id] === 1;
  }
  hasHarbor(n) { return n.settlements.some(i => this.tiles[i].harbor); }
  canReach(a, b) {
    if (this.bordersNation(a, b)) return true;
    if (a.trait === 'maritime' && this.hasHarbor(a)) return true;
    if (a.wonders.includes('lighthouse')) return true;
    return this.hasHarbor(a) && this.hasHarbor(b);
  }

  // ---------- Alliances, vassals ----------
  allied(a, b) { return this.alliances.has(this.warKey(a, b)); }
  allies(n) { return this.nations.filter(o => o !== n && o.alive && this.allied(n, o)); }
  acceptsAlliance(o, n) {
    if (o.isPlayer) return false; // players answer through the UI (marriage makes them accept automatically)
    if (this.allies(o).length >= 2) return false;
    const rel = this.rel(o, n);
    if (rel >= 45) return true;
    if (rel >= 25 && (this.enemies(o).length || this.attackStrength(n) > this.attackStrength(o) + 3)) return true;
    return false;
  }
  formAlliance(a, b) {
    this.alliances.add(this.warKey(a, b));
    a.allianceOffers && a.allianceOffers.delete(b.id); b.allianceOffers && b.allianceOffers.delete(a.id);
    this.shiftRel(a, b, 10);
  }
  breakAlliance(a, b, why) {
    if (!this.allied(a, b)) return;
    this.alliances.delete(this.warKey(a, b));
    this.addLog(`The pact between ${a.name} and ${b.name} is broken${why ? ' — ' + why : ''}.`, a);
  }
  isVassalOf(v, lord) { return v.vassalOf === lord.id && v.vassalUntil > this.turn; }

  // Winning side may demand tribute with a peace: the loser pays part of its income for 20 turns.
  canDemandTribute(n, o) { return this.attackStrength(n) >= this.attackStrength(o) + 3 && o.lostTiles >= 3; }
  imposeTribute(lord, vassal) {
    const inc = vassal.income || this.computeIncome(vassal);
    const amount = Math.max(3, Math.round(Math.max(0, inc.goldGross) * 0.12));
    this.tributes = this.tributes.filter(t => !(t.from === vassal.id && t.to === lord.id));
    this.tributes.push({ from: vassal.id, to: lord.id, amount, until: this.turn + 20 });
    vassal.vassalOf = lord.id; vassal.vassalUntil = this.turn + 20;
    return amount;
  }

  // Executes an action. Returns { ok, why, msg }.
  doAction(n, id, t, target, extra) {
    const c = this.checkAction(n, id, t, target, extra);
    if (!c.ok) return { ok: false, why: c.why };
    this.pay(n, c.cost);
    let msg = '';
    switch (id) {
      case 'raid': msg = this.resolveConquest(n, t).replace(/^conquers/, 'raids and conquers'); break;
      case 'colonize': this.foundSettlement(n, t, 'village', 1); msg = `lands colonists and founds ${t.settlement.name} on the far shore.`; break;
      case 'alliance': {
        const o = this.nation(target);
        const forced = n.marriedTo && n.marriedTo.has(o.id);
        if (forced || this.acceptsAlliance(o, n)) { this.formAlliance(n, o); msg = `forms a pact with ${o.name}.`; }
        else if (o.isPlayer) { o.allianceOffers = o.allianceOffers || new Set(); o.allianceOffers.add(n.id); msg = `proposes a pact to ${o.name}.`; }
        else msg = `proposes a pact to ${o.name}, who declines.`;
        break;
      }
      case 'marriage': {
        const o = this.nation(target);
        n.marriedTo = n.marriedTo || new Set(); n.marriedTo.add(o.id);
        o.marriedTo = o.marriedTo || new Set(); o.marriedTo.add(n.id);
        this.shiftRel(n, o, 25);
        msg = `joins its royal house with ${o.name}'s.`; break;
      }
      case 'greatwork': {
        if (n.wonderId !== target) { n.wonderId = target; n.wonderProgress = 0; }
        n.wonderProgress++;
        const w = WONDERS[target];
        if (n.wonderProgress >= WONDER_STEPS) {
          n.wonders.push(target); this.wondersBuilt[target] = n.id; n.wonderId = null; n.wonderProgress = 0;
          if (n.capital >= 0) this.tiles[n.capital].wonder = target;
          msg = `completes the ${w.name}! ${w.desc}`;
        } else msg = `works on the ${w.name} (${n.wonderProgress}/${WONDER_STEPS}).`;
        break;
      }
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
      case 'harbor': t.harbor = true; n.harborsBuilt++; msg = `builds a harbour at ${t.settlement.name}.`; break;
      case 'trade': {
        const o = this.nation(target);
        n.trades.add(o.id); o.trades.add(n.id);
        this.shiftRel(n, o, 15);
        msg = `opens a trade route with ${o.name}.`; break;
      }
      case 'conquer': msg = this.resolveConquest(n, t); break;
      case 'declare_war': {
        const o = this.nation(target);
        msg = this.declareWar(n, o) ? `declares war on ${o.name}!` : `moves to declare war on ${o.name}, but is bought off.`;
        break;
      }
      case 'peace': {
        const o = this.nation(target);
        if (extra === 'tribute') {
          const accepts = o.isPlayer ? false : (o.lostTiles >= 3 && this.attackStrength(n) > this.attackStrength(o)) || this.rng.chance(0.2);
          if (accepts) { this.makePeace(n, o); const amt = this.imposeTribute(n, o); msg = `forces ${o.name} to accept peace and pay ${amt} gold a turn in tribute for 20 turns.`; }
          else if (o.isPlayer) { o.peaceOffers.add(n.id); o.tributeDemand = n.id; msg = `demands tribute from ${o.name} in exchange for peace.`; }
          else msg = `demands tribute from ${o.name}, who refuses.`;
          break;
        }
        if (n.peaceOffers.has(o.id)) {
          if (n.tributeDemand === o.id) { const amt = this.imposeTribute(o, n); n.tributeDemand = null; this.makePeace(n, o); msg = `accepts peace and will pay ${o.name} ${amt} gold a turn in tribute.`; }
          else { this.makePeace(n, o); msg = `makes peace with ${o.name}. A truce holds for ${TRUCE_TURNS} turns.`; }
        }
        else if (this.acceptsPeace(o, n)) { this.makePeace(n, o); msg = `makes peace with ${o.name}. A truce holds for ${TRUCE_TURNS} turns.`; }
        else if (o.isPlayer) { o.peaceOffers.add(n.id); msg = `offers peace to ${o.name}.`; }
        else msg = `offers peace to ${o.name}, who refuses.`;
        break;
      }
      case 'edict': {
        n.edict = target; n.edictUntil = this.turn + EDICT_TURNS + 2 * this.masteryOf(n, 'edict');
        msg = `proclaims the ${EDICTS[target].name}.`; break;
      }
    }
    n.lastAction = c.label;
    // Spend an action point; waiting ends the turn. Accepting an offered peace is free.
    const free = id === 'peace' && c.label === 'Accept peace';
    if (id === 'wait') n.ap = 0; else if (!free) n.ap = Math.max(0, n.ap - 1);
    n.idle = id === 'wait' ? n.idle + 1 : 0;
    this.actionCounts[id] = (this.actionCounts[id] || 0) + 1;
    this.addLog(`${n.name} ${msg}`, n);
    return { ok: true, msg };
  }

  // Does taking this settlement need a siege first? (Overwhelming force storms it outright.)
  needsSiege(n, t) {
    if (!t.settlement) return false;
    const o = this.nation(t.owner);
    if (this.attackStrength(n) > this.defenseAt(o, t) + 4) return false;
    return !(t.siege && t.siege.by === n.id && this.turn - t.siege.turn <= 4);
  }

  resolveConquest(n, t) {
    const o = this.nation(t.owner);
    if (this.fireReaction(o, 'ambush', `springs on ${n.name}'s troops at (${t.x}, ${t.y}) — the attack fails.`)) return `is ambushed at (${t.x}, ${t.y}) and withdraws.`;
    if (o.armed.includes('militia')) this.fireReaction(o, 'militia', 'stands to arms.');
    if (this.needsSiege(n, t)) {
      t.siege = { by: n.id, turn: this.turn };
      return `lays siege to the ${SETTLEMENTS[t.settlement.type].name.toLowerCase()} of ${t.settlement.name} (${o.name}). Its yields are halved; a second March within 4 turns takes it.`;
    }
    const wasSettlement = t.settlement ? `${SETTLEMENTS[t.settlement.type].name.toLowerCase()} of ${t.settlement.name}` : null;
    const wasCapital = t.settlement && t.settlement.capital;
    this.claim(n, t);
    t.conqueredTurn = this.turn;
    t.siege = null;
    if (t.settlement) { t.settlement.capital = false; n.settlementsTaken++; }
    n.conquests++;
    o.lostTiles++;
    this.shiftRel(n, o, -10);
    // Third parties who border or trade with the victim take offence.
    const anger = n.leader.trait === 'reckless' ? -6 : -3;
    for (const x of this.nations) {
      if (x === n || x === o || !x.alive) continue;
      if (x.trades.has(o.id) || this.bordersNation(x, o)) this.shiftRel(n, x, anger);
    }
    let msg = wasSettlement ? `conquers the ${wasSettlement} from ${o.name}!` : `seizes land at (${t.x}, ${t.y}) from ${o.name}.`;
    if (t.settlement) { // plunder
      const pg = t.settlement.pop * 8, pm = t.settlement.pop * 4;
      n.gold += pg; n.mat += pm;
      msg += ` Plunder: +${pg} gold, +${pm} materials.`;
    }
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
      n.contentment = this.contentmentOf(n);
      let gm = 0.6 + n.contentment / 125; // 0.6 .. 1.4
      if (n.trait === 'agrarian') gm *= 1.25;
      if (n.leader.trait === 'beloved') gm *= 1.3;
      if (n.wonders.includes('aqueduct')) gm *= 1.3;
      n.growth += inc.net > 0 ? inc.net * gm : inc.net;
      if (n.growth < 0) {
        n.growth = 0;
        const hungry = n.settlements.map(i => this.tiles[i].settlement).filter(s => s.pop > 1);
        if (hungry.length && !this.fireReaction(n, 'sanctuary', 'keeps the granaries open — famine is averted.')) { const s = this.rng.pick(hungry); s.pop--; this.addLog(`Famine in ${s.name} (${n.name}): population falls to ${s.pop}.`, n); }
      }
      this.naturalGrowth(n);
      this.unrest(n);
      const need = this.growthNeed(inc.pop);
      if (n.growth >= need) {
        const room = n.settlements.map(i => this.tiles[i].settlement).filter((s, k) => s.pop < SETTLEMENTS[s.type].maxPop && !this.tiles[n.settlements[k]].siege);
        if (room.length) {
          room.sort((a, b) => (a.pop / SETTLEMENTS[a.type].maxPop) - (b.pop / SETTLEMENTS[b.type].maxPop));
          room[0].pop++; n.growth -= need;
          if (n.isPlayer) this.addLog(`${room[0].name} grows to ${room[0].pop} people.`, n);
        } else {
          n.growth = need; // capped until there is room
          if (n.isPlayer && !n.growthWarned) { this.addLog(`Your settlements are full — upgrade one or found a village so your people can grow.`, n); n.growthWarned = true; }
        }
      }
      if (n.edict && this.turn >= n.edictUntil) { this.addLog(`The ${EDICTS[n.edict].name} of ${n.name} comes to an end.`, n); n.edict = null; }
      this.randomEvent(n);
      this.returnArmed(n);
    }
    // sieges lapse after 4 turns without a second blow
    for (const t of this.tiles) if (t.siege && (this.turn - t.siege.turn > 4 || t.owner === null || !this.nation(t.siege.by).alive || !this.atWar(this.nation(t.siege.by), this.nation(t.owner)))) t.siege = null;
    // tributes and vassalage expire
    this.tributes = this.tributes.filter(tr => { if (tr.until <= this.turn) { this.addLog(`${this.nation(tr.from).name} no longer pays tribute to ${this.nation(tr.to).name}.`, this.nation(tr.from)); return false; } return true; });
    for (const n of this.nations) if (n.vassalOf !== null && n.vassalUntil <= this.turn) n.vassalOf = null;
    this.updateRelations();
    for (const n of this.nations) { n.income = this.computeIncome(n); this.resetActions(n); }
    this.turn++;
    this.checkEnd();
  }

  // Low contentment breeds unrest; after a few turns a settlement may throw off your rule.
  unrest(n) {
    if (n.contentment < 30) n.unrest++; else n.unrest = Math.max(0, n.unrest - 1);
    if (n.unrest >= 3 && n.settlements.length > 1 && this.rng.chance(0.25)) {
      const cands = n.settlements.filter(i => !this.tiles[i].settlement.capital);
      if (!cands.length) return;
      const i = this.rng.pick(cands);
      const t = this.tiles[i];
      this.release(n, t);
      for (const nb of this.ring(t, 1)) if (nb.owner === n.id && !nb.settlement) this.release(n, nb);
      n.unrest = 0;
      this.addLog(`Unrest! ${t.settlement.name} rises up and throws off ${n.name}'s rule. It stands independent — claim it back with Expansion.`, n);
    }
  }
  // Make a tile unowned (keeping any settlement on it as an independent town).
  release(n, t) {
    n.owned.delete(t.i);
    if (t.settlement) { n.settlements = n.settlements.filter(i => i !== t.i); t.settlement.owner = null; t.settlement.capital = false; if (n.capital === t.i) n.capital = n.settlements[0] !== undefined ? n.settlements[0] : -1; }
    if (t.castle) { n.castles = n.castles.filter(i => i !== t.i); }
    t.owner = null; t.siege = null;
  }

  // ---------- Random events ----------
  randomEvent(n) {
    if (!this.rng.chance(EVENT_CHANCE) || !n.settlements.length) return;
    const setts = n.settlements.map(i => this.tiles[i]);
    const s = this.rng.pick(setts);
    const size = 1 + n.owned.size / 40;
    const roll = this.rng.float();
    let msg;
    if (roll >= 0.44 && roll < 0.82 && this.fireReaction(n, 'sanctuary', 'shelters the people — a calamity passes them by.')) return;
    if (roll < 0.18) { n.growth += 15; msg = `A bountiful harvest blesses ${n.name} (+15 growth).`; }
    else if (roll < 0.32) { const g = Math.round(25 * size); n.gold += g; msg = `Merchants bring rare goods to ${s.settlement.name}: ${n.name} gains ${g} gold.`; }
    else if (roll < 0.44) {
      const room = s.settlement.pop < SETTLEMENTS[s.settlement.type].maxPop;
      if (room) { s.settlement.pop++; msg = `Migrants settle in ${s.settlement.name} (${n.name}): population ${s.settlement.pop}.`; }
      else { n.growth += 10; msg = `Migrants arrive at the gates of ${s.settlement.name} (${n.name}) (+10 growth).`; }
    }
    else if (roll < 0.58) {
      if (s.settlement.pop > 1) { const loss = Math.min(s.settlement.pop - 1, s.settlement.type === 'city' ? 2 : 1); s.settlement.pop -= loss; msg = `Plague strikes ${s.settlement.name} (${n.name}): population falls to ${s.settlement.pop}.`; }
      else msg = `A sickness passes through ${s.settlement.name} (${n.name}) but claims no lives.`;
    }
    else if (roll < 0.70) {
      const guarded = n.castles.some(i => this.dist(this.tiles[i], s) <= 3);
      if (guarded) msg = `Bandits threaten ${s.settlement.name}, but ${n.name}'s castle drives them off.`;
      else { const g = Math.round(n.gold * 0.15); n.gold -= g; msg = `Bandits raid the roads near ${s.settlement.name}: ${n.name} loses ${g} gold. A castle nearby would have stopped them.`; }
    }
    else if (roll < 0.82) {
      const targets = Array.from(n.owned, i => this.tiles[i]).filter(t => t.improvement && (t.coastal || t.water || t.improvement === 'lumber'));
      if (targets.length) { const t = this.rng.pick(targets); const what = IMPROVEMENTS[t.improvement].name.toLowerCase(); t.improvement = null; msg = `${t.water || t.coastal ? 'A storm' : 'Wildfire'} destroys the ${what} at (${t.x}, ${t.y}) belonging to ${n.name}.`; }
      else msg = `A storm batters the coasts of ${n.name} but does little harm.`;
    }
    else if (roll < 0.92) { const m = Math.round(30 * size); n.mat += m; msg = `Quarrymen of ${n.name} strike a fine seam of stone: +${m} materials.`; }
    else { n.relics++; msg = `Scholars of ${n.name} recover a lost chronicle (+15 score).`; }
    this.addLog(`Event: ${msg}`, n);
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
      if (this.atWar(n, o)) { this.relations[k] = Math.max(-100, v - 1); continue; }
      const trading = n.trades.has(o.id);
      if (trading && v < 45) v += (n.edict === 'fairs' || o.edict === 'fairs') ? 2.5 : 1.5;
      if (this.allied(n, o)) { if (v < 80) v += 1; if (v < 0) this.breakAlliance(n, o, 'the friendship has soured'); }
      if ((n.marriedTo && n.marriedTo.has(o.id)) && v < 60) v += 0.5;
      if ((n.leader.trait === 'charismatic' || o.leader.trait === 'charismatic') && v < 60) v += 1;
      if (this.turn > 12 && this.bordersNation(n, o)) {
        let friction = trading ? 0 : 0.75;
        if (this.isAggressive(n) || this.isAggressive(o)) friction += trading ? 0.5 : 1;
        if (frontier.get(n.id) < 4 || frontier.get(o.id) < 4) friction += trading ? 1 : 1.5; // land hunger
        v -= friction;
      }
      v -= v * 0.02; // goodwill and grudges both fade with time
      v += v > 0 ? -0.5 : v < 0 ? 0.5 : 0;
      this.relations[k] = Math.max(-100, Math.min(100, v));
    }
  }

  growthNeed(pop) { return 10 + pop * 2; }

  // Borders creep outward around settlements each turn: each settlement has a chance to claim
  // one free tile within its influence radius that touches existing territory.
  naturalGrowth(n) {
    const chance = 0.4 + (n.trait === 'wanderers' ? 0.2 : 0);
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
    s += n.castles.length * 8 + n.trades.size * 4 + Math.floor(n.gold / 20) + n.relics * 15;
    for (const w of n.wonders) s += w === 'temple' ? 40 : 30;
    s += this.allies(n).length * 5;
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
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi]; const t = this.tiles[i];
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
    const add = (score, id, tile, target, extra) => cands.push({ score: score * jitter(), id, tile, target, extra });
    // Borders change little within one nation's turn: refresh once per nation-turn.
    const stamp = `${this.turn}:${n.id}`;
    if (this.bordersStamp !== stamp) { this.refreshBorders(); this.bordersStamp = stamp; }
    // Accepting an offered peace needs no card and no action.
    for (const oid of Array.from(n.peaceOffers)) {
      const o = this.nation(oid);
      if (o.alive && this.atWar(n, o) && (this.rel(n, o) > -50 || n.lostTiles >= 2 || this.attackStrength(o) >= this.attackStrength(n))) this.doAction(n, 'peace', null, oid);
    }
    // Arm reaction cards (free) and use the market when rich.
    for (let i = n.hand.length - 1; i >= 0; i--) {
      const id = n.hand[i];
      if (!CARDS[id].reaction || n.armed.includes(id)) continue;
      const ctx0 = { atWar: this.enemies(n).length > 0, threatened: this.nations.some(o => o !== n && o.alive && this.rel(n, o) < -25 && this.bordersNation(n, o)) };
      if (id === 'sanctuary' || id === 'bribe' || ctx0.atWar || ctx0.threatened) this.armCard(n, i);
    }
    if (n.gold > this.marketCost(n) * 6 && n.hand.length < this.handMax(n) - 1) {
      const cat = this.enemies(n).length ? 'war' : n.mat > 400 ? 'build' : n.settlements.length < this.settlementCap(n) ? 'growth' : 'fortune';
      this.buyCard(n, cat);
    }
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
      let s = 2.5 + bv * 0.6 + (n.owned.size < 16 ? 1 : 0) + (T === 'wanderers' ? 1.5 : 0) + (L === 'ambitious' ? 0.5 : 0);
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
      if (n.settlements.length < this.settlementCap(n)) {
        const blocked = this.settlementBlocked();
        // only sites that would bring new land into production are worth scoring
        let sites = Array.from(n.owned, i => this.tiles[i]).concat(frontier.filter(t => !t.water))
          .filter(t => !blocked.has(t.i) && !t.water && t.terrain !== 'mountains' && !t.castle && (!near.has(t.i) || this.isFrontier(n, t)));
        if (sites.length > 30) { // cheap pre-score: prefer spots surrounded by land not yet worked
          const key = new Map(sites.map(t => [t.i, this.neighbors(t).filter(nb => !nb.water && !near.has(nb.i)).length + this.rng.float()]));
          sites = sites.sort((a, b) => key.get(b.i) - key.get(a.i)).slice(0, 30);
        }
        for (const t of sites) {
          const v = this.siteValue(t, n, near);
          if (v > bv) { bv = v; best = t; }
        }
      }
      if (best && bv > 8) add(5 + bv / 6, 'village', best);
    }

    // Upgrades
    for (const i of n.settlements) {
      const t = this.tiles[i], S = SETTLEMENTS[t.settlement.type];
      if (S.next && t.settlement.pop >= S.upgradePop) add(8 + (T === 'scholarly' ? 2 : 0) + (n.settlements.length >= this.settlementCap(n) ? 3 : 0), 'upgrade', t);
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
    const threatened = this.nations.some(o => o !== n && o.alive && (this.atWar(n, o) || this.rel(n, o) < -10) && this.bordersNation(n, o));
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

    // War: conquest against nations we are at war with; declarations against those we resent.
    const atk = this.attackStrength(n);
    const conquerCost = this.scaleCost(COSTS.conquer, this.costMul(n, 'conquer'));
    const landHungry = this.expandCost(n).gold > conquerCost.gold * 1.5 || landFrontier < 4;
    const seenEnemy = new Set();
    const warTargets = new Map(); // nation id -> best case for declaring war
    for (const i of n.owned) for (const nb of this.neighbors(this.tiles[i])) {
      if (nb.owner === null || nb.owner === n.id || seenEnemy.has(nb.i)) continue;
      seenEnemy.add(nb.i);
      const o = this.nation(nb.owner);
      const relv = this.rel(n, o);
      const def = this.defenseAt(o, nb);
      if (atk <= def) continue;
      let s = (relv < -20 ? 6 : 2.5) + this.tileValue(nb, n) * 0.4 + (nb.settlement ? 5 : 0) + (aggressive ? 1.5 : 0) + (landHungry ? 2.5 : 0);
      if (nb.siege && nb.siege.by === n.id) s += 4; // finish the siege
      if (atk - def < 2) s -= 1;
      if (this.atWar(n, o)) add(s + 1, 'conquer', nb);
      else {
        if (this.allied(n, o) || this.isVassalOf(n, o)) continue;
        if (relv >= (aggressive ? 55 : landHungry ? 50 : 30) && L !== 'reckless') continue;
        if (relv > -15 && !aggressive && !landHungry) continue; // boxed-in nations covet their neighbours' land
        if (this.truceActive(n, o)) continue;
        if (!warTargets.has(o.id) || warTargets.get(o.id) < s) warTargets.set(o.id, s);
      }
    }
    // Overseas wars only make sense with a Sea Raid in hand.
    if (this.hasCardFor(n, 'raid') && this.hasHarbor(n)) {
      for (const o of this.nations) {
        if (o === n || !o.alive || this.atWar(n, o) || warTargets.has(o.id) || this.bordersNation(n, o) || !this.hasHarbor(o)) continue;
        if (this.rel(n, o) > (aggressive ? 20 : -25) || this.allied(n, o) || this.truceActive(n, o)) continue;
        const target = Array.from(o.owned, i => this.tiles[i]).find(t => (t.coastal || t.water) && this.nearHarbor(n, t, 6) && atk > this.defenseAt(o, t));
        if (target) warTargets.set(o.id, 4);
      }
    }
    // Declaring war is a whole action, so only worth it when several good targets exist and we are stronger.
    for (const [oid, s] of warTargets) {
      const o = this.nation(oid);
      if (this.attackStrength(o) > atk + 2 && !aggressive) continue;
      if (this.enemies(n).length >= 2) continue; // no third front
      add(s - 1.5, 'declare_war', null, oid);
    }
    // Peace: when weary, losing, or no longer able to make progress. Demand tribute when clearly winning.
    for (const o of this.enemies(n)) {
      const stalled = !cands.some(c => c.id === 'conquer' && this.tiles[c.tile.i].owner === o.id);
      if (this.canDemandTribute(n, o)) add(6, 'peace', null, o.id, 'tribute');
      else if (n.lostTiles >= 3 || (stalled && this.rel(n, o) > -60) || this.attackStrength(o) > atk + 4) add(4 + n.lostTiles, 'peace', null, o.id);
    }
    // Sea raids on coastal enemy tiles near our harbours.
    if (this.hasCardFor(n, 'raid')) {
      for (const o of this.enemies(n)) for (const i of o.owned) {
        const t = this.tiles[i];
        if (!(t.coastal || t.water) || !this.nearHarbor(n, t, 6) || seenEnemy.has(i)) continue;
        if (atk > this.defenseAt(o, t)) add(4 + this.tileValue(t, n) * 0.4 + (t.settlement ? 4 : 0), 'raid', t);
      }
    }
    // Alliances with friendly, useful neighbours.
    if (this.hasCardFor(n, 'alliance') && this.allies(n).length < 2 && !aggressive) {
      for (const o of this.nations) {
        if (o === n || !o.alive || this.allied(n, o) || this.atWar(n, o) || this.rel(n, o) < 30 || !this.canReach(n, o)) continue;
        add(3 + (this.enemies(n).length || threatened ? 3 : 0) + Math.min(3, this.attackStrength(o) / 5), 'alliance', null, o.id);
      }
    }
    if (this.hasCardFor(n, 'marriage')) {
      const best = this.nations.filter(o => o !== n && o.alive && !this.atWar(n, o) && !(n.marriedTo && n.marriedTo.has(o.id))).sort((a, b) => this.attackStrength(b) - this.attackStrength(a))[0];
      if (best) add(3.5, 'marriage', null, best.id);
    }
    // Wonders: when materials are plentiful, or to finish one already begun.
    if (this.hasCardFor(n, 'greatwork') && n.capital >= 0) {
      const wid = n.wonderId || Object.keys(WONDERS).find(w => this.wondersBuilt[w] === undefined && (w !== 'lighthouse' || this.hasHarbor(n)));
      if (wid) add((n.wonderId ? 6 : 3) + (n.mat > 300 ? 2 : 0), 'greatwork', null, wid);
    }
    // Colonists: free coastal land near our harbours.
    if (this.hasCardFor(n, 'colonize') && this.hasHarbor(n) && n.settlements.length < this.settlementCap(n)) {
      let best = null, bv = 8;
      const seenC = new Set();
      for (const hi of n.settlements) {
        if (!this.tiles[hi].harbor) continue;
        for (const t of this.ring(this.tiles[hi], 6)) {
          if (seenC.has(t.i) || t.owner !== null || t.water || !t.coastal || !this.canPlaceSettlement(t)) continue;
          seenC.add(t.i);
          const v = this.siteValue(t, n, near);
          if (v > bv) { bv = v; best = t; }
        }
      }
      if (best) add(5 + bv / 8, 'colonize', best);
    }
    // Edicts: pick one that suits the moment.
    if (!n.edict || this.turn >= n.edictUntil - 2) {
      const want = this.enemies(n).length ? 'levy' : (T === 'mercantile' && n.trades.size >= 2) ? 'fairs' : (n.growth < this.growthNeed(this.totalPop(n)) * 0.5 && T !== 'builders') ? 'harvest' : 'corvee';
      if (want !== n.edict) add(4.5 + (want === 'levy' ? 2 : 0), 'edict', null, want);
    }

    // Bonus cards are free: play them all first.
    for (let i = n.hand.length - 1; i >= 0; i--) { const cid = n.hand[i]; if (!CARDS[cid].action && !CARDS[cid].reaction && cid !== 'mercenaries') this.playCard(n, i); }

    // Choose the best affordable action we hold a card for, unless something much better is worth saving for.
    cands.sort((a, b) => b.score - a.score);
    const worthSaving = new Set(['village', 'upgrade', 'castle', 'harbor']);
    let choice = null, bestUnaffordable = null;
    for (const c of cands) {
      if (!this.hasCardFor(n, c.id)) continue;
      const chk = this.checkAction(n, c.id, c.tile, c.target, c.extra);
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
    if (choice.id === 'conquer' && n.hand.includes('mercenaries') && n.gold > 60 && !n.tempAttack) this.playCard(n, n.hand.indexOf('mercenaries'));
    return this.playCard(n, this.handIndexFor(n, choice.id), choice.tile, choice.target, choice.extra);
  }

  // After acting, the AI throws away cards it cannot use so fresh ones arrive next turn.
  aiTidyHand(n) {
    const ctx = this.cardContext(n);
    const keep = [];
    const seen = {};
    for (const id of n.armed) seen[id] = 1;
    for (const id of n.hand) {
      seen[id] = (seen[id] || 0) + 1;
      const c = CARDS[id];
      if (this.cardUsefulness(n, id, ctx) < 0.3) continue;
      const limit = c.reaction || id === 'greatwork' || id === 'alliance' || id === 'marriage' ? 1 : 2;
      if (seen[id] > limit) continue;
      keep.push(id);
    }
    n.hand = keep;
  }

  // ---------- Save / load ----------
  // The map is regenerated from its seed; only dynamic tile state and nations are stored.
  serialize() {
    const tiles = [];
    for (const t of this.tiles) {
      if (t.owner === null && !t.improvement && !t.settlement && !t.castle && !t.road && !t.harbor && !t.siege && !t.wonder && !t.conqueredTurn && t.ruins === this.map.ruinsAt(t.i)) continue;
      tiles.push({ i: t.i, o: t.owner, imp: t.improvement, s: t.settlement, c: t.castle, r: t.road, h: t.harbor, ct: t.conqueredTurn || 0, ru: t.ruins, sg: t.siege, w: t.wonder });
    }
    const setify = (obj, keys) => { const out = Object.assign({}, obj); for (const k of keys) out[k] = Array.from(obj[k] || []); return out; };
    return {
      version: GAME_VERSION,
      map: { width: this.W, height: this.H, seed: this.map.seed, type: this.map.type },
      turn: this.turn, maxTurns: this.maxTurns, rng: this.rng.state, logSeq: this.logSeq || 0,
      over: this.over, continued: !!this.continued, winnerId: this.winner ? this.winner.id : null, reason: this.reason || null,
      relations: this.relations, wars: Array.from(this.wars), truces: this.truces, alliances: Array.from(this.alliances), tributes: this.tributes, wondersBuilt: this.wondersBuilt,
      pool: Array.from(this.pool), actionCounts: this.actionCounts, log: this.log.slice(-200),
      nations: this.nations.map(n => { const o = setify(n, ['owned', 'trades', 'peaceOffers', 'marriedTo', 'allianceOffers']); delete o.flag; delete o.flagURL; delete o.income; delete o._ctx; delete o._lux; return o; }),
      tiles,
    };
  }

  static deserialize(data) {
    const map = generateMap(data.map);
    const g = new Game(map, { skipInit: true, maxTurns: data.maxTurns, unlocked: [] });
    g.pool = new Set(data.pool);
    g.rng.state = data.rng;
    g.turn = data.turn; g.logSeq = data.logSeq; g.over = data.over; g.continued = data.continued; g.reason = data.reason;
    g.relations = data.relations; g.wars = new Set(data.wars); g.truces = data.truces; g.alliances = new Set(data.alliances || []);
    g.tributes = data.tributes || []; g.wondersBuilt = data.wondersBuilt || {}; g.actionCounts = data.actionCounts || {}; g.log = data.log || [];
    g.nations = data.nations.map(d => {
      const n = Object.assign(g.makeNation(d.id, d.name, d.leader.name, d.colorId, d.leader.trait, d.isPlayer), d);
      n.owned = new Set(d.owned); n.trades = new Set(d.trades); n.peaceOffers = new Set(d.peaceOffers);
      n.marriedTo = d.marriedTo && d.marriedTo.length ? new Set(d.marriedTo) : null;
      n.allianceOffers = d.allianceOffers && d.allianceOffers.length ? new Set(d.allianceOffers) : null;
      return n;
    });
    g.winner = data.winnerId !== null && data.winnerId !== undefined ? g.nations[data.winnerId] : null;
    for (const d of data.tiles) {
      const t = g.tiles[d.i];
      t.owner = d.o; t.improvement = d.imp; t.settlement = d.s; t.castle = d.c; t.road = d.r; t.harbor = d.h; t.conqueredTurn = d.ct || undefined; t.ruins = d.ru; t.siege = d.sg || null; t.wonder = d.w;
    }
    for (const n of g.nations) n.income = g.computeIncome(n);
    return g;
  }

  runAITurns() {
    for (const n of this.nations) {
      if (n.isPlayer || !n.alive) continue;
      let guard = 5;
      while (n.ap > 0 && guard-- > 0) this.aiTurn(n);
      this.aiTidyHand(n);
    }
  }
}

