// Packages the game into a single executable using Node's built-in Single Executable Applications.
//
//   npm run build:exe            -> dist/CakeDefense.exe   (Windows x64)
//   npm run build:exe -- linux   -> dist/CakeDefense-linux (Linux x64)
//
// Works from any OS: it downloads the official Node binary for the target, bundles the server
// with esbuild, embeds the client files as SEA assets, and injects them into the binary.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, '.build');
const DIST = path.join(ROOT, 'dist');
const target = process.argv[2] || 'win';
const version = process.version; // the blob must be made by the same Node version as the target binary

const TARGETS = {
  win: { url: `https://nodejs.org/dist/${version}/win-x64/node.exe`, out: 'CakeDefense.exe' },
  linux: { url: `https://nodejs.org/dist/${version}/node-${version}-linux-x64.tar.gz`, out: 'CakeDefense-linux', tar: `node-${version}-linux-x64/bin/node` },
};

async function download(url, dest) {
  if (fs.existsSync(dest)) return;
  console.log(`⬇️  Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  fs.writeFileSync(dest + '.part', Buffer.from(await res.arrayBuffer()));
  fs.renameSync(dest + '.part', dest);
}

async function main() {
  const t = TARGETS[target];
  if (!t) throw new Error(`Unknown target "${target}". Use one of: ${Object.keys(TARGETS).join(', ')}`);
  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 1. bundle the server (+ ws) into one CommonJS file
  console.log('📦 Bundling server');
  require('esbuild').buildSync({
    entryPoints: [path.join(ROOT, 'server.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(BUILD, 'server.cjs'),
    external: ['bufferutil', 'utf-8-validate'], // optional ws speedups
    logLevel: 'warning',
  });

  // 2. make the SEA blob with the client files embedded
  console.log('🍰 Embedding game files');
  const seaConfig = {
    main: path.join(BUILD, 'server.cjs'),
    output: path.join(BUILD, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useCodeCache: false, // must be off when building for another platform
    assets: {
      'index.html': path.join(ROOT, 'public', 'index.html'),
      'client.js': path.join(ROOT, 'public', 'client.js'),
      'three.module.js': path.join(path.dirname(require.resolve('three')), 'three.module.js'),
    },
  };
  const configPath = path.join(BUILD, 'sea-config.json');
  fs.writeFileSync(configPath, JSON.stringify(seaConfig, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', configPath], { stdio: 'inherit' });

  // 3. grab the official Node binary for the target
  const cached = path.join(BUILD, `${version}-${path.basename(t.url)}`);
  await download(t.url, cached);
  const out = path.join(DIST, t.out);
  if (t.tar) {
    execFileSync('tar', ['-xzf', cached, '-C', BUILD, t.tar]);
    fs.copyFileSync(path.join(BUILD, t.tar), out);
  } else {
    fs.copyFileSync(cached, out);
  }
  fs.chmodSync(out, 0o755);
  if (target === 'win') stripAuthenticode(out);

  // 4. inject the blob
  console.log('💉 Injecting into binary');
  await require('postject').inject(out, 'NODE_SEA_BLOB', fs.readFileSync(seaConfig.output), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  });

  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(`✅ Built ${path.relative(ROOT, out)} (${mb} MB)`);
}

// node.exe ships signed by the Node.js foundation. Injecting would leave a broken signature behind,
// so remove it (same as `signtool remove /s`): clear the PE certificate table and drop its bytes.
function stripAuthenticode(file) {
  const buf = fs.readFileSync(file);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('Not a PE file');
  const opt = pe + 24;
  const magic = buf.readUInt16LE(opt);
  const dirs = opt + (magic === 0x20b ? 112 : 96);
  const certEntry = dirs + 4 * 8; // IMAGE_DIRECTORY_ENTRY_SECURITY
  const offset = buf.readUInt32LE(certEntry);
  const size = buf.readUInt32LE(certEntry + 4);
  if (!offset || !size) return;
  buf.writeUInt32LE(0, certEntry);
  buf.writeUInt32LE(0, certEntry + 4);
  const end = offset + size === buf.length ? offset : buf.length;
  fs.writeFileSync(file, buf.subarray(0, end));
  console.log('✂️  Removed original code signature');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
