/* global World */
(() => {
  const { TILE, T, O } = World;
  const CHUNK = 16;
  const SPEED = 165;
  const PLAYER_R = 11;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const mini = document.getElementById('minimap');
  const mctx = mini.getContext('2d');
  const $ = (id) => document.getElementById(id);

  let ws = null;
  let world = null;
  let myId = null;
  let dayLength = 240;
  let nightStart = 0.62;
  let serverTime = 0;
  let timeSyncedAt = 0;

  const me = { x: 0, y: 0, dir: 0, hp: 100, downed: false, inv: { wood: 0, stone: 0, gold: 0 }, sword: 1, swingT: 0 };
  const others = new Map(); // id -> {x,y,tx,ty,...}
  const enemies = new Map(); // id -> {x,y,tx,ty,...}
  const mods = { removed: new Set(), structures: new Map() };
  const shrines = new Map();
  const chunks = new Map();
  const fx = [];
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false };
  let buildMode = null;
  let chatting = false;
  let lastSend = 0;
  let lastAttack = 0;
  let cam = { x: 0, y: 0 };
  let W = 0;
  let H = 0;
  let dpr = 1;

  // ---------- Setup ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  window.addEventListener('resize', resize);
  resize();

  const savedName = localStorageGet('wl-name');
  if (savedName) $('nameInput').value = savedName;
  $('nameInput').focus();

  $('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('nameInput').value.trim() || 'Wanderer';
    localStorageSet('wl-name', name);
    connect(name);
  });

  function localStorageGet(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  }
  function localStorageSet(k, v) {
    try { localStorage.setItem(k, v); } catch { /* private mode */ }
  }

  function connect(name) {
    $('status').textContent = 'Connecting…';
    ws = new WebSocket(location.origin.replace(/^http/, 'ws'));
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name }));
    ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      $('join').style.display = 'grid';
      $('status').textContent = myId ? 'Disconnected from server. Refresh to rejoin.' : 'Could not connect to server.';
    };
  }

  function sendMsg(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  // ---------- Network ----------
  function onMessage(m) {
    switch (m.t) {
      case 'welcome':
        myId = m.id;
        world = World.create(m.seed);
        dayLength = m.dayLength;
        nightStart = m.nightStart;
        m.mods.removed.forEach((k) => mods.removed.add(k));
        m.mods.structures.forEach(([k, s]) => mods.structures.set(k, s));
        m.mods.shrines.forEach(([k, s]) => shrines.set(k, s));
        me.x = m.spawn.x;
        me.y = m.spawn.y;
        $('join').style.display = 'none';
        canvas.focus();
        requestAnimationFrame(frame);
        break;
      case 'state':
        serverTime = m.time;
        timeSyncedAt = performance.now();
        applyState(m);
        break;
      case 'removed':
        if (m.on) mods.removed.add(m.key);
        else mods.removed.delete(m.key);
        break;
      case 'struct':
        if (m.s) mods.structures.set(m.key, m.s);
        else mods.structures.delete(m.key);
        break;
      case 'shrine':
        shrines.set(m.key, m.state);
        break;
      case 'chat':
        addChat(m.text, m.from);
        break;
      case 'toast':
        toast(m.text);
        break;
      case 'respawn':
        me.x = m.x;
        me.y = m.y;
        break;
      case 'fx':
        spawnFx(m);
        break;
    }
  }

  function applyState(m) {
    const seen = new Set();
    for (const p of m.players) {
      seen.add(p.id);
      if (p.id === myId) {
        Object.assign(me, { hp: p.hp, inv: p.inv, sword: p.sword, name: p.name, color: p.color, rp: p.rp, bleed: p.bleed, kills: p.kills });
        if (p.downed && !me.downed) {
          me.x = p.x;
          me.y = p.y;
        }
        me.downed = p.downed;
        continue;
      }
      let o = others.get(p.id);
      if (!o) {
        o = { x: p.x, y: p.y };
        others.set(p.id, o);
      }
      Object.assign(o, p, { x: o.x, y: o.y, tx: p.x, ty: p.y });
      if (p.swing) o.swingT = 0.2;
    }
    for (const id of others.keys()) if (!seen.has(id)) others.delete(id);

    const seenE = new Set();
    for (const e of m.enemies) {
      seenE.add(e.id);
      let o = enemies.get(e.id);
      if (!o) {
        o = { x: e.x, y: e.y, born: performance.now() };
        enemies.set(e.id, o);
      }
      Object.assign(o, e, { x: o.x, y: o.y, tx: e.x, ty: e.y });
    }
    for (const id of enemies.keys()) if (!seenE.has(id)) enemies.delete(id);
    updateHud();
  }

  // ---------- Input ----------
  window.addEventListener('keydown', (e) => {
    if (!myId) return;
    if (chatting) {
      if (e.key === 'Enter') {
        const text = $('chatInput').value.trim();
        if (text) sendMsg({ t: 'chat', text });
        closeChat();
      } else if (e.key === 'Escape') closeChat();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'enter') {
      chatting = true;
      keys.clear();
      $('chatInput').style.display = 'block';
      $('chatInput').value = '';
      $('chatInput').focus();
      e.preventDefault();
      return;
    }
    if (k === '1') buildMode = buildMode === 'campfire' ? null : 'campfire';
    if (k === '2') buildMode = buildMode === 'wall' ? null : 'wall';
    if (k === 'escape') buildMode = null;
    if (k === 'u') sendMsg({ t: 'upgrade' });
    if (k === 'h') $('help').style.display = $('help').style.display === 'none' ? '' : 'none';
    if (k === 'x') {
      const t = mouseTile();
      sendMsg({ t: 'demolish', tx: t[0], ty: t[1] });
    }
    if (k === 'e' && !e.repeat) tryInteract();
    keys.add(k);
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    updateToolbar();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  function closeChat() {
    chatting = false;
    $('chatInput').style.display = 'none';
    $('chatInput').blur();
  }

  canvas.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  canvas.addEventListener('mousedown', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (e.button === 2) {
      buildMode = null;
      updateToolbar();
      return;
    }
    if (buildMode) {
      const t = mouseTile();
      sendMsg({ t: 'build', kind: buildMode, tx: t[0], ty: t[1] });
      return;
    }
    mouse.down = true;
  });
  window.addEventListener('mouseup', () => (mouse.down = false));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Basic touch support: tap to attack toward the tap, drag left half to move.
  let touchMove = null;
  canvas.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < W / 2 && !touchMove) touchMove = { id: t.identifier, sx: t.clientX, sy: t.clientY, dx: 0, dy: 0 };
      else {
        mouse.x = t.clientX;
        mouse.y = t.clientY;
        mouse.down = true;
      }
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (touchMove && t.identifier === touchMove.id) {
        touchMove.dx = t.clientX - touchMove.sx;
        touchMove.dy = t.clientY - touchMove.sy;
      }
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (touchMove && t.identifier === touchMove.id) touchMove = null;
      else mouse.down = false;
    }
  });

  function mouseWorld() {
    return { x: mouse.x + cam.x, y: mouse.y + cam.y };
  }
  function mouseTile() {
    const p = mouseWorld();
    return [Math.floor(p.x / TILE), Math.floor(p.y / TILE)];
  }

  function interactLabel(o) {
    return { [O.TREE]: 'Chop tree', [O.ROCK]: 'Mine rock', [O.CHEST]: 'Open chest', [O.BUSH]: 'Eat berries', [O.SHRINE]: 'Awaken Guardian' }[o];
  }

  function findInteractable() {
    // A downed friend takes priority.
    for (const o of others.values()) {
      if (o.downed && Math.hypot(o.x - me.x, o.y - me.y) < 60) return { revive: o.id, label: `Hold E: revive ${o.name}` };
    }
    const ptx = Math.floor(me.x / TILE);
    const pty = Math.floor(me.y / TILE);
    let best = null;
    let bestD = 64;
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const tx = ptx + i;
        const ty = pty + j;
        const o = world.objectAt(tx, ty);
        if (o === O.NONE) continue;
        const key = tx + ',' + ty;
        if (o === O.SHRINE ? shrines.has(key) : mods.removed.has(key)) continue;
        const d = Math.hypot(tx * TILE + 16 - me.x, ty * TILE + 16 - me.y);
        if (d < bestD) {
          bestD = d;
          best = { tx, ty, label: 'E: ' + interactLabel(o) };
        }
      }
    }
    return best;
  }

  function tryInteract() {
    if (me.downed) return;
    const t = findInteractable();
    if (t && t.tx !== undefined) sendMsg({ t: 'interact', tx: t.tx, ty: t.ty });
  }

  // ---------- Update ----------
  function update(dt) {
    let mx = 0;
    let my = 0;
    if (!chatting) {
      if (keys.has('w') || keys.has('arrowup')) my -= 1;
      if (keys.has('s') || keys.has('arrowdown')) my += 1;
      if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
      if (keys.has('d') || keys.has('arrowright')) mx += 1;
    }
    if (touchMove && Math.hypot(touchMove.dx, touchMove.dy) > 12) {
      mx = touchMove.dx;
      my = touchMove.dy;
    }
    const len = Math.hypot(mx, my);
    if (len > 0 && !me.downed) {
      const sp = SPEED * world.speedAt(me.x, me.y) * dt;
      const np = world.move(me.x, me.y, (mx / len) * sp, (my / len) * sp, PLAYER_R, mods);
      me.x = np.x;
      me.y = np.y;
      me.walk = (me.walk || 0) + dt * 10;
    }
    const mw = mouseWorld();
    me.dir = Math.atan2(mw.y - me.y, mw.x - me.x);

    const now = performance.now();
    if (mouse.down && !buildMode && !me.downed && now - lastAttack > 360) {
      lastAttack = now;
      me.swingT = 0.2;
      sendMsg({ t: 'attack', angle: me.dir });
    }
    me.swingT = Math.max(0, me.swingT - dt);

    const target = findInteractable();
    const reviving = keys.has('e') && target && target.revive ? target.revive : null;
    if (now - lastSend > 50) {
      lastSend = now;
      sendMsg({ t: 'pos', x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, dir: me.dir, reviving });
    }
    const hint = $('hint');
    if (target && !me.downed && !buildMode) {
      hint.textContent = target.label;
      hint.style.display = 'block';
    } else hint.style.display = 'none';

    const lerp = 1 - Math.pow(0.0001, dt);
    for (const o of others.values()) {
      if (Math.hypot(o.tx - o.x, o.ty - o.y) > 400) {
        o.x = o.tx;
        o.y = o.ty;
      }
      const moving = Math.hypot(o.tx - o.x, o.ty - o.y) > 1;
      o.x += (o.tx - o.x) * lerp;
      o.y += (o.ty - o.y) * lerp;
      if (moving) o.walk = (o.walk || 0) + dt * 10;
      o.swingT = Math.max(0, (o.swingT || 0) - dt);
    }
    for (const e of enemies.values()) {
      e.x += (e.tx - e.x) * lerp;
      e.y += (e.ty - e.y) * lerp;
    }
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.life -= dt;
      f.x += (f.vx || 0) * dt;
      f.y += (f.vy || 0) * dt;
      if (f.vy !== undefined && f.kind === 'spark') f.vy += 300 * dt;
      if (f.life <= 0) fx.splice(i, 1);
    }

    cam.x = me.x - W / 2;
    cam.y = me.y - H / 2;
  }

  function spawnFx(m) {
    if (m.kind === 'hit' || m.kind === 'hurt') {
      fx.push({ kind: 'text', x: m.x + (Math.random() - 0.5) * 16, y: m.y - 20, vy: -40, life: 0.8, text: (m.kind === 'hurt' ? '-' : '') + m.n, color: m.kind === 'hurt' ? '#ff5d73' : '#fff' });
    }
    const n = m.kind === 'die' ? (m.enemy === 'guardian' ? 60 : 16) : 5;
    const color = { slime: '#7cff6b', wolf: '#c9c9c9', wraith: '#c78bff', guardian: '#ffd23f' }[m.enemy] || (m.kind === 'hurt' ? '#ff5d73' : '#fff6c2');
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * (m.enemy === 'guardian' ? 260 : 140);
      fx.push({ kind: 'spark', x: m.x, y: m.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.4 + Math.random() * 0.4, color });
    }
  }

  // ---------- Rendering: terrain chunks ----------
  const TILE_COLORS = {
    [T.DEEP]: [29, 78, 137],
    [T.WATER]: [52, 132, 196],
    [T.SAND]: [232, 212, 154],
    [T.GRASS]: [98, 176, 76],
    [T.FOREST]: [66, 140, 62],
    [T.HILL]: [140, 152, 92],
    [T.MOUNTAIN]: [122, 116, 112],
    [T.SNOW]: [218, 226, 236],
  };

  function getChunk(cx, cy) {
    const key = cx + ',' + cy;
    let c = chunks.get(key);
    if (c) return c;
    if (chunks.size > 160) chunks.clear();
    const cv = document.createElement('canvas');
    cv.width = cv.height = CHUNK * TILE;
    const g = cv.getContext('2d');
    const objs = [];
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const tx = cx * CHUNK + i;
        const ty = cy * CHUNK + j;
        const t = world.tileAt(tx, ty);
        const [r, gg, b] = TILE_COLORS[t];
        const v = 0.93 + world.hash(tx, ty, 41) * 0.12;
        g.fillStyle = `rgb(${r * v | 0},${gg * v | 0},${b * v | 0})`;
        g.fillRect(i * TILE, j * TILE, TILE, TILE);
        // Soft shoreline / edge shading toward lower terrain.
        const below = world.tileAt(tx, ty + 1);
        if (below < t && (t === T.MOUNTAIN || t === T.SNOW || t === T.HILL)) {
          g.fillStyle = 'rgba(0,0,0,0.18)';
          g.fillRect(i * TILE, j * TILE + TILE - 6, TILE, 6);
        }
        if (t === T.SAND && below <= T.WATER) {
          g.fillStyle = 'rgba(255,255,255,0.35)';
          g.fillRect(i * TILE, j * TILE + TILE - 3, TILE, 3);
        }
        // Little details.
        const h = world.hash(tx, ty, 9);
        if ((t === T.GRASS || t === T.FOREST) && h < 0.4) {
          g.fillStyle = 'rgba(30,80,30,0.35)';
          for (let k = 0; k < 3; k++) {
            const px = i * TILE + world.hash(tx, ty, 10 + k) * 28 + 2;
            const py = j * TILE + world.hash(tx, ty, 20 + k) * 28 + 2;
            g.fillRect(px, py, 2, 4);
          }
        } else if (t === T.GRASS && h < 0.46) {
          g.fillStyle = ['#ffe066', '#ff8fab', '#ffffff'][Math.floor(h * 100) % 3];
          g.beginPath();
          g.arc(i * TILE + 10 + h * 20, j * TILE + 12 + h * 10, 2.2, 0, 6.3);
          g.fill();
        } else if ((t === T.MOUNTAIN || t === T.HILL) && h < 0.2) {
          g.fillStyle = 'rgba(0,0,0,0.12)';
          g.fillRect(i * TILE + 6 + h * 40, j * TILE + 8, 6, 3);
        } else if (t === T.DEEP && h < 0.05) {
          g.strokeStyle = 'rgba(255,255,255,0.15)';
          g.beginPath();
          g.moveTo(i * TILE + 6, j * TILE + 16);
          g.quadraticCurveTo(i * TILE + 16, j * TILE + 10, i * TILE + 26, j * TILE + 16);
          g.stroke();
        }
        const o = world.objectAt(tx, ty);
        if (o !== O.NONE) objs.push([tx, ty, o]);
      }
    }
    c = { canvas: cv, objs };
    chunks.set(key, c);
    return c;
  }

  // ---------- Rendering: sprites ----------
  function drawTree(x, y, tx, ty) {
    const s = 0.9 + world.hash(tx, ty, 5) * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 15 * s, 6, 0, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(x - 3, y - 2, 6, 14);
    const sway = Math.sin(performance.now() / 900 + tx) * 1.2;
    ctx.fillStyle = '#2d6b2a';
    ctx.beginPath();
    ctx.arc(x + sway, y - 10 * s, 16 * s, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = '#3f8f39';
    ctx.beginPath();
    ctx.arc(x - 4 + sway, y - 14 * s, 10 * s, 0, 6.3);
    ctx.fill();
  }

  function drawStump(x, y) {
    ctx.fillStyle = '#6b4423';
    ctx.beginPath();
    ctx.ellipse(x, y + 6, 6, 4, 0, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = '#c49a6c';
    ctx.beginPath();
    ctx.ellipse(x, y + 4, 5, 3, 0, 0, 6.3);
    ctx.fill();
  }

  function drawRock(x, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 14, 5, 0, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = '#8d8a86';
    ctx.beginPath();
    ctx.moveTo(x - 14, y + 10);
    ctx.lineTo(x - 10, y - 6);
    ctx.lineTo(x + 2, y - 11);
    ctx.lineTo(x + 13, y - 3);
    ctx.lineTo(x + 14, y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b3afa9';
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 4);
    ctx.lineTo(x + 2, y - 9);
    ctx.lineTo(x + 4, y);
    ctx.closePath();
    ctx.fill();
  }

  function drawBush(x, y, picked) {
    ctx.fillStyle = '#2f7a34';
    ctx.beginPath();
    ctx.arc(x - 5, y + 4, 8, 0, 6.3);
    ctx.arc(x + 5, y + 4, 8, 0, 6.3);
    ctx.arc(x, y - 2, 8, 0, 6.3);
    ctx.fill();
    if (!picked) {
      ctx.fillStyle = '#e63950';
      for (const [dx, dy] of [[-5, 1], [4, -2], [2, 6], [-1, -5]]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 2.2, 0, 6.3);
        ctx.fill();
      }
    }
  }

  function drawChest(x, y, open) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x - 12, y + 8, 24, 4);
    ctx.fillStyle = open ? '#5a3b1d' : '#8b5a2b';
    ctx.fillRect(x - 12, y - 4, 24, 14);
    ctx.fillStyle = open ? '#3b2512' : '#a86d35';
    ctx.fillRect(x - 12, y - 10, 24, open ? 4 : 8);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(x - 12, y - 3, 24, 2);
    if (!open) {
      ctx.fillRect(x - 2, y - 4, 4, 6);
      const glint = (Math.sin(performance.now() / 300 + x) + 1) / 2;
      ctx.fillStyle = `rgba(255,240,150,${glint * 0.8})`;
      ctx.fillRect(x + 6, y - 9, 2, 2);
    }
  }

  function drawShrine(x, y, state) {
    const t = performance.now() / 1000;
    const glow = state === 'cleansed' ? '#4dd2ff' : state === 'active' ? '#ff4d6d' : '#c78bff';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + 14, 20, 7, 0, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = '#5b5866';
    ctx.fillRect(x - 18, y + 4, 36, 10);
    ctx.fillStyle = '#76738a';
    ctx.fillRect(x - 10, y - 30, 20, 36);
    ctx.fillStyle = '#8f8ca3';
    ctx.fillRect(x - 13, y - 34, 26, 6);
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 14 + Math.sin(t * 3) * 6;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(x, y - 24);
    ctx.lineTo(x + 5, y - 14);
    ctx.lineTo(x, y - 4);
    ctx.lineTo(x - 5, y - 14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCampfire(x, y) {
    const t = performance.now() / 1000;
    ctx.fillStyle = '#5a3b1d';
    ctx.save();
    ctx.translate(x, y + 6);
    ctx.rotate(0.4);
    ctx.fillRect(-12, -3, 24, 6);
    ctx.rotate(-0.8);
    ctx.fillRect(-12, -3, 24, 6);
    ctx.restore();
    for (let i = 0; i < 3; i++) {
      const f = Math.sin(t * 9 + i * 2) * 2;
      ctx.fillStyle = ['#ff4d1a', '#ff9f1a', '#ffe066'][i];
      ctx.beginPath();
      ctx.moveTo(x - 8 + i * 3, y + 4);
      ctx.quadraticCurveTo(x + f, y - 18 + i * 5, x + 8 - i * 3, y + 4);
      ctx.fill();
    }
  }

  function drawWall(x, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x - 16, y + 12, 32, 6);
    ctx.fillStyle = '#7d7a76';
    ctx.fillRect(x - 16, y - 20, 32, 34);
    ctx.fillStyle = '#9b9893';
    ctx.fillRect(x - 16, y - 20, 32, 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 16, y - 2);
    ctx.lineTo(x + 16, y - 2);
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x, y - 2);
    ctx.moveTo(x - 8, y - 2);
    ctx.lineTo(x - 8, y + 14);
    ctx.moveTo(x + 8, y - 2);
    ctx.lineTo(x + 8, y + 14);
    ctx.stroke();
  }

  function drawPlayer(p, isMe) {
    const { x, y } = p;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + 11, 11, 4, 0, 0, 6.3);
    ctx.fill();
    if (p.downed) {
      ctx.fillStyle = '#777';
      ctx.beginPath();
      ctx.ellipse(x, y + 4, 14, 8, 0, 0, 6.3);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(x, y + 4, 10, 5, 0, 0, 6.3);
      ctx.fill();
      // Revive progress ring + bleed-out timer.
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(x, y - 20, 12, 0, 6.3);
      ctx.stroke();
      ctx.strokeStyle = '#7cff6b';
      ctx.beginPath();
      ctx.arc(x, y - 20, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (p.rp || 0));
      ctx.stroke();
      ctx.fillStyle = '#ff5d73';
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('+', x, y - 16);
      ctx.fillText(`${Math.ceil((p.bleed || 0) * 30)}s`, x, y - 36);
      return;
    }
    const bob = Math.sin(p.walk || 0) * 1.5;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(x, y - 2 + bob, 11, 0, 6.3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Eyes face the aim direction.
    const ex = Math.cos(p.dir || 0) * 4;
    const ey = Math.sin(p.dir || 0) * 3;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + ex - 3, y - 4 + ey + bob, 3, 0, 6.3);
    ctx.arc(x + ex + 3, y - 4 + ey + bob, 3, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(x + ex * 1.3 - 3, y - 4 + ey * 1.3 + bob, 1.4, 0, 6.3);
    ctx.arc(x + ex * 1.3 + 3, y - 4 + ey * 1.3 + bob, 1.4, 0, 6.3);
    ctx.fill();
    // Sword.
    const swing = (p.swingT || 0) / 0.2;
    const a = (p.dir || 0) + (swing > 0 ? (swing - 0.5) * 2.4 : 0.9);
    const len = 22 + (p.sword || 1) * 1.2;
    ctx.save();
    ctx.translate(x, y - 2 + bob);
    ctx.rotate(a);
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(10, -2, 6, 4);
    ctx.fillStyle = (p.sword || 1) >= 5 ? '#ffd23f' : '#dfe6ee';
    ctx.fillRect(16, -2, len - 6, 4);
    ctx.restore();
    if (swing > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${swing * 0.7})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y - 2, 34, (p.dir || 0) - 1.1, (p.dir || 0) + 1.1);
      ctx.stroke();
    }
    // Name + HP.
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(p.name || '', x + 1, y - 25);
    ctx.fillStyle = isMe ? '#fff' : p.color;
    ctx.fillText(p.name || '', x, y - 26);
    if (!isMe) {
      ctx.fillStyle = '#3a1a22';
      ctx.fillRect(x - 14, y - 21, 28, 3);
      ctx.fillStyle = '#ff5d73';
      ctx.fillRect(x - 14, y - 21, 28 * (p.hp / 100), 3);
    }
  }

  function drawEnemy(e) {
    const t = performance.now() / 1000;
    const { x, y } = e;
    const flash = e.f;
    ctx.save();
    if (e.type === 'slime') {
      const sq = Math.sin(t * 8 + e.id) * 0.15;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(x, y + 9, 12, 4, 0, 0, 6.3);
      ctx.fill();
      ctx.fillStyle = flash ? '#fff' : '#5ed64a';
      ctx.beginPath();
      ctx.ellipse(x, y + 2 - sq * 6, 13 * (1 + sq), 11 * (1 - sq), 0, Math.PI, 0);
      ctx.lineTo(x + 13 * (1 + sq), y + 8);
      ctx.lineTo(x - 13 * (1 + sq), y + 8);
      ctx.fill();
      ctx.fillStyle = '#123';
      ctx.fillRect(x - 5, y - 2, 3, 4);
      ctx.fillRect(x + 2, y - 2, 3, 4);
    } else if (e.type === 'wolf') {
      const run = Math.sin(t * 14 + e.id) * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(x, y + 9, 15, 4, 0, 0, 6.3);
      ctx.fill();
      ctx.fillStyle = flash ? '#fff' : '#5c5f6b';
      ctx.fillRect(x - 10, y + 2 + run, 3, 7);
      ctx.fillRect(x + 7, y + 2 - run, 3, 7);
      ctx.beginPath();
      ctx.ellipse(x, y, 15, 8, 0, 0, 6.3);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 11, y - 5, 7, 0, 6.3);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 8, y - 10);
      ctx.lineTo(x + 10, y - 17);
      ctx.lineTo(x + 13, y - 10);
      ctx.fill();
      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(x + 13, y - 7, 2, 2);
    } else if (e.type === 'wraith') {
      const fl = Math.sin(t * 3 + e.id) * 4;
      ctx.globalAlpha = 0.8;
      ctx.shadowColor = '#c78bff';
      ctx.shadowBlur = 16;
      ctx.fillStyle = flash ? '#fff' : '#8f6bd6';
      ctx.beginPath();
      ctx.arc(x, y - 8 + fl, 12, Math.PI, 0);
      for (let i = 0; i <= 4; i++) ctx.lineTo(x + 12 - i * 6, y + 10 + fl + (i % 2 ? -4 : 0));
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff6c2';
      ctx.fillRect(x - 6, y - 10 + fl, 3, 3);
      ctx.fillRect(x + 3, y - 10 + fl, 3, 3);
    } else if (e.type === 'guardian') {
      const st = Math.sin(t * 4) * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(x, y + 24, 30, 9, 0, 0, 6.3);
      ctx.fill();
      ctx.fillStyle = flash ? '#fff' : '#6d6a7c';
      ctx.fillRect(x - 22, y - 26 + st, 44, 44);
      ctx.fillRect(x - 34, y - 18 - st, 12, 30);
      ctx.fillRect(x + 22, y - 18 + st, 12, 30);
      ctx.fillRect(x - 16, y + 16, 12, 10);
      ctx.fillRect(x + 4, y + 16, 12, 10);
      ctx.shadowColor = '#ff4d6d';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#ff4d6d';
      ctx.fillRect(x - 12, y - 16 + st, 6, 6);
      ctx.fillRect(x + 6, y - 16 + st, 6, 6);
      ctx.beginPath();
      ctx.arc(x, y + 2 + st, 6, 0, 6.3);
      ctx.fill();
    }
    ctx.restore();
    if (e.type !== 'guardian' && e.hp < 1) {
      ctx.fillStyle = '#300';
      ctx.fillRect(x - 12, y - 22, 24, 3);
      ctx.fillStyle = '#ff5d73';
      ctx.fillRect(x - 12, y - 22, 24 * e.hp, 3);
    }
  }

  // ---------- Rendering: frame ----------
  function darkness() {
    const p = dayPhase();
    const dusk = nightStart - 0.06;
    if (p < 0.05) return 0.75 * (1 - p / 0.05);
    if (p < dusk) return 0;
    if (p < nightStart + 0.02) return 0.75 * ((p - dusk) / (nightStart + 0.02 - dusk));
    return 0.75;
  }

  function dayPhase() {
    const t = serverTime + (performance.now() - timeSyncedAt) / 1000;
    return (t % dayLength) / dayLength;
  }

  const darkCanvas = document.createElement('canvas');
  const darkCtx = darkCanvas.getContext('2d');

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1d4e89';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));

    const cs = CHUNK * TILE;
    const c0x = Math.floor(cam.x / cs);
    const c0y = Math.floor(cam.y / cs);
    const c1x = Math.floor((cam.x + W) / cs);
    const c1y = Math.floor((cam.y + H) / cs);
    const drawables = [];
    for (let cy = c0y; cy <= c1y + 1; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const c = getChunk(cx, cy);
        if (cy <= c1y) ctx.drawImage(c.canvas, cx * cs, cy * cs);
        for (const [tx, ty, o] of c.objs) {
          const px = tx * TILE + 16;
          const py = ty * TILE + 16;
          if (px < cam.x - 40 || px > cam.x + W + 40 || py < cam.y - 20 || py > cam.y + H + 60) continue;
          drawables.push({ y: py + 12, o, tx, ty, px, py });
        }
      }
    }
    for (const [key, s] of mods.structures) {
      const [tx, ty] = key.split(',').map(Number);
      const px = tx * TILE + 16;
      const py = ty * TILE + 16;
      if (px < cam.x - 40 || px > cam.x + W + 40 || py < cam.y - 40 || py > cam.y + H + 60) continue;
      drawables.push({ y: py + 12, s: s.kind, px, py });
    }
    for (const o of others.values()) drawables.push({ y: o.y + 10, player: o });
    drawables.push({ y: me.y + 10, player: me, isMe: true });
    for (const e of enemies.values()) drawables.push({ y: e.y + 10, enemy: e });
    drawables.sort((a, b) => a.y - b.y);

    for (const d of drawables) {
      if (d.player) drawPlayer(d.player, d.isMe);
      else if (d.enemy) drawEnemy(d.enemy);
      else if (d.s === 'campfire') drawCampfire(d.px, d.py);
      else if (d.s === 'wall') drawWall(d.px, d.py);
      else {
        const key = d.tx + ',' + d.ty;
        const gone = mods.removed.has(key);
        if (d.o === O.TREE) gone ? drawStump(d.px, d.py) : drawTree(d.px, d.py, d.tx, d.ty);
        else if (d.o === O.ROCK) { if (!gone) drawRock(d.px, d.py); }
        else if (d.o === O.BUSH) drawBush(d.px, d.py, gone);
        else if (d.o === O.CHEST) drawChest(d.px, d.py, gone);
        else if (d.o === O.SHRINE) drawShrine(d.px, d.py, shrines.get(key));
      }
    }

    // Build preview.
    if (buildMode) {
      const [tx, ty] = mouseTile();
      const ok = canBuildAt(tx, ty);
      ctx.fillStyle = ok ? 'rgba(124,255,107,0.3)' : 'rgba(255,77,109,0.3)';
      ctx.strokeStyle = ok ? '#7cff6b' : '#ff4d6d';
      ctx.lineWidth = 2;
      ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      ctx.strokeRect(tx * TILE, ty * TILE, TILE, TILE);
    }

    for (const f of fx) {
      if (f.kind === 'text') {
        ctx.globalAlpha = Math.min(1, f.life * 2);
        ctx.font = 'bold 14px system-ui';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#000';
        ctx.fillText(f.text, f.x + 1, f.y + 1);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
      } else {
        ctx.globalAlpha = Math.min(1, f.life * 3);
        ctx.fillStyle = f.color;
        ctx.fillRect(f.x - 2, f.y - 2, 4, 4);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    renderDarkness();
    renderOffscreenArrows();
    renderBossBar();
  }

  function canBuildAt(tx, ty) {
    const cx = tx * TILE + 16;
    const cy = ty * TILE + 16;
    if (Math.hypot(cx - me.x, cy - me.y) > 120) return false;
    const key = tx + ',' + ty;
    if (mods.structures.has(key) || world.solidAt(tx, ty, mods)) return false;
    if (world.tileAt(tx, ty) === T.WATER) return false;
    if (world.objectAt(tx, ty) !== O.NONE && !mods.removed.has(key)) return false;
    const cost = buildMode === 'campfire' ? me.inv.wood >= 5 : me.inv.stone >= 2;
    return cost;
  }

  function renderDarkness() {
    const a = darkness();
    if (a <= 0.01) return;
    if (darkCanvas.width !== W || darkCanvas.height !== H) {
      darkCanvas.width = W;
      darkCanvas.height = H;
    }
    const g = darkCtx;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.fillStyle = `rgba(8,10,35,${a})`;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    const light = (x, y, r) => {
      const sx = x - cam.x;
      const sy = y - cam.y;
      if (sx < -r || sy < -r || sx > W + r || sy > H + r) return;
      const grad = g.createRadialGradient(sx, sy, 0, sx, sy, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.6, 'rgba(0,0,0,0.6)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(sx, sy, r, 0, 6.3);
      g.fill();
    };
    light(me.x, me.y, 170);
    for (const o of others.values()) light(o.x, o.y, 150);
    const flick = Math.sin(performance.now() / 120) * 8;
    for (const [key, s] of mods.structures) {
      if (s.kind !== 'campfire') continue;
      const [tx, ty] = key.split(',').map(Number);
      light(tx * TILE + 16, ty * TILE + 16, 230 + flick);
    }
    ctx.drawImage(darkCanvas, 0, 0, W, H);
  }

  function renderOffscreenArrows() {
    for (const o of others.values()) {
      const sx = o.x - cam.x;
      const sy = o.y - cam.y;
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      const a = Math.atan2(sy - H / 2, sx - W / 2);
      const r = Math.min(W, H) / 2 - 30;
      const ax = W / 2 + Math.cos(a) * r;
      const ay = H / 2 + Math.sin(a) * r;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(a);
      ctx.fillStyle = o.downed ? '#ff4d6d' : o.color;
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-8, -8);
      ctx.lineTo(-8, 8);
      ctx.fill();
      ctx.restore();
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      const dist = Math.round(Math.hypot(o.x - me.x, o.y - me.y) / TILE);
      ctx.fillText(`${o.name}${o.downed ? ' (DOWN!)' : ''} ${dist}m`, ax - Math.cos(a) * 24, ay - Math.sin(a) * 24);
    }
  }

  function renderBossBar() {
    let boss = null;
    for (const e of enemies.values()) if (e.type === 'guardian') boss = e;
    if (!boss) return;
    const w = Math.min(420, W - 40);
    const x = (W - w) / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 4, 14, w + 8, 26);
    ctx.fillStyle = '#3a1a22';
    ctx.fillRect(x, 26, w, 10);
    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(x, 26, w * Math.max(0, boss.hp), 10);
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('ANCIENT GUARDIAN', W / 2, 24);
  }

  // ---------- Minimap ----------
  let lastMini = 0;
  const MINI = 120;
  const miniImg = mctx.createImageData(MINI, MINI);
  const miniBase = document.createElement('canvas');
  miniBase.width = miniBase.height = MINI;
  let miniOrigin = { x: 0, y: 0 };
  let miniShrines = [];

  function renderMinimap(now) {
    if (now - lastMini > 400) {
      lastMini = now;
      const ox = Math.floor(me.x / TILE) - MINI / 2;
      const oy = Math.floor(me.y / TILE) - MINI / 2;
      miniOrigin = { x: ox, y: oy };
      miniShrines = [];
      const d = miniImg.data;
      for (let j = 0; j < MINI; j++) {
        for (let i = 0; i < MINI; i++) {
          const tx = ox + i;
          const ty = oy + j;
          const t = world.tileAt(tx, ty);
          let [r, g, b] = TILE_COLORS[t];
          const o = world.objectAt(tx, ty);
          if (o === O.TREE && !mods.removed.has(tx + ',' + ty)) [r, g, b] = [40, 100, 40];
          else if (o === O.SHRINE) miniShrines.push([tx, ty]);
          const idx = (j * MINI + i) * 4;
          d[idx] = r;
          d[idx + 1] = g;
          d[idx + 2] = b;
          d[idx + 3] = 255;
        }
      }
      miniBase.getContext('2d').putImageData(miniImg, 0, 0);
    }
    mctx.drawImage(miniBase, 0, 0);
    const dot = (x, y, color, size) => {
      mctx.fillStyle = color;
      mctx.fillRect(x / TILE - miniOrigin.x - size / 2, y / TILE - miniOrigin.y - size / 2, size, size);
    };
    for (const [tx, ty] of miniShrines) {
      const s = shrines.get(tx + ',' + ty);
      dot(tx * TILE + 16, ty * TILE + 16, s === 'cleansed' ? '#4dd2ff' : s === 'active' ? '#ff4d6d' : '#c78bff', 5);
    }
    for (const [key, s] of mods.structures) {
      if (s.kind !== 'campfire') continue;
      const [tx, ty] = key.split(',').map(Number);
      dot(tx * TILE + 16, ty * TILE + 16, '#ff9f1a', 3);
    }
    for (const e of enemies.values()) dot(e.x, e.y, e.type === 'guardian' ? '#ff4d6d' : '#ff9aa8', 2);
    for (const o of others.values()) dot(o.x, o.y, o.color, 4);
    dot(me.x, me.y, '#fff', 4);
  }

  // ---------- HUD ----------
  function updateHud() {
    $('pname').textContent = me.name || 'You';
    $('sword').textContent = me.sword;
    $('hpfill').style.width = Math.max(0, me.hp) + '%';
    $('wood').textContent = me.inv.wood;
    $('stone').textContent = me.inv.stone;
    $('gold').textContent = me.inv.gold;
    $('shrines').textContent = [...shrines.values()].filter((s) => s === 'cleansed').length;
    $('upcost').textContent = me.sword >= 10 ? 'MAX ·' : me.sword * 15;
    const p = dayPhase();
    const day = Math.floor((serverTime) / dayLength) + 1;
    const label = p < 0.05 ? 'Dawn' : p < 0.3 ? 'Morning' : p < 0.45 ? 'Noon' : p < nightStart - 0.06 ? 'Afternoon' : p < nightStart ? 'Dusk' : 'Night 🌙';
    $('clock').textContent = `Day ${day} · ${label} · ${me.kills || 0} kills`;
    $('downed').style.display = me.downed ? 'grid' : 'none';
    if (me.downed) $('downedText').textContent = `You're down! A friend can revive you… (${Math.ceil((me.bleed || 0) * 30)}s)`;
    const party = [{ ...me, id: myId }, ...others.values()];
    $('party').innerHTML = '<b>Party</b>' + party.map((p) =>
      `<div><span style="color:${p.color}">${escapeHtml(p.name || '')}${p.id === myId ? ' (you)' : ''}</span><span>${p.downed ? '💀' : Math.round(p.hp) + '❤'}</span></div>`).join('');
    updateToolbar();
  }

  function updateToolbar() {
    $('slot1').classList.toggle('on', buildMode === 'campfire');
    $('slot2').classList.toggle('on', buildMode === 'wall');
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function addChat(text, from) {
    const div = document.createElement('div');
    if (from) {
      const n = document.createElement('b');
      n.style.color = from.color;
      n.textContent = from.name + ': ';
      div.appendChild(n);
      div.appendChild(document.createTextNode(text));
    } else {
      div.className = 'sys';
      div.textContent = text;
    }
    const log = $('log');
    log.appendChild(div);
    while (log.children.length > 8) log.removeChild(log.firstChild);
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.style.display = 'none'), 1800);
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    renderMinimap(now);
    requestAnimationFrame(frame);
  }
})();
