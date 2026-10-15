// Runs the server like the official one on Fly.io: admin password, behind a proxy.
const fs = require('fs');
const os = require('os');
const path = require('path');
const BANS_FILE = path.join(os.tmpdir(), `cake-official-bans-${process.pid}.json`);
Object.assign(process.env, { CAKE_BANS_FILE: BANS_FILE, CAKE_ADMIN_TOKEN: 'sprinkles-123', TRUST_PROXY: '1' });
const assert = require('assert');
const WebSocket = require('ws');
const { start } = require('../server');

const wait = ms => new Promise(r => setTimeout(r, ms));

// every client "comes from" a different internet IP via the proxy header
function connect(port, name, room, ip) {
  const ws = new WebSocket(`ws://localhost:${port}`, { headers: { 'Fly-Client-IP': ip } });
  const c = { ws, chats: [], welcome: null, banned: null, full: false, closeCode: null };
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') c.welcome = m;
    if (m.t === 'chat') c.chats.push(m.text);
    if (m.t === 'banned') c.banned = m;
    if (m.t === 'full') c.full = true;
  });
  ws.on('close', code => { c.closeCode = code; });
  return new Promise(res => ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'join', name, room, playerId: `${name}-player-id` }));
    res(c);
  }));
}
const say = (c, text) => c.ws.send(JSON.stringify({ t: 'chat', text }));

(async () => {
  const port = await start(0);
  const info = await (await fetch(`http://localhost:${port}/info`)).json();
  assert.ok('official' in info, '/info says where the official server is');

  const admin = await connect(port, 'Potato', 'lobby', '203.0.113.1');
  const cheater = await connect(port, 'Cheater', 'other-room', '203.0.113.66');
  await wait(200);

  say(admin, '/ban Cheater');
  await wait(150);
  assert.ok(admin.chats.includes('Only admins can use commands.'), 'not an admin until logged in');
  assert.ok(!cheater.banned, 'nobody got banned');

  await wait(800);
  say(admin, '/admin wrong-password');
  await wait(150);
  assert.ok(admin.chats.includes('Wrong admin password.'), 'wrong password rejected');

  await wait(800);
  say(admin, '/admin sprinkles-123');
  await wait(150);
  assert.ok(admin.chats.some(t => t.startsWith("You're an admin now")), 'right password works');

  await wait(800);
  say(admin, '/ban Cheater 7d aimbot');
  await wait(200);
  assert.strictEqual(cheater.banned?.reason, 'aimbot', 'admin bans someone in a different lobby');
  assert.strictEqual(cheater.closeCode, 4003);
  const saved = JSON.parse(fs.readFileSync(BANS_FILE, 'utf8'));
  assert.strictEqual(saved[0].ip, '203.0.113.66', 'ban uses the real IP from the proxy, not the proxy');

  const evader = await connect(port, 'TotallyNew', 'some-lobby', '203.0.113.66');
  await wait(200);
  assert.ok(evader.banned && !evader.welcome, 'ban follows them into any lobby');

  const bruteForcer = await connect(port, 'Guesser', 'lobby', '203.0.113.7');
  for (let i = 0; i < 5; i++) { say(bruteForcer, '/admin guess' + i); await wait(800); }
  assert.strictEqual(bruteForcer.closeCode, 1008, 'kicked after too many password guesses');

  // 8 players max per lobby
  const crowd = [];
  for (let i = 0; i < 8; i++) crowd.push(await connect(port, `P${i}`, 'packed', `198.51.100.${i + 1}`));
  await wait(200);
  const late = await connect(port, 'Late', 'packed', '198.51.100.99');
  await wait(200);
  assert.ok(late.full && !late.welcome && late.closeCode === 4002, '9th player gets "room full"');

  fs.rmSync(BANS_FILE, { force: true });
  console.log('✅ all official-server tests passed');
  process.exit(0);
})().catch(err => { console.error('❌', err); process.exit(1); });
