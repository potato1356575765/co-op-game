// 🍰 Cake Defense — server
// Serves the static client and runs one authoritative simulation per room.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT ?? 3000;
const TICK_RATE = 30;
const SEND_RATE = 20;
const DT = 1 / TICK_RATE;

const W = 1600;
const H = 1000;
const CAKE = { x: W / 2, y: H / 2, r: 56, maxHp: 100 };
const PLAYER_R = 18;
const PLAYER_MAX_HP = 100;
const REVIVE_RANGE = 60;
const REVIVE_TIME = 2;
const AUTO_RESPAWN = 15;
const INTERMISSION = 12;
const GAME_OVER_TIME = 8;

const ENEMY_TYPES = {
  // dmg = hurts players, bite = hurts the cake (per second)
  ant:    { hp: 3,  speed: 75,  r: 12, dmg: 5,  bite: 1, coins: 1, target: 'cake' },
  wasp:   { hp: 2,  speed: 135, r: 11, dmg: 8,  bite: 1, coins: 2, target: 'player' },
  beetle: { hp: 14, speed: 45,  r: 22, dmg: 12, bite: 3, coins: 4, target: 'cake' },
  queen:  { hp: 90, speed: 35,  r: 38, dmg: 25, bite: 8, coins: 25, target: 'cake' },
};

const SHOP = {
  damage:  { label: 'Sprinkle Power', base: 15, step: 10, max: 8 },
  rate:    { label: 'Rapid Fire',     base: 15, step: 10, max: 8 },
  speed:   { label: 'Zoomies',        base: 10, step: 8,  max: 5 },
  repair:  { label: 'Frosting Patch', base: 20, step: 0,  max: Infinity },
};

const COLORS = ['#ff6b9d', '#4dd2ff', '#ffd23f', '#7cff6b', '#c38bff', '#ff9f43', '#ff5e5e', '#5effc8'];

let nextId = 1;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

class Room {
  constructor(id) {
    this.id = id;
    this.players = new Map();
    this.reset();
  }

  reset() {
    this.enemies = [];
    this.bullets = [];
    this.cakeHp = CAKE.maxHp;
    this.coins = 0;
    this.wave = 0;
    this.phase = 'intermission'; // intermission | wave | gameover
    this.timer = 5;
    this.toSpawn = [];
    this.spawnTimer = 0;
    this.upgrades = { damage: 0, rate: 0, speed: 0 };
    this.kills = 0;
    for (const p of this.players.values()) this.respawn(p);
  }

  respawn(p) {
    const a = Math.random() * Math.PI * 2;
    p.x = CAKE.x + Math.cos(a) * 110;
    p.y = CAKE.y + Math.sin(a) * 110;
    p.hp = PLAYER_MAX_HP;
    p.downed = false;
    p.downTimer = 0;
    p.reviveProgress = 0;
    p.cooldown = 0;
  }

  addPlayer(ws, name) {
    const p = {
      id: nextId++,
      ws,
      name: String(name || 'Baker').slice(0, 16) || 'Baker',
      color: COLORS[this.players.size % COLORS.length],
      input: { up: false, down: false, left: false, right: false, ax: 0, ay: 0, shoot: false },
      score: 0,
    };
    this.respawn(p);
    this.players.set(p.id, p);
    return p;
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws.readyState === 1) p.ws.send(data);
    }
  }

  say(text) {
    this.broadcast({ t: 'chat', name: '🍰', text });
  }

  price(item) {
    const s = SHOP[item];
    if (!s) return null;
    const lvl = this.upgrades[item] || 0;
    if (lvl >= s.max) return null;
    return s.base + s.step * lvl;
  }

  buy(p, item) {
    const cost = this.price(item);
    if (cost == null) return;
    if (item === 'repair' && this.cakeHp >= CAKE.maxHp) return;
    if (this.coins < cost) return;
    this.coins -= cost;
    if (item === 'repair') this.cakeHp = Math.min(CAKE.maxHp, this.cakeHp + 25);
    else this.upgrades[item]++;
    this.say(`${p.name} bought ${SHOP[item].label}!`);
  }

  startWave() {
    this.wave++;
    this.phase = 'wave';
    const n = this.players.size;
    const scale = 1 + (n - 1) * 0.6;
    const list = [];
    const ants = Math.round((5 + this.wave * 3) * scale);
    const wasps = this.wave >= 2 ? Math.round((this.wave - 1) * 1.5 * scale) : 0;
    const beetles = this.wave >= 3 ? Math.round((this.wave - 2) * scale) : 0;
    for (let i = 0; i < ants; i++) list.push('ant');
    for (let i = 0; i < wasps; i++) list.push('wasp');
    for (let i = 0; i < beetles; i++) list.push('beetle');
    if (this.wave % 5 === 0) for (let i = 0; i < Math.ceil(n / 2); i++) list.push('queen');
    list.sort(() => Math.random() - 0.5);
    this.toSpawn = list;
    this.spawnTimer = 0;
    this.say(this.wave % 5 === 0 ? `Wave ${this.wave} — 👑 THE QUEEN APPROACHES 👑` : `Wave ${this.wave} incoming!`);
  }

  spawnEnemy(type) {
    const def = ENEMY_TYPES[type];
    const side = Math.floor(Math.random() * 4);
    const m = def.r + 10;
    const pos = [
      { x: rand(0, W), y: -m },
      { x: W + m, y: rand(0, H) },
      { x: rand(0, W), y: H + m },
      { x: -m, y: rand(0, H) },
    ][side];
    const hpScale = 1 + (this.wave - 1) * 0.12;
    this.enemies.push({
      id: nextId++, type, x: pos.x, y: pos.y, r: def.r,
      hp: Math.ceil(def.hp * hpScale), maxHp: Math.ceil(def.hp * hpScale),
      speed: def.speed * rand(0.9, 1.1), biteCd: 0, wobble: Math.random() * 10,
    });
  }

  tick() {
    const players = [...this.players.values()];

    // --- phase logic ---
    if (this.phase === 'intermission') {
      this.timer -= DT;
      if (this.timer <= 0) this.startWave();
    } else if (this.phase === 'wave') {
      this.spawnTimer -= DT;
      if (this.toSpawn.length && this.spawnTimer <= 0) {
        this.spawnEnemy(this.toSpawn.pop());
        this.spawnTimer = Math.max(0.15, 0.9 - this.wave * 0.05);
      }
      if (!this.toSpawn.length && !this.enemies.length) {
        const bonus = 5 + this.wave * 2;
        this.coins += bonus;
        this.phase = 'intermission';
        this.timer = INTERMISSION;
        this.bullets = [];
        for (const p of players) if (p.downed) this.respawn(p);
        this.say(`Wave ${this.wave} cleared! +${bonus} coins. Shop is open 🛒`);
      }
    } else if (this.phase === 'gameover') {
      this.timer -= DT;
      if (this.timer <= 0) this.reset();
      return;
    }

    // --- players ---
    const speed = 230 + this.upgrades.speed * 25;
    const fireCd = Math.max(0.07, 0.3 - this.upgrades.rate * 0.03);
    for (const p of players) {
      if (p.downed) {
        p.downTimer -= DT;
        const helper = players.find(o => o !== p && !o.downed && dist2(o, p) < REVIVE_RANGE ** 2);
        if (helper) {
          p.reviveProgress += DT;
          if (p.reviveProgress >= REVIVE_TIME) {
            const { x, y } = p;
            this.respawn(p);
            p.x = x; p.y = y; p.hp = PLAYER_MAX_HP / 2;
            this.say(`${helper.name} revived ${p.name} 💖`);
          }
        } else {
          p.reviveProgress = Math.max(0, p.reviveProgress - DT);
        }
        if (p.downed && p.downTimer <= 0) this.respawn(p);
        continue;
      }
      const i = p.input;
      let dx = (i.right ? 1 : 0) - (i.left ? 1 : 0);
      let dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);
      const len = Math.hypot(dx, dy);
      if (len) { dx /= len; dy /= len; }
      p.x = clamp(p.x + dx * speed * DT, PLAYER_R, W - PLAYER_R);
      p.y = clamp(p.y + dy * speed * DT, PLAYER_R, H - PLAYER_R);
      // push out of the cake
      const cd = Math.hypot(p.x - CAKE.x, p.y - CAKE.y);
      const minD = CAKE.r + PLAYER_R;
      if (cd < minD && cd > 0) {
        p.x = CAKE.x + ((p.x - CAKE.x) / cd) * minD;
        p.y = CAKE.y + ((p.y - CAKE.y) / cd) * minD;
      }
      p.cooldown -= DT;
      if (i.shoot && p.cooldown <= 0 && this.phase === 'wave') {
        p.cooldown = fireCd;
        const a = Math.atan2(i.ay - p.y, i.ax - p.x);
        const spread = rand(-0.05, 0.05);
        this.bullets.push({
          id: nextId++, owner: p.id, color: p.color,
          x: p.x + Math.cos(a) * PLAYER_R, y: p.y + Math.sin(a) * PLAYER_R,
          vx: Math.cos(a + spread) * 650, vy: Math.sin(a + spread) * 650, life: 1.2,
        });
      }
    }

    // --- bullets ---
    const dmg = 1 + this.upgrades.damage;
    for (const b of this.bullets) {
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      b.life -= DT;
      for (const e of this.enemies) {
        if (e.hp > 0 && dist2(b, e) < (e.r + 5) ** 2) {
          e.hp -= dmg;
          b.life = 0;
          if (e.hp <= 0) {
            this.coins += ENEMY_TYPES[e.type].coins;
            this.kills++;
            const owner = this.players.get(b.owner);
            if (owner) owner.score += ENEMY_TYPES[e.type].coins;
          }
          break;
        }
      }
    }
    this.bullets = this.bullets.filter(b => b.life > 0 && b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20);
    this.enemies = this.enemies.filter(e => e.hp > 0);

    // --- enemies ---
    const alive = players.filter(p => !p.downed);
    for (const e of this.enemies) {
      const def = ENEMY_TYPES[e.type];
      e.biteCd -= DT;
      e.wobble += DT * 8;
      let target = CAKE;
      let targetR = CAKE.r;
      if (def.target === 'player' && alive.length) {
        target = alive.reduce((best, p) => (dist2(p, e) < dist2(best, e) ? p : best));
        targetR = PLAYER_R;
      }
      const d = Math.hypot(target.x - e.x, target.y - e.y);
      if (d > targetR + e.r - 4) {
        const wob = Math.sin(e.wobble) * 0.35;
        const a = Math.atan2(target.y - e.y, target.x - e.x) + wob;
        e.x += Math.cos(a) * e.speed * DT;
        e.y += Math.sin(a) * e.speed * DT;
      } else if (e.biteCd <= 0) {
        e.biteCd = 1;
        if (target === CAKE) this.cakeHp -= def.bite;
        else this.hurt(target, def.dmg);
      }
      // bump players that stand in the way
      for (const p of alive) {
        if (target !== p && e.biteCd <= 0 && dist2(p, e) < (PLAYER_R + e.r) ** 2) {
          e.biteCd = 1;
          this.hurt(p, def.dmg);
        }
      }
    }

    if (this.cakeHp <= 0) {
      this.cakeHp = 0;
      this.phase = 'gameover';
      this.timer = GAME_OVER_TIME;
      this.say(`💀 The cake has been devoured on wave ${this.wave}. ${this.kills} bugs squished.`);
    }
  }

  hurt(p, amount) {
    if (p.downed) return;
    p.hp -= amount;
    if (p.hp <= 0) {
      p.hp = 0;
      p.downed = true;
      p.downTimer = this.players.size === 1 ? 5 : AUTO_RESPAWN;
      p.reviveProgress = 0;
    }
  }

  snapshot() {
    const r = n => Math.round(n);
    return {
      t: 'state',
      phase: this.phase,
      timer: Math.max(0, Math.ceil(this.timer)),
      wave: this.wave,
      cakeHp: Math.ceil(this.cakeHp),
      coins: this.coins,
      kills: this.kills,
      upgrades: this.upgrades,
      prices: Object.fromEntries(Object.keys(SHOP).map(k => [k, this.price(k)])),
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, x: r(p.x), y: r(p.y),
        hp: Math.ceil(p.hp), downed: p.downed, score: p.score,
        revive: p.downed ? +(p.reviveProgress / REVIVE_TIME).toFixed(2) : 0,
        respawn: p.downed ? Math.ceil(p.downTimer) : 0,
        aim: +Math.atan2(p.input.ay - p.y, p.input.ax - p.x).toFixed(2),
      })),
      enemies: this.enemies.map(e => ({ id: e.id, type: e.type, x: r(e.x), y: r(e.y), r: e.r, hp: e.hp / e.maxHp })),
      bullets: this.bullets.map(b => ({ id: b.id, x: r(b.x), y: r(b.y), c: b.color })),
    };
  }
}

const rooms = new Map();

function getRoom(id) {
  const key = String(id || 'lobby').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'lobby';
  if (!rooms.has(key)) rooms.set(key, new Room(key));
  return rooms.get(key);
}

// --- static files ---
const ASSETS = {
  '/': path.join(__dirname, 'public', 'index.html'),
  '/index.html': path.join(__dirname, 'public', 'index.html'),
  '/client.js': path.join(__dirname, 'public', 'client.js'),
  '/icon.png': path.join(__dirname, 'build', 'icon.png'),
  '/vendor/three.module.js': path.join(path.dirname(require.resolve('three')), 'three.module.js'),
};
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ game: 'cake-defense', port: server.address().port, lan: lanAddresses() }));
  }
  const file = ASSETS[pathname];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] });
    res.end(data);
  });
});

// --- websockets ---
// --- bans ---
// Bans live on the host's computer (every player's app is its own server), keyed by the player's
// app ID and IP. CAKE_BANS_FILE sets where they're saved; the desktop app points it at its user data.
const BANS_FILE = process.env.CAKE_BANS_FILE || path.join(__dirname, 'bans.json');
let bans = loadBans();

function loadBans() {
  try { return JSON.parse(fs.readFileSync(BANS_FILE, 'utf8')); } catch { return []; }
}

function saveBans() {
  try { fs.writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2)); } catch (err) { console.error('Could not save bans:', err.message); }
}

function findBan(playerId, ip) {
  const now = Date.now();
  const before = bans.length;
  bans = bans.filter(b => !b.until || b.until > now);
  if (bans.length !== before) saveBans();
  return bans.find(b => b.playerId === playerId || (ip && b.ip === ip)) || null;
}

// Also the hook for Easy Anti-Cheat: call ban(player, 'Easy Anti-Cheat violation') when it flags someone.
function ban(p, reason, durationMs) {
  const entry = {
    playerId: p.playerId, ip: p.ip, name: p.name,
    reason: reason || 'No reason given', at: Date.now(),
    until: durationMs ? Date.now() + durationMs : null,
  };
  bans = bans.filter(b => b.playerId !== p.playerId);
  bans.push(entry);
  saveBans();
  for (const room of rooms.values()) {
    for (const other of room.players.values()) {
      if (other.playerId === p.playerId || (p.ip && other.ip === p.ip)) sendBanned(other.ws, entry);
    }
  }
  return entry;
}

function sendBanned(ws, entry) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'banned', reason: entry.reason, until: entry.until }));
  ws.close(4003, 'Banned');
}

const DURATION = { m: 60e3, h: 3600e3, d: 86400e3 };
function parseDuration(text) {
  const m = /^(\d+)([mhd])$/i.exec(text || '');
  return m ? Number(m[1]) * DURATION[m[2].toLowerCase()] : null;
}

const isLoopback = ip => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);

// Host-only chat commands. Returns the reply to show the host.
function runCommand(room, host, text) {
  const [cmd, target, ...rest] = text.slice(1).split(/\s+/);
  const findPlayer = () => [...room.players.values()].find(p => p.name.toLowerCase() === (target || '').toLowerCase());
  switch ((cmd || '').toLowerCase()) {
    case 'kick': {
      const p = findPlayer();
      if (!p) return `No player named "${target}" here.`;
      if (p === host) return "You can't kick yourself 😅";
      if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'kicked' }));
      p.ws.close(4001, 'Kicked');
      room.say(`${p.name} was kicked.`);
      return null;
    }
    case 'ban': {
      const p = findPlayer();
      if (!p) return `No player named "${target}" here.`;
      if (p === host) return "You can't ban yourself 😅";
      const duration = parseDuration(rest[0]);
      const reason = rest.slice(duration ? 1 : 0).join(' ');
      ban(p, reason, duration);
      room.say(`🔨 ${p.name} was banned${duration ? ` for ${rest[0]}` : ''}.`);
      return null;
    }
    case 'unban': {
      const before = bans.length;
      bans = bans.filter(b => b.name.toLowerCase() !== (target || '').toLowerCase());
      if (bans.length === before) return `No ban for "${target}".`;
      saveBans();
      return `Unbanned ${target}.`;
    }
    case 'bans':
      findBan(null, null); // drop expired ones
      return bans.length ? 'Bans: ' + bans.map(b => `${b.name} (${b.until ? 'until ' + new Date(b.until).toLocaleString() : 'permanent'})`).join(', ') : 'Nobody is banned.';
    default:
      return 'Commands: /kick Name · /ban Name [30m|2h|7d] [reason] · /unban Name · /bans';
  }
}

// Anti-cheat: the server owns all game state (movement speed, fire rate, damage, coins, shop),
// so clients can only send inputs. On top of that we cap message size and rate, and kick floods.
const MAX_MSGS_PER_SEC = 60;
const MSG_BURST = 120;
const CHAT_COOLDOWN = 0.75;

const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  let room = null;
  let player = null;

  let tokens = MSG_BURST;
  let lastRefill = Date.now();
  let lastChat = 0;

  ws.on('message', raw => {
    const now = Date.now();
    tokens = Math.min(MSG_BURST, tokens + ((now - lastRefill) / 1000) * MAX_MSGS_PER_SEC);
    lastRefill = now;
    if (--tokens < 0) {
      ws.close(1008, 'Too many messages');
      return;
    }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join' && !player) {
      const playerId = /^[a-zA-Z0-9-]{8,64}$/.test(msg.playerId) ? msg.playerId : `anon-${Math.random().toString(36).slice(2)}`;
      const existing = findBan(playerId, isLoopback(ip) ? null : ip);
      if (existing) return sendBanned(ws, existing);
      room = getRoom(msg.room);
      player = room.addPlayer(ws, msg.name);
      player.playerId = playerId;
      player.ip = isLoopback(ip) ? null : ip; // never IP-ban the host's own computer
      ws.send(JSON.stringify({ t: 'welcome', id: player.id, room: room.id, w: W, h: H, cake: CAKE, shop: SHOP }));
      room.say(`${player.name} joined the bakery 🧑‍🍳`);
      return;
    }
    if (!player) return;

    if (msg.t === 'input') {
      const i = player.input;
      for (const k of ['up', 'down', 'left', 'right', 'shoot']) i[k] = !!msg[k];
      if (Number.isFinite(msg.ax)) i.ax = clamp(msg.ax, -W, 2 * W);
      if (Number.isFinite(msg.ay)) i.ay = clamp(msg.ay, -H, 2 * H);
    } else if (msg.t === 'buy') {
      room.buy(player, msg.item);
    } else if (msg.t === 'chat') {
      if (now - lastChat < CHAT_COOLDOWN * 1000) return;
      lastChat = now;
      const text = String(msg.text || '').trim().slice(0, 140);
      if (text.startsWith('/')) {
        const reply = isLoopback(ip) ? runCommand(room, player, text) : 'Only the host can use commands.';
        if (reply && ws.readyState === 1) ws.send(JSON.stringify({ t: 'chat', name: '🛡️', text: reply }));
        return;
      }
      if (text) room.broadcast({ t: 'chat', name: player.name, color: player.color, text });
    }
  });

  ws.on('close', () => {
    if (!room || !player) return;
    room.players.delete(player.id);
    if (room.players.size === 0) rooms.delete(room.id);
    else room.say(`${player.name} left`);
  });
});

let ticks = 0;
setInterval(() => {
  ticks++;
  const send = ticks % Math.round(TICK_RATE / SEND_RATE) === 0;
  for (const room of rooms.values()) {
    room.tick();
    if (send) room.broadcast(room.snapshot());
  }
}, 1000 / TICK_RATE);

function start(port = PORT) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

if (require.main === module) {
  start().then(port => console.log(`🍰 Cake Defense running at http://localhost:${port}`));
}

module.exports = { server, rooms, start, lanAddresses, ban };
