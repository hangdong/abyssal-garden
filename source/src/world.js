// ============================================================================
// world layout + procedural content generation (load-time only)
// ============================================================================

// designed rock masses: ax, az, bx, bz, radius, top, overhang, waist
const MESAS = [
  [-37, -42, -33, -22, 9, -7, 3.5, 2], [-29, -15, -33, 5, 12, -14, 3, 2], [-36, 11, -30, 27, 9, -5, 4, 2],   // west wall of the main canyon
  [30, -45, 35, -27, 9, -9, 4, 2], [37, -20, 31, -3, 11, -16, 3, 2], [32, 5, 35, 9, 7, -8, 4, 2],          // east wall
  [19, -15, 19, -15, 4.4, -6, 2, 1.5],   // pillar with window
  [6, -88, 6, -88, 10, -34, 0, 0],       // mound in the kelp basin
  [0, -106, 0, -106, 8, 3, 2, 2],        // pillar reaching the surface
  [44, 6, 47, -8, 7, -17, 3, 1],         // ship supports
  [33, 29, 37, 12, 9, -19, -6.5, 0],     // sloped sunlit wall beside the wreck
  [74, 14, 74, 14, 8, -15, 3, 1],
  [-84, -34, -80, -12, 10, -7, 6, 2], [-78, -6, -83, 12, 12, -13, 5, 2], [-82, 18, -79, 32, 9, -8, 6, 2],   // sponge canyon west wall
  [-17, 62, -19, 78, 10, -6, 9, 3], [-21, 84, -18, 100, 11, -9, 8, 3],     // grotto overhang cliff
  [22, 67, 24, 80, 7, -11, 6, 2],        // grotto coral rock
  [-16, 122, 34, 122, 9, -27, 3, 2],     // grotto far wall
  [172, -47, 118, -43, 7, 11, 3.5, 2], [172, 47, 118, 43, 7, 11, 3.5, 2],
  [104, -54, 100, -50, 4.5, 3.4, 1.8, 1.5], [93, -61, 90, -58, 3.4, 2.6, 1.2, 1], [101, -70, 101, -70, 3.2, 3, 1.4, 1],   // sea stacks off the north point   // rocky points either side of the cove
];
// vertical ring arches: cx, cy, cz, yaw, major radius, minor radius, y squash
const ARCHES = [
  [-23, -9.5, -16, 0.3, 4.2, 1.4, 1.2],
  [0, -45, -34, 1.57, 14, 2.7, 1.2],
  [98, -5, -36, 1.57, 6.5, 1.8, 1.2],     // sea arch off the north point of the cove
  [-40, -45, 44, 1.57, 10, 2.2, 1.3],
];
// carved tunnels: ax, ay, az, radius, bx, by, bz
const HOLES = [
  [19, -21, -23, 2.5, 19, -21, -7],
  [9, -37, 108, 4.2, 9, -34, 136],
];
// regions kept free of random mesas: ax, az, bx, bz, radius, softness
const CLEARS = [
  [0, -45, 0, 35, 22, 10], [0, -86, 0, -86, 46, 12], [42, 24, 74, 6, 22, 10], [72, -26, 72, -26, 26, 10],
  [-60, -36, -60, 36, 13, 8], [-60, 42, -18, 46, 12, 8], [4, 58, 8, 100, 24, 10], [-34, -74, -56, -46, 11, 8], [105, 0, 150, 0, 45, 12],
];
const PURPLE = [6, 84];
const beachAt = (x, z) => sstep(80, 42, abs(z)) * sstep(70, 105, x); // sand of the east cove (see W_DENS)
const zoneP = (x, z) => sstep(44, 26, hypot(x - PURPLE[0], z - PURPLE[1]));
const MAGENTA = [[14, 6, 13], [-4, 20, 9], [6, 84, 30], [-58, 8, 10], [50, 30, 12], [8, -70, 10], [-12, -98, 9], [-36, 44, 9], [-46, -60, 9], [24, 42, 8], [-56, 26, 9], [-44, 38, 8], [-10, 44, 8], [12, 24, 8], [-50, -45, 8]];
const magAt = (x, z) => {
  let m = sstep(0.54, 0.66, fbm(x * 0.03, 7, z * 0.03, 3)) * 0.9;
  for (const p of MAGENTA) m = max(m, sstep(p[2], p[2] * 0.45, hypot(x - p[0], z - p[1])));
  return m * sstep(0.3, 0.55, fbm(x * 0.17, 1, z * 0.17, 2) + m * 0.25);
};

function primBuffer() {
  const a = [];
  for (const m of MESAS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  for (const m of ARCHES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of HOLES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of CLEARS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], 0, 0);
  return new Float32Array(a);
}

// ---------------------------------------------------------------- terrain mesh from the density grid
function buildTerrain(D) {
  const sn = surfaceNets(D, NX, NY, NZ), nv = sn.nv, gp = sn.pos;
  const smp = sampler3(D, NX, NY, NZ);
  const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
  const wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3);
  for (let k = 0; k < nv; k++) {
    const x = gp[k * 3], y = gp[k * 3 + 1], z = gp[k * 3 + 2], e = 0.8;
    let nx = smp(x - e, y, z) - smp(x + e, y, z), ny = smp(x, y - e, z) - smp(x, y + e, z), nz = smp(x, y, z - e) - smp(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const X = OX + x * VS, Y = OY + y * VS, Z = OZ + z * VS;
    wp[k * 3] = vf[k * 4] = X; wp[k * 3 + 1] = vf[k * 4 + 1] = Y; wp[k * 3 + 2] = vf[k * 4 + 2] = Z;
    wn[k * 3] = nx; wn[k * 3 + 1] = ny; wn[k * 3 + 2] = nz;
    v8[k * 16 + 12] = round(nx * 127); v8[k * 16 + 13] = round(ny * 127); v8[k * 16 + 14] = round(nz * 127); v8[k * 16 + 15] = 127;
  }
  // bucket quads into the XZ culling grid
  const nq = sn.ni / 6, key = new Uint8Array(nq), cnt = new Uint32Array(CELLS * CELLS + 1);
  const lo = new Float32Array(CELLS * CELLS).fill(1e9), hi = new Float32Array(CELLS * CELLS).fill(-1e9);
  for (let q = 0; q < nq; q++) {
    const a = sn.idx[q * 6] * 3;
    const c = clamp(floor((wp[a] - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((wp[a + 2] - OZ) / CELLW), 0, CELLS - 1);
    key[q] = c; cnt[c + 1]++;
    for (let j = 0; j < 6; j++) { const y = wp[sn.idx[q * 6 + j] * 3 + 1]; if (y < lo[c]) lo[c] = y; if (y > hi[c]) hi[c] = y; }
  }
  for (let c = 0; c < CELLS * CELLS; c++) cnt[c + 1] += cnt[c];
  const ib = new Uint32Array(sn.ni), fill = cnt.slice();
  for (let q = 0; q < nq; q++) { const o = fill[key[q]]++ * 6; for (let j = 0; j < 6; j++) ib[o + j] = sn.idx[q * 6 + j]; }
  return { vb, ib, nv, wp, wn, smp, start: cnt, lo, hi };
}

// ---------------------------------------------------------------- instance stores
function makeWorld(D, T, flyPts, POSES) {
  const gi = (x, y, z) => x + NX * (y + NY * z);
  const smp = T.smp;
  const Dw = (x, y, z) => smp((x - OX) / VS, (y - OY) / VS, (z - OZ) / VS);
  const nCells = CELLS * CELLS;
  const cellOf = (x, z) => clamp(floor((x - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((z - OZ) / CELLW), 0, CELLS - 1);
  const big = Array.from({ length: nCells }, () => []), small = Array.from({ length: nCells }, () => []);
  // Medium and Low keep every 2nd / 4th leaf (but every kelp stem), made wider; the random stream is the same
  let nth = 0;
  const leaf = (L, x, y, z, len, yaw, tilt, wid, hA, type, s1, s2, bend) => { if (type === 1 || !(nth++ % THIN)) L[cellOf(x, z)].push(x, y, z, len, yaw, tilt, type === 1 ? wid : wid * (1 + LV / 2), hA, type, s1, s2, bend); };
  const glint = (...a) => { nth++ % THIN || glints.push(...a); };
  const solids = []; // per mesh id: arrays of 12 floats
  const props = Array.from({ length: 6 }, () => Array.from({ length: nCells }, () => []));
  const solid = (mesh, x, y, z, sc, q, mat, seed, ts = 1, bob = 0) => { (mesh > 3 && mesh < 10 ? props[mesh - 4][cellOf(x, z)] : (solids[mesh] ||= [])).push(x, y, z, sc, q[0], q[1], q[2], q[3], mat, seed, ts, bob); };
  const chunks = Array.from({ length: NCHUNK }, () => Array.from({ length: nCells }, () => []));
  const glints = [];
  const rel = (i, f, r) => { const p = POSES[i]; let fx = p[3] - p[0], fz = p[5] - p[2]; const l = hypot(fx, fz); fx /= l; fz /= l; return [p[0] + fx * f - fz * r, p[2] + fz * f + fx * r]; };
  const bubbles = [], kelpAbs = new Float32Array((NX / 2) * (NY / 2) * (NZ / 2));

  // --- surface queries
  const fl = [];
  const floorsAt = (x, z) => {
    const ix = clamp(round((x - OX) / VS), 1, NX - 2), iz = clamp(round((z - OZ) / VS), 1, NZ - 2);
    fl.length = 0; let ceil = 3;
    for (let gy = NY - 2; gy >= 0; gy--) {
      const d = D[gi(ix, gy, iz)], da = D[gi(ix, gy + 1, iz)];
      if (da <= 0 && d > 0) { const y = OY + (gy + d / (d - da)) * VS; fl.push(y, min(ceil, 0) - y); } else if (da > 0 && d <= 0) ceil = OY + (gy + 0.5) * VS;
    }
    return fl;
  };
  const grad = (x, y, z) => {
    const e = 0.6; let nx = Dw(x - e, y, z) - Dw(x + e, y, z), ny = Dw(x, y - e, z) - Dw(x, y + e, z), nz = Dw(x, y, z - e) - Dw(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
  };
  // march from outside along -n to the surface
  const snap = (x, y, z, n) => {
    let px = x + n[0] * 2.5, py = y + n[1] * 2.5, pz = z + n[2] * 2.5, prev = Dw(px, py, pz);
    if (prev > 0) return null;
    for (let i = 0; i < 24; i++) {
      const qx = px - n[0] * 0.25, qy = py - n[1] * 0.25, qz = pz - n[2] * 0.25, d = Dw(qx, qy, qz);
      if (d > 0) { const t = prev / (prev - d); const p = [mix(px, qx, t), mix(py, qy, t), mix(pz, qz, t)]; return p.concat(grad(p[0], p[1], p[2])); }
      px = qx; py = qy; pz = qz; prev = d;
    }
    return null;
  };
  const pickV = () => ((rnd() * T.nv) | 0) * 3;
  const tangent = (n) => { let t = abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [1, 0, 0]; const l = hypot(...t); t = t.map((v) => v / l); return [t, [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]]; };
  const nearFly = (x, y, z, r) => { for (const p of flyPts) if (hypot(x - p[0], z - p[2]) < r && y < p[1] + 3 && y > p[1] - 13) return true; return false; };
  const nearPose = (x, z, r = 3) => { for (const p of POSES) if (hypot(x - p[0], z - p[2]) < r) return true; return false; };
  // --- kelp columns
  const column = (x, y, z, H, kind, dens = 1) => {
    const strands = 2 + (rnd() < 0.6) + (rnd() < 0.3), ph = rnd() * TAU, tw = rr(0.1, 0.28), sr = rr(0.2, 0.55), sc = rr(0.75, 1.25);
    const la = rnd() * TAU, lm = rr(0, 0.11), full = rr(0.55, 1.3) * dens;
    const stem = (s, h) => { const a = ph + s * TAU / strands + h * tw, r = sr * (1 - 0.6 * h / H), ln = lm * h * h / H; return [x + cos(a) * r + cos(la) * ln, z + sin(a) * r + sin(la) * ln, a]; };
    for (let s = 0; s < strands; s++) for (let h = 0; h < H - 1; h += 1.7) { const p = stem(s, h); leaf(big, p[0], y + h, p[1], 2.1, p[2] + PI / 2, 0.1, 0.17, h, 1, rnd(), rnd(), 0.3); }
    const n = floor(H * 30 * full);
    for (let i = 0; i < n; i++) {
      const t = pow(rnd(), 0.9), h = t * H, p = stem((rnd() * strands) | 0, h);
      const L = ((0.55 + 0.75 * rnd() * rnd()) * (1 - 0.5 * t * t) * sc + 0.25) * (kind === 1 ? 1.25 : 1.15);
      const tilt = mix(rr(0.4, 1.0), rr(0.15, 0.45), t);
      const type = kind === 1 ? (rnd() < 0.8 ? 3 : 4) : kind === 2 ? (rnd() < 0.5 ? 4 : 0) : 0;
      leaf(big, p[0], y + h, p[1], L, rnd() * TAU, tilt, L * (kind === 1 ? rr(0.09, 0.13) : rr(0.15, 0.21)) + 0.03, h, type, rnd(), rnd(), rr(0.38, 0.95));
    }
    for (let i = floor(H * (kind === 1 ? 16 : 13)); i > 0; i--) { const h = rnd() * H, a = rnd() * TAU, r = rr(0.15, 0.8) * (1 - 0.5 * h / H), ln = lm * h * h / H; glint(x + cos(a) * r + cos(la) * ln, y + h, z + sin(a) * r + sin(la) * ln, h, rnd(), kind === 1 ? rnd() : rnd() * 0.6, rr(0.018, 0.05), 0); }
    // light absorption footprint for the skylight bake
    const hx = round((x - OX) / VS / 2), hz = round((z - OZ) / VS / 2);
    for (let hy = floor((y - OY) / VS / 2); hy <= floor((y + H - OY) / VS / 2); hy++) {
      if (hy >= 0 && hy < NY / 2 && hx > 0 && hx < NX / 2 - 1 && hz > 0 && hz < NZ / 2 - 1) kelpAbs[hx + NX / 2 * (hy + NY / 2 * hz)] += 0.17;
    }
  };
  const KELPZ = [[-32, -5, 13, 0.85], [0, -86, 46, 1], [72, -26, 27, 0.9], [-60, -4, 11, 0.8], [0, -36, 12, 0.55], [-17, -8, 6, 0.8], [15, -8, 6, 0.8], [-4, 120, 20, 0.4], [-45, -63, 15, 0.9], [62, -26, 12, 0.9], [-100, 70, 30, 0.8], [100, 60, 30, 0.8], [-95, -90, 32, 0.8], [105, -85, 30, 0.7], [100, -4, 24, 0.85], [96, 34, 14, 0.6], [96, -30, 12, 0.5]];
  const NOKELP = [[-5, -106.5, 8], [4.6, -109.4, 10], [14.2, -112.3, 12], [-26, -100, 6], [-20.5, -101.7, 4.5], [-14.8, -104.5, 6], [-7.5, -107.8, 7], [4, 112, 11], [2, 4, 15], [42, 22, 12], [6, 78, 19], [-58, -16, 8], [9, -66, 9], [8, -76, 8]];
  const kelpDens = (x, z) => {
    for (const p of NOKELP) if (hypot(x - p[0], z - p[1]) < p[2]) return 0;
    let d = sstep(0.52, 0.64, fbm(x * 0.022, 4, z * 0.022, 3)) * 0.5;
    for (const p of KELPZ) d = max(d, p[3] * sstep(p[2], p[2] * 0.75, hypot(x - p[0], z - p[1])));
    return d;
  };
  const occ = new Set();
  rseed(1);
  const tryColumn = (x, z, kind, force, dens = 1) => {
    const key = floor(x / 2.3) * 4096 + floor(z / 2.3);
    if (occ.has(key)) return;
    const f = floorsAt(x, z); const c = [];
    for (let i = 0; i < f.length; i += 2) if (f[i + 1] > 9) c.push(i);
    if (!c.length) return;
    const i = c[(rnd() * c.length) | 0], y = f[i];
    if (grad(x, y, z)[1] < 0.55) return;
    if (!force && flyPts.some((p) => hypot(x - p[0], z - p[2]) < 5)) return;
    occ.add(key);
    column(x, y - 0.3, z, min(f[i + 1] - rr(0.8, 5), force ? rr(30, 42) : rr(15, 40)), kind, dens);
  };
  // hand-placed columns framing the viewpoints: x, z, kind, density
  for (const p of [[...rel(0, 11, -8.5), 0], [...rel(0, 16, -10.5), 0], [...rel(0, 21, -9), 0], [...rel(0, 9, 7), 0], [...rel(0, 14, 9.5), 0], [...rel(0, 19, 8), 0], [...rel(0, 26, 6), 0],
    [...rel(5, 6.5, 5.2), 1], [...rel(5, 12, 7), 1], [...rel(5, 15, -8), 0], [...rel(5, 22, -5), 1], [...rel(3, 12, -5.5), 0], [...rel(3, 16, 5.5), 0], [...rel(3, 20, -4.5), 0], [...rel(3, 25, 6), 0], [...rel(3, 13, 8), 0], [...rel(3, 30, -7), 0], [24, 62, 1], [-6, 96, 1], [20, 96, 2], [-10, 70, 0], [16, 52, 1],
    [...rel(4, 15, -9), 0, 1.2], [...rel(4, 19, -13), 0, 1.2], [...rel(4, 23, -8.5), 0, 1.2], [...rel(4, 25, -15), 0, 1.2],
    [...rel(4, 25, 0.5), 2, 1.2], [...rel(4, 27, -3), 2, 1.2], [...rel(4, 28, 3.5), 2, 1.2], [...rel(4, 31, 0), 0, 1.3], [...rel(4, 33, -5), 0, 1.3], [...rel(4, 33, 5), 0, 1.3], [...rel(4, 21, 9), 0, 1.2], [...rel(4, 27, 11), 0, 1.2],
    [...rel(2, 6.5, -5.5), 0, 1.5], [...rel(2, 9.5, -8), 0, 1.3], [...rel(2, 8, 6), 0, 1.4], [...rel(2, 12, 3.6), 0, 1.3], [...rel(2, 17, -2.5), 0, 1.2], [...rel(2, 21, 4), 0, 1.2], [...rel(2, 12, -4.5), 2, 1.2], [...rel(2, 27, -9), 0, 1.2], [...rel(2, 30, 8.5), 0, 1.2], [...rel(2, 37, -3), 0, 1.1],
    [...rel(2, 13.5, 6.5), 0, 1.3], [...rel(2, 14.5, -7), 0, 1.3], [...rel(2, 6.5, 6.5), 0, 1.3], [...rel(2, 9, -8), 2, 1.3]]) tryColumn(p[0], p[1], p[2], true, p[3]);
  // random columns across the world
  rseed(2);
  for (let i = 0; i < 15000; i++) {
    const a = rnd() * TAU, r = sqrt(rnd()) * 170, x = cos(a) * r, z = sin(a) * r;
    if (rnd() < kelpDens(x, z)) tryColumn(x, z, zoneP(x, z) > 0.5 && rnd() < 0.5 ? 1 : rnd() < 0.03 ? 2 : 0);
  }

  // --- clusters of ribbon leaves on the ground
  const cluster = (x, y, z, n, type, lmin, lmax, wmin, wmax, tmax, sway) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, r = rnd() * 0.5, L = rr(lmin, lmax);
      leaf(big, x + cos(a) * r, y - 0.15, z + sin(a) * r, L, a, rr(0.05, tmax), rr(wmin, wmax), sway, type, rnd(), rnd(), rr(0.3, 0.8));
    }
  };
  const HOT = [[0, 5, 30], [42, 30, 24], [6, 82, 34], [-58, 10, 24], [4, -88, 30], [-36, 44, 18], [-46, -60, 20]];
  const hot = (x, z) => { let h = 0.4; for (const p of HOT) h = max(h, sstep(p[2], p[2] * 0.4, hypot(x - p[0], z - p[1]))); return h; };
  rseed(3);
  for (let i = 0; i < 40000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (hypot(x, z) > 172 || y > -6) continue;
    const h = hot(x, z), zp = zoneP(x, z), u = rnd();
    if (nearFly(x, y, z, 4) || hypot(x + 1, z - 2) < 9 || nearPose(x, z, 8)) continue;
    if (ny > 0.75 && u < 0.10 * h) cluster(x, y, z, 8 + rnd() * 14 | 0, 2, 1.0, 3.0, 0.13, 0.26, 0.6, 2.5);
    else if (ny > 0.6 && u < 0.10 * h + 0.07 * max(zp, h * 0.4)) cluster(x, y, z, 10 + rnd() * 18 | 0, rnd() < 0.8 ? 3 : 4, 0.9, 2.6, 0.14, 0.28, 0.9, 1.5);
    else if (ny < -0.35 && u < 0.5 * max(zp, 0.2)) { // hanging fronds
      const n = 12 + rnd() * 20 | 0;
      for (let j = 0; j < n; j++) leaf(big, x + rr(-0.6, 0.6), y + 0.2, z + rr(-0.6, 0.6), rr(0.8, 3.2), rnd() * TAU, PI - rr(0, 0.4), rr(0.08, 0.18), 0, zp > 0.3 || rnd() < 0.5 ? 6 : 0, rnd(), rnd(), rr(0.3, 0.6));
    } else if (ny > -0.2 && ny < 0.8 && u < 0.07) { // wall tufts
      const yaw = atan2(T.wn[k + 2], T.wn[k]), n = 5 + rnd() * 7 | 0;
      for (let j = 0; j < n; j++) leaf(big, x, y, z, rr(0.5, 1.4), yaw + rr(-0.9, 0.9), rr(0.3, 1.1), rr(0.06, 0.12), 0.5, zp > 0.4 && rnd() < 0.6 ? 3 : 0, rnd(), rnd(), rr(0.2, 0.6));
    }
  }
  // --- ground cover: dense carpets of small tufts in the magenta patches
  rseed(4);
  for (const p of MAGENTA) for (let i = p[2] * p[2] * PI * 45; i > 0; i--) {
    const a = rnd() * TAU, r = sqrt(rnd()) * p[2], x = p[0] + cos(a) * r, z = p[1] + sin(a) * r;
    if (rnd() > magAt(x, z) + 0.12 || nearPose(x, z)) continue;
    const f = floorsAt(x, z); if (!f.length) continue;
    const y = f[f.length - 2]; if (y > -4 || grad(x, y, z)[1] < 0.7) continue;
    const nl = 2 + (rnd() * 3 | 0), yw = rnd() * TAU;
    for (let j = 0; j < nl; j++) leaf(small, x, y - 0.03, z, rr(0.08, 0.26), yw + j * TAU / nl + rr(-0.4, 0.4), rr(0.15, 0.85), rr(0.035, 0.07), 0, 5, rnd(), rnd(), rr(0.3, 0.7));
    if (rnd() < 0.3) for (let j = 0; j < 2; j++) leaf(small, x + rr(-0.2, 0.2), y - 0.04, z + rr(-0.2, 0.2), rr(0.2, 0.55), rnd() * TAU, rr(0.05, 0.6), rr(0.03, 0.06), 0, 7, rnd(), rnd(), rr(0.3, 0.8));
    if (rnd() < 0.3) glint(x, y + rr(0.08, 0.22), z, 0, rnd(), 0.82 + rnd() * 0.18, rr(0.01, 0.02), 0);
  }
  rseed(5);
  for (let i = 0; i < 620000; i++) {
    const k = pickV(), ny = T.wn[k + 1];
    if (ny < 0.72) continue;
    const x = T.wp[k] + rr(-0.45, 0.45), z = T.wp[k + 2] + rr(-0.45, 0.45), y = T.wp[k + 1];
    if (hypot(x, z) > 170 || y > -4 || nearPose(x, z)) continue;
    const m = magAt(x, z), zp = zoneP(x, z), u = rnd();
    if (m > 0.3 && u < m * 0.9) for (let j = 0; j < 4; j++) leaf(small, x + rr(-0.1, 0.1), y - 0.05, z + rr(-0.1, 0.1), rr(0.12, 0.34), rnd() * TAU, rr(0.05, 0.75), rr(0.04, 0.08), 0, 5, rnd(), rnd(), rr(0.3, 0.7));
    else if (u < m * 0.9 + 0.5 * max(zp, hot(x, z)) * sstep(0.42, 0.6, fbm(x * 0.09, 9, z * 0.09, 2))) for (let j = 0; j < 3; j++) leaf(small, x + rr(-0.1, 0.1), y - 0.05, z + rr(-0.1, 0.1), rr(0.25, 0.7), rnd() * TAU, rr(0.1, 0.8), rr(0.05, 0.1), 0, 7, rnd(), rnd(), rr(0.3, 0.8));
  }

  // --- sponges and coral (clustered on rock)
  const spots = [];
  const ZS = [[-58, 8, 30, 1], [0, 0, 30, 0.7], [6, 84, 36, 0.9], [4, -88, 22, 0.6], [44, 20, 24, 0.5]];
  const zw = (x, z) => { let h = 0.45; for (const p of ZS) h = max(h, p[3] * sstep(p[2], p[2] * 0.4, hypot(x - p[0], z - p[1]))); return h; };
  rseed(6);
  for (let i = 0; i < 13000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
    if (hypot(x, z) > 170 || y > -8 || T.wn[k + 1] < -0.15 || rnd() > zw(x, z) || nearFly(x, y, z, 3)) continue;
    const n0 = [T.wn[k], T.wn[k + 1], T.wn[k + 2]], [t1, t2] = tangent(n0), coral = T.wn[k + 1] > 0.85 || rnd() < 0.35, cnt = coral ? 2 + rnd() * 5 | 0 : 3 + rnd() * 9 | 0, sd = rnd();
    for (let j = 0; j < cnt; j++) {
      const a = rr(-1, 1) * (0.5 + cnt * 0.13), b = rr(-1, 1) * (0.5 + cnt * 0.13);
      const s = snap(x + t1[0] * a + t2[0] * b, y + t1[1] * a + t2[1] * b, z + t1[2] * a + t2[2] * b, n0);
      if (!s) continue;
      let ux = s[3], uy = s[4] + (coral ? 0.9 : 1.1), uz = s[5]; const l = hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
      const q = qMul(qFromY(ux, uy, uz), qAxis(0, 1, 0, rnd() * TAU)), sc = coral ? rr(0.5, 1.5) : rr(0.35, 0.9) * (rnd() < 0.1 ? 1.6 : 1);
      solid(coral ? 7 + (rnd() * 3 | 0) : 4 + (rnd() * 3 | 0), s[0] - ux * 0.12 * sc, s[1] - uy * 0.12 * sc, s[2] - uz * 0.12 * sc, sc, q, coral ? 5 : 4, fract(sd + rr(-0.03, 0.03)), 1, 0);
    }
    if (!coral && rnd() < 0.3) spots.push([x + n0[0], y + n0[1] + 0.5, z + n0[2]]);
  }

  // dense sponge / coral gardens: x, z, radius, count
  rseed(7);
  for (const g of [[-68, -6, 9, 260], [-66, 6, 7, 160], [16, 72, 7, 200], [-6, 74, 6, 120], [-13, -2, 6, 80], [8, -88, 8, 160], [44, 12, 7, 120], [-62, 22, 6, 140], [-47, 40, 6, 140], [-30, 47, 6, 120], [-12, 48, 5, 100], [14, 28, 6, 140], [28, 45, 6, 120], [-36, -76, 6, 130], [-49, -58, 6, 130], [-58, -38, 6, 120]]) {
    let made = 0;
    for (let i = 0; i < 400000 && made < g[3]; i++) {
      const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
      if (hypot(x - g[0], z - g[1]) > g[2] || y > -14 || T.wn[k + 1] < -0.1 || nearFly(x, y, z, 2.2)) continue;
      made++;
      const coral = T.wn[k + 1] > 0.85 || rnd() < 0.3, nx = T.wn[k], ny = T.wn[k + 1] + (coral ? 0.9 : 1.1), nz = T.wn[k + 2], l = hypot(nx, ny, nz);
      const sc = coral ? rr(0.5, 1.4) : rr(0.35, 0.9) * (rnd() < 0.15 ? 1.7 : 1);
      solid(coral ? 7 + (rnd() * 3 | 0) : 4 + (rnd() * 3 | 0), x - nx / l * 0.1 * sc, y - ny / l * 0.1 * sc, z - nz / l * 0.1 * sc, sc, qMul(qFromY(nx / l, ny / l, nz / l), qAxis(0, 1, 0, rnd() * TAU)), coral ? 5 : 4, rnd(), 1, 0);
    }
  }
  // --- rocks: floating boulder clusters + scattered ground rocks
  const BOULD = [[-11, -11, -105, 14, 5], [-56, -19, -18, 18, 6], [10, -13, -88, 22, 7], [24, -15, -24, 22, 7], [-18, -12, 4, 14, 6], [30, -14, 30, 16, 6], [36, -12, -70, 22, 8], [-30, -13, -84, 16, 7], [-58, -14, 0, 14, 6], [19, -13, 98, 18, 6], [62, -9, 34, 14, 6]];
  rseed(8);
  for (let i = 0; i < 9; i++) { const a = rnd() * TAU, r = rr(60, 150); BOULD.push([cos(a) * r, rr(-20, -9), sin(a) * r, 10 + rnd() * 12 | 0, rr(5, 9)]); }
  for (const b of BOULD) for (let i = 0; i < b[3]; i++) {
    const sc = rnd() < 0.12 ? rr(1.8, 3.2) : rr(0.35, 1.5);
    const x = b[0] + rr(-1, 1) * b[4], y = b[1] + rr(-1, 1) * b[4] * 0.6, z = b[2] + rr(-1, 1) * b[4];
    if (Dw(x, y, z) > -sc) continue;
    const bob = rr(0.12, 0.4), sd = rnd();
    solid(rnd() * 4 | 0, x, min(y, -2 - sc), z, sc, qRand(), 1, sd, 1, bob);
    if (sc > 1.1) for (let j = 0; j < 7; j++) solid(rnd() * 4 | 0, x + rr(-1.6, 1.6) * sc, min(y, -2 - sc) + rr(-1.4, 1) * sc, z + rr(-1.6, 1.6) * sc, rr(0.1, 0.35), qRand(), 1, sd, 1, bob);
  }
  rseed(9);
  for (let i = 0; i < 2600; i++) {
    const k = pickV(); if (T.wn[k + 1] < 0.7 || T.wp[k + 1] > 2.5 || hypot(T.wp[k], T.wp[k + 2]) > 170 || nearFly(T.wp[k], T.wp[k + 1], T.wp[k + 2], 6)) continue;
    const sc = rr(0.25, 1.3) * (rnd() < 0.1 ? 2 : 1);
    solid(rnd() * 4 | 0, T.wp[k], T.wp[k + 1] + sc * 0.2, T.wp[k + 2], sc, qRand(), 1, rnd(), 1, 0);
  }

  rseed(10);
  for (let i = 0; i < 60000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (hypot(x, z) > 172 || y > -3 || (ny > 0.8 && rnd() < 0.6) || nearFly(x, y, z, 3.5)) continue;
    const sc = (0.35 + 2.1 * pow(rnd(), 2.6)) * (ny > 0.8 ? 0.5 : 1), q = qRand();
    chunks[(sc > 1.15 ? 3 : 0) + (rnd() * 3 | 0)][cellOf(x, z)].push(x - T.wn[k] * sc * 0.3, y - ny * sc * 0.3, z - T.wn[k + 2] * sc * 0.3, sc, q[0], q[1], q[2], q[3], 1, rnd(), sc > 1.15 ? 0 : 96, 0);
  }
  rseed(11);
  for (let i = 0; i < 170000; i++) { // pebbles and rubble on the sea floor
    const k = pickV(), x = T.wp[k] + rr(-0.4, 0.4), z = T.wp[k + 2] + rr(-0.4, 0.4), y = T.wp[k + 1];
    if (T.wn[k + 1] < 0.8 || hypot(x, z) > 170 || nearFly(x, y, z, 1.3)) continue;
    const sc = 0.05 + 0.3 * pow(rnd(), 2), q = qRand();
    nth++ % THIN || chunks[6][cellOf(x, z)].push(x, y - sc * 0.25, z, sc, q[0], q[1], q[2], q[3], 1, rnd(), 44, 0);
  }
  // --- set pieces
  const gy = (x, z) => { const f = floorsAt(x, z); return f.length ? f[f.length - 2] : -45; };
  solid(10, -5, gy(-5, -4) - 0.6, -4, 1, qMul(qAxis(0, 1, 0, 1.2), qMul(qAxis(0, 0, 1, 0.16), qAxis(1, 0, 0, -0.3))), 2, 0.3, 1, 0);          // whale fluke
  solid(11, 59.5, -23, 6, 1, qMul(qAxis(0, 1, 0, -PI / 2), qMul(qAxis(0, 0, 1, -0.1), qAxis(1, 0, 0, 0.32))), 3, 0.5, 1, 0); // ship hull
  // barrel sponges in front of viewpoint 4, small sponges around the fluke base
  rseed(12);
  for (const b of [[7, 3.2, 1.3, 4], [8.4, 4.6, 1.0, 6], [9.6, 2.6, 1.5, 4], [11, 5, 1.1, 5], [8, -3.6, 1.2, 4], [12.5, 2, 1.2, 6], [9, 3.9, 0.8, 4]]) { const p = rel(3, b[0], b[1]), c = POSES[3]; let ux = (c[0] - p[0]) * 0.07, uz = (c[2] - p[1]) * 0.07; const l = hypot(ux, 1, uz); solid(b[3], p[0], gy(p[0], p[1]) - 0.1, p[1], b[2], qFromY(ux / l, 1 / l, uz / l), 4, rnd(), 1, 0); }
  for (let i = 0; i < 9; i++) { const a = rnd() * TAU; const x = -5 + cos(a) * rr(1.2, 2.6), z = -4 + sin(a) * rr(1.5, 4); solid(6, x, gy(x, z) + 0.05, z, rr(0.4, 0.9), qAxis(0, 1, 0, rnd() * 6), 4, rnd(), 1, 0); }

  // --- the clifftop and stairs: palms, wind-sculpted trees, bushes, steps, rails, lamps, benches, the lifeguard tower
  // mesh slots: 0 palm, 1-2 tree, 3 bush, 4 step, 5 rail, 6 lamp, 7 bench, 8-10 tower (concrete, glass and steel, wood)
  // 11-14 people meshes (standing, sitting, lying on a towel, crouching: drawn as animated actors), 15 umbrella, 16 sea lion, 17 cave frame
  const MATOF = [6, 6, 6, 6, 7, 7, 7, 7, 7, 8, 9, 10, 10, 10, 10, 12, 11, 7];
  const deco = Array.from({ length: 18 }, () => []);
  const put = (k, x, y, z, sc, q, seed = rnd()) => deco[k].push(x, y, z, sc, q[0], q[1], q[2], q[3], MATOF[k], seed, 1, 0);
  const topAt = (x, z) => { const f = floorsAt(x, z); return f.length && f[0] > 9 ? f[0] : null; };
  const yawQ = (a) => qAxis(0, 1, 0, a);
  const groundOf = (x, z) => { const f = floorsAt(x, z); return f.length ? f[0] : 0; };
  rseed(15);
  for (const p of [[183, -17], [184, 10], [186, 22], [186, -6], [182, 29], [183, -28], [181, -40], [182, 40], [187, 2]]) { const y = topAt(p[0], p[1]); if (y !== null) put(0, p[0], y - 0.25, p[1], rr(0.9, 1.25), yawQ(rnd() * TAU)); }
  // the point's centre line: z = k * (43.4 + 3.2 * (x - 122) / 50)
  const cz = (k, x) => k * (43.4 + 3.2 * (x - 122) / 50);
  // trees stand on the lawn strip between the path and the rail, leaning inland (+x) away from the wind
  for (const k of [-1, 1]) for (const x of [127, 137, 147, 157, 166]) {
    const z = cz(k, x) + k * rr(2.8, 3.3) * (rnd() < 0.5 ? 1 : -1), y = topAt(x, z); if (y !== null) put(1 + (rnd() * 2 | 0), x + rr(-1, 1), y - 0.15, z, rr(0.8, 1.2), yawQ(rr(-0.4, 0.4)));
  }
  for (const p of [[185, -42], [184, 38], [189, -14], [189, 16]]) { const y = topAt(p[0], p[1]); if (y !== null) put(1 + (rnd() * 2 | 0), p[0], y - 0.15, p[1], rr(0.9, 1.3), yawQ(rr(-0.4, 0.4))); }
  for (let i = 0; i < 90; i++) {
    const t = rnd(), k = rnd() < 0.5 ? -1 : 1, onPoint = rnd() < 0.6;
    const x = onPoint ? mix(124, 168, t) : rr(181, 189), z = onPoint ? cz(k, x) + k * (rnd() < 0.5 ? 1 : -1) * rr(2.6, 5.2) : rr(-60, 60);
    const y = topAt(x, z); if (y === null) continue;
    if (!onPoint && abs(z) < 30 && x < 183) continue;
    put(3, x, y - 0.1, z, rr(0.6, 1.4), yawQ(rnd() * TAU));
  }
  // stairs: steps on the ramp and a rail on the cove side
  for (const sg of [-1, 1]) {
    const a = [138, sg * 34.5, 0.4], b = [170, sg * 37.5, 10.05], hz = hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / hz, uz = (b[1] - a[1]) / hz;
    const hAt = (s) => mix(a[2], b[2], s / hz), yaw = yawQ(atan2(-uz, ux));
    const ns = floor(hz / 0.62);
    for (let j = 0; j < ns; j++) { const s = (j + 0.5) / ns * hz; put(4, a[0] + ux * s, hAt(s) + 0.04, a[1] + uz * s, 1, yaw, 0); }
    const L3 = hypot(hz, b[2] - a[2]), nr = round(L3 / 2), qr = qMul(yaw, qAxis(0, 0, 1, atan2(b[2] - a[2], hz)));
    for (let j = 0; j < nr; j++) { const s = (j + 0.5) / nr * hz; put(5, a[0] + ux * s + sg * uz * 1.65, hAt(s), a[1] + uz * s - sg * ux * 1.65, 1, qr, 0); }
  }
  // rails along the clifftop edges (the lifeguard tower and the stair heads are left open)
  const railLine = (pts, skip) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i], q = pts[i + 1], l = hypot(q[0] - p[0], q[1] - p[1]), n = max(1, round(l / 2)), yaw = yawQ(atan2(-(q[1] - p[1]), q[0] - p[0]));
      for (let j = 0; j < n; j++) {
        const f = (j + 0.5) / n, x = mix(p[0], q[0], f), z = mix(p[1], q[1], f);
        if (skip && skip(x, z)) continue;
        const y = topAt(x, z); if (y !== null) put(5, x, y - 0.05, z, l / n / 2, yaw, 0);
      }
    }
  };
  const nearHead = (x, z) => (x > 160 && abs(abs(z) - 40) < 7) || (abs(z + 10) < 6.5 && x < 180);
  const arc = []; for (let a = -15.4; a <= 15.4; a += 2.2) arc.push([174.6 * cos(a * PI / 180), 174.6 * sin(a * PI / 180)]);
  railLine(arc, nearHead);
  for (const k of [-1, 1]) for (const e of [-1, 1]) railLine([[123, cz(k, 123) + e * 4.3], [166, cz(k, 166) + e * 4.3]], nearHead);
  for (const k of [-1, 1]) railLine([[122.7, cz(k, 122) - 4.3], [122.7, cz(k, 122) + 4.3]]);
  for (const p of [[150, -43.6], [136, -42.8], [150, 46.6], [136, 45.8], [180, -30], [180, 30]]) { const y = topAt(p[0], p[1]); if (y !== null) put(6, p[0], y, p[1], 1, yawQ(0), 0); }
  // benches facing the sea
  for (const p of [[177, -24], [177, 22], [139, cz(-1, 139) + 2.2], [139, cz(1, 139) - 2.2], [152, cz(-1, 152) + 2.2], [152, cz(1, 152) - 2.2]]) { const y = topAt(p[0], p[1]); if (y !== null) put(7, p[0], y, p[1], 1, yawQ(0), 0); }
  // the lifeguard tower, cantilevered over the cliff edge, facing west
  { const x = 177.4, z = -10, y = topAt(x, z); if (y !== null) for (const k of [8, 9, 10]) put(k, x, y, z, 1.5, yawQ(0), 0); }

  // the cave mouth: a concrete lintel and a pillar between the two tunnels
  put(17, 129, 0, 32.6, 1, yawQ(0), 0);

  // --- beach life: people on the north side, sea lions on the south side, swimmers (all are animated actors, see main.js)
  // {k: 'P' person (pose 0 stand, 1 sit, 2 lie, 3 crouch), 'L' sea lion on land, 'S' sea lion swimming, 'N' snorkeler}
  const actors = [];
  const seaA = -PI / 2;   // yaw that turns a figure's front (+z) toward the sea (-x)
  rseed(18);
  const KID = 0.62, ad = () => rr(0.93, 1.06);
  const P = (pose, x, z, yaw, sc, walk) => actors.push({ k: 'P', pose, x, z, yaw, sc, seed: rnd(), walk });
  put(15, 151.5, groundOf(151.5, -26.5), -26.5, 1, yawQ(rnd() * TAU), 0); put(15, 158, groundOf(158, -14), -14, 1, yawQ(rnd() * TAU), 0);
  P(0, 148.4, -29.5, seaA + 0.5, ad()); P(2, 149.2, -24, 0.4, ad()); P(2, 153.4, -24.8, -0.6, ad()); P(1, 151, -29.8, seaA, ad());
  P(3, 145.8, -20.6, seaA + 0.3, KID); P(3, 146.9, -18.8, seaA - 0.6, KID * 1.05); P(0, 143.8, -22.2, seaA + 0.3, ad());
  P(0, 142.6, -16.4, seaA, KID * 1.1); P(0, 143.4, -14.8, seaA - 0.4, ad());
  P(1, 157.2, -16.6, seaA + 0.2, ad()); P(1, 159.2, -16, seaA - 0.2, ad()); P(2, 160, -11.4, 1.3, ad());
  P(3, 154.2, -12.4, seaA, KID); P(0, 156, -9.2, seaA, KID * 1.15);
  P(0, 143.4, -8.4, -0.4 - PI / 2, ad(), [143.4, -8.4, 146.5, -30]); P(0, 144.2, -7.2, -0.4 - PI / 2, ad(), [144.2, -7.2, 147.2, -29]);
  P(0, 148, -34, seaA, ad()); P(0, 150.4, -35.4, seaA + 0.4, KID);
  const blockers = [];
  for (const r of [[139.5, 21, 2.2], [135, 27, 1.8], [142.4, 16.6, 1.4], [131, 31.5, 1.6], [136.5, 18, 1.1]]) { blockers.push([r[0], r[1], r[2] + 0.1]); const y = groundOf(r[0], r[1]); if (y !== null) solid(rnd() * 4 | 0, r[0], y + r[2] * 0.15, r[1], r[2], qMul(qAxis(0, 1, 0, rnd() * 6), qAxis(1, 0, 0, 0.1)), 1, rnd(), 1, 0); }
  for (const a of [[143.5, 22.8, 1, 3.4], [142.3, 25.8, 0.95, 3.9], [138.2, 24.8, 1.05, 3.0], [137.4, 29.6, 0.55, 3.6], [132.5, 28.3, 1, 3.3], [137.8, 31.2, 0.9, 2.8],
    [146, 26, 1, 3.7], [146.5, 19.5, 0.95, 3.1], [139, 15.2, 1.05, 3.9], [134.2, 21.5, 0.5, 3.4], [147.5, 23.5, 1, 3.2], [144.5, 28.8, 0.9, 4.1]]) actors.push({ k: 'L', x: a[0], z: a[1], yaw: a[3], sc: a[2], seed: rnd() });
  // pups: tucked in among the adults
  for (const a of [[141.2, 23.9, 0.5, 3.0], [140, 26.8, 0.45, 3.5], [139.4, 29.6, 0.5, 3.2], [134.2, 30.2, 0.48, 3.9], [148.6, 25.2, 0.5, 3.4], [145.2, 17.4, 0.45, 3.7],
    [141.2, 14.2, 0.5, 3.1], [135.7, 23.2, 0.46, 3.3], [146.6, 30.4, 0.52, 3.8]]) actors.push({ k: 'L', x: a[0], z: a[1], yaw: a[3], sc: a[2], seed: rnd() });
  for (const q of [[121, 2], [112, 20], [124, -30], [108, -14], [117, 36]]) actors.push({ k: 'S', x: q[0], z: q[1], yaw: rnd() * TAU, sc: rr(0.95, 1.1), seed: rnd() });
  for (const q of [[113, -19], [125, 11], [106, 26], [119, -41], [127, -4]]) actors.push({ k: 'N', x: q[0], z: q[1], yaw: rnd() * TAU, sc: 1, seed: rnd() });
  // harbour seals: shy, spotted, swimming offshore (seed >= 10 marks a seal for the shader)
  for (const q of [[99, -26], [103, 14], [96, -6], [107, 34], [101, -40]]) actors.push({ k: 'E', x: q[0], z: q[1], yaw: rnd() * TAU, sc: rr(0.9, 1.1), seed: 10 + rnd() });
  // gulls: on the sand (st 0), floating on the sea (st 1) and in the air (st 2)
  for (const q of [[148, -2, 0], [152, 6, 0], [146, 12, 0], [155, -16, 0], [112, -4, 1], [118, 14, 1], [108, -22, 1], [120, 14, 2], [116, -10, 2], [127, 26, 2]]) actors.push({ k: 'G', x: q[0], z: q[1], yaw: rnd() * TAU, sc: rr(0.95, 1.1), seed: rnd(), st: q[2] });
  // the lifeguard on the tower deck (red top: the seed is picked for it), who shouts at anyone too close to the sea lions
  let gs = 0.05; while (!(((gs * 7.3 + 0.31) % 1) < 0.14)) gs += 0.011;
  actors.push({ k: 'F', pose: 0, x: 172.8, z: -8.7, yaw: -0.8, sc: 1, seed: gs, high: 1, lift: 1.58 });
  // out beyond the cove and the swimmers: kayaks, paddle boards and surfers (seed picks the colours of boards and boats)
  for (const q of [[72, -22], [66, 14], [84, 38]]) actors.push({ k: 'K', x: q[0], z: q[1], yaw: rnd() * TAU, sc: 1, seed: rnd() });
  for (const q of [[60, -8], [78, -36]]) actors.push({ k: 'U', x: q[0], z: q[1], yaw: rnd() * TAU, sc: 1, seed: rnd() });
  for (const q of [[82, -60], [80, -52], [86, -68]]) actors.push({ k: 'R', x: q[0], z: q[1], yaw: rnd() * TAU, sc: 1, seed: rnd(), st: rnd() < 0.5 ? 0 : 1 });
  // visitors who now and then wander over to the sea lions, until someone tells them to keep away
  for (const q of [[152, 0, 0], [154, 2, 0], [150, 3, 0], [155, -2, 1]]) actors.push({ k: 'V', pose: 0, x: q[0], z: q[1], yaw: seaA, sc: q[2] ? KID * 1.15 : ad(), seed: rnd() });
  // pelicans: two on the cliff, one on a sea stack, two afloat and one in the air, all of them fishing now and then (seed >= 5 marks a pelican)
  for (const q of [[174.4, 30, 12], [123.6, 43.4, 12], [101, -70, 8]]) actors.push({ k: 'Q', x: q[0], z: q[1], yaw: rnd() * TAU, sc: 1.25, seed: 5 + rnd(), st: 0, y0: q[2] });
  for (const q of [[118, -28], [110, 22]]) actors.push({ k: 'Q', x: q[0], z: q[1], yaw: rnd() * TAU, sc: 1.25, seed: 5 + rnd(), st: 1, y0: 4 });
  actors.push({ k: 'Q', x: 126, z: 6, yaw: 0, sc: 1.25, seed: 5.6, st: 2, y0: 4 });
  // crabs along the waterline, in the wet sand and the shallows (some start dug in)
  rseed(20);
  for (let i = 0; i < 18; i++) { const z = rr(-36, 34); actors.push({ k: 'X', x: 130 + 14 * (1 - min(z * z / 1600, 1)) + rr(-5, 8), z, yaw: rnd() * TAU, sc: rr(0.7, 1.0), seed: rnd(), st: rnd() < 0.3 ? 2 : 0 }); }
  // tourists on the clifftop, and the chipmunks that beg from them and from you
  actors.push({ k: 'P', pose: 0, x: 176.3, z: -21, yaw: seaA, sc: 1, seed: rnd(), high: 1 }, { k: 'P', pose: 1, x: 177.2, z: 22, yaw: seaA, sc: 1, seed: rnd(), high: 1, lift: 0.34 },
    { k: 'P', pose: 0, x: 141, z: -44.2, yaw: seaA, sc: 0.97, seed: rnd(), high: 1 }, { k: 'P', pose: 0, x: 142.4, z: -43.4, yaw: seaA, sc: KID * 1.1, seed: rnd(), high: 1 });
  for (const q of [[175.8, -19.5], [177, -22.4], [176.6, 20.4], [183, 3], [186, -12], [181, 18], [140, -45.6], [150, -44.8], [160, 46.2], [135, 44.6]]) actors.push({ k: 'C', x: q[0], z: q[1], yaw: rnd() * TAU, sc: 1.6, seed: rnd() });

  // --- grass on the clifftop lawn (leaf type 9), left off the paved path
  const segD = (x, z, ax, az, bx, bz) => { const px = x - ax, pz = z - az, qx = bx - ax, qz = bz - az, t = clamp((px * qx + pz * qz) / (qx * qx + qz * qz), 0, 1); return hypot(px - qx * t, pz - qz * t); };
  const pathD = (x, z) => { let d = 99; for (const k of [-1, 1]) { d = min(d, segD(x, z, 122, k * 43.4, 172, k * 46.6), segD(x, z, 170, k * 37.5, 172, k * 46.6), segD(x, z, 172, k * 46.6, 180, k * 24)); } return min(d, segD(x, z, 180, -24, 180, 24)); };
  rseed(21);
  for (let i = 0; i < 3000000; i++) {
    const k = pickV(), y = T.wp[k + 1]; if (y < 9.2 || T.wn[k + 1] < 0.9) continue;
    const x = T.wp[k], z = T.wp[k + 2]; if (hypot(x, z) > 190 || pathD(x, z) < 2.4 || nearPose(x, z, 1)) continue;
    for (let j = 5 + rnd() * 6 | 0; j > 0; j--) leaf(small, x + rr(-0.45, 0.45), y - 0.03, z + rr(-0.45, 0.45), rr(0.12, 0.4), rnd() * TAU, rr(0.05, 0.6), rr(0.012, 0.022), 0, 9, rnd(), rnd(), rr(0.3, 0.8));
  }

  // --- sea grass in beds on the sand shelf in front of the beach
  rseed(16);
  for (let i = 0; i < 900000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
    if (x < 80 || x > 152 || abs(z) > 66 || y > -1.4 || y < -17 || T.wn[k + 1] < 0.86) continue;
    if (rnd() > sstep(0.36, 0.5, fbm(x * 0.06, 8, z * 0.06, 3)) * sstep(80, 98, x) || nearPose(x, z, 2)) continue;
    for (let j = 30 + rnd() * 24 | 0; j > 0; j--) leaf(small, x + rr(-0.6, 0.6), y - 0.05, z + rr(-0.6, 0.6), rr(0.6, 1.4), rnd() * TAU, rr(0.05, 0.6), rr(0.014, 0.026), 0, 8, rnd(), rnd(), rr(0.35, 0.9));
  }
  // garibaldi: small territorial groups over the rocks and grass
  const gar = [];
  rseed(17);
  for (const g of [[120, -24, 7], [121, 22, 7], [119, 40, 5], [117, -40, 5], [122, 0, 6]]) {
    const f = floorsAt(g[0], g[1]); if (!f.length) continue;
    for (let i = 0; i < g[2]; i++) gar.push(g[0], f[f.length - 2] + 2.0, g[1], rr(2.5, 4.5), 10 + rnd(), (rnd() < 0.5 ? -1 : 1) * rr(0.18, 0.3), rr(0.46, 0.56), rnd());
  }

  // --- bubbles
  const VENTS = [[4, -44, -3], [4.5, -44, -3.5], [-1, -44, 2], [2, -44, -1], [5.5, -44, -7], [3, -44, -9], [6, -44, -90], [8, -44, -84], [4, -44, -93], [-9, -44, 3], [5, -35, -86], [9, -37, -92], [40, -44, 20], [-56, -44, 12], [10, -44, 80], [-2, -44, 30], [0, -44, -30], [12, -44, 2], [6, -44, -2], [46, -44, 30], [-20, -44, -103], [-52, -44, -12], [4, -44, 70], [9, -44, -74], [4, -44, -78], [14, -44, 26], [26, -44, 40], [-45, -44, -64], [-55, -44, -40], [-58, -44, 22], [-40, -44, 40], [-14, -44, 45], [-1, -44, -9], [-7, -44, -6]];
  rseed(13);
  for (const s of spots) if (rnd() < 0.28) VENTS.push(s);
  for (const v of VENTS) {
    const n = 90 + rnd() * 70 | 0, y0 = v[1] === -44 ? gy(v[0], v[2]) : v[1];
    for (let i = 0; i < n; i++) {
      const sz = rnd() < 0.24 ? rr(0.1, 0.3) : rr(0.025, 0.08);
      bubbles.push(v[0] + rr(-0.3, 0.3), y0, v[2] + rr(-0.3, 0.3), sz, rnd(), rr(1.1, 2.4) * (0.6 + sz * 3), -y0 - 0.2, rr(0.05, 0.16));
    }
  }

  // --- pack leaves (36 bytes: 8 floats + 4 unorm8), sorted by culling cell
  const pack = (L, step = 1, wm = 1) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += Math.ceil(L[c].length / 12 / step); }
    start[nCells] = n;
    const buf = new ArrayBuffer(n * 36), f = new Float32Array(buf), u8 = new Uint8Array(buf), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12 * step, k++) {
      for (let j = 0; j < 8; j++) f[k * 9 + j] = a[i + j];
      f[k * 9 + 6] *= wm;
      u8[k * 36 + 32] = a[i + 8]; u8[k * 36 + 33] = a[i + 9] * 255; u8[k * 36 + 34] = a[i + 10] * 255; u8[k * 36 + 35] = a[i + 11] * 255;
      const y = a[i + 1], l = a[i + 3]; if (y - l < lo[c]) lo[c] = y - l; if (y + l > hi[c]) hi[c] = y + l;
    } }
    return { buf, n, start, lo, hi };
  };

  // --- half-res volume: r = openness, g = skylight
  const hx = NX / 2, hy = NY / 2, hz = NZ / 2, volD = new Uint8Array(hx * hy * hz * 2);
  let Lp = new Float32Array(hx * hz).fill(1), Ln = new Float32Array(hx * hz), tmp = new Float32Array(hx * hz);
  for (let y = hy - 1; y >= 0; y--) {
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) { const i = x + hx * z; tmp[i] = (Lp[x > 0 ? i - 1 : i] + 2 * Lp[i] + Lp[x < hx - 1 ? i + 1 : i]) * 0.25; }
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) {
      const i = x + hx * z, b = (tmp[z > 0 ? i - hx : i] + 2 * tmp[i] + tmp[z < hz - 1 ? i + hx : i]) * 0.25;
      const g0 = gi(x * 2, y * 2, z * 2);
      const d = (D[g0] + D[g0 + 1] + D[g0 + NX] + D[g0 + NX + 1] + D[g0 + NX * NY] + D[g0 + NX * NY + 1] + D[g0 + NX * NY + NX] + D[g0 + NX * NY + NX + 1]) * 0.125;
      const o = x + hx * (y + hy * z);
      const l = b * clamp(0.5 - d / 1.5, 0, 1) * (1 - min(kelpAbs[o], 0.5));
      Ln[i] = l;
      volD[o * 2] = clamp(0.5 - d / 12, 0, 1) * 255; volD[o * 2 + 1] = min(1, b) * 255;
    }
    const t = Lp; Lp = Ln; Ln = t;
  }

  // --- ground map: r magenta cover, g beach sand, b purple zone, a sand
  const gm = new Uint8Array(512 * 512 * 4);
  for (let j = 0; j < 512; j++) for (let i = 0; i < 512; i++) {
    const x = (i + 0.5) / 512 * 384 - 192, z = (j + 0.5) / 512 * 384 - 192, o = (i + 512 * j) * 4;
    gm[o] = magAt(x, z) * 255; gm[o + 1] = beachAt(x, z) * 255; gm[o + 2] = zoneP(x, z) * 255; gm[o + 3] = sstep(0.42, 0.6, fbm(x * 0.04, 3, z * 0.04, 3)) * 255;
  }

  // --- fish schools + mantas
  const fish = [];
  rseed(14);
  const SCH = [[-2, -36, -10, 15, 520, 0.3, 1, 0.945], [8, -30, -70, 22, 420, 0.32, -1], [48, -30, 14, 18, 360, 0.3, 1], [-58, -30, -8, 11, 420, 0.28, -1, 0.3], [8, -36, 84, 16, 320, 0.28, 1],
    [-90, -28, -70, 25, 300, 0.3, 1], [95, -30, 70, 25, 300, 0.3, -1], [0, -22, 20, 30, 380, 0.34, -1], [-30, -30, -100, 18, 300, 0.3, 1], [16, -36, 30, 12, 300, 0.3, 1], [-48, -34, -58, 12, 300, 0.3, -1], [-45, -35, 38, 14, 320, 0.3, 1]];
  for (const s of SCH) { const ss = s[7] === undefined ? rnd() : s[7]; for (let i = 0; i < s[4]; i++) fish.push(s[0], s[1], s[2], s[3], rnd(), s[6] * 1.9 / s[3], s[5], ss); }
  const mantas = [];
  for (const m of [[1, -28, 3.5, 14, 3.012, 0.085, 3.6, 0.1], [49, -31, 24.5, 5, 0.029, -0.08, 3.7, 0.4], [0, -14, -80, 34, 0.3, 0.06, 5.2, 0.7], [-50, -18, 20, 26, 5, -0.075, 3.8, 0.55], [10, -16, 86, 26, 2.2, 0.07, 4.4, 0.85], [20, -11, -20, 46, 4.2, -0.045, 5.6, 0.25]]) mantas.push(...m);

  // --- drifting particles
  const snow = new Float32Array(9000 * 4);
  for (let i = 0; i < snow.length; i++) snow[i] = rnd();

  const sol = { data: [], ranges: [] }; let si = 0;
  for (let m = 0; m < 12; m++) { const a = solids[m] || []; sol.ranges.push([si, a.length / 12]); si += a.length / 12; for (let i = 0; i < a.length; i++) sol.data.push(a[i]); }
  const packC = (L) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += L[c].length / 12; }
    start[nCells] = n;
    const data = new Float32Array(n * 12), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12) { for (let j = 0; j < 12; j++) data[k++] = a[i + j]; lo[c] = min(lo[c], a[i + 1] - 3); hi[c] = max(hi[c], a[i + 1] + 3); } }
    return { data, n, start, lo, hi };
  };
  return { blockers, actors, gar: new Float32Array(gar), deco: deco.map((a) => new Float32Array(a)), gy, glints: new Float32Array(glints), chunks: chunks.map(packC), props: props.map(packC), big: pack(big), bigF: pack(big, 2, 1.5), small: pack(small), solids: { data: new Float32Array(sol.data), ranges: sol.ranges }, bubbles: new Float32Array(bubbles), volD, gm, fish: new Float32Array(fish), mantas: new Float32Array(mantas), snow };
}
const fract = (x) => x - floor(x);

// ---------------------------------------------------------------- procedural meshes
function meshChunk(sd, sub = 2, det = sub > 2) {
  if (LV > 1 && sub > 1) sub--; // Low: a quarter of the triangles
  rseed(100 + sd);
  const pl = []; for (let i = 0; i < 4; i++) { const q = qRand(); pl.push([q[0], q[1], q[2], rr(0.8, 0.98)]); const l = hypot(q[0], q[1], q[2]) || 1; pl[i][0] /= l; pl[i][1] /= l; pl[i][2] /= l; }
  return icosphere(sub, (x, y, z) => {
    let r = 1 + (fbm(x * 1.6 + sd, y * 1.6, z * 1.6, 2) - 0.5) * 0.9 + (det ? (fbm(x * 4 + sd, y * 4, z * 4, 2) - 0.5) * 0.25 : 0);
    let px = x * r, py = y * r * 0.8, pz = z * r;
    for (const p of pl) { const d = px * p[0] + py * p[1] + pz * p[2] - p[3]; if (d > 0) { px -= p[0] * d; py -= p[1] * d; pz -= p[2] * d; } }
    return [px, py, pz];
  });
}
function meshLathe(prof, seg, lump, ribs = 0) {
  const m = new Mesh(), rings = [];
  for (const [r, h, ao] of prof) { const ring = []; for (let s = 0; s < seg; s++) { const a = s / seg * TAU, rl = r * (1 + lump * (fbm(cos(a) * 1.5 + h * 2, h * 3, sin(a) * 1.5, 2) - 0.5) + 0.07 * cos(ribs * a + h * 1.5)); ring.push(m.v(cos(a) * rl, h, sin(a) * rl, ao)); } rings.push(ring); }
  for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < seg; s++) { const s2 = (s + 1) % seg; m.quad(rings[k][s], rings[k + 1][s], rings[k + 1][s2], rings[k][s2]); }
  return m;
}
function meshCoral(fan, lo = LV > 1) {
  rseed(200 + fan);
  const m = new Mesh();
  const nrm = (v) => { const l = hypot(...v) || 1; return v.map((c) => c / l); };
  const br = (p, d, r, len, depth) => {
    const pts = [p]; let q = p;
    for (let i = 0; i < 3; i++) { d = nrm([d[0] + rr(-0.3, 0.3), d[1] + rr(-0.1, 0.3), d[2] + (fan ? rr(-0.05, 0.05) : rr(-0.3, 0.3))]); q = [q[0] + d[0] * len / 3, q[1] + d[1] * len / 3, q[2] + d[2] * len / 3]; pts.push(q); }
    if (!depth) pts.push([q[0] + d[0] * r * 1.6, q[1] + d[1] * r * 1.6, q[2] + d[2] * r * 1.6]);
    if (lo) m.tube(depth ? [pts[0], pts[3]] : [pts[0], pts[3], pts[4]], (k) => (k > 1 ? r * 0.36 : r * (1 - 0.22 * k)) * 1.25, 3, true, (k) => clamp(1 - (depth + 1 - k) / 5, 0, 1));
    else m.tube(pts, (k) => k > 3 ? r * 0.36 : r * (1 - 0.22 * k / 3), fan ? 5 : 6, true, (k) => clamp(1 - (depth + 1 - k / 3) / 5, 0, 1));
    if (depth > 0) { const n = 2 + (rnd() < 0.5); for (let i = 0; i < n; i++) br(q, nrm([d[0] + rr(-0.8, 0.8), d[1] + rr(-0.1, 0.5), d[2] + (fan ? rr(-0.08, 0.08) : rr(-0.8, 0.8))]), r * 0.78, len * 0.8, depth - 1); }
  };
  const n0 = fan ? 1 : 2 + (rnd() * 2 | 0);
  for (let i = 0; i < n0; i++) br([rr(-0.08, 0.08), 0, rr(-0.08, 0.08)], nrm([rr(-0.5, 0.5), 1, fan ? 0 : rr(-0.5, 0.5)]), fan ? 0.06 : 0.08, fan ? 0.5 : 0.45, 3);
  return m;
}
function meshTubes() {
  rseed(210);
  const m = new Mesh();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU, r0 = rr(0, 0.28), h = rr(0.45, 1.1), rad = rr(0.07, 0.12), lean = rr(0.05, 0.3), pts = [];
    for (let k = 0; k <= 4; k++) pts.push([cos(a) * (r0 + lean * k / 4 * h), h * k / 4, sin(a) * (r0 + lean * k / 4 * h)]);
    m.tube(pts, (k) => rad * (0.8 + 0.25 * k / 4), 12, false, (k) => 0.35 + 0.65 * k / 4);
    // rim + dark throat
    const e = pts[4], n = m.p.length / 3, c = m.v(e[0], e[1] - rad * 1.2, e[2], 0.05);
    for (let s2 = 0; s2 < 12; s2++) m.tri(n - 12 + s2, n - 12 + (s2 + 1) % 12, c);
  }
  return m;
}
// stone whale fluke: SDF of tapered capsules -> surface nets
function meshFluke() {
  const C = [];
  const chain = (pts, zs) => { for (let i = 0; i < pts.length - 1; i++) C.push([...pts[i], ...pts[i + 1], zs]); };
  chain([[0, -1.6, 3.7, 1.2], [0, 1.8, 2.35, 0.98], [0, 4.6, 1.0, 0.76], [0, 6.9, 0.1, 0.6]], 0.8);
  chain([[0, 6.6, 0.1, 0.72], [1.9, 7.9, 0, 0.98], [3.9, 8.8, -0.1, 0.9], [5.7, 9.8, -0.25, 0.64], [7.0, 11.2, -0.4, 0.38], [7.7, 12.8, -0.55, 0.2], [7.9, 14.1, -0.65, 0.1]], 0.18);
  chain([[0, 6.6, 0.1, 0.72], [-1.7, 8.3, 0.05, 0.96], [-3.3, 9.7, -0.05, 0.88], [-4.7, 11.2, -0.2, 0.64], [-5.6, 12.9, -0.4, 0.38], [-6.0, 14.6, -0.5, 0.2], [-5.9, 15.9, -0.6, 0.1]], 0.18);
  const sdf = (x, y, z) => {
    let d = 1e9;
    for (const c of C) {
      const zs = c[8], pz = z / zs, az = c[2] / zs, bz = c[6] / zs;
      const bax = c[4] - c[0], bay = c[5] - c[1], baz = bz - az, pax = x - c[0], pay = y - c[1], paz = pz - az;
      const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
      const e = (hypot(pax - bax * h, pay - bay * h, paz - baz * h) - mix(c[3], c[7], h)) * zs;
      const k = 0.45, hh = max(k - abs(d - e), 0) / k;
      d = min(d, e) - hh * hh * k * 0.25;
    }
    return d;
  };
  const vs = 0.09, ox = -7.6, oy = -2.6, oz = -2.2, nx = 186, ny = 216, nz = 76, D = new Float32Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) D[x + nx * (y + ny * z)] = -sdf(ox + x * vs, oy + y * vs, oz + z * vs);
  const sn = surfaceNets(D, nx, ny, nz), smp = sampler3(D, nx, ny, nz);
  const vb = new ArrayBuffer(sn.nv * 16), f = new Float32Array(vb), s = new Int8Array(vb);
  for (let k = 0; k < sn.nv; k++) {
    const x = sn.pos[k * 3], y = sn.pos[k * 3 + 1], z = sn.pos[k * 3 + 2], e = 0.7;
    let ax = smp(x - e, y, z) - smp(x + e, y, z), ay = smp(x, y - e, z) - smp(x, y + e, z), az = smp(x, y, z - e) - smp(x, y, z + e);
    const l = hypot(ax, ay, az) || 1;
    f[k * 4] = ox + x * vs; f[k * 4 + 1] = oy + y * vs; f[k * 4 + 2] = oz + z * vs;
    s[k * 16 + 12] = round(ax / l * 127); s[k * 16 + 13] = round(ay / l * 127); s[k * 16 + 14] = round(az / l * 127); s[k * 16 + 15] = 127;
  }
  return { vb, ib: new Uint32Array(sn.idx), nv: sn.nv };
}
// sunken ship (bow at +x): keel with stem and stern posts, curved ribs, hull planking with a breach,
// raised stern castle with transom, deck remnants, two masts with yards, bowsprit
function meshShip() {
  rseed(220);
  const m = new Mesh(), Lh = 17, B = 5.6, Dp = 7.6;
  const hb = (x) => B * pow(max(1 - pow(abs(x / Lh), x < 0 ? 3.6 : 2.6), 0), 0.5);
  const dp = (x) => Dp * (1 - 0.36 * pow(abs(x / Lh), 2.5));
  const sheer = (x) => 0.5 + (x > 0 ? 3.0 : 3.8) * pow(abs(x / Lh), 2.2);
  const pt = (x, ph, off = 0) => { const b = hb(x) + off, d = dp(x) + off, s = sheer(x); return [x, s - (d + s) * pow(max(cos(ph), 0), 0.66), b * Math.sign(ph) * pow(abs(sin(ph)), 0.8)]; };
  const out = (p) => { const l = hypot(p[1] + 0.5, p[2] * 1.3) || 1; return [0, (p[1] + 0.5) / l, p[2] * 1.3 / l]; };
  const up = () => [0, 1, 0];
  const keel = [];
  for (let i = 0; i <= 44; i++) { const x = mix(-Lh - 1.0, Lh + 2.4, i / 44), e = max(abs(x) / Lh - 0.78, 0) * 4.2; keel.push([x, -dp(clamp(x, -Lh, Lh)) - 0.3 + e * e * e * 4.2, 0]); }
  m.sweep(keel, 0.55, 0.95, up);
  for (let x = -Lh + 0.7; x < Lh - 0.3; x += 0.8) {
    const a0 = rnd() < 0.1 ? rr(-0.9, -0.2) : -PI / 2, a1 = rnd() < 0.1 ? rr(0.2, 0.9) : PI / 2, pts = [];
    for (let i = 0; i <= 16; i++) pts.push(pt(x, mix(a0, a1, i / 16)));
    m.sweep(pts, 0.24, 0.3, out);
  }
  const holeX = rr(-6, 2), holeS = rnd() < 0.5 ? 1 : -1;
  const BR = [[holeX, holeS * 0.8, 3.2, 0.42], [7, -holeS * 0.95, 2.4, 0.34], [12, holeS * 0.5, 1.7, 0.28], [-11, -holeS * 0.55, 2.1, 0.3]];
  const holed = (x, ph) => { for (const h of BR) { const a = (x - h[0]) / h[2], b = (ph - h[1]) / h[3]; if (a * a + b * b < 1 + 0.45 * sin(x * 3.1 + ph * 9)) return true; } return false; };
  const NS = 14, xs = []; for (let x = -Lh + 0.35; x <= Lh - 0.3; x += 0.85) xs.push(x);
  for (let j = 0; j < NS; j++) {
    const p0 = mix(-1.5, 1.5, j / NS), p1 = mix(-1.5, 1.5, (j + 1) / NS), sg = p0 + p1 < 0 ? -1 : 1, lo = sg < 0 ? p1 : p0, hi = sg < 0 ? p0 : p1;
    let pv = null;
    for (const x of xs) {
      const cu = [m.v(...pt(x, lo, 0.27)), m.v(...pt(x, hi, 0.14)), m.v(...pt(x, lo, 0.1)), m.v(...pt(x, hi, 0.1))];
      if (pv && !holed(x - 0.42, (p0 + p1) / 2)) {
        if (sg > 0) { m.quad(pv[0], pv[1], cu[1], cu[0]); m.quad(pv[2], cu[2], cu[3], pv[3]); }
        else { m.quad(pv[0], cu[0], cu[1], pv[1]); m.quad(pv[2], pv[3], cu[3], cu[2]); }
      }
      pv = cu;
    }
  }
  for (const sgn of [-1, 1]) {
    let pts = []; for (let x = -Lh + 0.6; x <= Lh - 0.6; x += 1) pts.push(pt(x, sgn * PI / 2, 0.2)); m.sweep(pts, 0.3, 0.28, up);
    // stern castle bulwarks
    for (let j = 0; j < 3; j++) { pts = []; for (let x = -Lh + 0.4; x <= -Lh + 8.5 - j; x += 0.9) pts.push([x, sheer(x) + 0.55 + j * 0.86, sgn * (max(hb(x), 2.6) + 0.15)]); m.sweep(pts, 0.82, 0.09, () => [0, 0, sgn]); }
  }
  // transom
  for (let y = -3; y < sheer(-Lh) + 3; y += 0.86) { const w = max(1.2, 2.9 * sstep(-4.5, 1.5, y)); if (rnd() < 0.9) m.sweep([[-Lh + 0.35, y, -w], [-Lh + 0.35, y, w]], 0.82, 0.1, () => [1, 0, 0]); }
  for (let x = -Lh + 2; x < Lh - 2; x += rr(1.8, 3.2)) m.sweep([[x, sheer(x) - 0.25, -hb(x)], [x, sheer(x) - 0.2, 0], [x, sheer(x) - 0.25, hb(x)]], 0.26, 0.26, up);
  for (let z = -3.9; z <= 3.9; z += 0.62) { let x = -Lh + rr(1, 5); while (x < Lh - 4) { const x1 = min(x + rr(3, 9), Lh - 3.5); if (rnd() < 0.6) { const pts = []; for (let xx = x; xx <= x1; xx += 1) if (hb(xx) > abs(z) + 0.3) pts.push([xx, sheer(xx) - 0.05, z]); if (pts.length > 1) m.sweep(pts, 0.56, 0.07, up); } x = x1 + rr(0.5, 3); } }
  // foremast with yard, broken main mast, bowsprit
  m.sweep([[7, -Dp + 0.6, 0], [7.1, 1, 0], [7.4, 8, 0.3], [7.8, 15, 0.8]], (k) => 0.62 - k * 0.1, (k) => 0.62 - k * 0.1, () => [1, 0, 0]);
  m.sweep([[7.5, 9.5, -5.2], [7.5, 9.6, 0.3], [7.5, 9.2, 5.6]], 0.26, 0.26, up);
  m.sweep([[7.7, 13.2, -3.2], [7.7, 13.3, 3.6]], 0.2, 0.2, up);
  m.sweep([[-3, -Dp + 0.6, 0], [-3.2, 1, 0.2], [-3.9, 6, 1.0], [-5.2, 9.5, 2.6]], (k) => 0.74 - k * 0.1, (k) => 0.74 - k * 0.1, () => [1, 0, 0]);
  m.sweep([[Lh + 1.4, 2.6, 0], [Lh + 8, 5.2, 0.2]], 0.34, 0.34, up);
  return m;
}
// manta ray: span along x (half span = 1), nose +z; aux = span coordinate for the flap animation
function meshManta() {
  const m = new Mesh(), NU = 72, M = 22, rings = [];
  for (let j = 0; j <= NU; j++) {
    const u = j / NU * 2 - 1, au = abs(u);
    let zl = 0.52 - 0.74 * pow(au, 1.35) + 0.07 * exp(-pow((au - 0.13) / 0.05, 2)) - 0.05 * exp(-pow(au / 0.05, 2)) - 0.08 * pow(au, 5);
    const zt = -0.5 + 0.3 * pow(au, 0.8) + 0.02 - 0.08 * pow(au, 5);
    if (zl < zt + 0.004) zl = zt + 0.004;
    const th = 0.08 * pow(1 - au, 1.15) + 0.004 + 0.12 * exp(-pow(u / 0.2, 2)), ring = [];
    for (let k = 0; k < M; k++) { const a = k / M * TAU; ring.push(m.v(u, th * sin(a) * (0.62 + 0.38 * cos(a)), mix(zt, zl, 0.5 + 0.5 * cos(a)), u)); }
    rings.push(ring);
  }
  for (let j = 0; j < NU; j++) for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; m.quad(rings[j][k], rings[j + 1][k], rings[j + 1][k2], rings[j][k2]); }
  const tail = []; for (let i = 0; i <= 8; i++) tail.push([0, 0, -0.42 - i * 0.19]);
  const n0 = m.p.length / 3;
  m.tube(tail, (k) => 0.016 * (1 - k / 9), 4, true);
  for (let k = n0; k < m.aux.length; k++) m.aux[k] = 0;
  for (const sx of [-1, 1]) { // cephalic fins
    const n1 = m.p.length / 3;
    m.tube([[sx * 0.12, -0.02, 0.48], [sx * 0.135, -0.05, 0.6], [sx * 0.115, -0.09, 0.69], [sx * 0.085, -0.125, 0.74]], (k) => 0.045 * (1 - k / 4.4), 6, true);
    for (let k = n1; k < m.aux.length; k++) m.aux[k] = sx * 0.1;
  }
  return m;
}
function meshFish() {
  const m = new Mesh();
  const X = [0.5, 0.3, 0.05, -0.22, -0.34], H = [0.01, 0.13, 0.17, 0.09, 0.035], Wd = [0.01, 0.05, 0.065, 0.03, 0.012], rings = [];
  for (let i = 0; i < 5; i++) { const r = []; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; r.push(m.v(X[i], sin(a) * H[i], cos(a) * Wd[i])); } rings.push(r); }
  for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) { const k2 = (k + 1) % 6; m.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]); }
  const a = m.v(-0.33, 0, 0), b = m.v(-0.56, 0.2, 0), c = m.v(-0.47, 0, 0), d = m.v(-0.56, -0.2, 0);
  m.tri(a, b, c); m.tri(a, c, d);
  return m;
}

// ---------------------------------------------------------------- clifftop meshes: foliage has a negative aux (ao)
const merge = (m, o, ox, oy, oz, auxFn) => {
  const n = m.p.length / 3;
  for (let k = 0; k < o.p.length; k += 3) m.v(o.p[k] + ox, o.p[k + 1] + oy, o.p[k + 2] + oz, auxFn ? auxFn(o.p[k], o.p[k + 1], o.p[k + 2]) : o.aux[k / 3]);
  for (const i of o.i) m.i.push(i + n);
};
const foliage = (m, n0, ref) => { for (let k = n0; k < m.aux.length; k++) m.aux[k] = -clamp(0.3 + 0.7 * ref(m.p[k * 3], m.p[k * 3 + 1], m.p[k * 3 + 2], m.aux[k]), 0.1, 1); };
// a wind-trimmed clump of foliage: flat-topped, cut away on the windward (-x) side
const blob = (m, cx, cy, cz, R, sq = 0.55) => {
  for (let i = 0; i < 6; i++) {   // a heap of overlapping lumps, thrown a little downwind (+x), flatter on top
    const an = rnd() * TAU, d = i ? R * rr(0.3, 0.6) : 0, r = R * (i ? rr(0.45, 0.62) : 0.7), sd = rnd() * 50, ox = cx + 0.25 * R + cos(an) * d, oy = cy + (i ? rr(-0.12, 0.12) * R : 0.05 * R), oz = cz + sin(an) * d;
    const o = icosphere(2, (x, y, z) => {
      const k = r * (1 + (fbm(x * 2 + sd, y * 2, z * 2, 3) - 0.5) * 0.3);
      let py = y * k * sq * 1.3; if (py > 0.5 * r * sq) py = 0.5 * r * sq + (py - 0.5 * r * sq) * 0.3;
      return [x * k, py, z * k];
    });
    const n0 = m.p.length / 3;
    merge(m, o, ox, oy, oz, () => 1);
    foliage(m, n0, (x, y) => (y - cy) / (R * sq) * 0.5 + 0.55);
  }
};
const CROWN = {};   // canopy discs [x, topY, z, radius] of each tree mesh, so birds can perch on them
function meshPalm() {
  rseed(230);
  const m = new Mesh(), H = 9, pts = [];
  for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([sin(t * 1.3) * 0.5 * t, H * t, cos(t * 1.1) * 0.25 * t]); }
  m.tube(pts, (k) => 0.3 * (1 - 0.35 * k / 8) + (k === 0 ? 0.12 : 0), 8, true, (k) => 0.4 + 0.6 * k / 8);
  const top = pts[8];
  // dead fronds hang below the crown (bark colour), living ones arch out above it
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + rr(-0.2, 0.2), len = rr(1.9, 2.5), fp = [];
    for (let k = 0; k <= 5; k++) { const t = k / 5; fp.push([top[0] + cos(a) * len * t * 0.8, top[1] - 0.1 - len * t * 0.95 * t * 0.5 - t * 0.6, top[2] + sin(a) * len * t * 0.8]); }
    blade(m, fp, [0, 1, 2, 3, 4, 5].map((k) => 0.15 + 0.5 * sin(PI * (k + 0.5) / 6)), 0.04, 1, 3);
  }
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * TAU + rr(-0.15, 0.15), len = rr(2.3, 3.2), up = rr(0.25, 1.0), fp = [], n0 = m.aux.length;
    for (let k = 0; k <= 6; k++) { const t = k / 6; fp.push([top[0] + cos(a) * len * t, top[1] + 0.15 + len * (up * sin(t * 1.9) - t * t * (0.9 + 0.5 * (1 - up))), top[2] + sin(a) * len * t]); }
    blade(m, fp, [0, 1, 2, 3, 4, 5, 6].map((k) => 0.1 + 1.1 * sin(PI * (k + 0.6) / 7.2)), 0.03, 1, 3);
    foliage(m, n0, (x, y) => 0.45 + 0.5 * ((y - top[1]) / 2 + 0.5));
  }
  CROWN.p = [[top[0], top[1] + 0.45, top[2], 1.5]];
  return m;
}
function meshTree(seed) {
  rseed(240 + seed);
  const m = new Mesh(), H = rr(4.5, 6.2), pts = [], z0 = rr(-0.6, 0.6);
  for (let k = 0; k <= 6; k++) { const t = k / 6; pts.push([H * (0.4 * t * t + 0.06 * t), H * t, z0 * sin(t * 2.2)]); }
  m.tube(pts, (k) => 0.4 * (1 - 0.72 * k / 6) + (k === 0 ? 0.15 : 0), 7, true, (k) => 0.35 + 0.65 * k / 6);
  const top = pts[6];
  const cw = [], bl = (x, y, z, R) => { blob(m, x, y, z, R); cw.push([x + 0.25 * R, y + 0.4 * R, z, R * 0.7]); };
  bl(top[0] + 0.8, top[1] + 0.2, top[2], rr(1.8, 2.4));
  for (let i = 0; i < 4; i++) {
    const t = rr(0.45, 0.85), s = pts[min(6, round(t * 6))], a = rr(-1.3, 1.3), len = rr(2, 3.6), e = [s[0] + cos(a) * len, s[1] + rr(0.3, 1.2), s[2] + sin(a) * len];
    m.tube([s, [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2 + 0.2, (s[2] + e[2]) / 2], e], (k) => 0.17 * (1 - 0.6 * k / 2), 5, true, () => 0.7);
    bl(e[0] + 0.5, e[1] + 0.1, e[2], rr(1.3, 2));
  }
  CROWN['t' + seed] = cw;
  return m;
}
function meshBush() {
  rseed(250);
  const m = new Mesh();
  for (let i = 0; i < 3; i++) blob(m, rr(-0.5, 0.5), 0.3, rr(-0.5, 0.5), rr(0.55, 0.85), 0.8);
  return m;
}
// a box with its top at y = 0: x in [x0, x1], z in [-hz, hz], y down to -dy
function box(m, x0, x1, hz, dy, y0 = 0, zc = 0) {
  const v = [[x0, y0 - dy, zc - hz], [x1, y0 - dy, zc - hz], [x1, y0, zc - hz], [x0, y0, zc - hz], [x0, y0 - dy, zc + hz], [x1, y0 - dy, zc + hz], [x1, y0, zc + hz], [x0, y0, zc + hz]];
  for (const f of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]]) { const q = f.map((i) => m.v(...v[i], 1)); m.quad(...q); }
}
const meshStep = () => { const m = new Mesh(); box(m, -0.33, 0.33, 1.72, 0.32); return m; };
function meshRail() {
  const m = new Mesh();
  for (const x of [-0.97, 0.97]) box(m, x - 0.04, x + 0.04, 0.04, 1.0, 1.0);
  box(m, -1, 1, 0.03, 0.05, 1.02); box(m, -1, 1, 0.025, 0.04, 0.55);
  return m;
}
function meshLamp() {
  const m = new Mesh();
  m.tube([[0, 0, 0], [0, 2, 0], [0, 4.2, 0]], (k) => 0.09 - k * 0.012, 6, true, () => 0.8);
  box(m, -0.2, 0.2, 0.2, 0.3, 4.55);
  return m;
}

function meshGaribaldi() {
  const m = new Mesh(), X = [0.5, 0.34, 0.1, -0.16, -0.3], H = [0.02, 0.19, 0.26, 0.16, 0.05], Wd = [0.01, 0.055, 0.07, 0.04, 0.015], rings = [];
  for (let i = 0; i < 5; i++) { const r = []; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; r.push(m.v(X[i], sin(a) * H[i], cos(a) * Wd[i])); } rings.push(r); }
  for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) { const k2 = (k + 1) % 6; m.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]); }
  const a = m.v(-0.29, 0, 0), b = m.v(-0.55, 0.22, 0), c = m.v(-0.46, 0, 0), d = m.v(-0.55, -0.22, 0);
  m.tri(a, b, c); m.tri(a, c, d);
  const f0 = m.v(0.22, 0.2, 0), f1 = m.v(0.04, 0.4, 0), f2 = m.v(-0.2, 0.3, 0), f3 = m.v(-0.3, 0.12, 0); m.tri(f0, f1, f2); m.tri(f0, f2, f3);
  const g0 = m.v(0.0, -0.22, 0), g1 = m.v(-0.14, -0.34, 0), g2 = m.v(-0.26, -0.1, 0); m.tri(g0, g1, g2);
  return m;
}
function meshBench() {
  const m = new Mesh();
  box(m, -0.35, 0.35, 0.9, 0.08, 0.48); box(m, 0.28, 0.36, 0.9, 0.5, 0.95);
  for (const z of [-0.7, 0.7]) box(m, -0.3, 0.3, 0.06, 0.48, 0.48, z);
  return m;
}
// the tower faces -x. Concrete: pedestal. Glass and steel: front window, side panes, deck rail. Wood: cabin, roof, slats, deck.
function meshTowerC() {
  const m = new Mesh();
  box(m, -4.4, 2.2, 2.7, 3.2, 0.9); box(m, -3.2, 1.4, 2.0, 3.0, -2.3);
  return m;
}
function meshTowerG() {
  const m = new Mesh();
  // slanted front window, leaning out at the top
  const f = [[-1.7, 0.95, -1.5], [-1.7, 0.95, 1.5], [-2.35, 3.45, 1.5], [-2.35, 3.45, -1.5]].map((p) => m.v(...p, 1)); m.quad(...f);
  for (const z of [-1.55, 1.55]) { const s = [[-1.7, 0.95, z], [-2.35, 3.45, z], [-1.7, 3.45, z], [-1.7, 0.95, z]].map((p) => m.v(...p, 1)); m.tri(s[0], s[1], s[2]); }
  // deck rail
  for (const z of [-2.3, 2.3]) for (const x of [-4.1, -2.8, -1.8]) box(m, x - 0.03, x + 0.03, 0.03, 1.0, 2.05, z);
  for (const y of [2.05, 1.7, 1.35]) { box(m, -4.14, -4.08, 2.3, 0.03, y); for (const z of [-2.3, 2.3]) box(m, -4.1, -1.8, 0.015, 0.03, y, z); }
  return m;
}
function meshTowerW() {
  const m = new Mesh();
  box(m, -4.2, 1.9, 2.4, 0.2, 1.05);                // deck
  box(m, -1.0, 1.8, 1.6, 2.5, 3.45); box(m, -1.7, -1.0, 0.1, 2.5, 3.45);   // cabin back and a mullion
  for (const z of [-1.6, 1.6]) box(m, -1.7, 1.8, 0.05, 2.5, 3.45, z);
  box(m, -4.9, 2.1, 2.5, 0.22, 3.8);                  // roof
  for (let z = -2.2; z <= 2.2; z += 0.55) box(m, -5.6, -4.9, 0.1, 0.2, 3.7 - (z + 2.2) * 0.03, z);   // slats beyond the roof
  return m;
}

// ---------------------------------------------------------------- people, animals
// the aux value of a vertex is its body part. People: skin .15, top .4, bottom .6, hair .78 (also eyes, nose), bright .93.
// Sea lions and seals: fur .5, flippers and ears .65, eyes and nose .78, whiskers .93. Gulls: body .1, wing .3, wing tip .5, beak .7, feet .85, eye .95.
const AUX = { skin: 0.15, top: 0.4, bottom: 0.6, hair: 0.78, bright: 0.93 };
const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
// Catmull-Rom resampling of a path of number arrays (position, radii, ...): f points per segment, so bodies come out smooth
function resample(P, f) {
  const n = P.length, out = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < f; j++) {
    const t = j / f, a = P[max(i - 1, 0)], b = P[i], c = P[i + 1], d = P[min(i + 2, n - 1)];
    out.push(b.map((_, k) => cr(a[k], b[k], c[k], d[k], t)));
  }
  out.push(P[n - 1].slice());
  return out;
}
const limb = (m, pts, rad, aux, sides = 10, f = 3) => { const R = resample(pts.map((p, k) => [p[0], p[1], p[2], rad[k]]), f); m.tube(R.map((r) => [r[0], r[1], r[2]]), (k) => R[k][3], sides, true, () => aux); };
const ball = (m, c, r, aux, sy = 1, sub = 1) => { const o = icosphere(sub, (x, y, z) => [x * r, y * r * sy, z * r]); merge(m, o, c[0], c[1], c[2], () => aux); };
const mergeT = (m, o, tf) => { const n = m.p.length / 3; for (let k = 0; k < o.p.length; k += 3) { const q = tf(o.p[k], o.p[k + 1], o.p[k + 2]); m.v(q[0], q[1], q[2], o.aux[k / 3]); } for (const i of o.i) m.i.push(i + n); };
// a flat paddle or blade along a path with a width at every point (flippers, wings, tails)
function blade(m, pts, w, thick, aux, f = 3, up = [0, 1, 0]) {
  const R = resample(pts.map((p, k) => [p[0], p[1], p[2], w[k]]), f), n0 = m.aux.length;
  m.sweep(R.map((r) => [r[0], r[1], r[2]]), (k) => R[k][3], thick, () => up);
  for (let k = n0; k < m.aux.length; k++) m.aux[k] = aux;
}
// stacked elliptical rings in the XZ plane: R = [x, y, z, rx, rz, aux], smoothed; give a colour change two rings at the same height
function rings(m, R, sides = 14, f = 2) {
  const runs = []; let cur = [R[0]];
  for (let i = 1; i < R.length; i++) { if (R[i][1] === R[i - 1][1]) { runs.push(cur); cur = [R[i]]; } else cur.push(R[i]); }
  runs.push(cur);
  const all = [];
  for (const run of runs) for (const r of run.length > 1 ? resample(run.map((q) => q.slice(0, 5)), f) : [run[0].slice(0, 5)]) all.push(r.concat(run[0][5]));
  const out = [];
  for (const r of all) { const ring = []; for (let s = 0; s < sides; s++) { const a = s / sides * TAU; ring.push(m.v(r[0] + cos(a) * r[3], r[1], r[2] + sin(a) * r[4], r[5])); } out.push(ring); }
  for (let k = 0; k < out.length - 1; k++) for (let s = 0; s < sides; s++) { const s2 = (s + 1) % sides; m.quad(out[k][s], out[k][s2], out[k + 1][s2], out[k + 1][s]); }
  for (const [ring, r] of [[out[0], all[0]], [out[out.length - 1], all[all.length - 1]]]) { const c = m.v(r[0], r[1], r[2], r[5]); for (let s = 0; s < sides; s++) m.tri(ring[s], ring[(s + 1) % sides], c); }
}
const plimb = (m, pts, rad, aux, sides = 12, f = 3) => limb(m, pts, rad.map((r) => r * 0.9), aux, sides, f);
const prings = (m, R, sides = 16, f = 3) => prings0(m, R, sides, f);
function prings0(m, R, sides, f) { rings(m, R.map((r) => [r[0], r[1], r[2], r[3] * 0.92, r[4] * 0.9, r[5]]), sides, f); }
function head(m, c) {
  const A = AUX, LP = 0.29, WH = 1;
  ball(m, c, 0.098, A.skin, 1.14, 2);
  ball(m, [c[0], c[1] - 0.034, c[2] + 0.042], 0.07, A.skin, 0.95, 2);                         // jaw, cheeks and chin
  ball(m, [c[0], c[1] - 0.052, c[2] + 0.07], 0.03, A.skin, 0.8, 1);
  ball(m, [c[0], c[1] - 0.008, c[2] + 0.094], 0.017, A.skin, 1.3, 2);                         // nose
  ball(m, [c[0], c[1] - 0.04, c[2] + 0.088], 0.017, LP, 0.45, 1);                             // lips
  for (const s of [-1, 1]) {
    ball(m, [c[0] + s * 0.098, c[1] - 0.005, c[2] - 0.005], 0.021, A.skin, 1.25, 1);          // ears
    ball(m, [c[0] + s * 0.037, c[1] + 0.014, c[2] + 0.084], 0.0125, WH, 0.8, 1);              // the white of the eye
    ball(m, [c[0] + s * 0.037, c[1] + 0.014, c[2] + 0.093], 0.0075, A.hair, 1, 1);            // the iris
    limb(m, [[c[0] + s * 0.018, c[1] + 0.042, c[2] + 0.088], [c[0] + s * 0.058, c[1] + 0.046, c[2] + 0.08]], [0.005, 0.004], A.hair, 4, 1);   // brows
  }
  ball(m, [c[0], c[1] + 0.03, c[2] - 0.014], 0.106, A.hair, 0.78, 2); ball(m, [c[0], c[1] - 0.025, c[2] - 0.078], 0.07, A.hair, 1.05, 1);
  ball(m, [c[0], c[1] + 0.066, c[2] + 0.05], 0.05, A.hair, 0.5, 1);                           // a fringe
}
const hand = (m, c, s, aux) => {
  ball(m, c, 0.026, aux, 1.4);                                                                 // palm
  for (let k = 0; k < 4; k++) plimb(m, [[c[0] + s * (-0.012 + k * 0.008), c[1] - 0.025, c[2] + 0.01], [c[0] + s * (-0.012 + k * 0.008), c[1] - 0.06 - (k === 1 || k === 2 ? 0.01 : 0), c[2] + 0.02]], [0.0075, 0.005], aux, 5, 1);   // fingers
  plimb(m, [[c[0] - s * 0.02, c[1] + 0.005, c[2] + 0.012], [c[0] - s * 0.03, c[1] - 0.03, c[2] + 0.03]], [0.009, 0.006], aux, 5, 1);               // thumb
};
const foot = (m, s, y0, z0, aux) => {
  plimb(m, [[s * 0.105, y0 + 0.02, z0 - 0.04], [s * 0.105, y0 - 0.005, z0 + 0.06], [s * 0.105, y0 - 0.015, z0 + 0.14]], [0.044, 0.042, 0.032], aux, 10, 2);
  for (let k = 0; k < 5; k++) ball(m, [s * (0.105 + (2 - k) * 0.0095 * (s > 0 ? -1 : 1) * -1), y0 - 0.014, z0 + 0.165 - (k === 0 ? 0.0 : 0.006 * k)], 0.0085 - k * 0.0007, aux, 0.8, 1);
};
// an upright person (the other poses are built from it or bend its parts)
function bodyStanding(m) {
  const A = AUX;
  prings(m, [[0, 0.88, 0, 0.16, 0.11, A.bottom], [0, 0.97, 0, 0.158, 0.108, A.bottom], [0, 0.97, 0, 0.165, 0.112, A.top], [0, 1.1, 0, 0.14, 0.095, A.top], [0, 1.25, 0, 0.15, 0.1, A.top], [0, 1.36, 0, 0.17, 0.112, A.top], [0, 1.43, 0, 0.19, 0.1, A.top], [0, 1.47, 0, 0.1, 0.07, A.top]]);
  plimb(m, [[0, 1.46, 0], [0, 1.57, 0.008]], [0.05, 0.043], A.skin); head(m, [0, 1.67, 0.012]);
  prings(m, [[0, 1.44, 0, 0.1, 0.08, A.top], [0, 1.47, 0, 0.075, 0.062, A.top]], 14, 1);   // collar
  for (const s of [-1, 1]) {
    plimb(m, [[s * 0.095, 0.93, 0], [s * 0.098, 0.72, 0.01], [s * 0.1, 0.62, 0.015]], [0.09, 0.083, 0.074], A.bottom);
    plimb(m, [[s * 0.1, 0.62, 0.015], [s * 0.1, 0.5, 0.02], [s * 0.103, 0.28, 0], [s * 0.105, 0.08, 0]], [0.07, 0.062, 0.056, 0.04], A.skin); foot(m, s, 0.05, 0, A.skin);
    ball(m, [s * 0.185, 1.4, 0], 0.056, A.top, 1);                                                        // the shoulder
    plimb(m, [[s * 0.2, 1.4, 0], [s * 0.235, 1.17, 0.01]], [0.062, 0.052], A.top);
    plimb(m, [[s * 0.235, 1.17, 0.01], [s * 0.245, 1.05, 0.04], [s * 0.25, 0.93, 0.07]], [0.045, 0.04, 0.034], A.skin); hand(m, [s * 0.255, 0.88, 0.08], s, A.skin);
  }
}
// pose 0 standing and walking, 1 sitting on the sand, 2 lying on a towel, 3 crouching (digging), 4 snorkeler
function meshPerson(pose) {
  const m = new Mesh(), A = AUX;
  if (pose === 0) bodyStanding(m);
  else if (pose === 1) {
    prings(m, [[0, 0.1, 0, 0.16, 0.12, A.bottom], [0, 0.22, -0.01, 0.158, 0.112, A.bottom], [0, 0.22, -0.01, 0.165, 0.115, A.top], [0, 0.34, -0.03, 0.14, 0.095, A.top], [0, 0.5, -0.05, 0.165, 0.105, A.top], [0, 0.62, -0.07, 0.19, 0.1, A.top], [0, 0.67, -0.075, 0.1, 0.07, A.top]]);
    plimb(m, [[0, 0.66, -0.075], [0, 0.76, -0.07]], [0.05, 0.043], A.skin); head(m, [0, 0.86, -0.058]);
    for (const s of [-1, 1]) {
      plimb(m, [[s * 0.095, 0.13, 0], [s * 0.1, 0.25, 0.22], [s * 0.1, 0.37, 0.42]], [0.09, 0.082, 0.068], A.bottom);
      plimb(m, [[s * 0.1, 0.37, 0.42], [s * 0.105, 0.2, 0.6], [s * 0.11, 0.06, 0.72]], [0.062, 0.054, 0.04], A.skin); foot(m, s, 0.05, 0.72, A.skin);
      plimb(m, [[s * 0.2, 0.6, -0.06], [s * 0.23, 0.45, 0.02]], [0.062, 0.052], A.top);
      plimb(m, [[s * 0.23, 0.45, 0.02], [s * 0.2, 0.43, 0.2], [s * 0.16, 0.4, 0.38]], [0.045, 0.04, 0.034], A.skin); hand(m, [s * 0.15, 0.4, 0.41], s, A.skin);
    }
  } else if (pose === 2) {
    const o = new Mesh(); bodyStanding(o);
    mergeT(m, o, (x, y, z) => [x, z + 0.12, -y]);                              // laid on the back, head toward -z
    const n0 = m.p.length / 3; box(m, -0.5, 0.5, 1.05, 0.03, 0.03, -0.7); for (let k = n0; k < m.aux.length; k++) m.aux[k] = A.bright;
  } else if (pose === 3) {
    plimb(m, [[0, 0.3, -0.12], [0, 0.47, -0.02], [0, 0.66, 0.1]], [0.15, 0.15, 0.16], A.top, 12);
    plimb(m, [[0, 0.66, 0.1], [0, 0.73, 0.15]], [0.05, 0.045], A.skin); head(m, [0, 0.84, 0.2]);
    ball(m, [0, 0.3, -0.1], 0.16, A.bottom, 0.8);
    for (const s of [-1, 1]) {
      plimb(m, [[s * 0.1, 0.3, -0.08], [s * 0.13, 0.36, 0.22]], [0.088, 0.07], A.bottom); plimb(m, [[s * 0.13, 0.36, 0.22], [s * 0.115, 0.2, 0.17], [s * 0.11, 0.04, 0.1]], [0.062, 0.052, 0.042], A.skin); foot(m, s, 0.03, 0.05, A.skin);
      plimb(m, [[s * 0.19, 0.63, 0.08], [s * 0.22, 0.42, 0.2]], [0.06, 0.05], A.top); plimb(m, [[s * 0.22, 0.42, 0.2], [s * 0.19, 0.25, 0.3], [s * 0.17, 0.07, 0.4]], [0.044, 0.038, 0.034], A.skin); hand(m, [s * 0.17, 0.05, 0.42], s, A.skin);
    }
  } else {
    // a snorkeler face down, heading +x: wetsuit, mask, snorkel, fins
    plimb(m, [[-0.2, 0, 0], [0.1, 0, 0], [0.35, 0, 0], [0.52, 0, 0]], [0.12, 0.15, 0.16, 0.12], A.top, 12);
    plimb(m, [[0.5, 0, 0], [0.6, 0.01, 0]], [0.065, 0.05], A.skin);
    const h = new Mesh(); head(h, [0, 0, 0]); mergeT(m, h, (x, y, z) => [0.7 + y, -z, x]);
    ball(m, [0.78, -0.015, 0], 0.062, A.hair, 0.75, 2); plimb(m, [[0.7, 0.1, 0.075], [0.72, 0.3, 0.09], [0.76, 0.46, 0.1]], [0.014, 0.014, 0.013], A.bright, 6, 2);
    for (const s of [-1, 1]) {
      plimb(m, [[0.48, 0, 0.16 * s], [0.1, -0.01, 0.19 * s], [-0.2, -0.01, 0.17 * s]], [0.05, 0.045, 0.04], A.skin);
      plimb(m, [[-0.15, 0, 0.07 * s], [-0.5, -0.01, 0.075 * s], [-0.9, -0.03, 0.08 * s]], [0.08, 0.065, 0.05], A.bottom);
      blade(m, [[-0.9, -0.03, 0.08 * s], [-1.1, -0.035, 0.09 * s], [-1.35, -0.04, 0.1 * s]], [0.1, 0.17, 0.24], 0.02, A.bright);
    }
  }
  return m;
}
function meshUmbrella() {
  const m = new Mesh();
  limb(m, [[0, 0, 0], [0, 2.4, 0]], [0.025, 0.02], 0.1, 6, 1);
  const apex = m.v(0, 2.55, 0, 0.5);
  const ring = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * TAU; ring.push([cos(a) * 1.15, 2.05, sin(a) * 1.15]); }
  for (let i = 0; i < 12; i++) { const a = m.v(...ring[i], 0.5), b = m.v(...ring[i + 1], 0.5); m.tri(apex, b, a); m.tri(apex, a, b); }
  return m;
}
// round tube with an elliptical section (ry vertical, rz sideways) along a smoothed path, local frame from the up vector
function etube(m, pts, ry, rz, aux, sides = 14, f = 3) {
  const R = resample(pts.map((p, k) => [p[0], p[1], p[2], ry[k], rz[k]]), f), rg = [];
  for (let k = 0; k < R.length; k++) {
    const p = R[k], a = R[max(k - 1, 0)], b = R[min(k + 1, R.length - 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let lx = -tz, lz = tx; const ll = hypot(lx, lz) || 1; lx /= ll; lz /= ll;
    const vx = ty * lz, vy = tz * lx - tx * lz, vz = -ty * lx, ring = [];
    for (let s = 0; s < sides; s++) { const an = s / sides * TAU, c = cos(an) * p[4], d = sin(an) * p[3]; ring.push(m.v(p[0] + lx * c + vx * d, p[1] + vy * d, p[2] + lz * c + vz * d, aux)); }
    rg.push(ring);
  }
  for (let k = 0; k < rg.length - 1; k++) for (let s = 0; s < sides; s++) { const s2 = (s + 1) % sides; m.quad(rg[k][s], rg[k][s2], rg[k + 1][s2], rg[k + 1][s]); }
  for (const [ring, p] of [[rg[0], R[0]], [rg[rg.length - 1], R[R.length - 1]]]) { const c = m.v(p[0], p[1], p[2], aux); for (let s = 0; s < sides; s++) m.tri(ring[s], ring[(s + 1) % sides], c); }
}
// California sea lion (NOAA diagram): big, with a long muscular neck, external ear flaps, large elongated fore flippers, rear flippers that point back.
// +x forward. swim: streamlined with flippers swept back; otherwise a body propped up on the fore flippers (the shader lowers it to rest)
function meshSeaLion(swim) {
  const m = new Mesh(), F = 0.5, D = AUX.hair, FL = 0.65;
  const px = swim ? [-0.98, -0.8, -0.45, -0.05, 0.3, 0.55, 0.75, 0.88, 0.98, 1.07, 1.15, 1.21, 1.26] : [-0.98, -0.8, -0.45, -0.05, 0.28, 0.46, 0.58, 0.68, 0.77, 0.86, 0.95, 1.03, 1.09];
  const py = swim ? [0, 0.01, 0.03, 0.04, 0.04, 0.05, 0.06, 0.07, 0.08, 0.07, 0.06, 0.05, 0.04] : [0.07, 0.1, 0.17, 0.3, 0.46, 0.66, 0.86, 1.03, 1.15, 1.22, 1.25, 1.25, 1.23];
  // chubby: a deep round body, a thick neck, a broad rounded head with a short, blunt muzzle
  const ry = swim ? [0.08, 0.16, 0.25, 0.3, 0.32, 0.25, 0.19, 0.16, 0.15, 0.14, 0.115, 0.085, 0.06] : [0.09, 0.17, 0.26, 0.32, 0.34, 0.3, 0.24, 0.19, 0.165, 0.15, 0.13, 0.095, 0.06];
  const rz = swim ? [0.09, 0.17, 0.26, 0.3, 0.32, 0.24, 0.18, 0.155, 0.145, 0.14, 0.115, 0.09, 0.065] : [0.1, 0.18, 0.27, 0.33, 0.35, 0.3, 0.23, 0.18, 0.155, 0.15, 0.13, 0.1, 0.065];
  etube(m, px.map((x, k) => [x, py[k], 0]), ry.map((r) => r * 0.93), rz.map((r) => r * 0.93), F, 22, 4);
  ball(m, [px[12] + 0.012, py[12] - 0.004, 0], 0.04, D, 0.85, 2);                                   // nose
  for (const s of [-1, 1]) {
    ball(m, [px[10] - 0.03, py[10] + 0.035, 0.1 * s], 0.025, D, 1, 2);                              // eyes
    blade(m, [[px[9] + 0.0, py[9] + 0.05, 0.12 * s], [px[9] - 0.04, py[9] + 0.08, 0.14 * s], [px[9] - 0.08, py[9] + 0.105, 0.155 * s]], [0.036, 0.03, 0.01], 0.012, FL, 2);   // external ear flaps
    ball(m, [px[11] + 0.01, py[11] - 0.015, 0.05 * s], 0.042, F, 1, 1);                             // whisker pads
    for (let k = 0; k < 7; k++) limb(m, [[px[11] + 0.04, py[11] - 0.015 + (k % 3) * 0.012, 0.055 * s], [px[11] + 0.24, py[11] + (k - 3) * 0.028, (0.17 + 0.03 * (k % 3)) * s]], [0.004, 0.002], AUX.bright, 3, 1);
    if (swim) { blade(m, [[0.45, -0.05, 0.28 * s], [0.32, -0.1, 0.56 * s], [0.2, -0.13, 0.76 * s]], [0.22, 0.3, 0.22], 0.03, FL); blade(m, [[-0.95, 0, 0.06 * s], [-1.2, 0, 0.18 * s], [-1.42, 0, 0.32 * s]], [0.18, 0.28, 0.4], 0.03, FL); }
    else { blade(m, [[0.34, 0.42, 0.3 * s], [0.5, 0.24, 0.46 * s], [0.68, 0.07, 0.6 * s], [0.9, 0.02, 0.72 * s]], [0.2, 0.3, 0.32, 0.22], 0.04, FL); blade(m, [[-0.62, 0.14, 0.26 * s], [-0.5, 0.06, 0.42 * s], [-0.3, 0.03, 0.56 * s]], [0.15, 0.26, 0.32], 0.035, FL); }
  }
  return m;
}
// harbour seal: smaller, rounder, a cat-like head with big eyes and no ear flaps (just ear holes), small fore flippers, rear flippers trailing together
function meshSeal() {
  const m = new Mesh(), F = 0.5, D = AUX.hair, FL = 0.65;
  const px = [-0.8, -0.64, -0.38, -0.08, 0.22, 0.46, 0.6, 0.7, 0.78, 0.86, 0.93, 0.99, 1.03];
  const py = [0.02, 0.025, 0.035, 0.045, 0.045, 0.05, 0.055, 0.06, 0.065, 0.065, 0.05, 0.035, 0.03];
  const ry = [0.03, 0.075, 0.16, 0.21, 0.22, 0.18, 0.13, 0.11, 0.105, 0.1, 0.075, 0.05, 0.035], rz = ry.map((r) => r * 1.0);
  etube(m, px.map((x, k) => [x, py[k], 0]), ry, rz, F, 22, 4);
  ball(m, [px[12] + 0.01, py[12], 0], 0.022, D, 0.9, 2);
  for (const s of [-1, 1]) {
    ball(m, [px[10] - 0.04, py[10] + 0.04, 0.062 * s], 0.026, D, 1.05, 2);                           // big dark eyes
    ball(m, [px[9] - 0.03, py[9] + 0.03, 0.095 * s], 0.008, D);                                      // ear holes
    for (let k = 0; k < 5; k++) limb(m, [[px[11], py[11] - 0.01, 0.03 * s], [px[11] + 0.1, py[11] + (k - 2) * 0.022, (0.1 + 0.02 * (k % 3)) * s]], [0.003, 0.002], AUX.bright, 3, 1);
    blade(m, [[0.42, -0.06, 0.15 * s], [0.34, -0.1, 0.25 * s], [0.28, -0.12, 0.33 * s]], [0.07, 0.1, 0.07], 0.02, FL, 2);
    blade(m, [[-0.78, 0.02, 0.02 * s], [-1.0, 0.02, 0.08 * s], [-1.2, 0.02, 0.14 * s]], [0.1, 0.18, 0.24], 0.02, FL);
  }
  return m;
}
// a gull, +x forward, feet at y = 0; wings spread (the shader folds them on the ground and flaps them in flight)
function meshGull() {
  const m = new Mesh(), W = 0.1, WG = 0.3, TIP = 0.5, BK = 0.7, FT = 0.85, EY = 0.95, H = 0.18;
  const bp = [[-0.27, 0.03 + H, 0], [-0.14, 0.06 + H, 0], [0.0, 0.07 + H, 0], [0.14, 0.09 + H, 0], [0.24, 0.12 + H, 0], [0.3, 0.17 + H, 0], [0.34, 0.2 + H, 0]];
  etube(m, bp, [0.02, 0.07, 0.09, 0.085, 0.055, 0.04, 0.038], [0.02, 0.07, 0.085, 0.075, 0.05, 0.038, 0.036], W, 16, 4);
  ball(m, [0.36, 0.21 + H, 0], 0.043, W, 1, 2);
  limb(m, [[0.39, 0.2 + H, 0], [0.47, 0.185 + H, 0]], [0.017, 0.009], BK, 6, 1); ball(m, [0.475, 0.182 + H, 0], 0.01, BK);
  for (const s of [-1, 1]) {
    ball(m, [0.375, 0.225 + H, 0.032 * s], 0.009, EY);
    blade(m, [[0.06, 0.12 + H, 0.05 * s], [0.02, 0.14 + H, 0.35 * s], [-0.02, 0.13 + H, 0.6 * s]], [0.2, 0.17, 0.11], 0.016, WG);
    blade(m, [[-0.02, 0.13 + H, 0.6 * s], [-0.06, 0.12 + H, 0.8 * s]], [0.11, 0.04], 0.014, TIP, 2);
    limb(m, [[0.0, H, 0.035 * s], [0.01, H * 0.5, 0.035 * s], [0.02, 0.01, 0.035 * s]], [0.008, 0.007, 0.006], FT, 5, 2);
    limb(m, [[0.02, 0.01, 0.035 * s], [0.07, 0.008, 0.045 * s]], [0.008, 0.005], FT, 4, 1);
  }
  blade(m, [[-0.24, 0.04 + H, 0], [-0.32, 0.035 + H, 0], [-0.4, 0.03 + H, 0]], [0.07, 0.11, 0.13], 0.012, W, 2);
  return m;
}
// a chipmunk, +x forward, in metres: striped back, bushy tail, big eyes
function meshChipmunk() {
  const m = new Mesh(), T = 0.1, DK = 0.3, EY = 0.95, NS = 0.7;
  const bp = [[-0.075, 0.04, 0], [-0.04, 0.05, 0], [0.0, 0.055, 0], [0.04, 0.055, 0], [0.075, 0.052, 0]];
  etube(m, bp, [0.022, 0.035, 0.04, 0.037, 0.028], [0.022, 0.034, 0.038, 0.034, 0.026], T, 10, 2);
  ball(m, [0.1, 0.06, 0], 0.03, T, 0.9, 2);
  limb(m, [[0.115, 0.058, 0], [0.14, 0.05, 0]], [0.018, 0.009], T, 6, 1); ball(m, [0.143, 0.05, 0], 0.008, NS);
  etube(m, [[-0.075, 0.05, 0], [-0.13, 0.085, 0], [-0.15, 0.14, 0], [-0.13, 0.19, 0]], [0.016, 0.02, 0.022, 0.016], [0.012, 0.016, 0.018, 0.012], T, 8, 2);
  for (const s of [-1, 1]) {
    ball(m, [0.108, 0.07, 0.022 * s], 0.01, EY);
    ball(m, [0.088, 0.088, 0.016 * s], 0.012, T, 1.2);
    limb(m, [[0.05, 0.035, 0.02 * s], [0.07, 0.015, 0.025 * s], [0.085, 0.004, 0.028 * s]], [0.01, 0.008, 0.007], T, 6, 1);
    limb(m, [[-0.04, 0.035, 0.03 * s], [-0.03, 0.012, 0.03 * s], [-0.01, 0.004, 0.032 * s]], [0.022, 0.012, 0.008], T, 6, 1);
  }
  return m;
}
// concrete frame of the sea cave: lintel across both mouths and a pillar between them
function meshCaveFrame() {
  const m = new Mesh();
  box(m, -7, 7, 1.0, 0.9, 3.9); box(m, -0.5, 0.5, 0.6, 4.7, 3.1); box(m, -6.8, -5.8, 0.9, 4.7, 3.1); box(m, 5.8, 6.8, 0.9, 4.7, 3.1);
  return m;
}

// gear for the people on the water. Colours: aux .93 is a bright colour picked per object, .6 a second colour, 1 white foam, .78 dark.
function board(len, wid, th) {
  const m = new Mesh(), L = len / 2, w = wid / 2;
  etube(m, [[-L, th, 0], [-L * 0.75, th, 0], [-L * 0.3, th, 0], [L * 0.3, th, 0], [L * 0.8, th, 0], [L, th * 1.1, 0]], [th * 0.5, th, th, th, th * 0.9, th * 0.4], [w * 0.1, w * 0.8, w, w, w * 0.7, w * 0.08], AUX.bright, 12, 2);
  return m;
}
const meshSurfboard = () => board(2.1, 0.52, 0.035), meshSUPBoard = () => board(3.2, 0.82, 0.05);
function meshKayak() {
  const m = new Mesh();
  etube(m, [[-1.7, 0.12, 0], [-1.2, 0.1, 0], [-0.4, 0.1, 0], [0.4, 0.1, 0], [1.2, 0.1, 0], [1.7, 0.14, 0]], [0.03, 0.1, 0.14, 0.14, 0.1, 0.03], [0.02, 0.2, 0.3, 0.3, 0.2, 0.02], AUX.bright, 12, 2);
  ball(m, [-0.1, 0.25, 0], 0.28, 0.78, 0.12, 2);
  return m;
}
function meshPaddle(double) {
  const m = new Mesh();
  if (double) { limb(m, [[0, 0, -1.2], [0, 0, 1.2]], [0.016, 0.016], 0.78, 6, 1); for (const s of [-1, 1]) blade(m, [[0, 0, 1.15 * s], [0, 0, 1.5 * s]], [0.1, 0.12], 0.015, AUX.bright, 2); }
  else { limb(m, [[0, 0.5, 0], [0, -1.0, 0]], [0.016, 0.016], 0.78, 6, 1); blade(m, [[0, -0.95, 0], [0, -1.45, 0]], [0.1, 0.13], 0.016, AUX.bright, 2, [0, 0, 1]); }
  return m;
}
// a patch of white spray behind a surfer
function meshFoam() {
  const m = new Mesh();
  etube(m, [[-1.8, 0.03, 0], [-0.9, 0.03, 0], [0, 0.03, 0], [0.5, 0.03, 0]], [0.015, 0.02, 0.02, 0.01], [0.05, 0.38, 0.42, 0.12], 1, 10, 2);
  return m;
}

// a brown pelican, +x forward, feet at y = 0: long S-curved neck, huge bill with a pouch, long broad wings (the gull's wing animation drives them)
function meshPelican() {
  const m = new Mesh(), H = 0.2, HD = 0.2, BK = 0.7, PCH = 0.78, FT = 0.85, EY = 0.95;
  etube(m, [[-0.5, 0.05 + H, 0], [-0.3, 0.1 + H, 0], [0, 0.14 + H, 0], [0.3, 0.16 + H, 0], [0.45, 0.2 + H, 0]], [0.03, 0.12, 0.17, 0.16, 0.1], [0.03, 0.11, 0.15, 0.14, 0.09], 0.1, 18, 4);
  etube(m, [[0.4, 0.22 + H, 0], [0.5, 0.34 + H, 0], [0.46, 0.5 + H, 0], [0.5, 0.6 + H, 0], [0.57, 0.66 + H, 0]], [0.075, 0.06, 0.05, 0.045, 0.045], [0.07, 0.055, 0.045, 0.04, 0.04], HD, 14, 4);
  ball(m, [0.6, 0.68 + H, 0], 0.055, HD, 1, 2);
  limb(m, [[0.64, 0.665 + H, 0], [0.9, 0.62 + H, 0], [1.16, 0.58 + H, 0]], [0.034, 0.026, 0.012], BK, 8, 2); ball(m, [1.17, 0.575 + H, 0], 0.014, BK);
  etube(m, [[0.66, 0.63 + H, 0], [0.9, 0.57 + H, 0], [1.1, 0.56 + H, 0]], [0.03, 0.05, 0.012], [0.028, 0.045, 0.01], PCH, 8, 2);
  for (const s of [-1, 1]) {
    ball(m, [0.63, 0.71 + H, 0.042 * s], 0.01, EY);
    blade(m, [[0.05, 0.22 + H, 0.12 * s], [0.0, 0.24 + H, 0.6 * s], [-0.08, 0.22 + H, 1.05 * s]], [0.38, 0.34, 0.24], 0.02, 0.3);
    blade(m, [[-0.08, 0.22 + H, 1.05 * s], [-0.14, 0.2 + H, 1.4 * s]], [0.24, 0.08], 0.016, 0.5, 2);
    limb(m, [[0.0, H, 0.08 * s], [0.02, 0.0, 0.08 * s]], [0.025, 0.02], FT, 6, 1); limb(m, [[0.02, 0.01, 0.08 * s], [0.16, 0.01, 0.1 * s]], [0.02, 0.01], FT, 5, 1);
  }
  blade(m, [[-0.48, 0.06 + H, 0], [-0.6, 0.05 + H, 0], [-0.72, 0.04 + H, 0]], [0.1, 0.15, 0.17], 0.015, 0.1, 2);
  return m;
}

// a crab, +x forward, in metres: a wide shell, stalked eyes, four legs a side and two claws; aux .1 shell, .18 legs, .25 claws, .3 the movable finger, .95 eyes
function meshCrab() {
  const m = new Mesh(), B = 0.1, LG = 0.18, CL = 0.25, MV = 0.3, EY = 0.95;
  merge(m, icosphere(2, (x, y, z) => [x * 0.055, y * 0.028, z * 0.078]), 0, 0.04, 0, () => B);
  merge(m, icosphere(1, (x, y, z) => [x * 0.045, y * 0.02, z * 0.062]), 0, 0.024, 0, () => B);
  for (const s of [-1, 1]) {
    limb(m, [[0.04, 0.062, 0.025 * s], [0.052, 0.088, 0.032 * s]], [0.004, 0.003], B, 5, 1); ball(m, [0.053, 0.092, 0.033 * s], 0.008, EY, 1, 1);
    for (const x of [-0.04, -0.015, 0.01, 0.035]) limb(m, [[x, 0.035, 0.06 * s], [x * 1.1, 0.062, 0.115 * s], [x * 1.3, 0.0, 0.16 * s]], [0.006, 0.005, 0.003], LG, 5, 2);
    limb(m, [[0.045, 0.04, 0.055 * s], [0.08, 0.05, 0.09 * s]], [0.011, 0.009], CL, 6, 2);                         // arm
    ball(m, [0.115, 0.05, 0.085 * s], 0.022, CL, 0.8, 1);                                                          // palm
    limb(m, [[0.13, 0.045, 0.078 * s], [0.172, 0.045, 0.066 * s]], [0.009, 0.002], CL, 5, 1);                     // fixed finger
    limb(m, [[0.13, 0.058, 0.09 * s], [0.172, 0.055, 0.088 * s]], [0.008, 0.002], MV, 5, 1);                      // movable finger
  }
  return m;
}

// a soft contact shadow: a flat disc whose vertices carry their distance from the centre (stretched along x for long bodies)
function meshBlob(sx, sz) {
  const m = new Mesh(), R = [0.45, 0.75, 1], N = 16, c = m.v(0, 0, 0, 0), rg = [];
  for (const r of R) { const ring = []; for (let k = 0; k < N; k++) { const a = k / N * TAU; ring.push(m.v(cos(a) * r * sx, 0, sin(a) * r * sz, r)); } rg.push(ring); }
  for (let k = 0; k < N; k++) { const k2 = (k + 1) % N; m.tri(c, rg[0][k2], rg[0][k]); for (let j = 0; j < 2; j++) m.quad(rg[j][k], rg[j][k2], rg[j + 1][k2], rg[j + 1][k]); }
  return m;
}

// the fish a pelican has caught: silver, about 30 cm, with a dark eye and a forked tail (aux 1 is white, .78 dark)
function meshCaughtFish() {
  const m = new Mesh();
  etube(m, [[-0.17, 0, 0], [-0.1, 0, 0], [0, 0, 0], [0.1, 0, 0], [0.17, 0, 0]], [0.008, 0.038, 0.05, 0.036, 0.012], [0.006, 0.022, 0.03, 0.02, 0.008], 1, 12, 3);
  blade(m, [[-0.15, 0, 0], [-0.22, 0, 0], [-0.27, 0, 0]], [0.02, 0.07, 0.11], 0.008, 1, 2, [0, 0, 1]);
  blade(m, [[0.02, 0.04, 0], [-0.03, 0.08, 0], [-0.08, 0.05, 0]], [0.04, 0.05, 0.03], 0.006, 0.78, 2, [0, 0, 1]);
  for (const s of [-1, 1]) ball(m, [0.125, 0.012, 0.02 * s], 0.008, 0.78);
  return m;
}
