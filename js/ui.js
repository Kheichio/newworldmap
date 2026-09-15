// UI: setup screen, HUD panels, map interaction, tooltips, game-over screen.

const UI = {
  game: null, renderer: null, player: null,
  selectedColor: 'crimson',
  needsDraw: true,
  busy: false,
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
  return parts.join(' ');
};

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
  lt.innerHTML = '<option value="">Random</option>' + Object.entries(LEADER_TRAITS).map(([k, v]) => `<option value="${k}">${v.name} — ${v.desc}</option>`).join('');
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
  $('trait-preview').innerHTML = `<b>${c.name} — ${T.name}:</b> ${T.desc}<br><b>Leader — ${L ? L.name : 'Random trait'}:</b> ${L ? L.desc : 'Your leader will receive a random trait when the nation is founded.'}`;
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
  game.addLog(`${UI.player.name} is founded under ${UI.player.leader.name}. Seed: ${seed}`, UI.player);
  $('setup').classList.add('hidden');
  $('app').classList.remove('hidden');
  initMap();
  centerOnHome();
  selectTile(null);
  refreshAll();
}

// Centre the camera on the player's capital (or any owned tile if the capital was lost).
function centerOnHome() {
  const g = UI.game, p = UI.player;
  const i = p.capital >= 0 ? p.capital : (p.owned.size ? p.owned.values().next().value : Math.floor(g.tiles.length / 2));
  UI.renderer.centerOn(g.tiles[i]);
  UI.renderer.clampCamera();
  UI.needsDraw = true;
}

// ---------------- Map interaction ----------------
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
  resizeCanvas();
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
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) { R().cam.x = drag.cx + dx; R().cam.y = drag.cy + dy; R().clampCamera(); canvas.classList.add('dragging'); UI.needsDraw = true; }
    }
  });
  window.addEventListener('mouseup', e => {
    if (!drag) return;
    const wasClick = !drag.moved;
    drag = null; canvas.classList.remove('dragging');
    if (wasClick && e.target === canvas) {
      const rect = canvas.getBoundingClientRect();
      selectTile(R().screenToTile(e.clientX - rect.left, e.clientY - rect.top));
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
    else if (k === 'escape') { selectTile(null); return; }
    else if (k === 'c') { centerOnHome(); return; }
    else if (k === 'g') { R().showGrid = !R().showGrid; }
    else if (k === 'h') { $('help').classList.toggle('hidden'); return; }
    else return;
    R().clampCamera(); UI.needsDraw = true;
  });
}

function showTooltip(t, x, y) {
  const tip = $('tooltip');
  if (!t) { tip.classList.add('hidden'); return; }
  const g = UI.game, T = TERRAINS[t.terrain];
  const owner = t.owner !== null ? g.nations[t.owner] : null;
  const y0 = owner ? g.tileYield(t, owner) : g.tileYield(t, UI.player);
  let html = `<b>${T.name}</b>`;
  if (t.river && !t.water) html += ' · River';
  if (t.coastal) html += ' · Coastal';
  if (t.resource) { const r = RESOURCE_BY_ID[t.resource]; html += `<br>${r.icon} ${r.name} <span class="muted">(${CATEGORY_NAMES[r.cat]})</span>`; }
  html += `<br>Yield: ${yieldStr(y0)}`;
  if (t.improvement) html += `<br>${IMPROVEMENTS[t.improvement].icon} ${IMPROVEMENTS[t.improvement].name}`;
  if (t.settlement) html += `<br>🏘️ ${esc(t.settlement.name)} — ${SETTLEMENTS[t.settlement.type].name}, pop ${t.settlement.pop}${t.settlement.capital ? ' (capital)' : ''}`;
  if (t.castle) html += '<br>🏰 Castle';
  if (t.harbor) html += '<br>⚓ Harbour';
  if (owner) html += `<br><span style="color:${owner.color}">■</span> ${esc(owner.name)}${g.isWorked(t, owner) ? '' : ' <span class="muted">(unworked)</span>'}`;
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  const wrap = $('map-wrap').getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.min(wrap.width - tw - 8, x + 14) + 'px';
  tip.style.top = Math.min(wrap.height - th - 8, y + 14) + 'px';
}

let toastTimer = null;
function toast(msg, bad = false) {
  const el = $('toast');
  el.textContent = msg; el.classList.toggle('bad', bad); el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// ---------------- Selection & actions ----------------
function selectTile(t) {
  UI.renderer.selected = t;
  UI.needsDraw = true;
  renderTilePanel();
}

const TILE_ACTIONS = ['expand', 'conquer', 'village', 'upgrade', 'farm', 'mine', 'lumber', 'pasture', 'fishery', 'road', 'harbor', 'castle'];

function renderTilePanel() {
  const panel = $('tile-panel');
  const t = UI.renderer.selected;
  const g = UI.game, p = UI.player;
  if (!t) { panel.innerHTML = '<h3>Selected tile</h3><div class="muted">Click a tile on the map to see what you can do there.</div>'; return; }
  const T = TERRAINS[t.terrain];
  const owner = t.owner !== null ? g.nations[t.owner] : null;
  const y = g.tileYield(t, owner || p);
  let html = `<h3>Selected tile</h3><div class="tile-title">${esc(T.name)} <span class="coords">(${t.x}, ${t.y})</span></div><div class="kv">`;
  const feats = [];
  if (t.river && !t.water) feats.push('River');
  if (t.coastal) feats.push('Coastal');
  if (feats.length) html += `<span>Features</span><span>${feats.join(', ')}</span>`;
  if (t.resource) {
    const r = RESOURCE_BY_ID[t.resource];
    html += `<span>Resource</span><span>${r.icon} ${r.name} <span class="muted">— ${CATEGORY_NAMES[r.cat]}, full yield ${yieldStr(r.yield)} with a ${IMPROVEMENTS[r.imp].name.toLowerCase()}</span></span>`;
  }
  html += `<span>Yield</span><span class="yield">${yieldStr(y)}</span>`;
  if (t.improvement) html += `<span>Improvement</span><span>${IMPROVEMENTS[t.improvement].icon} ${IMPROVEMENTS[t.improvement].name}</span>`;
  if (t.road) html += `<span>Road</span><span>Yes</span>`;
  if (t.castle) html += `<span>Castle</span><span>🏰 Defends tiles within 2</span>`;
  if (t.settlement) {
    const S = SETTLEMENTS[t.settlement.type];
    html += `<span>Settlement</span><span>🏘️ <b>${esc(t.settlement.name)}</b> — ${S.name}${t.settlement.capital ? ' (capital)' : ''}, population ${t.settlement.pop}/${S.maxPop}${t.harbor ? ', ⚓ harbour' : ''}</span>`;
  }
  if (owner) {
    html += `<span>Owner</span><span><span style="color:${owner.color}">■</span> ${esc(owner.name)}${owner === p ? ' (you)' : ''}</span>`;
    if (owner === p) html += `<span>Worked</span><span>${g.isWorked(t, p) ? 'Yes' : '<span class="neg">No — too far from a settlement</span>'}</span>`;
    else html += `<span>Defence</span><span>${g.defenseAt(owner, t).toFixed(1)} vs your attack ${g.attackStrength(p)}</span>`;
  } else html += `<span>Owner</span><span class="muted">Unclaimed</span>`;
  html += '</div><div class="actions">';

  let any = false;
  for (const id of TILE_ACTIONS) {
    const c = g.checkAction(p, id, t);
    // Hide actions that make no sense for this tile at all.
    if (!c.ok && isIrrelevant(id, t, c)) continue;
    any = true;
    const danger = id === 'conquer';
    html += `<button class="action${danger ? ' danger' : ''}" data-action="${id}" ${c.ok ? '' : 'disabled'} title="${esc(c.why || '')}"><span>${esc(c.label)}</span><span class="cost">${costHtml(c.cost)}</span></button>`;
    if (c.why) html += `<div class="why">${esc(c.why)}</div>`;
  }
  if (!any) html += '<div class="muted">Nothing can be done on this tile.</div>';
  html += '</div>';
  panel.innerHTML = html;
  for (const b of panel.querySelectorAll('button[data-action]')) b.onclick = () => playerAction(b.dataset.action, t);
}

// Decide whether a disabled action is worth showing for the tile.
function isIrrelevant(id, t, c) {
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
    default: // improvements
      return !mine || !g.improvementAllowed(t, id) || t.improvement === id;
  }
}

function playerAction(id, tile, target) {
  if (UI.busy || !UI.game) return;
  const g = UI.game, p = UI.player;
  if (g.over && !g.continued) { $('gameover').classList.remove('hidden'); return; }
  if (!p.alive) { toast('Your nation has fallen.', true); return; }
  const res = g.doAction(p, id, tile, target);
  if (!res.ok) { toast(res.why, true); return; }
  UI.busy = true;
  const logStart = g.log.length;
  g.runAITurns();
  g.endTurn();
  UI.busy = false;
  // Surface anything that happened to the player.
  const hits = g.log.slice(logStart).filter(e => /from (?:the )?/.test(e.msg) && e.msg.includes(`from ${p.name}`));
  if (hits.length) toast(hits[hits.length - 1].msg, true);
  refreshAll();
  if (g.over && !g.continued) showGameOver();
}

// ---------------- Panels ----------------
function refreshAll() {
  renderTopbar();
  renderNationPanel();
  renderResPanel();
  renderTilePanel();
  renderDiploPanel();
  renderLog();
  UI.needsDraw = true;
}

function renderTopbar() {
  const g = UI.game;
  $('turn-info').textContent = `Turn ${Math.min(g.turn, g.maxTurns)} / ${g.maxTurns}`;
  const ranked = g.nations.slice().sort((a, b) => g.score(b) - g.score(a));
  $('ranking').innerHTML = ranked.map(n => `<span class="chip${n.alive ? '' : ' dead'}" title="${esc(n.name)} — ${esc(n.leader.name)}"><span class="swatch" style="background:${n.color}"></span>${esc(n.colorName)}${n.isPlayer ? ' (you)' : ''} · ${g.score(n)}</span>`).join('');
}

function renderNationPanel() {
  const p = UI.player, g = UI.game;
  const T = NATION_TRAITS[p.trait], L = LEADER_TRAITS[p.leader.trait];
  $('nation-panel').innerHTML = `
    <div class="nation-head"><div class="big-swatch" style="background:${p.color}"></div>
      <div><div class="name">${esc(p.name)}</div><div class="muted">${esc(p.leader.name)} · ${p.colorName} nation${p.alive ? '' : ' · <span class="neg">fallen</span>'}</div></div></div>
    <div class="trait"><b>${T.name}:</b> ${T.desc}</div>
    <div class="trait"><b>${L.name} leader:</b> ${L.desc}</div>`;
}

function renderResPanel() {
  const p = UI.player, g = UI.game;
  const inc = p.income || g.computeIncome(p);
  const need = g.growthNeed(inc.pop);
  const pct = Math.min(100, Math.round((p.growth / need) * 100));
  const land = g.landCount(p);
  $('res-panel').innerHTML = `
    <div class="res-grid">
      <div class="res gold"><div class="label">Gold</div><div class="val">${Math.floor(p.gold)}</div><div class="delta">${fmtDelta(inc.gold)}/turn <span class="muted" title="Upkeep">(−${inc.goldUp})</span></div></div>
      <div class="res mat"><div class="label">Materials</div><div class="val">${Math.floor(p.mat)}</div><div class="delta">${fmtDelta(inc.mat)}/turn <span class="muted" title="Upkeep">(−${inc.matUp})</span></div></div>
      <div class="res food"><div class="label">Food</div><div class="val">${inc.food}</div><div class="delta">${fmtDelta(inc.net)} after ${inc.pop} pop</div></div>
    </div>
    <div class="muted" style="margin-top:6px">Growth ${Math.floor(p.growth)} / ${need}</div><div class="bar"><div style="width:${pct}%"></div></div>
    <div class="stats">
      <span>Territory</span><span>${p.owned.size} tiles (${land} land, ${Math.round(g.claimedShare(p) * 100)}% of claimed)</span>
      <span>Settlements</span><span>${p.settlements.length} · pop ${inc.pop}</span>
      <span>Castles</span><span>${p.castles.length}</span>
      <span>Trade routes</span><span>${p.trades.size}</span>
      <span>Attack</span><span>${g.attackStrength(p)}</span>
      <span>Score</span><span>${g.score(p)}</span>
      <span>Next expansion</span><span>🪙${g.expandCost(p).gold}</span>
    </div>`;
}

function renderDiploPanel() {
  const p = UI.player, g = UI.game;
  let html = '<h3>Other nations</h3>';
  for (const n of g.nations) {
    if (n === p) continue;
    const T = NATION_TRAITS[n.trait], L = LEADER_TRAITS[n.leader.trait];
    const rel = g.rel(p, n), relL = g.relLabel(rel);
    const trading = p.trades.has(n.id);
    const c = g.checkAction(p, 'trade', null, n.id);
    html += `<div class="nation-row${n.alive ? '' : ' dead'}">
      <span class="swatch" style="background:${n.color}"></span>
      <div><div class="nm">${esc(n.name)} <span class="muted">(${n.colorName})</span></div>
        <div class="sub">${esc(n.leader.name)} · ${T.name}, ${L.name} · ${n.alive ? `${n.owned.size} tiles, ${n.settlements.length} settlements, score ${g.score(n)}` : 'fallen'}</div>
        <div class="sub">Relations: <span class="rel-${relL}">${relL} (${Math.round(rel)})</span>${trading ? ` · 🤝 trading (+${g.tradeIncome(p, n)} gold)` : ''} · attack ${g.attackStrength(n)} · last: ${esc(n.lastAction)}</div>
      </div>
      <div>${n.alive && !trading ? `<button class="small" data-trade="${n.id}" ${c.ok ? '' : 'disabled'} title="${esc(c.why || 'Open a trade route: ' + g.costStr(c.cost))}">Trade 🪙${c.cost.gold}</button>` : ''}</div>
    </div>`;
  }
  const panel = $('diplo-panel');
  panel.innerHTML = html;
  for (const b of panel.querySelectorAll('button[data-trade]')) b.onclick = () => playerAction('trade', null, parseInt(b.dataset.trade, 10));
}

function renderLog() {
  const g = UI.game, p = UI.player;
  const entries = g.log.slice(-60);
  $('log').innerHTML = entries.map(e => {
    const war = /conquer|seizes|fallen|Famine/.test(e.msg);
    return `<div class="entry${e.nation === p.id ? ' mine' : ''}${war ? ' war' : ''}"><span class="t">T${e.turn}</span>${esc(e.msg)}</div>`;
  }).join('');
}

function showGameOver() {
  const g = UI.game, p = UI.player;
  $('go-title').textContent = g.winner === p ? '🏆 Victory!' : `${g.winner.name} wins`;
  $('go-reason').textContent = g.reason;
  const ranked = g.nations.slice().sort((a, b) => g.score(b) - g.score(a));
  $('go-table').innerHTML = '<tr><th>#</th><th>Nation</th><th>Leader</th><th>Tiles</th><th>Settlements</th><th>Pop</th><th>Score</th></tr>' +
    ranked.map((n, i) => `<tr class="${n === p ? 'me' : ''}"><td>${i + 1}</td><td><span class="swatch" style="background:${n.color}"></span> ${esc(n.name)}${n.alive ? '' : ' (fallen)'}</td><td>${esc(n.leader.name)}</td><td>${n.owned.size}</td><td>${n.settlements.length}</td><td>${g.totalPop(n)}</td><td>${g.score(n)}</td></tr>`).join('');
  $('gameover').classList.remove('hidden');
}
