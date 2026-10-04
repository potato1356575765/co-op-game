// Wildlands game server: serves the client and runs the authoritative
// simulation for enemies, combat, health, resources and world changes.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const World = require('./shared/world');

const PORT = Number(process.env.PORT) || 3000;
const SEED = Number(process.env.SEED) || Math.floor(Math.random() * 1e9);
const TICK_HZ = 20;
const DT = 1 / TICK_HZ;
const { TILE, T, O } = World;
const world = World.create(SEED);
const SPAWN = world.findSpawn();

// Day/night: one full day lasts DAY_LENGTH seconds; t in [0,1), night when t > NIGHT_START.
const DAY_LENGTH = 240;
const NIGHT_START = 0.62;

const PLAYER_MAX_HP = 100;
const REVIVE_TIME = 2.5;
const BLEED_OUT_TIME = 30;
const ATTACK_COOLDOWN = 0.35;
const RESPAWN_TREE = 90;
const RESPAWN_ROCK = 120;
const COLORS = ['#ff5d73', '#4dd2ff', '#ffd23f', '#7cff6b', '#c78bff', '#ff9f40', '#ff6bd6', '#6bffd8'];

const ENEMY_TYPES = {
  slime: { hp: 30, speed: 60, dmg: 8, r: 12, sight: 320, gold: 2, night: false },
  wolf: { hp: 45, speed: 125, dmg: 12, r: 13, sight: 700, gold: 4, night: true },
  wraith: { hp: 70, speed: 90, dmg: 16, r: 14, sight: 800, gold: 8, night: true, ghost: true },
  guardian: { hp: 300, speed: 70, dmg: 18, r: 26, sight: 900, gold: 0, boss: true },
};

const BUILDS = {
  campfire: { cost: { wood: 5 } },
  wall: { cost: { stone: 2 } },
};

// ---- World modifications (shared by everyone) ----
const mods = {
  removed: new Map(), // "tx,ty" -> respawn timestamp (ms) or Infinity
  structures: new Map(), // "tx,ty" -> { kind }
};
const shrines = new Map(); // "tx,ty" -> 'active' | 'cleansed'

const players = new Map();
const enemies = new Map();
let nextId = 1;
let worldTime = (Number(process.env.START_PHASE) || 0.2) * DAY_LENGTH; // start in the morning

const dayPhase = () => (worldTime % DAY_LENGTH) / DAY_LENGTH;
const isNight = () => dayPhase() > NIGHT_START;
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const tileOf = (x, y) => [Math.floor(x / TILE), Math.floor(y / TILE)];

// ---- Static file server ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
const STATIC = { '/shared/world.js': path.join(__dirname, 'shared', 'world.js') };

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = STATIC[urlPath] || path.join(__dirname, 'public', path.normalize(urlPath));
  if (!file.startsWith(path.join(__dirname, 'public')) && !STATIC[urlPath]) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---- Networking ----
const wss = new WebSocketServer({ server });

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(data);
}

function chat(text, from = null) {
  broadcast({ t: 'chat', from, text });
}

function modSnapshot() {
  return {
    removed: [...mods.removed.keys()],
    structures: [...mods.structures.entries()],
    shrines: [...shrines.entries()],
  };
}

wss.on('connection', (ws) => {
  let player = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!player) {
      if (msg.t !== 'join') return;
      const id = nextId++;
      const name = String(msg.name || 'Wanderer').replace(/[^\w \-]/g, '').slice(0, 16) || 'Wanderer';
      player = {
        id,
        ws,
        name,
        color: COLORS[(id - 1) % COLORS.length],
        x: SPAWN.x + (Math.random() - 0.5) * 40,
        y: SPAWN.y + (Math.random() - 0.5) * 40,
        dir: 0,
        hp: PLAYER_MAX_HP,
        downed: false,
        downedFor: 0,
        reviveProgress: 0,
        reviving: null,
        inv: { wood: 0, stone: 0, gold: 0 },
        sword: 1,
        lastAttack: 0,
        lastHurt: 0,
        swingAt: 0,
        kills: 0,
      };
      players.set(id, player);
      send(ws, { t: 'welcome', id, seed: SEED, spawn: SPAWN, mods: modSnapshot(), dayLength: DAY_LENGTH, nightStart: NIGHT_START });
      chat(`${name} joined the adventure!`);
      return;
    }
    handle(player, msg);
  });

  ws.on('close', () => {
    if (!player) return;
    players.delete(player.id);
    chat(`${player.name} left.`);
  });
});

function handle(p, msg) {
  const now = Date.now() / 1000;
  switch (msg.t) {
    case 'pos': {
      if (p.downed) return;
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // Trust the client for movement (it's co-op), but reject teleports.
      if ((x - p.x) ** 2 + (y - p.y) ** 2 < 300 * 300) {
        p.x = x;
        p.y = y;
      }
      p.dir = Number(msg.dir) || 0;
      p.reviving = Number.isInteger(msg.reviving) ? msg.reviving : null;
      break;
    }
    case 'attack': {
      if (p.downed || now - p.lastAttack < ATTACK_COOLDOWN) return;
      p.lastAttack = now;
      p.swingAt = now;
      const angle = Number(msg.angle) || 0;
      const reach = 60;
      const dmg = 10 + (p.sword - 1) * 7;
      for (const e of enemies.values()) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > reach + e.r) continue;
        let diff = Math.atan2(dy, dx) - angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) > 1.1 && d > e.r + 10) continue;
        damageEnemy(e, dmg, p, dx / (d || 1), dy / (d || 1));
      }
      break;
    }
    case 'interact': {
      if (p.downed) return;
      const tx = Math.floor(Number(msg.tx));
      const ty = Math.floor(Number(msg.ty));
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
      const cx = tx * TILE + TILE / 2;
      const cy = ty * TILE + TILE / 2;
      if ((cx - p.x) ** 2 + (cy - p.y) ** 2 > 80 * 80) return;
      interact(p, tx, ty);
      break;
    }
    case 'build': {
      if (p.downed) return;
      const spec = BUILDS[msg.kind];
      const tx = Math.floor(Number(msg.tx));
      const ty = Math.floor(Number(msg.ty));
      if (!spec || !Number.isFinite(tx) || !Number.isFinite(ty)) return;
      const key = tx + ',' + ty;
      const cx = tx * TILE + TILE / 2;
      const cy = ty * TILE + TILE / 2;
      if ((cx - p.x) ** 2 + (cy - p.y) ** 2 > 120 * 120) return;
      if (mods.structures.has(key) || world.solidAt(tx, ty, mods)) return;
      const t = world.tileAt(tx, ty);
      if (t === T.WATER) return;
      const o = world.objectAt(tx, ty);
      if (o !== O.NONE && !mods.removed.has(key)) return;
      // Don't wall anyone in.
      if (msg.kind === 'wall') {
        for (const other of players.values()) {
          if (Math.abs(other.x - cx) < TILE / 2 + 12 && Math.abs(other.y - cy) < TILE / 2 + 12) return;
        }
      }
      for (const [res, n] of Object.entries(spec.cost)) if (p.inv[res] < n) return;
      for (const [res, n] of Object.entries(spec.cost)) p.inv[res] -= n;
      mods.structures.set(key, { kind: msg.kind, by: p.name });
      broadcast({ t: 'struct', key, s: mods.structures.get(key) });
      break;
    }
    case 'demolish': {
      const key = `${Math.floor(msg.tx)},${Math.floor(msg.ty)}`;
      const s = mods.structures.get(key);
      if (!s) return;
      const [tx, ty] = key.split(',').map(Number);
      if ((tx * TILE + 16 - p.x) ** 2 + (ty * TILE + 16 - p.y) ** 2 > 120 * 120) return;
      mods.structures.delete(key);
      if (s.kind === 'campfire') p.inv.wood += 2;
      else p.inv.stone += 1;
      broadcast({ t: 'struct', key, s: null });
      break;
    }
    case 'upgrade': {
      const cost = p.sword * 15;
      if (p.inv.gold < cost || p.sword >= 10) return;
      p.inv.gold -= cost;
      p.sword++;
      send(p.ws, { t: 'toast', text: `Sword upgraded to level ${p.sword}!` });
      break;
    }
    case 'chat': {
      const text = String(msg.text || '').slice(0, 140).trim();
      if (text) chat(text, { name: p.name, color: p.color });
      break;
    }
    case 'ping':
      send(p.ws, { t: 'pong', at: msg.at });
      break;
  }
}

function interact(p, tx, ty) {
  const key = tx + ',' + ty;
  const o = world.objectAt(tx, ty);
  if (o === O.SHRINE) {
    if (shrines.has(key)) return;
    shrines.set(key, 'active');
    broadcast({ t: 'shrine', key, state: 'active' });
    chat(`${p.name} awakened an Ancient Guardian! Gather your party!`);
    const spot = freeTileNear(tx, ty + 2) || [tx, ty + 1];
    spawnEnemy('guardian', spot[0] * TILE + TILE / 2, spot[1] * TILE + TILE / 2, key);
    return;
  }
  if (mods.removed.has(key)) return;
  const now = Date.now();
  if (o === O.TREE) {
    p.inv.wood += 3;
    mods.removed.set(key, now + RESPAWN_TREE * 1000);
  } else if (o === O.ROCK) {
    p.inv.stone += 3;
    mods.removed.set(key, now + RESPAWN_ROCK * 1000);
  } else if (o === O.BUSH) {
    p.hp = Math.min(PLAYER_MAX_HP, p.hp + 15);
    mods.removed.set(key, now + RESPAWN_TREE * 1000);
    send(p.ws, { t: 'toast', text: '+15 HP (berries!)' });
  } else if (o === O.CHEST) {
    const gold = 10 + Math.floor(Math.random() * 25);
    p.inv.gold += gold;
    mods.removed.set(key, Infinity);
    send(p.ws, { t: 'toast', text: `Chest opened: +${gold} gold!` });
  } else {
    return;
  }
  broadcast({ t: 'removed', key, on: true });
}

// ---- Enemies ----
function freeTileNear(tx, ty) {
  for (let r = 0; r < 4; r++) {
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        // Guardians are big, so look for a 2x2 open area.
        const ok = [0, 1].every((a) => [0, 1].every((b) => !world.solidAt(tx + i + a, ty + j + b, mods)));
        if (ok) return [tx + i, ty + j];
      }
    }
  }
  return null;
}

function spawnEnemy(type, x, y, shrine = null) {
  const spec = ENEMY_TYPES[type];
  const id = nextId++;
  // Bosses get tougher the bigger the party.
  const hp = spec.boss ? spec.hp + 150 * Math.max(0, players.size - 1) : spec.hp;
  enemies.set(id, { id, type, x, y, hp, maxHp: hp, r: spec.r, vx: 0, vy: 0, lastHit: 0, wander: Math.random() * 6.28, shrine, flash: 0 });
}

function damageEnemy(e, dmg, p, nx, ny) {
  e.hp -= dmg;
  e.flash = 0.15;
  const kb = ENEMY_TYPES[e.type].boss ? 60 : 220;
  e.vx += nx * kb;
  e.vy += ny * kb;
  broadcast({ t: 'fx', kind: 'hit', x: e.x, y: e.y, n: dmg });
  if (e.hp > 0) return;
  enemies.delete(e.id);
  p.kills++;
  const spec = ENEMY_TYPES[e.type];
  if (spec.gold) p.inv.gold += spec.gold;
  broadcast({ t: 'fx', kind: 'die', x: e.x, y: e.y, enemy: e.type });
  if (e.shrine) {
    shrines.set(e.shrine, 'cleansed');
    broadcast({ t: 'shrine', key: e.shrine, state: 'cleansed' });
    for (const other of players.values()) other.inv.gold += 50;
    const count = [...shrines.values()].filter((s) => s === 'cleansed').length;
    chat(`The Guardian has fallen! Shrine cleansed (${count} total). Everyone gets +50 gold!`);
  }
}

function hurtPlayer(p, dmg) {
  if (p.downed) return;
  // Campfires give a little protection.
  p.hp -= dmg;
  p.lastHurt = Date.now() / 1000;
  if (p.hp <= 0) {
    p.hp = 0;
    p.downed = true;
    p.downedFor = 0;
    p.reviveProgress = 0;
    chat(`${p.name} is down! Hold E next to them to revive!`);
  }
}

function nearCampfire(x, y, radius) {
  const [tx, ty] = tileOf(x, y);
  const r = Math.ceil(radius / TILE);
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const s = mods.structures.get(`${tx + i},${ty + j}`);
      if (!s || s.kind !== 'campfire') continue;
      const cx = (tx + i) * TILE + TILE / 2;
      const cy = (ty + j) * TILE + TILE / 2;
      if ((cx - x) ** 2 + (cy - y) ** 2 < radius * radius) return true;
    }
  }
  return false;
}

function trySpawnAround(p) {
  const night = isNight();
  const cap = night ? 9 : 4;
  let near = 0;
  for (const e of enemies.values()) if (dist2(e, p) < 900 * 900) near++;
  if (near >= cap) return;
  for (let attempt = 0; attempt < 6; attempt++) {
    const a = Math.random() * Math.PI * 2;
    const d = 450 + Math.random() * 300;
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    const [tx, ty] = tileOf(x, y);
    const t = world.tileAt(tx, ty);
    if (world.solidAt(tx, ty, mods) || t === T.WATER) continue;
    if (nearCampfire(x, y, 200)) continue;
    let tooClose = false;
    for (const o of players.values()) if (dist2(o, { x, y }) < 350 * 350) tooClose = true;
    if (tooClose) continue;
    let type = 'slime';
    if (night) type = Math.random() < 0.25 ? 'wraith' : Math.random() < 0.6 ? 'wolf' : 'slime';
    spawnEnemy(type, x, y);
    return;
  }
}

function updateEnemies() {
  const now = Date.now() / 1000;
  for (const e of enemies.values()) {
    const spec = ENEMY_TYPES[e.type];
    e.flash = Math.max(0, e.flash - DT);

    let target = null;
    let best = spec.sight * spec.sight;
    let nearestAny = Infinity;
    for (const p of players.values()) {
      const d = dist2(e, p);
      nearestAny = Math.min(nearestAny, d);
      if (!p.downed && d < best) {
        best = d;
        target = p;
      }
    }
    if (!spec.boss && nearestAny > 1300 * 1300) {
      enemies.delete(e.id);
      continue;
    }
    // Night creatures burn away at dawn.
    if (spec.night && !isNight() && Math.random() < 0.01) {
      enemies.delete(e.id);
      broadcast({ t: 'fx', kind: 'die', x: e.x, y: e.y, enemy: e.type });
      continue;
    }

    let mx = 0;
    let my = 0;
    if (target) {
      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      mx = dx / d;
      my = dy / d;
      if (d < e.r + 12 && now - e.lastHit > 1) {
        e.lastHit = now;
        hurtPlayer(target, spec.dmg);
        broadcast({ t: 'fx', kind: 'hurt', x: target.x, y: target.y, n: spec.dmg });
      }
    } else {
      e.wander += (Math.random() - 0.5) * 0.4;
      mx = Math.cos(e.wander) * 0.35;
      my = Math.sin(e.wander) * 0.35;
    }

    const sp = spec.speed * (spec.ghost ? 1 : world.speedAt(e.x, e.y));
    let dx = (mx * sp + e.vx) * DT;
    let dy = (my * sp + e.vy) * DT;
    e.vx *= 0.8;
    e.vy *= 0.8;
    // Monsters fear the fire.
    if (!spec.boss && nearCampfire(e.x + dx, e.y + dy, 110)) {
      dx = -mx * sp * DT;
      dy = -my * sp * DT;
    }
    if (spec.ghost) {
      e.x += dx;
      e.y += dy;
    } else {
      const np = world.move(e.x, e.y, dx, dy, Math.min(e.r, 14), mods);
      // Slide around obstacles by picking a new wander direction when stuck.
      if (np.x === e.x && np.y === e.y) e.wander = Math.random() * 6.28;
      e.x = np.x;
      e.y = np.y;
    }
  }
}

function updatePlayers() {
  const now = Date.now() / 1000;
  for (const p of players.values()) {
    if (p.downed) {
      p.downedFor += DT;
      let helped = false;
      for (const o of players.values()) {
        if (o !== p && !o.downed && o.reviving === p.id && dist2(o, p) < 70 * 70) helped = true;
      }
      p.reviveProgress = helped ? p.reviveProgress + DT : Math.max(0, p.reviveProgress - DT * 0.5);
      if (p.reviveProgress >= REVIVE_TIME) {
        p.downed = false;
        p.hp = PLAYER_MAX_HP / 2;
        chat(`${p.name} is back on their feet!`);
      } else if (p.downedFor >= BLEED_OUT_TIME) {
        p.downed = false;
        p.hp = PLAYER_MAX_HP;
        p.x = SPAWN.x;
        p.y = SPAWN.y;
        p.inv.wood = Math.floor(p.inv.wood / 2);
        p.inv.stone = Math.floor(p.inv.stone / 2);
        p.inv.gold = Math.floor(p.inv.gold / 2);
        send(p.ws, { t: 'respawn', x: p.x, y: p.y });
        chat(`${p.name} respawned at camp (and dropped half their loot).`);
      }
      continue;
    }
    const regen = nearCampfire(p.x, p.y, 120) ? 6 : now - p.lastHurt > 5 ? 1.5 : 0;
    p.hp = Math.min(PLAYER_MAX_HP, p.hp + regen * DT);
  }
}

function respawnResources() {
  const now = Date.now();
  for (const [key, at] of mods.removed) {
    if (at > now) continue;
    // Don't regrow a tree on top of someone.
    const [tx, ty] = key.split(',').map(Number);
    let blocked = mods.structures.has(key);
    for (const p of players.values()) {
      if (Math.abs(p.x - (tx * TILE + 16)) < 30 && Math.abs(p.y - (ty * TILE + 16)) < 30) blocked = true;
    }
    if (blocked) continue;
    mods.removed.delete(key);
    broadcast({ t: 'removed', key, on: false });
  }
}

let tickCount = 0;
let wasNight = false;
setInterval(() => {
  tickCount++;
  worldTime += DT;
  updatePlayers();
  updateEnemies();
  if (tickCount % TICK_HZ === 0) {
    for (const p of players.values()) trySpawnAround(p);
    respawnResources();
  }
  const night = isNight();
  if (night !== wasNight) {
    chat(night ? 'Night falls... the wraiths are stirring. Build a campfire!' : 'The sun rises. Night creatures fade away.');
    wasNight = night;
  }
  // Snapshots at 20Hz.
  const ps = [...players.values()].map((p) => ({
    id: p.id, name: p.name, color: p.color, x: Math.round(p.x), y: Math.round(p.y), dir: +p.dir.toFixed(2),
    hp: Math.round(p.hp), downed: p.downed, rp: +(p.reviveProgress / REVIVE_TIME).toFixed(2),
    bleed: +(1 - p.downedFor / BLEED_OUT_TIME).toFixed(2), inv: p.inv, sword: p.sword, kills: p.kills,
    swing: Date.now() / 1000 - p.swingAt < 0.2,
  }));
  for (const p of players.values()) {
    const es = [];
    for (const e of enemies.values()) {
      if (dist2(e, p) > 1100 * 1100) continue;
      es.push({ id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y), hp: e.hp / e.maxHp, f: e.flash > 0 });
    }
    send(p.ws, { t: 'state', time: worldTime, players: ps, enemies: es });
  }
}, 1000 / TICK_HZ);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Wildlands running at http://localhost:${PORT}  (seed ${SEED})`);
    console.log('Share your LAN IP (or deploy it) so friends can join!');
  });
}

module.exports = { server, SEED };
