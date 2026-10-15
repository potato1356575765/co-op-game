// Spins up the server, connects two players to the same room and checks the basics.
const fs = require('fs');
const os = require('os');
const path = require('path');
const BANS_FILE = path.join(os.tmpdir(), `cake-bans-${process.pid}.json`);
process.env.CAKE_BANS_FILE = BANS_FILE;
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { server, rooms, start, lanAddresses, ban } = require('../server');

const wait = ms => new Promise(r => setTimeout(r, ms));

function connect(port, name, room, { host = 'localhost', playerId = `${name}-test-id` } = {}) {
  const ws = new WebSocket(`ws://${host}:${port}`);
  const client = { ws, states: [], chats: [], welcome: null, banned: null, kicked: false, closeCode: null };
  ws.on('close', code => { client.closeCode = code; });
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.t === 'welcome') client.welcome = msg;
    if (msg.t === 'state') client.states.push(msg);
    if (msg.t === 'chat') client.chats.push(msg);
    if (msg.t === 'banned') client.banned = msg;
    if (msg.t === 'kicked') client.kicked = true;
  });
  return new Promise(res => ws.on('open', () => { ws.send(JSON.stringify({ t: 'join', name, room, playerId })); res(client); }));
}

const get = (port, p) => new Promise(res => http.get(`http://localhost:${port}${p}`, r => { r.resume(); res(r.statusCode); }));

(async () => {
  const port = await start(0);

  assert.strictEqual(await get(port, '/'), 200, 'serves index.html');
  assert.strictEqual(await get(port, '/client.js'), 200, 'serves client.js');
  assert.strictEqual(await get(port, '/vendor/three.module.js'), 200, 'serves three.js');
  assert.strictEqual(await get(port, '/icon.png'), 200, 'serves icon');
  assert.notStrictEqual(await get(port, '/../server.js'), 200, 'blocks path traversal');
  assert.strictEqual(await get(port, '/info'), 200, 'serves /info');
  assert.strictEqual(await get(port, '/healthz'), 200, 'health check');

  const a = await connect(port, 'Alice', 'Test-Room');
  const b = await connect(port, 'Bob', 'test-room');
  const c = await connect(port, 'Carol', 'other');
  await wait(300);

  assert.ok(a.welcome && b.welcome, 'both got welcome');
  assert.strictEqual(a.welcome.room, 'test-room');
  assert.strictEqual(rooms.size, 2, 'two rooms exist');
  const last = a.states.at(-1);
  assert.strictEqual(last.players.length, 2, 'Alice sees two players');
  assert.ok(!last.players.some(p => p.name === 'Carol'), 'rooms are isolated');
  assert.strictEqual(last.cakeHp, 100);

  // movement
  const before = last.players.find(p => p.id === a.welcome.id);
  a.ws.send(JSON.stringify({ t: 'input', right: true, ax: 0, ay: 0 }));
  await wait(400);
  a.ws.send(JSON.stringify({ t: 'input', right: false }));
  await wait(100);
  const after = b.states.at(-1).players.find(p => p.id === a.welcome.id);
  assert.ok(after.x > before.x + 30, `Bob sees Alice move (${before.x} -> ${after.x})`);

  // can't buy without coins
  b.ws.send(JSON.stringify({ t: 'buy', item: 'damage' }));
  await wait(100);
  assert.strictEqual(b.states.at(-1).upgrades.damage, 0, 'no free upgrades');

  // shop works once the team has coins
  rooms.get('test-room').coins = 100;
  b.ws.send(JSON.stringify({ t: 'buy', item: 'damage' }));
  await wait(100);
  assert.strictEqual(a.states.at(-1).upgrades.damage, 1, 'upgrade is shared');
  assert.strictEqual(a.states.at(-1).coins, 85, 'coins are shared');

  // chat
  a.ws.send(JSON.stringify({ t: 'chat', text: 'protect the cake!!' }));
  await wait(100);
  assert.ok(b.chats.some(m => m.name === 'Alice' && m.text === 'protect the cake!!'), 'chat delivered');
  assert.ok(!c.chats.some(m => m.text === 'protect the cake!!'), 'chat stays in room');

  // a wave starts, bugs spawn, and shooting kills them
  const room = rooms.get('test-room');
  room.timer = 0;
  await wait(1500);
  assert.strictEqual(a.states.at(-1).phase, 'wave');
  assert.ok(a.states.at(-1).enemies.length > 0, 'bugs spawned');
  room.upgrades.damage = 50;
  // keep aiming at a bug that has walked onto the blanket (bugs spawn just off the edge)
  for (let i = 0; i < 60 && !room.kills; i++) {
    const target = room.enemies.find(e => e.x > 0 && e.x < 1600 && e.y > 0 && e.y < 1000);
    if (target) a.ws.send(JSON.stringify({ t: 'input', shoot: true, ax: target.x, ay: target.y }));
    await wait(50);
  }
  a.ws.send(JSON.stringify({ t: 'input', shoot: false }));
  assert.ok(room.kills > 0, 'squished a bug');

  // cake death -> game over
  room.cakeHp = 0;
  await wait(200);
  assert.strictEqual(a.states.at(-1).phase, 'gameover');

  // anti-cheat: chat spam is throttled, message floods get kicked
  const before2 = b.chats.length;
  for (let i = 0; i < 5; i++) a.ws.send(JSON.stringify({ t: 'chat', text: 'spam ' + i }));
  await wait(150);
  assert.strictEqual(b.chats.length - before2, 1, 'chat cooldown lets 1 through and drops the spam');
  const flooder = await connect(port, 'Flooder', 'flood');
  const closed = new Promise(r => flooder.ws.on('close', code => r(code)));
  for (let i = 0; i < 500; i++) flooder.ws.send(JSON.stringify({ t: 'input' }));
  assert.strictEqual(await closed, 1008, 'flooder kicked');

  // bans: only the host (connected from this computer) can use commands
  const lan = lanAddresses()[0];
  if (lan) {
    await wait(800);
    const d = await connect(port, 'Dave', 'test-room', { host: lan, playerId: 'dave-id-1234' });
    await wait(200);
    assert.ok(d.welcome, 'Dave joined over the network');
    d.ws.send(JSON.stringify({ t: 'chat', text: '/ban Alice' }));
    await wait(150);
    assert.ok(d.chats.some(m => m.text === 'Only the host can use commands.'), 'non-host cannot use commands');

    a.ws.send(JSON.stringify({ t: 'chat', text: '/ban Dave 1h being mean' }));
    await wait(200);
    assert.strictEqual(d.banned?.reason, 'being mean', 'Dave sees ban reason');
    assert.ok(d.banned.until > Date.now() + 59 * 60e3, 'ban lasts an hour');
    assert.strictEqual(d.closeCode, 4003, 'Dave disconnected');
    assert.ok(JSON.parse(fs.readFileSync(BANS_FILE, 'utf8')).some(b => b.name === 'Dave'), 'ban saved to disk');

    const d2 = await connect(port, 'Dave2', 'test-room', { host: lan, playerId: 'new-id-5678' });
    await wait(200);
    assert.ok(d2.banned && !d2.welcome, 'IP ban stops a new ID from the same computer');

    await wait(800);
    a.ws.send(JSON.stringify({ t: 'chat', text: '/unban Dave' }));
    await wait(150);
    const d3 = await connect(port, 'Dave', 'test-room', { host: lan, playerId: 'dave-id-1234' });
    await wait(200);
    assert.ok(d3.welcome && !d3.banned, 'unban lets Dave back in');
    d3.ws.close();
  } else {
    console.log('(no LAN address, skipping network ban tests)');
  }

  // can't ban yourself, and bans expire
  await wait(800);
  a.ws.send(JSON.stringify({ t: 'chat', text: '/ban Alice' }));
  await wait(150);
  assert.ok(a.chats.some(m => m.text.includes("can't ban yourself")), 'host cannot ban themselves');
  const e = await connect(port, 'Eve', 'test-room');
  await wait(150);
  ban(rooms.get('test-room').players.get(e.welcome.id), 'test', 1);
  await wait(50);
  const e2 = await connect(port, 'Eve', 'test-room');
  await wait(150);
  assert.ok(e2.welcome && !e2.banned, 'expired ban lets player back in');
  e2.ws.close();

  // kick
  await wait(800);
  a.ws.send(JSON.stringify({ t: 'chat', text: '/kick Bob' }));
  await wait(200);
  assert.ok(b.kicked && b.closeCode === 4001, 'Bob was kicked');

  // leaving cleans up empty rooms
  c.ws.close();
  await wait(200);
  assert.ok(!rooms.has('other'), 'empty room deleted');

  fs.rmSync(BANS_FILE, { force: true });
  console.log('✅ all smoke tests passed');
  a.ws.close(); b.ws.close();
  process.exit(0);
})().catch(err => { console.error('❌', err); process.exit(1); });
