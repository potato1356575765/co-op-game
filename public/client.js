// 🍰 Cake Defense — 3D client (three.js)
// The server simulates on a flat 2D plane (x, y in "px"); we render that plane as the 3D ground (x, z).

import * as THREE from 'three';

const S = 0.1; // px -> world units
const $ = id => document.getElementById(id);

// ---------- renderer / scene ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (err) {
  document.body.innerHTML = `<div style="display:grid;place-items:center;height:100vh;text-align:center;padding:16px">
    <div><h1>😵 No 3D graphics available</h1><p>Cake Defense needs WebGL. Try updating your graphics drivers.</p></div></div>`;
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fd8ff');
scene.fog = new THREE.Fog('#9fd8ff', 120, 260);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
camera.position.set(80, 70, 110);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const hemi = new THREE.HemisphereLight('#ffffff', '#88aa66', 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
sun.position.set(60, 100, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, far: 300 });
scene.add(sun, sun.target);

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
const shadowy = m => { m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return m; };

// ---------- world (built after welcome, since it depends on arena size) ----------
let arena = { w: 1600, h: 1000 };
let cake = null;

function picnicTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const n = 8, s = 256 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    g.fillStyle = (i + j) % 2 ? '#ffffff' : '#ff6b8a';
    g.fillRect(i * s, j * s, s, s);
  }
  g.globalAlpha = 0.25;
  for (let i = 0; i < n; i++) { g.fillStyle = '#ff6b8a'; g.fillRect(i * s, 0, s / 2, 256); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildWorld(info) {
  arena = { w: info.w, h: info.h };
  const W = info.w * S, H = info.h * S;

  const grass = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat('#7ccf5a', { roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(W / 2, -0.05, H / 2);
  grass.receiveShadow = true;
  scene.add(grass);

  const tex = picnicTexture();
  tex.repeat.set(W / 20, H / 20);
  const blanket = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat('#fff', { map: tex, roughness: 0.95 }));
  blanket.rotation.x = -Math.PI / 2;
  blanket.position.set(W / 2, 0, H / 2);
  blanket.receiveShadow = true;
  scene.add(blanket);

  // little candy fence posts around the edge
  const postGeo = new THREE.CylinderGeometry(0.5, 0.5, 3, 10);
  const postMats = [mat('#ff6b9d'), mat('#ffffff')];
  let k = 0;
  const post = (x, z) => {
    const m = new THREE.Mesh(postGeo, postMats[k++ % 2]);
    m.position.set(x, 1.5, z);
    scene.add(shadowy(m));
  };
  for (let x = 0; x <= W; x += 8) { post(x, -1.5); post(x, H + 1.5); }
  for (let z = 8; z < H; z += 8) { post(-1.5, z); post(W + 1.5, z); }

  // decor: giant cupcakes + gumdrops scattered outside the arena
  const rnd = mulberry(7);
  for (let i = 0; i < 40; i++) {
    let x, z;
    do { x = rnd() * 360 - 100; z = rnd() * 300 - 100; } while (x > -10 && x < W + 10 && z > -10 && z < H + 10);
    const d = rnd() < 0.5 ? makeCupcake(rnd) : makeGumdrop(rnd);
    d.position.set(x, 0, z);
    d.rotation.y = rnd() * 6;
    scene.add(d);
  }

  cake = makeCake();
  cake.position.set(info.cake.x * S, 0, info.cake.y * S);
  scene.add(cake);
  camera.position.set(W / 2, 70, H / 2 + 60);
  camera.lookAt(W / 2, 0, H / 2);
}

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeCupcake(rnd) {
  const g = new THREE.Group();
  const s = 2 + rnd() * 3;
  const wrapper = new THREE.Mesh(new THREE.CylinderGeometry(s, s * 0.75, s * 1.2, 16), mat(['#4dd2ff', '#ffd23f', '#c38bff'][Math.floor(rnd() * 3)]));
  wrapper.position.y = s * 0.6;
  const top = new THREE.Mesh(new THREE.SphereGeometry(s * 1.1, 16, 12), mat(['#fff0f5', '#ffb3d1', '#8b5a2b'][Math.floor(rnd() * 3)]));
  top.position.y = s * 1.3;
  top.scale.y = 0.8;
  const cherry = new THREE.Mesh(new THREE.SphereGeometry(s * 0.25, 12, 8), mat('#e01b3c', { roughness: 0.2 }));
  cherry.position.y = s * 2.2;
  g.add(wrapper, top, cherry);
  return shadowy(g);
}

function makeGumdrop(rnd) {
  const s = 1.5 + rnd() * 2;
  const m = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    mat(['#ff5e5e', '#7cff6b', '#ff9f43', '#c38bff'][Math.floor(rnd() * 4)], { roughness: 0.3, transparent: true, opacity: 0.9 }));
  m.scale.y = 1.3;
  return shadowy(m);
}

function makeCake() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.2, 0.5, 40), mat('#ffffff', { roughness: 0.2 }));
  plate.position.y = 0.25;
  g.add(plate);
  const tiers = [];
  const defs = [[5.4, 3, '#ff8fb8'], [4, 2.6, '#fff0e0'], [2.7, 2.2, '#ff8fb8']];
  let y = 0.5;
  for (const [r, h, c] of defs) {
    const tier = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40), mat(c));
    body.position.y = h / 2;
    const frost = new THREE.Mesh(new THREE.TorusGeometry(r, 0.35, 10, 40), mat('#ffffff'));
    frost.rotation.x = Math.PI / 2;
    frost.position.y = h;
    tier.add(body, frost);
    // sprinkles
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.3, 2, 4), mat(['#4dd2ff', '#ffd23f', '#7cff6b', '#c38bff'][i % 4]));
      sp.position.set(Math.cos(a) * r * 1.001, h * (0.3 + 0.4 * ((i * 7) % 5) / 5), Math.sin(a) * r * 1.001);
      sp.rotation.set(Math.random() * 3, a, Math.random() * 3);
      tier.add(sp);
    }
    tier.position.y = y;
    y += h;
    g.add(tier);
    tiers.push(tier);
  }
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 2, 10), mat('#4dd2ff'));
  candle.position.y = y + 1;
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffcc33' }));
  flame.scale.y = 1.6;
  flame.position.y = y + 2.4;
  const light = new THREE.PointLight('#ffaa33', 30, 30);
  light.position.y = y + 2.6;
  g.add(candle, flame, light);
  g.userData = { tiers, candle, flame, light, shake: 0, lastHp: 100 };
  return shadowy(g);
}

// ---------- characters ----------
function makePlayer(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.8, 24, 16), mat(color, { roughness: 0.4 }));
  body.position.y = 1.8;
  const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1, 20), mat('#ffffff'));
  hatBand.position.y = 3.7;
  const hatPuff = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), mat('#ffffff'));
  hatPuff.position.y = 4.6;
  hatPuff.scale.y = 0.75;
  const eyeMat = mat('#ffffff', { roughness: 0.1 });
  const pupilMat = mat('#111111');
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), eyeMat);
    eye.position.set(1.45, 2.4, side * 0.65);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), pupilMat);
    pupil.position.set(0.35, 0, 0);
    eye.add(pupil);
    eyes.push(eye);
  }
  // sprinkle blaster (a piping bag)
  const bag = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.4, 12), mat('#ffffff', { roughness: 0.3 }));
  bag.rotation.z = -Math.PI / 2;
  bag.position.set(2.2, 1.6, 1.3);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 8), mat('#cccccc', { metalness: 0.8, roughness: 0.2 }));
  tip.rotation.z = -Math.PI / 2;
  tip.position.set(3.6, 1.6, 1.3);
  const inner = new THREE.Group();
  inner.add(body, hatBand, hatPuff, ...eyes, bag, tip);
  g.add(inner);
  // revive ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 6, 40, 1, 0, Math.PI * 2), new THREE.MeshBasicMaterial({ color: '#ff6b9d', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  ring.visible = false;
  g.add(ring);
  g.userData = { inner, ring };
  return shadowy(g);
}

const enemyBuilders = {
  ant: () => bug('#2a1a1a', 1.2, 3),
  queen: () => {
    const g = bug('#6b2fa0', 3.8, 3);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.1, 1.4, 6, 1, true), mat('#ffd23f', { metalness: 0.9, roughness: 0.2, side: THREE.DoubleSide }));
    crown.position.set(g.userData.headX, g.userData.headY + 2.2, 0);
    g.userData.body.add(crown);
    return g;
  },
  beetle: () => {
    const g = new THREE.Group();
    const body = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat('#1f8a5b', { metalness: 0.6, roughness: 0.25 }));
    shell.scale.set(1.2, 0.9, 1);
    shell.position.y = 0.6;
    const line = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.1, 0.12), mat('#0b3d28'));
    line.position.y = 2.6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), mat('#0b3d28'));
    head.position.set(2.6, 1, 0);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.6, 8), mat('#0b3d28'));
    horn.rotation.z = -Math.PI / 3;
    horn.position.set(3.4, 1.8, 0);
    body.add(shell, line, head, horn);
    addLegs(body, 1.6, 0.6, '#0b3d28');
    g.add(body);
    g.userData = { body };
    return shadowy(g);
  },
  wasp: () => {
    const g = new THREE.Group();
    const body = new THREE.Group();
    const abdomen = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat('#ffd23f'));
    abdomen.scale.set(1.5, 0.9, 0.9);
    abdomen.position.x = -0.9;
    for (const x of [-0.6, -1.3]) {
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.16, 6, 16), mat('#111'));
      stripe.rotation.y = Math.PI / 2;
      stripe.position.x = x;
      body.add(stripe);
    }
    const stinger = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.8, 8), mat('#111'));
    stinger.rotation.z = Math.PI / 2;
    stinger.position.x = -2.5;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.65, 12, 10), mat('#111'));
    head.position.x = 0.9;
    const wingMat = new THREE.MeshStandardMaterial({ color: '#dff6ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const wings = [];
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CircleGeometry(1.2, 16), wingMat);
      w.scale.set(0.6, 1, 1);
      w.position.set(-0.3, 0.6, side * 1.1);
      w.rotation.x = Math.PI / 2;
      wings.push(w);
    }
    body.add(abdomen, stinger, head, ...wings);
    body.position.y = 3.5;
    g.add(body);
    g.userData = { body, wings, flying: true };
    return shadowy(g);
  },
};

function bug(color, scale, segments) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  const m = mat(color, { roughness: 0.35 });
  let x = -1.2, headX = 0, headY = 0;
  for (let i = 0; i < segments; i++) {
    const r = [0.7, 0.45, 0.55][i];
    const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m);
    seg.position.set(x, 0.9, 0);
    if (i === 0) seg.scale.set(1.3, 1, 1);
    body.add(seg);
    headX = x; headY = 0.9;
    x += [1, 0.9, 0][i];
  }
  for (const side of [-1, 1]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 4), m);
    ant.position.set(headX + 0.3, 1.5, side * 0.2);
    ant.rotation.set(side * 0.5, 0, -0.6);
    body.add(ant);
  }
  addLegs(body, 0.6, 0.5, color);
  body.scale.setScalar(scale);
  g.add(body);
  g.userData = { body, headX, headY };
  return shadowy(g);
}

function addLegs(body, spread, y, color) {
  const legs = [];
  const m = mat(color);
  for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4), m);
    leg.position.set((i - 1) * 0.5 - 0.1, y, side * spread);
    leg.rotation.x = side * 1.0;
    leg.userData.phase = i * 2 + (side > 0 ? 1 : 0);
    body.add(leg);
    legs.push(leg);
  }
  body.userData.legs = legs;
}

// ---------- particles ----------
const particles = [];
const crumbGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
function burst(x, z, color, n = 10, y = 1) {
  const m = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < n; i++) {
    const p = new THREE.Mesh(crumbGeo, m);
    p.position.set(x, y, z);
    p.userData = { v: new THREE.Vector3((Math.random() - 0.5) * 14, Math.random() * 12 + 4, (Math.random() - 0.5) * 14), life: 0.8 + Math.random() * 0.4 };
    scene.add(p);
    particles.push(p);
  }
}

// ---------- networking ----------
let ws = null;
let myId = null;
let state = null;
let shopInfo = null;
const players = new Map(); // id -> { mesh, label, target }
const enemies = new Map();
const bullets = new Map();
const labelsEl = $('labels');

const params = new URLSearchParams(location.search);
const isApp = !!window.cakeApp;
$('room').value = params.get('room') || '';
$('name').value = params.get('name') || localStorageGet('cd-name') || '';
if (params.get('error')) showJoinError(params.get('error'));
if (isApp) for (const id of ['quit', 'quit2']) $(id).classList.remove('hidden');
$('quit').onclick = $('quit2').onclick = () => window.cakeApp?.quit();

// anti-cheat: if it's on and didn't load, block the game with an error screen
let antiCheatBlocked = false;
if (window.cakeApp?.antiCheatStatus) {
  window.cakeApp.antiCheatStatus().then(ac => {
    if (!ac.enabled || ac.ok) return;
    antiCheatBlocked = true;
    ws?.close();
    $('join').classList.add('hidden');
    $('eacmessage').textContent = ac.message;
    $('eaccode').textContent = `Error: ${ac.code}`;
    $('eacdetail').textContent = ac.detail;
    $('eacerror').classList.remove('hidden');
  });
}
$('eacretry').onclick = () => window.cakeApp?.relaunch();
$('eacquit').onclick = () => window.cakeApp?.quit();

function showJoinError(text) {
  $('joinerror').textContent = text;
  $('joinerror').classList.remove('hidden');
}

// tell the host which address friends should type in
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  fetch('/info').then(r => r.json()).then(info => {
    if (!info.lan.length) return;
    const port = info.port === 3000 ? '' : `:${info.port}`;
    $('myaddr').innerHTML = `Friends on your Wi-Fi join you with:<br><b>${info.lan.map(ip => ip + port).join('</b> or <b>')}</b>`;
  }).catch(() => {});
}

// go back to the menu (on the host's own computer when we're in the app)
function goHome() {
  if (window.cakeApp) window.cakeApp.home();
  else location.href = '/';
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

$('play').onclick = join;
for (const id of ['name', 'room']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

async function join() {
  if (antiCheatBlocked) return;
  const name = $('name').value.trim() || 'Baker' + Math.floor(Math.random() * 1000);
  const room = $('room').value.trim() || 'lobby';
  localStorageSet('cd-name', name);
  const host = $('host').value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (host && host !== location.host) {
    // the friend's computer serves the game too, so we just go there
    const addr = /:\d+$/.test(host) ? host : `${host}:3000`;
    $('play').disabled = true;
    $('play').textContent = 'Connecting…';
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 4000);
      const info = await (await fetch(`http://${addr}/info`, { signal: ctrl.signal })).json();
      if (info.game !== 'cake-defense') throw new Error();
      location.href = `http://${addr}/?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}&autoplay=1`;
    } catch {
      showJoinError(`Couldn't find a Cake Defense game at ${addr}. Check the address and that you're on the same Wi-Fi.`);
      $('play').disabled = false;
      $('play').textContent = 'PLAY';
    }
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, room }));
  ws.onmessage = e => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    $('banner').innerHTML = 'Disconnected 😢<br><small>Press Esc for the menu</small>';
    ws = null;
  };
  $('join').classList.add('hidden');
}

function onMessage(msg) {
  if (msg.t === 'welcome') {
    myId = msg.id;
    shopInfo = msg.shop;
    buildWorld(msg);
    buildShop();
    history.replaceState(null, '', `?room=${encodeURIComponent(msg.room)}`);
    $('roomname').textContent = `🏠 ${msg.room}`;
    for (const id of ['hud', 'cakebar', 'scores', 'chat', 'help']) $(id).classList.remove('hidden');
  } else if (msg.t === 'state') {
    applyState(msg);
  } else if (msg.t === 'chat') {
    const div = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = msg.name + ': ';
    b.style.color = msg.color || '#ffd23f';
    div.append(b, document.createTextNode(msg.text));
    $('chatlog').append(div);
    while ($('chatlog').children.length > 8) $('chatlog').firstChild.remove();
  }
}

function makeLabel(html) {
  const el = document.createElement('div');
  el.className = 'label';
  el.innerHTML = html;
  labelsEl.append(el);
  return el;
}

function sync(map, list, create, update) {
  const seen = new Set();
  for (const item of list) {
    seen.add(item.id);
    let entry = map.get(item.id);
    if (!entry) { entry = create(item); map.set(item.id, entry); }
    update(entry, item);
  }
  for (const [id, entry] of map) {
    if (!seen.has(id)) {
      entry.onRemove?.();
      scene.remove(entry.mesh);
      entry.label?.remove();
      map.delete(id);
    }
  }
}

let predicted = null; // local player position (px)

function applyState(s) {
  state = s;

  sync(players, s.players, p => {
    const mesh = makePlayer(p.color);
    scene.add(mesh);
    const label = makeLabel(`<span></span><div class="bar"><i></i></div>`);
    label.firstChild.textContent = p.name;
    label.firstChild.style.color = p.color;
    mesh.position.set(p.x * S, 0, p.y * S);
    return { mesh, label, target: { x: p.x, y: p.y }, data: p };
  }, (e, p) => {
    e.target = { x: p.x, y: p.y };
    e.data = p;
    e.label.querySelector('i').style.width = `${p.hp}%`;
    if (p.id === myId && (!predicted || p.downed)) predicted = { x: p.x, y: p.y };
  });

  sync(enemies, s.enemies, en => {
    const mesh = enemyBuilders[en.type]();
    mesh.position.set(en.x * S, 0, en.y * S);
    scene.add(mesh);
    const label = en.type === 'beetle' || en.type === 'queen' ? makeLabel(`<div class="bar"><i style="background:#ff5e5e"></i></div>`) : null;
    const entry = { mesh, label, target: { x: en.x, y: en.y }, hp: en.hp, flash: 0, type: en.type };
    entry.onRemove = () => burst(mesh.position.x, mesh.position.z, en.type === 'wasp' ? '#ffd23f' : en.type === 'beetle' ? '#1f8a5b' : en.type === 'queen' ? '#c38bff' : '#553333', en.type === 'queen' ? 40 : 12, mesh.userData.flying ? 3.5 : 1);
    return entry;
  }, (e, en) => {
    e.target = { x: en.x, y: en.y };
    if (en.hp < e.hp) e.flash = 0.12;
    e.hp = en.hp;
    if (e.label) e.label.querySelector('i').style.width = `${en.hp * 100}%`;
  });

  sync(bullets, s.bullets, b => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.6, 2, 6), new THREE.MeshBasicMaterial({ color: b.c }));
    mesh.position.set(b.x * S, 1.6, b.y * S);
    mesh.rotation.z = Math.PI / 2;
    scene.add(mesh);
    return { mesh, target: { x: b.x, y: b.y } };
  }, (e, b) => {
    const dx = b.x - e.target.x, dy = b.y - e.target.y;
    if (dx || dy) e.mesh.rotation.y = -Math.atan2(dy, dx);
    e.target = { x: b.x, y: b.y };
  });

  // HUD
  $('wave').textContent = `🌊 Wave ${s.wave}`;
  $('coins').textContent = `🪙 ${s.coins}`;
  $('kills').textContent = `🐜 ${s.kills}`;
  $('cakebar').firstChild.style.width = `${s.cakeHp}%`;
  if (cake && s.cakeHp < cake.userData.lastHp) {
    cake.userData.shake = 0.3;
    burst(cake.position.x, cake.position.z, '#ff8fb8', 6, 4);
  }
  if (cake) cake.userData.lastHp = s.cakeHp;

  const me = s.players.find(p => p.id === myId);
  let banner = '';
  if (s.phase === 'intermission') banner = s.wave === 0 ? `Get ready! First wave in ${s.timer}` : `Wave ${s.wave + 1} in ${s.timer}… go shopping 🛒`;
  else if (s.phase === 'gameover') banner = `💀 CAKE DEVOURED 💀<br><small>Made it to wave ${s.wave} · restarting in ${s.timer}</small>`;
  else if (me?.downed) banner = `You're down! 😵<br><small>A friend can revive you · respawn in ${me.respawn}s</small>`;
  $('banner').innerHTML = banner;

  $('shop').classList.toggle('hidden', s.phase !== 'intermission');
  for (const btn of $('shop').children) {
    const k = btn.dataset.item;
    const price = s.prices[k];
    const lvl = s.upgrades[k];
    btn.querySelector('.p').textContent = price == null ? 'MAXED' : `🪙 ${price}`;
    btn.querySelector('.l').textContent = lvl != null ? ` (Lv ${lvl})` : '';
    btn.disabled = price == null || s.coins < price || (k === 'repair' && s.cakeHp >= 100);
  }

  $('scores').innerHTML = '<b>Bakers</b>' + [...s.players].sort((a, b) => b.score - a.score)
    .map(p => `<div><span style="color:${p.color}">${escapeHtml(p.name)}${p.downed ? ' 😵' : ''}</span><span>${p.score}</span></div>`).join('');
}

function escapeHtml(t) { return t.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`); }

function buildShop() {
  const shop = $('shop');
  Object.entries(shopInfo).forEach(([key, info], i) => {
    const btn = document.createElement('button');
    btn.dataset.item = key;
    btn.innerHTML = `[${i + 1}] ${info.label}<span class="l"></span><br><b class="p"></b>`;
    btn.onclick = () => buy(key);
    shop.append(btn);
  });
}

function togglePause(show = $('pause').classList.contains('hidden')) {
  $('pause').classList.toggle('hidden', !show);
  if (show) { for (const k in keys) keys[k] = false; input.shoot = false; }
}
$('resume').onclick = () => togglePause(false);
$('leave').onclick = () => { ws?.close(); goHome(); };
$('fullscreen').onclick = () => {
  if (window.cakeApp) window.cakeApp.toggleFullscreen();
  else if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
};

function buy(item) { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'buy', item })); }

// ---------- input ----------
const keys = {};
const input = { up: false, down: false, left: false, right: false, shoot: false, ax: 0, ay: 0 };
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.6);
const chatInput = $('chatinput');

addEventListener('keydown', e => {
  if (document.activeElement === chatInput) {
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text && ws) ws.send(JSON.stringify({ t: 'chat', text }));
      chatInput.value = '';
      chatInput.blur();
      chatInput.classList.add('hidden');
    } else if (e.key === 'Escape') { chatInput.blur(); chatInput.classList.add('hidden'); }
    return;
  }
  if (!myId) return;
  if (e.key === 'Escape') { togglePause(); return; }
  if (e.key === 'Enter') { chatInput.classList.remove('hidden'); chatInput.focus(); e.preventDefault(); return; }
  const n = Number(e.key);
  if (n >= 1 && n <= 4 && shopInfo) buy(Object.keys(shopInfo)[n - 1]);
  keys[e.code] = true;
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; input.shoot = false; });

const canvas = renderer.domElement;
canvas.addEventListener('mousemove', e => { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); });
canvas.addEventListener('mousedown', e => { if (e.button === 0) input.shoot = true; });
addEventListener('mouseup', e => { if (e.button === 0) input.shoot = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// touch: left half = joystick, right half = aim + shoot
const touch = { moveId: null, ox: 0, oy: 0, dx: 0, dy: 0, aimId: null };
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth / 2 && touch.moveId == null) Object.assign(touch, { moveId: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 });
    else if (touch.aimId == null) { touch.aimId = t.identifier; input.shoot = true; setMouse(t); }
  }
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === touch.moveId) { touch.dx = t.clientX - touch.ox; touch.dy = t.clientY - touch.oy; }
    if (t.identifier === touch.aimId) setMouse(t);
  }
}, { passive: false });
canvas.addEventListener('touchend', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === touch.moveId) Object.assign(touch, { moveId: null, dx: 0, dy: 0 });
    if (t.identifier === touch.aimId) { touch.aimId = null; input.shoot = false; }
  }
});
function setMouse(t) { mouse.set((t.clientX / innerWidth) * 2 - 1, -(t.clientY / innerHeight) * 2 + 1); }

function readInput() {
  const dz = 15;
  input.up = !!(keys.KeyW || keys.ArrowUp) || touch.dy < -dz;
  input.down = !!(keys.KeyS || keys.ArrowDown) || touch.dy > dz;
  input.left = !!(keys.KeyA || keys.ArrowLeft) || touch.dx < -dz;
  input.right = !!(keys.KeyD || keys.ArrowRight) || touch.dx > dz;
  raycaster.setFromCamera(mouse, camera);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit)) { input.ax = Math.round(hit.x / S); input.ay = Math.round(hit.z / S); }
}

let lastSent = '';
let sendTimer = 0;
function sendInput(dt) {
  sendTimer -= dt;
  const json = JSON.stringify({ t: 'input', ...input });
  if (ws?.readyState === 1 && (json !== lastSent || sendTimer <= 0)) {
    ws.send(json);
    lastSent = json;
    sendTimer = 0.05;
  }
}

// ---------- main loop ----------
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
const camTarget = new THREE.Vector3(80, 0, 50);

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  const k = 1 - Math.exp(-dt * 14);

  if (myId) { readInput(); sendInput(dt); }

  // local prediction so our own movement feels instant
  const meEntry = players.get(myId);
  if (meEntry && predicted && !meEntry.data.downed && state?.phase !== 'gameover') {
    const speed = 230 + (state.upgrades.speed || 0) * 25;
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const len = Math.hypot(dx, dy);
    if (len) { dx /= len; dy /= len; }
    predicted.x = Math.max(18, Math.min(arena.w - 18, predicted.x + dx * speed * dt));
    predicted.y = Math.max(18, Math.min(arena.h - 18, predicted.y + dy * speed * dt));
    const c = 1 - Math.exp(-dt * 4);
    predicted.x += (meEntry.target.x - predicted.x) * c;
    predicted.y += (meEntry.target.y - predicted.y) * c;
  }

  for (const [id, e] of players) {
    const tgt = id === myId && predicted && !e.data.downed ? predicted : e.target;
    e.mesh.position.x += (tgt.x * S - e.mesh.position.x) * (id === myId ? 1 : k);
    e.mesh.position.z += (tgt.y * S - e.mesh.position.z) * (id === myId ? 1 : k);
    const aim = id === myId && meEntry ? Math.atan2(input.ay - (predicted?.y ?? 0), input.ax - (predicted?.x ?? 0)) : e.data.aim;
    const { inner, ring } = e.mesh.userData;
    if (e.data.downed) {
      inner.rotation.z += (Math.PI / 2 - inner.rotation.z) * k;
      inner.position.y = 0;
      ring.visible = true;
      ring.geometry.dispose();
      ring.geometry = new THREE.RingGeometry(5.2, 6, 40, 1, 0, Math.max(0.01, e.data.revive) * Math.PI * 2);
    } else {
      inner.rotation.z += (0 - inner.rotation.z) * k;
      inner.rotation.y = -aim;
      inner.position.y = Math.abs(Math.sin(t * 10 + id)) * 0.4;
      ring.visible = false;
    }
  }

  for (const e of enemies.values()) {
    const nx = e.target.x * S, nz = e.target.y * S;
    const dx = nx - e.mesh.position.x, dz = nz - e.mesh.position.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.01) {
      const want = -Math.atan2(dz, dx);
      let diff = want - e.mesh.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      e.mesh.rotation.y += diff * k;
    }
    e.mesh.position.x += dx * k;
    e.mesh.position.z += dz * k;
    const ud = e.mesh.userData;
    if (ud.body.userData.legs) for (const leg of ud.body.userData.legs) leg.rotation.z = Math.sin(t * 18 + leg.userData.phase) * 0.5;
    if (ud.wings) { for (const w of ud.wings) w.rotation.x = Math.PI / 2 + Math.sin(t * 60) * 0.6; ud.body.position.y = 3.5 + Math.sin(t * 4 + e.mesh.id) * 0.4; }
    e.flash -= dt;
    ud.body.scale.setScalar((e.type === 'queen' ? 3.8 : e.type === 'ant' ? 1.2 : 1) * (e.flash > 0 ? 1.25 : 1));
  }

  for (const e of bullets.values()) {
    e.mesh.position.x += (e.target.x * S - e.mesh.position.x) * k;
    e.mesh.position.z += (e.target.y * S - e.mesh.position.z) * k;
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const u = p.userData;
    u.life -= dt;
    u.v.y -= 30 * dt;
    p.position.addScaledVector(u.v, dt);
    p.rotation.x += dt * 8;
    if (p.position.y < 0.2) { p.position.y = 0.2; u.v.set(0, 0, 0); }
    if (u.life <= 0) { scene.remove(p); particles.splice(i, 1); }
  }

  if (cake) {
    const u = cake.userData;
    u.flame.scale.set(1 + Math.sin(t * 20) * 0.1, 1.6 + Math.sin(t * 13) * 0.25, 1);
    u.light.intensity = 26 + Math.sin(t * 17) * 6;
    u.shake = Math.max(0, u.shake - dt);
    cake.position.x = arena.w / 2 * S + (Math.random() - 0.5) * u.shake * 2;
    // the cake gets eaten tier by tier
    const hp = state?.cakeHp ?? 100;
    u.tiers[2].visible = hp > 66;
    u.tiers[1].visible = hp > 33;
    u.candle.visible = u.flame.visible = u.light.visible = hp > 66;
  }

  // camera follows you
  const focus = meEntry ? meEntry.mesh.position : null;
  if (focus) camTarget.lerp(tmp.set(focus.x, 0, focus.z), 1 - Math.exp(-dt * 5));
  camera.position.lerp(tmp.set(camTarget.x, 62, camTarget.z + 48), 1 - Math.exp(-dt * 5));
  camera.lookAt(camTarget);
  sun.position.set(camTarget.x + 60, 100, camTarget.z + 40);
  sun.target.position.copy(camTarget);

  // HTML labels
  for (const e of players.values()) placeLabel(e.label, e.mesh.position, 6.2);
  for (const e of enemies.values()) if (e.label) placeLabel(e.label, e.mesh.position, e.type === 'queen' ? 8 : 4.5);

  renderer.render(scene, camera);
}

function placeLabel(el, pos, h) {
  tmp.set(pos.x, pos.y + h, pos.z).project(camera);
  if (tmp.z > 1) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.style.left = `${(tmp.x * 0.5 + 0.5) * innerWidth}px`;
  el.style.top = `${(-tmp.y * 0.5 + 0.5) * innerHeight}px`;
}

if (params.get('autoplay') && $('name').value) join();
animate();
