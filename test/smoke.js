// Boots the server, connects two players, and checks the core co-op loop works.
process.env.PORT = 0;
process.env.SEED = 4242;
const assert = require('assert');
const WebSocket = require('ws');
const World = require('../shared/world');
const { server, SEED } = require('../server');

function client(port, name) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const next = (pred, ms = 3000) => new Promise((resolve, reject) => {
    const found = inbox.find(pred);
    if (found) return resolve(found);
    waiters.push({ pred, resolve });
    setTimeout(() => reject(new Error(`${name}: timed out waiting`)), ms);
  });
  const send = (m) => ws.send(JSON.stringify(m));
  return new Promise((res) => ws.on('open', () => { send({ t: 'join', name }); res({ ws, next, send, inbox }); }));
}

server.listen(0, async () => {
  const port = server.address().port;
  try {
    const a = await client(port, 'Alice');
    const b = await client(port, 'Bob');
    const wa = await a.next((m) => m.t === 'welcome');
    const wb = await b.next((m) => m.t === 'welcome');
    assert.strictEqual(wa.seed, SEED);
    assert.notStrictEqual(wa.id, wb.id);

    const st = await a.next((m) => m.t === 'state' && m.players.length === 2);
    assert.deepStrictEqual(st.players.map((p) => p.name).sort(), ['Alice', 'Bob']);

    // Find a tree near spawn, walk next to it and chop it.
    const world = World.create(SEED);
    let tree = null;
    for (let r = 1; r < 60 && !tree; r++)
      for (let j = -r; j <= r && !tree; j++)
        for (let i = -r; i <= r && !tree; i++) {
          const tx = Math.floor(wa.spawn.x / 32) + i, ty = Math.floor(wa.spawn.y / 32) + j;
          if (world.objectAt(tx, ty) === World.O.TREE) tree = [tx, ty];
        }
    assert(tree, 'there should be a tree near spawn');
    // Hop toward the tree in steps (server rejects teleports).
    const me = { x: wa.spawn.x, y: wa.spawn.y };
    const goal = { x: tree[0] * 32 + 16, y: tree[1] * 32 + 48 };
    while (Math.hypot(goal.x - me.x, goal.y - me.y) > 1) {
      const d = Math.hypot(goal.x - me.x, goal.y - me.y), s = Math.min(d, 200);
      me.x += ((goal.x - me.x) / d) * s; me.y += ((goal.y - me.y) / d) * s;
      a.send({ t: 'pos', x: me.x, y: me.y, dir: 0 });
      await new Promise((r) => setTimeout(r, 60));
    }
    a.send({ t: 'interact', tx: tree[0], ty: tree[1] });
    const rm = await b.next((m) => m.t === 'removed' && m.key === tree.join(','));
    assert(rm.on, 'Bob should see the tree get chopped');
    const st2 = await a.next((m) => m.t === 'state' && m.players.find((p) => p.name === 'Alice').inv.wood === 3);
    assert(st2);

    // Chat relays to the other player.
    a.send({ t: 'chat', text: 'hi bob' });
    const c = await b.next((m) => m.t === 'chat' && m.text === 'hi bob');
    assert.strictEqual(c.from.name, 'Alice');

    console.log('smoke test passed ✔');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
});
