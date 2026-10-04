// Shared world generation + physics helpers.
// Loaded by both the Node server (require) and the browser (window.World),
// so the same seed produces the exact same infinite world everywhere.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.World = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TILE = 32;

  const T = { DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, FOREST: 4, HILL: 5, MOUNTAIN: 6, SNOW: 7 };

  const O = { NONE: 0, TREE: 1, ROCK: 2, CHEST: 3, SHRINE: 4, BUSH: 5 };

  const CHEST_CELL = 12; // at most one chest per 12x12 tile cell
  const SHRINE_CELL = 48; // at most one shrine per 48x48 tile cell

  function hash(x, y, seed) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function valueNoise(x, y, seed) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = smooth(x - xi);
    const v = smooth(y - yi);
    const a = hash(xi, yi, seed);
    const b = hash(xi + 1, yi, seed);
    const c = hash(xi, yi + 1, seed);
    const d = hash(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  function fbm(x, y, seed, octaves) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += valueNoise(x * freq, y * freq, seed + i * 101) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  function create(seed) {
    const tileCache = new Map();

    function computeTile(tx, ty) {
      // Gentle island bias around spawn so players never start in the ocean.
      const d = Math.sqrt(tx * tx + ty * ty);
      const spawnBoost = Math.max(0, 0.12 - d / 400);
      const e = fbm(tx / 56, ty / 56, seed, 5) + spawnBoost;
      const m = fbm(tx / 70 + 500, ty / 70 - 500, seed + 7, 3);
      if (e < 0.36) return T.DEEP;
      if (e < 0.41) return T.WATER;
      if (e < 0.44) return T.SAND;
      if (e < 0.58) return m > 0.5 ? T.FOREST : T.GRASS;
      if (e < 0.64) return T.HILL;
      if (e < 0.69) return T.MOUNTAIN;
      return T.SNOW;
    }

    function tileAt(tx, ty) {
      const key = tx * 100003 + ty; // cheap numeric key, collision-free for |coords| < 50000
      let t = tileCache.get(key);
      if (t === undefined) {
        if (tileCache.size > 400000) tileCache.clear();
        t = computeTile(tx, ty);
        tileCache.set(key, t);
      }
      return t;
    }

    function cellSpot(tx, ty, size, salt) {
      const cx = Math.floor(tx / size);
      const cy = Math.floor(ty / size);
      const sx = cx * size + Math.floor(hash(cx, cy, seed + salt) * size);
      const sy = cy * size + Math.floor(hash(cy, cx, seed + salt + 1) * size);
      return { cx, cy, hit: sx === tx && sy === ty };
    }

    function objectAt(tx, ty) {
      const t = tileAt(tx, ty);
      if (t === T.DEEP || t === T.WATER || t === T.MOUNTAIN || t === T.SNOW) return O.NONE;
      if (Math.abs(tx) < 3 && Math.abs(ty) < 3) return O.NONE; // clear spawn plaza

      const shrine = cellSpot(tx, ty, SHRINE_CELL, 911);
      if (shrine.hit && t !== T.SAND && hash(shrine.cx, shrine.cy, seed + 77) < 0.7) return O.SHRINE;

      const chest = cellSpot(tx, ty, CHEST_CELL, 313);
      if (chest.hit && hash(chest.cx, chest.cy, seed + 55) < 0.45) return O.CHEST;

      const h = hash(tx, ty, seed + 3);
      if (t === T.FOREST) return h < 0.32 ? O.TREE : h < 0.36 ? O.BUSH : O.NONE;
      if (t === T.GRASS) return h < 0.035 ? O.TREE : h < 0.06 ? O.BUSH : O.NONE;
      if (t === T.HILL) return h < 0.14 ? O.ROCK : h < 0.17 ? O.TREE : O.NONE;
      if (t === T.SAND) return h < 0.015 ? O.ROCK : O.NONE;
      return O.NONE;
    }

    // mods: { removed: Map|Set of "tx,ty", structures: Map "tx,ty" -> {kind} }
    function solidAt(tx, ty, mods) {
      const t = tileAt(tx, ty);
      if (t === T.DEEP || t === T.MOUNTAIN || t === T.SNOW) return true;
      const key = tx + ',' + ty;
      if (mods) {
        const s = mods.structures && mods.structures.get(key);
        if (s && s.kind === 'wall') return true;
      }
      const o = objectAt(tx, ty);
      if (o === O.TREE || o === O.ROCK || o === O.SHRINE || o === O.CHEST) {
        return !(mods && mods.removed && mods.removed.has(key)) || o === O.SHRINE;
      }
      return false;
    }

    function speedAt(x, y) {
      const t = tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
      return t === T.WATER ? 0.5 : 1;
    }

    // Axis-separated circle-vs-tile movement. Returns new {x, y}.
    function move(x, y, dx, dy, r, mods) {
      const blocked = (px, py) => {
        const minX = Math.floor((px - r) / TILE);
        const maxX = Math.floor((px + r) / TILE);
        const minY = Math.floor((py - r) / TILE);
        const maxY = Math.floor((py + r) / TILE);
        for (let ty = minY; ty <= maxY; ty++) {
          for (let tx = minX; tx <= maxX; tx++) {
            if (!solidAt(tx, ty, mods)) continue;
            const cx = Math.max(tx * TILE, Math.min(px, tx * TILE + TILE));
            const cy = Math.max(ty * TILE, Math.min(py, ty * TILE + TILE));
            if ((px - cx) ** 2 + (py - cy) ** 2 < r * r) return true;
          }
        }
        return false;
      };
      let nx = x + dx;
      if (blocked(nx, y)) nx = x;
      let ny = y + dy;
      if (blocked(nx, ny)) ny = y;
      return { x: nx, y: ny };
    }

    function findSpawn() {
      for (let radius = 0; radius < 200; radius++) {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const tx = Math.round(Math.cos(a) * radius);
          const ty = Math.round(Math.sin(a) * radius);
          const t = tileAt(tx, ty);
          if ((t === T.GRASS || t === T.FOREST || t === T.SAND) && !solidAt(tx, ty)) {
            return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
          }
        }
      }
      return { x: TILE / 2, y: TILE / 2 };
    }

    return { seed, tileAt, objectAt, solidAt, speedAt, move, findSpawn, hash: (x, y, s) => hash(x, y, seed + s) };
  }

  return { TILE, T, O, create };
});
