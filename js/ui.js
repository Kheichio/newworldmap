// UI: setup screen, HUD panels, targeting modes, map interaction, tooltips, game-over screen.

const UI = {
  game: null, renderer: null, player: null,
  selectedColor: 'crimson',
  needsDraw: true,
  busy: false,
  mode: null,          // active targeting mode (quick action id) or null
  report: [],          // events from the last turn that concern the player
};

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDelta = v => `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${v}</span>`;
const yieldStr = y => {
  const parts = [];
  if (y.food) parts.push(`🌾${y.food}`);
  if (y.mat) parts.push(`🪵${y.mat}`);
  if (y.gold) parts.push(`🪙${y.gold}`);
  return parts.length ? parts.join(' ') : '—';
};
const costHtml = c => {
  const parts = [];
  if (c.mat) parts.push(`🪵${c.mat}`);
  if (c.gold) parts.push(`🪙${c.gold}`);
  return parts.join(' ') || 'free';
};

// Quick actions shown in the turn panel. `pick` = clicking a highlighted tile only selects it.
const QUICK = [
  { id: 'expand',  icon: '🧭', name: 'Expand',   hint: 'Claim a free tile next to your border' },
  { id: 'village', icon: '🏘️', name: 'Village',  hint: 'Found a village to work nearby land' },
  { id: 'improve', icon: '🛠️', name: 'Improve',  hint: 'Farm, mine, lumber camp, pasture or fishery', pick: true },
  { id: 'road',    icon: '🛤️', name: 'Road',     hint: 'Link settlements to your capital for gold' },
  { id: 'castle',  icon: '🏰', name: 'Castle',   hint: 'Claim and defend land, raise your attack' },
  { id: 'conquer', icon: '⚔️', name: 'Conquer',  hint: 'Seize an enemy border tile' },
];

// ---------------- Setup screen ----------------
function initSetup() {
  const rng = new RNG(Date.now());
  $('in-nation').value = genNationName(rng);
  $('in-leader').value = genLeaderName(rng);
  $('btn-random-names').onclick = () => {
    const r = new RNG(Date.now() + Math.random() * 1e6);
    $('in-nation').value = genNationName(r);
    $('in-leader').value = genLeaderName(r);
  };
  const picker = $('color-picker');
  picker.innerHTML = '';
  for (const c of NATION_COLORS) {
    const el = document.createElement('div');
    el.className = 'color-card' + (c.id === UI.selectedColor ? ' selected' : '');
    el.innerHTML = `<div class="sw" style="background:${c.hex}"></div><div class="cn">${c.name}</div><div class="ct">${NATION_TRAITS[c.trait].name}</div>`;
    el.onclick = () => { UI.selectedColor = c.id; initSetup.refreshCards(); };
    el.dataset.id = c.id;
    picker.appendChild(el);
  }
  initSetup.refreshCards = () => {
    for (const el of picker.children) el.classList.toggle('selected', el.dataset.id === UI.selectedColor);
    updateTraitPreview();
  };
  const lt = $('in-ltrait');
  lt.innerHTML = '<option value="">Random</option>' + Object.entries(LEADER_TRAITS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  lt.onchange = updateTraitPreview;
  $('in-type').innerHTML = Object.entries(MAP_TYPES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  $('in-size').innerHTML = Object.entries(MAP_SIZES).map(([k, v]) => `<option value="${k}" ${k === 'small' ? 'selected' : ''}>${v.name}</option>`).join('');
  updateTraitPreview();
  $('btn-start').onclick = startGame;
}

function updateTraitPreview() {
  const c = NATION_COLORS.find(x => x.id === UI.selectedColor);
  const T = NATION_TRAITS[c.trait];
  const lk = $('in-ltrait').value;
  const L = lk ? LEADER_TRAITS[lk] : null;
  $('trait-preview').innerHTML = `<div class="trait"><b>${c.name} — ${T.name}:</b> ${T.desc}</div><div class="trait"><b>Leader — ${L ? L.name : 'random trait'}:</b> ${L ? L.desc : 'Your leader receives a random trait when the nation is founded.'}</div>`;
}

function startGame() {
  const size = MAP_SIZES[$('in-size').value];
  const seedIn = $('in-seed').value.trim();
  const seed = seedIn || Math.floor(Math.random() * 1e9).toString(36);
  const rng = new RNG(seed + ':leader');
  const ltrait = $('in-ltrait').value || rng.pick(Object.keys(LEADER_TRAITS));
  const map = generateMap({ width: size.w, height: size.h, seed, type: $('in-type').value });
  const game = new Game(map, {
    player: {
      name: $('in-nation').value.trim() || 'My Nation',
      leaderName: $('in-leader').value.trim() || 'The Leader',
      colorId: UI.selectedColor,
      leaderTrait: ltrait,
    },
    aiCount: parseInt($('in-ai').value, 10),
    maxTurns: Math.max(30, Math.min(500, parseInt($('in-turns').value, 10) || 150)),
  });
  UI.game = game;
  UI.player = game.nations[0];
  UI.mode = null;
  UI.report = [{ kind: 'gold', msg: `${UI.player.name} is founded under ${UI.player.leader.name}. Seed: ${seed}` }];
  game.addLog(UI.report[0].msg, UI.player);
  $('setup').classList.add('hidden');
  $('app').classList.remove('hidden');
  initMap();
  centerOnHome();
  selectTile(null);
  refreshAll();
}

// ---------------- Map ----------------
function initMap() {
  const canvas = $('map');
  if (!UI.renderer) {
    UI.renderer = new Renderer(canvas, UI.game);
    bindMapEvents(canvas);
    window.addEventListener('resize', resizeCanvas);
    requestAnimationFrame(frame);
  } else {
    UI.renderer.game = UI.game;
    UI.renderer.hover = UI.renderer.selected = UI.renderer.highlight = null;
    UI.renderer.cam.zoom = 1.5;
    UI.renderer.buildTerrainCache();
  }
  UI.renderer.player = UI.player;
  resizeCanvas();
}

function centerOnHome() {
  const g = UI.game, p = UI.player;
  const i = p.capital >= 0 ? p.capital : (p.owned.size ? p.owned.values().next().value : Math.floor(g.tiles.length / 2));
  UI.renderer.centerOn(g.tiles[i]);
  UI.renderer.clampCamera();
  UI.needsDraw = true;
}

function resizeCanvas() {
  const canvas = $('map');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = Math.max(200, Math.floor(rect.width));
  canvas.height = Math.max(200, Math.floor(rect.height));
  UI.needsDraw = true;
}

function frame() {
  if (UI.needsDraw && UI.renderer && UI.game) { UI.renderer.draw(); UI.needsDraw = false; }
  requestAnimationFrame(frame);
}

function bindMapEvents(canvas) {
  const R = () => UI.renderer;
  let drag = null;
  canvas.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, cx: R().cam.x, cy: R().cam.y, moved: false }; });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) { R().cam.x = drag.cx + dx; R().cam.y = drag.cy + dy; R().clampCamera(); canvas.classList.add('dragging'); UI.needsDraw = true; }
  });
  window.addEventListener('mouseup', e => {
    if (!drag) return;
    const wasClick = !drag.moved;
    drag = null; canvas.classList.remove('dragging');
    if (wasClick && e.target === canvas) {
      const rect = canvas.getBoundingClientRect();
      mapClick(R().screenToTile(e.clientX - rect.left, e.clientY - rect.top));
    }
  });
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const t = R().screenToTile(e.clientX - rect.left, e.clientY - rect.top);
    if (t !== R().hover) { R().hover = t; UI.needsDraw = true; }
    showTooltip(t, e.clientX - rect.left, e.clientY - rect.top);
  });
  canvas.addEventListener('mouseleave', () => { R().hover = null; $('tooltip').classList.add('hidden'); UI.needsDraw = true; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    R().zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.2 : 1 / 1.2);
    R().clampCamera(); UI.needsDraw = true;
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (!UI.game || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const step = 60;
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') R().cam.x += step;
    else if (k === 'arrowright' || k === 'd') R().cam.x -= step;
    else if (k === 'arrowup' || k === 'w') R().cam.y += step;
    else if (k === 'arrowdown' || k === 's') R().cam.y -= step;
    else if (k === ' ') { e.preventDefault(); playerAction('wait'); return; }
    else if (k === 'escape') { if (UI.mode) setMode(null); else selectTile(null); return; }
    else if (k === 'c') { centerOnHome(); return; }
    else if (k === 'g') { R().showGrid = !R().showGrid; }
    else if (k === 'l') { $('legend').classList.toggle('hidden'); return; }
    else if (k === 'h') { $('help').classList.toggle('hidden'); return; }
    else return;
    R().clampCamera(); UI.needsDraw = true;
  });
}

function mapClick(t) {
  if (!t) return;
  if (UI.mode) {
    const q = QUICK.find(x => x.id === UI.mode);
    if (UI.renderer.highlight && UI.renderer.highlight.has(t.i)) {
      if (q.pick) { setMode(null); selectTile(t); }
      else { const id = UI.mode; setMode(null); selectTile(t); playerAction(id, t); }
    } else {
      toast('Not a valid target — highlighted tiles only. Esc to cancel.', true);
    }
    return;
  }
  selectTile(t);
}

// ---------------- Targeting modes ----------------
function validTargets(mode) {
  const g = UI.game, p = UI.player, set = new Set();
  // Only tiles in or next to the player's territory can ever be targets.
  const cands = Array.from(p.owned, i => g.tiles[i]);
  if (mode !== 'improve' && mode !== 'road' && mode !== 'castle') {
    const seen = new Set(p.owned);
    for (const i of p.owned) for (const nb of g.neighbors(g.tiles[i])) if (!seen.has(nb.i)) { seen.add(nb.i); cands.push(nb); }
  }
  for (const t of cands) {
    if (mode === 'improve') {
      for (const id in IMPROVEMENTS) if (g.checkAction(p, id, t).ok) { set.add(t.i); break; }
    } else if (g.checkAction(p, mode, t).ok) set.add(t.i);
  }
  return set;
}

function setMode(mode) {
  UI.mode = mode;
  const canvas = $('map'), banner = $('mode-banner');
  if (!mode) {
    UI.renderer.highlight = null;
    canvas.classList.remove('targeting');
    banner.classList.add('hidden');
  } else {
    const q = QUICK.find(x => x.id === mode);
    UI.renderer.highlight = validTargets(mode);
    canvas.classList.add('targeting');
    banner.innerHTML = `${q.icon} ${esc(q.name.toUpperCase())} — click a highlighted tile${q.pick ? ' to choose what to build' : ''}<span class="cancel">Esc to cancel</span>`;
    banner.classList.remove('hidden');
  }
  renderQuickActions();
  UI.needsDraw = true;
}

function renderQuickActions() {
  const g = UI.game, p = UI.player;
  const el = $('quick-actions');
  el.innerHTML = QUICK.map(q => {
    const n = validTargets(q.id).size;
    let cost = '';
    if (q.id === 'expand') cost = `🪙${g.expandCost(p).gold}`;
    else if (q.id === 'village') cost = costHtml(g.scaleCost(COSTS.village, g.costMul(p, 'village')));
    else if (q.id === 'road') cost = costHtml(g.scaleCost(COSTS.road, g.costMul(p, 'road')));
    else if (q.id === 'castle') cost = costHtml(g.scaleCost(COSTS.castle, g.costMul(p, 'castle')));
    else if (q.id === 'conquer') cost = costHtml(g.scaleCost(COSTS.conquer, g.costMul(p, 'conquer')));
    else cost = 'varies';
    const title = `${q.hint}. ${n ? `${n} valid tile${n === 1 ? '' : 's'}.` : 'No valid tiles right now (check cost or requirements).'}`;
    return `<button class="quick${UI.mode === q.id ? ' active' : ''}" data-mode="${q.id}" ${n ? '' : 'disabled'} title="${esc(title)}">
      <span class="qi">${q.icon}</span><span>${q.name}</span><span class="qn">${n ? `${n} tile${n === 1 ? '' : 's'} · ${cost}` : cost}</span></button>`;
  }).join('');
  for (const b of el.querySelectorAll('button[data-mode]')) b.onclick = () => setMode(UI.mode === b.dataset.mode ? null : b.dataset.mode);
}

// ---------------- Tooltip & toast ----------------
function showTooltip(t, x, y) {
  const tip = $('tooltip');
  if (!t) { tip.classList.add('hidden'); return; }
  const g = UI.game, T = TERRAINS[t.terrain];
  const owner = t.owner !== null ? g.nations[t.owner] : null;
  const y0 = g.tileYield(t, owner || UI.player);
  let html = `<b>${T.name}</b>`;
  if (t.river && !t.water) html += ' <span class="dim">· river</span>';
  if (t.coastal) html += ' <span class="dim">· coastal</span>';
  if (t.resource) { const r = RESOURCE_BY_ID[t.resource]; html += `<br>${r.icon} ${r.name} <span class="dim">(${CATEGORY_NAMES[r.cat].toLowerCase()})</span>`; }
  html += `<br>Yield ${yieldStr(y0)}`;
  if (t.improvement) html += ` <span class="dim">· ${IMPROVEMENTS[t.improvement].name.toLowerCase()}</span>`;
  if (t.settlement) html += `<br>🏘️ ${esc(t.settlement.name)} — ${SETTLEMENTS[t.settlement.type].name.toLowerCase()}, pop ${t.settlement.pop}${t.settlement.capital ? ', capital' : ''}${t.harbor ? ', harbour' : ''}`;
  if (t.castle) html += '<br>🏰 Castle';
  if (owner) html += `<br><span style="color:${owner.color}">■</span> ${esc(owner.name)}${owner === UI.player && !g.isWorked(t, owner) ? ' <span class="dim">— idle, no settlement nearby</span>' : ''}`;
  else if (!t.water || t.terrain !== 'ocean') html += '<br><span class="dim">Unclaimed</span>';
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  const wrap = $('map-wrap').getBoundingClientRect();
  tip.style.left = Math.min(wrap.width - tip.offsetWidth - 8, x + 16) + 'px';
  tip.style.top = Math.min(wrap.height - tip.offsetHeight - 8, y + 16) + 'px';
}

let toastTimer = null;
function toast(msg, bad = false) {
  const el = $('toast');
  el.textContent = msg; el.classList.toggle('bad', bad); el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

// ---------------- Selection & tile panel ----------------
function selectTile(t) {
  UI.renderer.selected = t;
  UI.needsDraw = true;
  renderTilePanel();
}

const GROUPS = [
  { title: 'Territory', ids: ['expand', 'conquer'] },
  { title: 'Settlement', ids: ['village', 'upgrade', 'harbor'] },
  { title: 'Improve this tile', ids: ['farm', 'mine', 'lumber', 'pasture', 'fishery'] },
  { title: 'Build', ids: ['road', 'castle'] },
];

function renderTilePanel() {
  const panel = $('tile-panel');
  const t = UI.renderer.selected;
  const g = UI.game, p = UI.player;
  if (!t) {
    panel.innerHTML = `<h3 class="engraved">Selected tile</h3><div class="empty">Click any tile to inspect it and see what you can do there — or use a quick action above to light up every valid tile.</div>`;
    return;
  }
  const T = TERRAINS[t.terrain];
  const owner = t.owner !== null ? g.nations[t.owner] : null;
  const y = g.tileYield(t, owner || p);
  const mine = owner === p;
  let html = `<h3 class="engraved">Selected tile</h3>
    <div class="tile-head"><span class="tile-name">${esc(T.name)}</span><span class="tile-coords">${t.x}, ${t.y}</span></div>`;
  html += `<div class="tile-owner">${owner ? `<span class="swatch" style="background:${owner.color}"></span> ${esc(owner.name)}${mine ? ' <b>(yours)</b>' : ''}` : '<i>Unclaimed land</i>'}</div>`;
  const tags = [];
  if (t.river && !t.water) tags.push('<span class="tag">River</span>');
  if (t.coastal) tags.push('<span class="tag">Coastal</span>');
  if (t.road) tags.push('<span class="tag">Road</span>');
  if (t.castle) tags.push('<span class="tag">🏰 Castle</span>');
  if (t.harbor) tags.push('<span class="tag">⚓ Harbour</span>');
  if (mine) tags.push(g.isWorked(t, p) ? '<span class="tag good">Worked</span>' : '<span class="tag warn">Idle — no settlement within 2</span>');
  if (t.conqueredTurn && g.turn - t.conqueredTurn < 6) tags.push('<span class="tag">Garrisoned</span>');
  if (tags.length) html += `<div class="tags">${tags.join('')}</div>`;
  html += '<div class="kv">';
  html += `<span>Yield</span><span class="yield">${yieldStr(y)}${mine && !g.isWorked(t, p) ? ' <span class="note">(not collected)</span>' : ''}</span>`;
  if (t.resource) {
    const r = RESOURCE_BY_ID[t.resource];
    const unlocked = t.improvement === r.imp;
    html += `<span>Resource</span><span>${r.icon} <b>${r.name}</b> — ${unlocked ? 'fully worked' : `full yield ${yieldStr(r.yield)} with a ${IMPROVEMENTS[r.imp].name.toLowerCase()}`}</span>`;
  }
  if (t.improvement) html += `<span>Improved</span><span>${IMPROVEMENTS[t.improvement].icon} ${IMPROVEMENTS[t.improvement].name}</span>`;
  if (t.settlement) {
    const S = SETTLEMENTS[t.settlement.type];
    html += `<span>Settlement</span><span>🏘️ <b>${esc(t.settlement.name)}</b>, ${S.name.toLowerCase()}${t.settlement.capital ? ' &amp; capital' : ''}<br>Population ${t.settlement.pop} / ${S.maxPop}${S.next ? ` — ${SETTLEMENTS[S.next].name.toLowerCase()} at ${S.upgradePop}` : ''}</span>`;
  }
  if (owner && !mine) html += `<span>Defence</span><span>${g.defenseAt(owner, t).toFixed(1)} <span class="note">vs your attack ${g.attackStrength(p)}</span></span>`;
  html += '</div>';

  let any = false;
  for (const grp of GROUPS) {
    let items = '';
    for (const id of grp.ids) {
      const c = g.checkAction(p, id, t);
      if (!c.ok && isIrrelevant(id, t)) continue;
      any = true;
      let sub = c.why ? `<span class="sub${c.ok ? '' : ' neg'}">${esc(c.why)}</span>` : '';
      if (IMPROVEMENTS[id] && c.ok) {
        const prev = t.improvement; t.improvement = id; const after = g.tileYield(t, p); t.improvement = prev;
        sub = `<span class="sub">Yield becomes ${yieldStr(after)}${c.why ? ' · ' + esc(c.why) : ''}</span>`;
      }
      items += `<button class="action${id === 'conquer' ? ' danger' : ''}${['village', 'upgrade'].includes(id) && c.ok ? ' gold' : ''}" data-action="${id}" ${c.ok ? '' : 'disabled'}>
        <span class="al">${esc(c.label)}</span><span class="cost">${costHtml(c.cost)}</span>${sub}</button>`;
    }
    if (items) html += `<div class="group-title">${grp.title}</div><div class="actions">${items}</div>`;
  }
  if (!any) html += '<div class="empty" style="margin-top:8px">Nothing can be done here this turn.</div>';
  panel.innerHTML = html;
  for (const b of panel.querySelectorAll('button[data-action]')) b.onclick = () => playerAction(b.dataset.action, t);
}

// Hide disabled actions that make no sense for the tile at all (keep the ones that fail only on cost/requirements).
function isIrrelevant(id, t) {
  const p = UI.player, g = UI.game;
  const mine = t.owner === p.id;
  const enemy = t.owner !== null && !mine;
  switch (id) {
    case 'expand': return t.owner !== null || t.terrain === 'ocean' || !g.isFrontier(p, t);
    case 'conquer': return !enemy || !g.isFrontier(p, t);
    case 'village': return t.water || t.terrain === 'mountains' || !!t.settlement || (!mine && !(t.owner === null && g.isFrontier(p, t)));
    case 'upgrade': return !t.settlement || !mine || !SETTLEMENTS[t.settlement.type].next;
    case 'harbor': return !t.settlement || !mine || !t.coastal || t.harbor;
    case 'castle': return !mine || t.water || t.terrain === 'mountains' || !!t.settlement || t.castle;
    case 'road': return !mine || t.water || t.terrain === 'mountains' || t.road || !!t.settlement;
    default: return !mine || !g.improvementAllowed(t, id) || t.improvement === id;
  }
}

// ---------------- Turn flow ----------------
function playerAction(id, tile, target) {
  if (UI.busy || !UI.game) return;
  const g = UI.game, p = UI.player;
  if (g.over && !g.continued) { $('gameover').classList.remove('hidden'); return; }
  if (!p.alive) { toast('Your nation has fallen.', true); return; }
  const res = g.doAction(p, id, tile, target);
  if (!res.ok) { toast(res.why, true); return; }
  UI.busy = true;
  setMode(null);
  const logStart = g.log.length - 1; // include the player's own action
  const before = { gold: p.gold, mat: p.mat, tiles: p.owned.size, pop: g.totalPop(p) };
  g.runAITurns();
  g.endTurn();
  UI.busy = false;
  buildReport(logStart, before);
  refreshAll();
  if (g.over && !g.continued) showGameOver();
}

function buildReport(logStart, before) {
  const g = UI.game, p = UI.player;
  const ev = [];
  const inc = p.income;
  ev.push({ kind: 'gold', msg: `Income: ${fmtDelta(inc.gold)} gold, ${fmtDelta(inc.mat)} materials, food ${fmtDelta(inc.net)} after feeding ${inc.pop} people.` });
  const tilesNow = p.owned.size;
  for (const e of g.log.slice(logStart)) {
    const m = e.msg;
    const aboutMe = e.nation === p.id || m.includes(p.name);
    if (!aboutMe) continue;
    let kind = 'neutral';
    if (/conquers|seizes|fallen/.test(m)) kind = m.startsWith(p.name) ? 'good' : 'bad';
    else if (/Famine/.test(m)) kind = 'bad';
    else if (/grows|borders/.test(m)) kind = 'good';
    else if (/trade route/.test(m)) kind = 'gold';
    ev.push({ kind, msg: m });
  }
  const gained = tilesNow - before.tiles;
  if (gained > 0 && !ev.some(e => /borders/.test(e.msg))) ev.push({ kind: 'good', msg: `Your territory grew by ${gained} tile${gained === 1 ? '' : 's'}.` });
  // Hostile neighbours warning
  for (const o of g.nations) {
    if (o === p || !o.alive) continue;
    if (g.rel(p, o) < -40 && g.bordersNation(p, o)) ev.push({ kind: 'bad', msg: `${o.name} is hostile and shares your border (attack ${g.attackStrength(o)}).` });
  }
  UI.report = ev;
}

// ---------------- Panels ----------------
function refreshAll() {
  renderTopbar();
  renderTurnPanel();
  renderTilePanel();
  renderReport();
  renderNationPanel();
  renderDiploPanel();
  renderLog();
  UI.needsDraw = true;
}

function renderTopbar() {
  const g = UI.game, p = UI.player;
  const inc = p.income || g.computeIncome(p);
  $('turn-info').textContent = `${Math.min(g.turn, g.maxTurns)} / ${g.maxTurns}`;
  const need = g.growthNeed(inc.pop);
  $('resbar').innerHTML = `
    <div class="res-pill" title="Gold pays for expansion, trade, conquest and upkeep. Income ${inc.goldGross}, upkeep ${inc.goldUp}."><span class="icon">🪙</span><div><div class="lbl">Gold</div><div class="num">${Math.floor(p.gold)} <span class="dlt">${fmtDelta(inc.gold)}</span></div></div></div>
    <div class="res-pill" title="Materials build improvements, roads, settlements and castles. Income ${inc.matGross}, upkeep ${inc.matUp}."><span class="icon">🪵</span><div><div class="lbl">Materials</div><div class="num">${Math.floor(p.mat)} <span class="dlt">${fmtDelta(inc.mat)}</span></div></div></div>
    <div class="res-pill" title="Food ${inc.food} produced, ${inc.pop} eaten by population. Surplus fills the growth bar (${Math.floor(p.growth)} / ${need}); shortfall causes famine."><span class="icon">🌾</span><div><div class="lbl">Food surplus</div><div class="num">${fmtDelta(inc.net)}</div></div></div>
    <div class="res-pill" title="Total population across your settlements. Growth ${Math.floor(p.growth)} / ${need}."><span class="icon">👥</span><div><div class="lbl">People</div><div class="num">${inc.pop}</div></div></div>
    <div class="res-pill" title="Score: territory, settlements, population, castles, trade and gold."><span class="icon">🏛️</span><div><div class="lbl">Score</div><div class="num">${g.score(p)}</div></div></div>`;
  const ranked = g.nations.slice().sort((a, b) => g.score(b) - g.score(a));
  $('ranking').innerHTML = ranked.map((n, i) => `<div class="rank-row${n.isPlayer ? ' me' : ''}${n.alive ? '' : ' dead'}" title="${esc(n.name)} — ${esc(n.leader.name)}">
    <span>${i + 1}</span><span class="swatch" style="background:${n.color}"></span><span>${esc(n.colorName)}${n.isPlayer ? ' · you' : ''}</span><span class="sc">${g.score(n)}</span></div>`).join('');
}

function renderTurnPanel() {
  const g = UI.game, p = UI.player;
  const title = $('turn-title'), sub = $('turn-sub');
  if (g.over && !g.continued) { title.textContent = 'Game over'; title.classList.add('done'); sub.textContent = g.reason; }
  else if (!p.alive) { title.textContent = 'Fallen'; title.classList.add('done'); sub.textContent = 'Your nation is no more.'; }
  else { title.textContent = 'Your move'; title.classList.remove('done'); sub.textContent = 'Choose one action. Then every rival nation makes its move.'; }
  renderQuickActions();
}

function renderReport() {
  $('report').innerHTML = UI.report.length
    ? UI.report.map(e => `<div class="ev ${e.kind}">${e.kind === 'gold' && e.msg.startsWith('Income') ? e.msg : esc(e.msg)}</div>`).join('')
    : '<div class="empty">Nothing yet.</div>';
}

function renderNationPanel() {
  const p = UI.player, g = UI.game;
  const inc = p.income || g.computeIncome(p);
  const T = NATION_TRAITS[p.trait], L = LEADER_TRAITS[p.leader.trait];
  const need = g.growthNeed(inc.pop);
  const pct = Math.min(100, Math.round((p.growth / need) * 100));
  $('nation-panel').innerHTML = `
    <h3 class="engraved">Your nation</h3>
    <div class="nation-head"><div class="big-swatch" style="background:${p.color}"></div>
      <div><div class="nation-name">${esc(p.name)}</div><div class="nation-leader">${esc(p.leader.name)} · ${p.colorName} nation${p.alive ? '' : ' · <span class="neg">fallen</span>'}</div></div></div>
    <div class="trait"><b>${T.name}</b> — ${T.desc}</div>
    <div class="trait"><b>${L.name} leader</b> — ${L.desc}</div>
    <div class="stats" style="margin-top:10px">
      <span>Growth</span><span>${Math.floor(p.growth)} / ${need} <span class="note">next citizen</span><div class="bar"><div style="width:${pct}%"></div></div></span>
      <span>Territory</span><span>${p.owned.size} tiles · ${Math.round(g.claimedShare(p) * 100)}% of all claimed land</span>
      <span>Settlements</span><span>${p.settlements.length} · ${g.workedTiles(p).size} worked tiles</span>
      <span>Castles</span><span>${p.castles.length} · attack ${g.attackStrength(p)}</span>
      <span>Trade</span><span>${p.trades.size} route${p.trades.size === 1 ? '' : 's'}</span>
    </div>`;
}

function renderDiploPanel() {
  const p = UI.player, g = UI.game;
  let html = '<h3 class="engraved">Other nations</h3>';
  for (const n of g.nations) {
    if (n === p) continue;
    const T = NATION_TRAITS[n.trait], L = LEADER_TRAITS[n.leader.trait];
    const rel = g.rel(p, n), relL = g.relLabel(rel);
    const trading = p.trades.has(n.id);
    const c = g.checkAction(p, 'trade', null, n.id);
    const borders = n.alive && g.bordersNation(p, n);
    html += `<div class="nation-row${n.alive ? '' : ' dead'}">
      <span class="swatch" style="background:${n.color}"></span>
      <div><div class="nm">${esc(n.name)} <span class="note">· ${n.colorName}</span></div>
        <div class="sub">${esc(n.leader.name)} — ${T.name}, ${L.name}</div>
        <div class="sub">${n.alive ? `${n.owned.size} tiles · ${n.settlements.length} settlements · attack ${g.attackStrength(n)} · score ${g.score(n)}` : 'This nation has fallen.'}</div>
        <div class="sub"><span class="rel-${relL}">${relL}</span> (${Math.round(rel)})${borders ? ' · shares your border' : ''}${trading ? ` · 🤝 trading, +${g.tradeIncome(p, n)} gold/turn` : ''}</div>
        <div class="sub">Last move: ${esc(n.lastAction)}</div>
      </div>
      <div>${n.alive && !trading ? `<button class="small" data-trade="${n.id}" ${c.ok ? '' : 'disabled'} title="${esc(c.why || 'Open a trade route: ' + g.costStr(c.cost))}">🤝 Trade<br>🪙${c.cost.gold}</button>` : ''}</div>
    </div>`;
  }
  const panel = $('diplo-panel');
  panel.innerHTML = html;
  for (const b of panel.querySelectorAll('button[data-trade]')) b.onclick = () => playerAction('trade', null, parseInt(b.dataset.trade, 10));
}

function renderLog() {
  const g = UI.game, p = UI.player;
  $('log').innerHTML = g.log.slice(-80).map(e => {
    const war = /conquer|seizes|fallen|Famine/.test(e.msg);
    return `<div class="entry${e.nation === p.id ? ' mine' : ''}${war ? ' war' : ''}"><span class="t">T${e.turn}</span>${esc(e.msg)}</div>`;
  }).join('');
}

function showGameOver() {
  const g = UI.game, p = UI.player;
  $('go-title').textContent = g.winner === p ? '🏆 Victory' : `${g.winner.name} prevails`;
  $('go-reason').textContent = g.reason;
  const ranked = g.nations.slice().sort((a, b) => g.score(b) - g.score(a));
  $('go-table').innerHTML = '<tr><th>#</th><th>Nation</th><th>Leader</th><th>Tiles</th><th>Settlements</th><th>People</th><th>Score</th></tr>' +
    ranked.map((n, i) => `<tr class="${n === p ? 'me' : ''}"><td>${i + 1}</td><td><span class="swatch" style="background:${n.color}"></span> ${esc(n.name)}${n.alive ? '' : ' (fallen)'}</td><td>${esc(n.leader.name)}</td><td>${n.owned.size}</td><td>${n.settlements.length}</td><td>${g.totalPop(n)}</td><td>${g.score(n)}</td></tr>`).join('');
  $('gameover').classList.remove('hidden');
}
