// ============================================================================
// renderer, camera and input
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
// a phone held upright gets the page turned on its side (see template.html)
const rot = matchMedia('(orientation:portrait) and (pointer:coarse)');
// loading bar: each stage glides it to `to` (the share done) over ~`ms` on the compositor, so it moves while this
// thread is busy
let loaded = 0, dead; // dead: the graphics device was lost
const say = (m, to, ms) => {
  if (!dead) $('s').textContent = m;
  const a = $('b').animate({ transform: [`scaleX(${loaded})`, `scaleX(${to})`] }, { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.3,.5,.5,1)' });
  loaded = to;
  // go on once the animation runs: one not started before the thread gets busy stays stuck (timer: hidden tabs)
  return new Promise((r) => { a.ready.then(() => setTimeout(r)); setTimeout(r, document.hidden ? 0 : 1e3); });
};
const fail = (m) => { throw new Error(m, { cause: 1 }); }; // cause marks a message that is shown as it is
if (!navigator.gpu) fail('This scene needs WebGPU. Try a current Chrome or Edge.');
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU adapter found.');
$('w').hidden = !!navigator.userAgentData; // only Chromium-based browsers have it
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
// GPU errors go on screen as well (phones have no console), under ?dbg=N or after any error
const errBox = document.createElement('pre'); errBox.style.cssText = 'position:fixed;left:0;bottom:0;right:0;max-height:40vh;overflow:auto;margin:0;padding:.5em;background:#300c;color:#fff;font:11px/1.3 monospace;white-space:pre-wrap;z-index:9;pointer-events:none;display:none';
document.body.append(errBox);
const showErr = (t) => { errBox.style.display = 'block'; errBox.textContent += t + '\n'; };
device.addEventListener('uncapturederror', (e) => { console.error('GPU: ' + e.error.message); showErr('GPU: ' + e.error.message.slice(0, 400)); });
if (new URLSearchParams(location.search).has('tune')) {
  const upd = () => { errBox.style.display = 'block'; errBox.textContent = 'above-water brightness AIREXP = ' + (AIREXP || 0.336).toFixed(3) + '   ( [ darker   ] brighter   Shift = bigger steps )'; };
  addEventListener('keydown', (e) => { if (e.code === 'BracketLeft' || e.code === 'BracketRight') { AIREXP = max(0.05, AIREXP + (e.code === 'BracketRight' ? 1 : -1) * (e.shiftKey ? 0.05 : 0.01)); upd(); } });
  upd();
}
if (DBG) { const ai = adapter.info || {}; showErr('dbg=' + DBG + ' ' + [ai.vendor, ai.architecture, ai.description].join(' ') + ' fmt=' + navigator.gpu.getPreferredCanvasFormat() + ' AA=' + AA + ' LV=' + LV); }
// out of memory or a GPU timeout: reload a level lower, or on Low say what happened
device.lost.then((l) => {
  if (l.reason === 'destroyed') return; // the page is closing
  if (LV < 2) { keep('cq', LV + 1); location.reload(); }
  dead = body.className = 'l e'; $('s').textContent = 'The graphics device was lost. Reload the page to try again.';
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float';
const TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage;

const mod = (code) => device.createShaderModule({ code });
const buf = (data, usage) => { const b = device.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | BU.COPY_DST }); Q.writeBuffer(b, 0, data.buffer || data, data.byteOffset || 0, data.byteLength); return b; };
const tex = (w, h, format, usage, o = {}) => device.createTexture({ size: [w, h, o.d || 1], format, usage, mipLevelCount: o.mips || 1, sampleCount: o.samples || 1, dimension: o.d ? '3d' : '2d' });

// ---------------------------------------------------------------- static resources
const sRep = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: LV > 1 ? 1 : 8 });
const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const sCmp = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
const tShadow = tex(SHADOW, SHADOW, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDummy = tex(1, 1, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tWater = tex(WATER, WATER, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 5 });
const tDetail = tex(1024, 1024, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 11 });
const tVol = tex(NX / 2, NY / 2, 'rg8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: NZ / 2 });
const tMap = tex(512, 512, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST);

const UB = new Float32Array(60), UBS = new Float32Array(60);
const ubo = device.createBuffer({ size: 240, usage: BU.UNIFORM | BU.COPY_DST }), uboS = device.createBuffer({ size: 240, usage: BU.UNIFORM | BU.COPY_DST });
const WT = new Float32Array(4), uboW = device.createBuffer({ size: 16, usage: BU.UNIFORM | BU.COPY_DST });

const VF = SS.VERTEX | SS.FRAGMENT;
const bgl0 = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: VF, sampler: {} }, { binding: 2, visibility: VF, sampler: {} }, { binding: 3, visibility: VF, sampler: { type: 'comparison' } },
  { binding: 4, visibility: VF, texture: { sampleType: 'depth' } },
  { binding: 5, visibility: VF, texture: {} }, { binding: 6, visibility: VF, texture: {} },
  { binding: 7, visibility: VF, texture: { viewDimension: '3d' } }, { binding: 8, visibility: VF, texture: {} }] });
const mkBG0 = (u, sh) => device.createBindGroup({ layout: bgl0, entries: [
  { binding: 0, resource: { buffer: u } }, { binding: 1, resource: sRep }, { binding: 2, resource: sClamp }, { binding: 3, resource: sCmp },
  { binding: 4, resource: sh.createView() }, { binding: 5, resource: tWater.createView() }, { binding: 6, resource: tDetail.createView() },
  { binding: 7, resource: tVol.createView() }, { binding: 8, resource: tMap.createView() }] });
const bg0 = mkBG0(ubo, tShadow), bg0s = mkBG0(uboS, tDummy);
const pl0 = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });

const bglBlit = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} }] });
const plBlit = device.createPipelineLayout({ bindGroupLayouts: [bglBlit] });
const mBlit = mod(W_BLIT);
const blitPipe = (entry, format, add) => device.createRenderPipeline({ layout: plBlit, vertex: { module: mBlit, entryPoint: 'vs' },
  fragment: { module: mBlit, entryPoint: entry, targets: [{ format, blend: add ? { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } : undefined }] } });
const pMip8 = blitPipe('fsMip', 'rgba8unorm'), pMip16 = blitPipe('fsMip', HDR), pDown0 = blitPipe('fsDown0', HDR), pDown = blitPipe('fsDown', HDR), pUp = blitPipe('fsUp', HDR, true);
const blitBG = (view) => device.createBindGroup({ layout: bglBlit, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sClamp }] });
const colorAtt = (view, clear) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] });

// vertex layouts
const A = (shaderLocation, offset, format) => ({ shaderLocation, offset, format });
const vbSolid = { arrayStride: 16, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4')] };
const ibSolid = { arrayStride: 48, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4')] };
const ibLeaf = { arrayStride: 36, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4'), A(2, 32, 'unorm8x4')] };
const ibAnim = { arrayStride: 32, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4')] };
const ibBub = { arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] };
const ibSnow = { arrayStride: 16, stepMode: 'instance', attributes: [A(0, 0, 'float32x4')] };

const scenePipe = (m, vsE, fsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  fragment: { module: m, entryPoint: fsE, targets: [{ format: HDR, blend: o.blend }] },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: !o.blend || !!o.dw, depthCompare: 'greater' }, multisample: { count: AA } });
const shadowPipe = (m, vsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 1.5 } });

await say('Compiling shaders…', 0.05, 300);
const mSolid = mod(W_SOLID), mLeaf = mod(W_LEAF), mAnim = mod(W_ANIM), mSurf = mod(W_SURF), mSpr = mod(W_SPR);
const pTerrain = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid], { cull: 'back' });
const pSolid = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid]);
const pLeaf = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 9 } });
const pLeaf5 = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 5 } });
const pLeafS = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: LV ? 3 : 5, FAR: 70 } });
const pLeafF = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3 } });
const pFish = scenePipe(mAnim, 'vsFish', 'fsFish', [vbSolid, ibAnim]);
const pManta = scenePipe(mAnim, 'vsManta', 'fsManta', [vbSolid, ibAnim]);
const PRE = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
const pBlob = scenePipe(mSolid, 'vs', 'fsBlob', [vbSolid, ibSolid], { blend: PRE });
const pSurf = scenePipe(mSurf, 'vs', 'fs', [], { strip: true, blend: PRE, dw: 1 }), pBack = scenePipe(mSurf, 'vsB', 'fsB', [], { strip: true });
const pBub = scenePipe(mSpr, 'vsBub', 'fsBub', [ibBub], { strip: true, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } });
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const pSnow = scenePipe(mSpr, 'vsSnow', 'fsSnow', [ibSnow], { strip: true, blend: ADD });
const pGl = scenePipe(mLeaf, 'vsGl', 'fsGl', [ibBub], { strip: true, blend: ADD, constants: { ROWS: 7 } });
const pSolidSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid]), pTerrSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid], { cull: 'front' });
const pLeafSh = shadowPipe(mLeaf, 'vs', [ibLeaf], { strip: true, constants: { ROWS: 3 } });

const mWater = mod(W_WATER);
const pWater = device.createRenderPipeline({ layout: 'auto', vertex: { module: mWater, entryPoint: 'vs' }, fragment: { module: mWater, entryPoint: 'fs', targets: [{ format: HDR }] } });
const bgWater = device.createBindGroup({ layout: pWater.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uboW } }] });
const waterViews = [0, 1, 2, 3, 4].map((m) => tWater.createView({ baseMipLevel: m, mipLevelCount: 1 }));
const waterBG = waterViews.map((v) => blitBG(v));
const waterPass = waterViews.map((v) => ({ colorAttachments: [colorAtt(v, true)] }));

const mRays = mod(W_RAYS), mPost = mod(W_POST), mRB = mod(W_RBLUR);
const pRB = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRB, entryPoint: 'vs' }, fragment: { module: mRB, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pRays = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRays, entryPoint: 'vs' }, fragment: { module: mRays, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pPost = device.createRenderPipeline({ layout: 'auto', vertex: { module: mPost, entryPoint: 'vs' }, fragment: { module: mPost, entryPoint: 'fs', targets: [{ format: FMT }] } });

// ---------------------------------------------------------------- sun + shadow matrix
const SUN = (() => { const v = [0.27, 1, -0.24], l = hypot(...v); return v.map((c) => c / l); })();
{
  const L = SUN, lr = [L[1], -L[0], 0], ll = hypot(...lr); lr[0] /= ll; lr[1] /= ll;
  const lu = [L[1] * lr[2] - L[2] * lr[1], L[2] * lr[0] - L[0] * lr[2], L[0] * lr[1] - L[1] * lr[0]];
  const R = 225, d0 = -175, d1 = 125, m = UBS;
  m[0] = lr[0] / R; m[4] = lr[1] / R; m[8] = lr[2] / R; m[12] = 0;
  m[1] = lu[0] / R; m[5] = lu[1] / R; m[9] = lu[2] / R; m[13] = 0;
  m[2] = -L[0] / (d1 - d0); m[6] = -L[1] / (d1 - d0); m[10] = -L[2] / (d1 - d0); m[14] = d1 / (d1 - d0);
  m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
  for (let i = 0; i < 16; i++) { UBS[16 + i] = m[i]; UB[16 + i] = m[i]; }
  for (let i = 0; i < 3; i++) { UB[48 + i] = UBS[48 + i] = SUN[i]; }
  UBS[32] = 0; UBS[33] = -20; UBS[34] = 0; UBS[35] = 0; UBS[58] = 1;
  Q.writeBuffer(uboS, 0, UBS);
}

// ---------------------------------------------------------------- world generation
await say('Sculpting the seabed…', 0.25, 1200);
// marks a load in progress (quality.js); leaving the page before it ends is not a crash
keep('cqLoad', 1);
addEventListener('pagehide', () => keep('cqLoad', ''));
let D;
{
  const prims = primBuffer();
  const m = mod(W_DENS), p = device.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'main' } });
  const size = NX * NY * NZ * 4;
  const u = new ArrayBuffer(48), uu = new Uint32Array(u), uf = new Float32Array(u);
  uu[0] = NX; uu[1] = NY; uu[2] = NZ; uf[4] = OX; uf[5] = OY; uf[6] = OZ; uf[7] = VS;
  uu[8] = MESAS.length; uu[9] = ARCHES.length; uu[10] = HOLES.length; uu[11] = CLEARS.length;
  const bu = buf(new Uint8Array(u), BU.UNIFORM), bp = buf(prims, BU.STORAGE);
  const bd = device.createBuffer({ size, usage: BU.STORAGE | BU.COPY_SRC }), br = device.createBuffer({ size, usage: BU.MAP_READ | BU.COPY_DST });
  const bg = device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bu } }, { binding: 1, resource: { buffer: bd } }, { binding: 2, resource: { buffer: bp } }] });
  const e = device.createCommandEncoder(), c = e.beginComputePass();
  c.setPipeline(p); c.setBindGroup(0, bg); c.dispatchWorkgroups(NX / 4, NY / 4, NZ / 4); c.end();
  e.copyBufferToBuffer(bd, 0, br, 0, size);
  Q.submit([e.finish()]);
  await br.mapAsync(GPUMapMode.READ);
  D = new Float32Array(br.getMappedRange().slice(0));
  br.unmap(); br.destroy(); bd.destroy();
  // rock connected to the seabed: each column's unbroken run up from the bottom is, and the rock above a gap
  // (overhangs, specks) is when it touches rock that is. What never connects is a speck of noise floating in
  // the water (surface nets would make it a small box), so it becomes water
  const S = NX * NY, R = new Uint8Array(D.length), O = [1, -1, NX, -NX, S, -S], b = new Uint8Array(NX), L = [];
  for (let i = 0; i < D.length;) { b.fill(1); for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++, i++) if (D[i] <= 0) b[x] = 0; else if (b[x]) R[i] = 1; else L.push(i); }
  for (let k = 1; k; L.reverse()) { k = 0; for (const i of L) if (!R[i] && O.some((o) => R[i + o])) R[i] = k = 1; }
  for (const i of L) if (!R[i]) D[i] = -D[i];
}
// Distance to the rock for collide(), in 1/127 m (> 0 in rock, clamped to ±1 m), kept only in the 4x4x4-voxel
// bricks near the surface within the camera's reach (~2 MB). CI per brick: 0 all water, 1 all rock, n brick n-2 in CG.
const CO = 52, CN = 115, CI = new Uint16Array(CN * CN * NY / 4);
let CG = new Int8Array(64 * 65534);
{
  let n = 0;
  for (let bz = 0; bz < CN; bz++) for (let by = 1; by < NY / 4 - 1; by++) for (let bx = 0; bx < CN; bx++) {
    // more than 156 m out: never reached, except on the cove's beach (east, x > 130)
    if (hypot(bx - 50.5, bz - 50.5) > 52 && !(bx > 94 && abs(bz - 50.5) < 25)) continue;
    let lo = 127, hi = -127;
    for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = CO + bx * 4 + x + NX * (by * 4 + y + NY * (CO + bz * 4 + z)), gz = D[i + NX * NY] - D[i - NX * NY];
      const gx = D[i + 1] - D[i - 1], g = D[i + NX] - D[i - NX], l = sqrt(gx * gx + g * g + gz * gz) / 1.5;
      const q = round(clamp(D[i] / max(l, 0.05), -1, 1) * 127);
      CG[n * 64 + x + 4 * y + 16 * z] = q; if (q < lo) lo = q; if (q > hi) hi = q;
    }
    CI[bx + CN * (by + NY / 4 * bz)] = lo === hi && lo * lo === 16129 ? +(lo > 0) : (n++, n + 1);
  }
  CG = CG.slice(0, n * 64);
}
await say('Carving canyons…', 0.32, 400);
const T = buildTerrain(D);

// preset viewpoints (position, look-at), keys 1-8; the world generator dresses the scene around them
const POSES = [
  [10, 1.3, 7, -9, -31, -10],
  [50, 1.3, 34, 58, -23, 8],
  [-26, 2.2, -100, 0, -9, -108],
  [-55, 1.5, -18, -60, -30, 8],
  [10, 1.2, -62, 6, -22, -90],
  [3, 1.6, 62, 1, -28, 100],
  [116, 1.3, 0, 150, -1, 0],
  [152, 1.7, 5, 80, 7, -22],  // standing on the beach
];
// 60 s camera path (position + look-at, Catmull-Rom): the world generator keeps it clear, dev.js flies along it
const FLY = new Float32Array([
  10, -42.2, 7, -9, -31, -10,
  7.5, -41.8, 5.5, -10, -31, -12,
  9, -40.5, 18, 17, -37, 42,
  22, -39.2, 40, 48, -36, 45,
  38, -39.2, 46, 57, -27, 18,
  50, -40.4, 35, 58, -24, 8,
  55, -39, 20, 60, -18, -10,
  58, -34, -12, 40, -26, -60,
  50, -30, -44, 10, -26, -80,
  30, -30, -70, 4, -28, -90,
  12, -38.5, -62, 6, -27, -90,
  -4, -36.5, -70, 0, -14, -100,
  -16, -37, -84, 0, -22, -108,
  -29, -38, -90, -44, -34, -60,
  -41, -38, -70, -56, -34, -40,
  -53, -38, -50, -60, -34, -20,
  -58, -38, -28, -60, -32, 0,
  -57, -38, -10, -60, -30, 16,
  -60, -38, 10, -50, -36, 40,
  -52, -37, 36, -20, -35, 44,
  -22, -38, 43, 4, -38, 52,
  -6, -39.2, 44.5, 4, -37, 70,
  3, -40.6, 53, 3, -35, 84,
  3, -41.5, 62, 1, -30, 100,
  4, -39, 76, 3, -22, 100,
]);
const FLYN = FLY.length / 6, FLYT = 60, LUTN = 1024, flyLUT = new Float32Array(LUTN + 1);
const flyPts = [];
// per-frame float state lives in one preallocated array, so the frame loop allocates no heap numbers
const F = new Float64Array(32), P6 = new Float64Array(6);
const CX = 0, CY = 1, CZ = 2, YAW = 3, PIT = 4, FX = 5, FY = 6, FZ = 7, RX = 8, RZ = 9, UX = 10, UY = 11, UZ = 12, VX = 13, VY = 14, VZ = 15, TIME = 16, FLT = 17, LAST = 18, GPU = 19, HUDT = 20, SPL = 21, MX = 22, MY = 23, MZ = 24, GH = 25;
let walk = false, above = false; // on the beach / head out of the water (see frame())
// aim the camera from P6 = position + look-at point
function aim() {
  const dx = P6[3] - P6[0], dy = P6[4] - P6[1], dz = P6[5] - P6[2];
  F[CX] = P6[0]; F[CY] = P6[1]; F[CZ] = P6[2];
  F[YAW] = atan2(dx, -dz); F[PIT] = atan2(dy, sqrt(dx * dx + dz * dz));
}
const lookAt = (x, y, z, tx, ty, tz) => { walk = above = false; F[VX] = F[VY] = F[VZ] = 0; P6[0] = x; P6[1] = y; P6[2] = z; P6[3] = tx; P6[4] = ty; P6[5] = tz; aim(); };
// camera spline (Catmull-Rom over position + look-at) at parameter F[SPL]
function flyRaw() {
  const s = F[SPL]; let i = floor(s) | 0; if (i > FLYN - 2) i = FLYN - 2;
  const u = s - i, i0 = (i > 0 ? i - 1 : 0) * 6, i1 = i * 6, i2 = (i + 1) * 6, i3 = (i + 2 < FLYN ? i + 2 : FLYN - 1) * 6;
  for (let o = 0; o < 6; o++) {
    const a = FLY[i0 + o], b = FLY[i1 + o], c = FLY[i2 + o], d = FLY[i3 + o];
    P6[o] = 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  }
  aim();
}
{ // arc-length table: flyLUT[k] = spline parameter at fraction k/LUTN of the total path length
  const M = 4096, len = new Float32Array(M + 1); let px = 0, py = 0, pz = 0;
  for (let k = 0; k <= M; k++) { F[SPL] = k / M * (FLYN - 1); flyRaw(); if (k) len[k] = len[k - 1] + hypot(F[CX] - px, F[CY] - py, F[CZ] - pz); px = F[CX]; py = F[CY]; pz = F[CZ]; }
  for (let k = 0, j = 0; k <= LUTN; k++) { const d = k / LUTN * len[M]; while (j < M - 1 && len[j + 1] < d) j++; flyLUT[k] = (j + (d - len[j]) / max(len[j + 1] - len[j], 1e-6)) / M * (FLYN - 1); }
}
// camera on the scripted path at time F[FLT]
function flyAt() {
  let s = F[FLT] / FLYT; s = s < 0 ? 0 : s > 1 ? 1 : s; s = s * s * (3 - 2 * s) * 0.25 + s * 0.75;
  s *= LUTN; let k = floor(s) | 0; if (k > LUTN - 1) k = LUTN - 1;
  F[SPL] = flyLUT[k] + (flyLUT[k + 1] - flyLUT[k]) * (s - k); flyRaw();
}
for (let t = 0; t <= FLYT; t += 0.1) { F[FLT] = t; flyAt(); flyPts.push([F[CX], F[CY], F[CZ]]); }
for (const p of POSES) flyPts.push([p[0], -40, p[2]]);

await say('Growing kelp…', 0.73, 2500);
const Wd = makeWorld(D, T, flyPts, POSES);
for (const p of POSES) p[1] += Wd.gy(p[0], p[2]);
D = Wd.gy = T.smp = null; // with gy goes the generator's working memory (about 200 MB)

await say('Building set pieces…', 0.94, 1200);
// mesh ids: 0-3 boulders, 4-6 sponges, 7-8 coral, 9 tube sponge, 10 whale fluke, 11 ship, 12 manta, 13 fish,
// 14-20 rock chunks + pebbles, 21-22 coral LOD, 23-25 far LOD of the large rock chunks
const meshes = [meshChunk(1, 3), meshChunk(7, 3), meshChunk(13, 3), meshChunk(22, 3),
  meshLathe([[0, 0, 0.5], [0.34, 0, 0.6], [0.5, 0.2, 0.85], [0.6, 0.6, 1], [0.55, 0.95, 1], [0.47, 1.08, 1], [0.38, 1.1, 0.9], [0.3, 1.0, 0.45], [0.26, 0.6, 0.15], [0, 0.35, 0.05]], 18, 0.3, 9),
  meshLathe([[0, 0, 0.5], [0.2, 0, 0.6], [0.26, 0.5, 0.85], [0.4, 1.25, 1], [0.4, 1.42, 1], [0.33, 1.48, 0.9], [0.26, 1.38, 0.4], [0.18, 0.8, 0.12], [0, 0.5, 0.05]], 16, 0.35, 8),
  meshLathe([[0, 0, 0.5], [0.5, 0, 0.7], [0.72, 0.18, 1], [0.74, 0.38, 1], [0.62, 0.5, 0.9], [0.48, 0.42, 0.45], [0.4, 0.2, 0.15], [0, 0.14, 0.06]], 18, 0.25, 10),
  meshCoral(0), meshCoral(1), meshTubes()].map((m) => m.build());
meshes.push(meshFluke(), meshShip().build(), meshManta().build(), meshFish().build(),
  meshChunk(3).build(), meshChunk(11).build(), meshChunk(29).build(), meshChunk(5, 3).build(), meshChunk(17, 3).build(), meshChunk(41, 3).build(), meshChunk(9, 1).build(), meshCoral(0, 1).build(), meshCoral(1, 1).build(), meshChunk(5, 2, 1).build(), meshChunk(17, 2, 1).build(), meshChunk(41, 2, 1).build());
const DECO0 = meshes.length; // palm, 2 trees, bush, step, rail, lamp
meshes.push(meshPalm().build(), meshTree(1).build(), meshTree(2).build(), meshBush().build(), meshStep().build(), meshRail().build(), meshLamp().build(), meshBench().build(), meshTowerC().build(), meshTowerG().build(), meshTowerW().build(),
  meshPerson(0).build(), meshPerson(1).build(), meshPerson(2).build(), meshPerson(3).build(), meshUmbrella().build(), meshSeaLion(false).build(), meshCaveFrame().build());
const GAR = meshGaribaldi().build(), SNORK = meshPerson(4).build(), LIONSWIM = meshSeaLion(true).build(), SEAL = meshSeal().build(), GULL = meshGull().build(), CHIP = meshChipmunk().build();
const BOARD = meshSurfboard().build(), SUPB = meshSUPBoard().build(), KAYAK = meshKayak().build(), PAD1 = meshPaddle(false).build(), PAD2 = meshPaddle(true).build(), FOAM = meshFoam().build(), PELICAN = meshPelican().build(), CRAB = meshCrab().build(), BLOB = meshBlob(1, 1).build(), BLOBL = meshBlob(1.9, 0.85).build(), CFISH = meshCaughtFish().build();
meshes.push(GAR, SNORK, LIONSWIM, SEAL, GULL, CHIP, BOARD, SUPB, KAYAK, PAD1, PAD2, FOAM, PELICAN, CRAB, BLOB, BLOBL, CFISH);
let nV = 0, nI = 0;
for (const m of meshes) { m.v0 = nV; m.i0 = nI; nV += m.nv; nI += m.ib.length; }
const allV = new Uint8Array(nV * 16), allI = new Uint32Array(nI);
for (const m of meshes) { allV.set(new Uint8Array(m.vb), m.v0 * 16); allI.set(m.ib, m.i0); }
const vbMesh = buf(allV, BU.VERTEX), ibMesh = buf(allI, BU.INDEX);
const vbTerrain = buf(new Uint8Array(T.vb), BU.VERTEX), ibTerrain = buf(T.ib, BU.INDEX);
const nSolid = Wd.solids.data.length / 12;
const solidData = new Float32Array((nSolid + 1) * 12); solidData.set(Wd.solids.data); solidData.set([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0], nSolid * 12);
const ibSolids = buf(solidData, BU.VERTEX);
const ibDeco = Wd.deco.map((a) => (a.length ? buf(a, BU.VERTEX) : null)), nDeco = Wd.deco.map((a) => a.length / 12);
const drawDeco = (r) => { for (let k = 0; k < nDeco.length; k++) if (nDeco[k]) { const m = meshes[DECO0 + k]; r.setVertexBuffer(1, ibDeco[k]); r.drawIndexed(m.ib.length, nDeco[k], m.i0, m.v0, 0); } };

// ---------------------------------------------------------------- beach life: people, sea lions, snorkelers
// Every figure is an actor: a little state machine on the CPU (where it is, what it does, how it reacts to the camera) that
// writes one instance per frame. The vertex shader poses it (walk cycle, digging, waving, head turn, breathing, swim stroke).
// slots: 0-3 people (stand, sit, lie, crouch), 4 snorkeler, 5 sea lion on land, 6 sea lion swimming
const SLM = [meshes[DECO0 + 11], meshes[DECO0 + 12], meshes[DECO0 + 13], meshes[DECO0 + 14], SNORK, meshes[DECO0 + 16], LIONSWIM, SEAL, GULL, CHIP, BOARD, SUPB, KAYAK, PAD1, PAD2, FOAM, PELICAN, CRAB, CFISH];   // 18 the pelican's fish, 17 crab, 16 pelican, 10 surfboard, 11 paddle board, 12 kayak, 13 paddle, 14 kayak paddle, 15 spray
const NACT = Wd.actors.length, SLI = SLM.map(() => new Float32Array(NACT * 12)), SLN = new Uint32Array(SLM.length);
const SLB = SLM.map(() => device.createBuffer({ size: NACT * 48, usage: BU.VERTEX | BU.COPY_DST }));
const drawActors = (r) => { for (let s = 0; s < SLM.length; s++) if (SLN[s]) { r.setVertexBuffer(1, SLB[s]); r.drawIndexed(SLM[s].ib.length, SLN[s], SLM[s].i0, SLM[s].v0, 0); } };
const ACT = Wd.actors.map((a) => ({ k: a.k, pose: a.pose || 0, hpose: a.pose || 0, x: a.x, z: a.z, y: 0, yaw: a.yaw, hx: a.x, hz: a.z, hyaw: a.yaw, sc: a.sc, seed: a.seed, ph: a.seed * 6, amt: 0, st: a.st !== undefined ? a.st : a.walk ? 4 : 0, tm: 0, high: a.high, lift: a.lift || 0, wx: a.x, wz: a.z, y0: a.y0, hy: 0, fish: 0, caught: 0, dig: 0, cl: 0, ft: 0, fx: 0, fz: 0, vc: 25 + a.seed * 70, vol: 0, vtm: 0, roll: 0, pk: 0, pk2: 0, fy: 10, dir: 1, sp: 0, mx: 0, mz: 1, cd: a.k === 'F' ? 0 : 4 + a.seed * 10, al: -1,
  w: a.walk, wt: 0, hd: a.yaw, mood: 0, seen: 0, bc: 0, bk: 0, hit: 0, lg: 0, pup: a.k === 'L' && a.sc < 0.7, ab: 0, wq: 0, tx: a.x, tz: a.z, dv: a.seed * 20, ret: 0, away: 0, idle: 0, mv: 0, pitch: 0, home: a.k === 'L' }));
let ACTINIT = false; // the collision grid is read the first time the actors update
const wlX = (z) => 130 + 14 * (1 - min(z * z / 1600, 1)); // x of the waterline at z (see the beach in W_DENS)
const turnTo = (a, to, rate, dt) => { let d = to - a.yaw; d = atan2(sin(d), cos(d)); const m = rate * dt; a.yaw += d < -m ? -m : d > m ? m : d; };
// one step toward (dx, dz) at speed sp, going around anything too steep, too deep (below minG) or too high; false if boxed in
function stepActor(a, dx, dz, sp, dt, minG) {
  const l = hypot(dx, dz) || 1; dx /= l; dz /= l;
  for (let k = 0; k < 5; k++) {
    const an = k === 0 ? 0 : k === 1 ? 0.7 : k === 2 ? -0.7 : k === 3 ? 1.5 : -1.5, c = cos(an), s = sin(an), ex = dx * c - dz * s, ez = dx * s + dz * c;
    const nx = a.x + ex * sp * dt, nz = a.z + ez * sp * dt, gh = ground(nx, a.y + 1.5, nz);
    if (gh > minG && gh < a.y + 0.45 && gh > a.y - 0.6) { a.x = nx; a.z = nz; a.y += (gh - a.y) * min(1, dt * 14); a.mx = ex; a.mz = ez; return true; }
  }
  return false;
}
const barkAt = (a, mood) => {
  if (!BARK) return;
  const dx = a.x - F[CX], dz = a.z - F[CZ], d = hypot(dx, dz);
  BARK(clamp((dx * F[RX] + dz * F[RZ]) / (d + 1), -1, 1), (mood ? 0.8 : 0.55) * clamp(1.2 - d / 35, 0, 1), mood);
};
function updPerson(a, dt, px, pz, py) {
  if (a.ft > 0) { // just pinched: hop away from the crab
    a.ft -= dt; a.pose = 0; stepActor(a, a.x - a.fx, a.z - a.fz, 2.4, dt, -0.45); turnTo(a, atan2(a.mx, a.mz), 8, dt);
    a.amt += (1 - a.amt) * min(1, dt * 8); a.ph += 2.4 * 4.2 * dt; if (a.ft <= 0) { a.st = 3; a.tm = 0; } return;
  }
  const dx = a.x - px, dz = a.z - pz, d = hypot(dx, dz), kid = a.sc < 0.72;
  const R = (a.hpose === 0 ? 3.2 : 2.4) * (kid ? 1.4 : 1) * (py < -2 ? 0.3 : 1);
  let sp = 0;
  switch (a.st) {
    case 0: // at home: sit, lie, dig or stand; get up and walk away when the camera comes close
      a.pose = a.hpose;
      if (d < R) { a.st = 1; a.pose = 0; a.tm = 0; a.amt = 0; }
      else if (a.hpose === 3) { a.ph += dt * 2.2; a.amt = 1; }
      else if (a.hpose === 1) a.amt += ((d < 9 && py > -2 ? 1 : 0) - a.amt) * min(1, dt * 3);
      else a.amt = 0;
      break;
    case 1: // walking or running away
      a.pose = 0; sp = kid ? 2.5 : 1.5;
      if (d > R + 3.5 || !stepActor(a, dx, dz, sp, dt, -0.45)) { a.st = 3; a.tm = 0; sp = 0; } else turnTo(a, atan2(a.mx, a.mz), 6, dt);
      break;
    case 3: // standing, watching
      a.pose = 0; turnTo(a, atan2(-dx, -dz), 3, dt);
      if (d < R * 0.8) a.st = 1; else if (d > 14) { a.tm += dt; if (a.tm > 4 && !a.w) a.st = 2; else if (a.tm > 4) a.st = 4; } else a.tm = 0;
      break;
    case 2: { // back home
      a.pose = 0; const hx = a.hx - a.x, hz = a.hz - a.z;
      if (hypot(hx, hz) < 0.4) { a.st = 0; a.pose = a.hpose; a.yaw = a.hyaw; a.ph = 0; a.y = ground(a.x, a.y + 2, a.z); }
      else { sp = 1.2; stepActor(a, hx, hz, sp, dt, -0.45); turnTo(a, atan2(a.mx, a.mz), 5, dt); if (d < R) a.st = 1; }
      break;
    }
    case 4: { // walking along the shore and back
      a.pose = 0; const t0 = a.wt ? 2 : 0, tx = a.w[t0] - a.x, tz = a.w[t0 + 1] - a.z;
      if (hypot(tx, tz) < 0.6) a.wt ^= 1; else { sp = 0.9; stepActor(a, tx, tz, sp, dt, -0.45); turnTo(a, atan2(a.mx, a.mz), 3, dt); }
      if (d < R + 1) a.st = 5;
      break;
    }
    default: // 5: a walker stops to look
      a.pose = 0; turnTo(a, atan2(-dx, -dz), 3, dt);
      if (d < R * 0.8) a.st = 1; else if (d > R + 5) a.st = 4;
  }
  if (a.pose === 0) a.amt += ((sp > 0 ? 1 : 0) - a.amt) * min(1, dt * 8);
  a.ph += sp * (kid ? 6 : 4.2) * dt;
}
// A hurt: the camera is shoved away from (fx, fz) and the picture flashes red
function hurt(fx, fz, pw = 9) {
  const dx = px0(), dz = pz0(), l = hypot(dx - fx, dz - fz) || 1;
  F[VX] += (dx - fx) / l * pw; F[VZ] += (dz - fz) / l * pw;
  canvas.style.filter = 'sepia(1) saturate(5) hue-rotate(-40deg) brightness(.7)'; setTimeout(() => { canvas.style.filter = ''; }, pw > 5 ? 280 : 160);
}
const px0 = () => F[CX], pz0 = () => F[CZ];
// land sea lion states: 0 resting, 1 gallop to the sea, 2 back up the beach, 3 warning (rears up and barks), 4 charge, 5 bite
function updLion(a, dt, px, pz, py) {
  const dx = a.x - px, dz = a.z - pz, d = hypot(dx, dz);
  let sp = 0, lunge = 0;
  if (d > 26) a.seen = 0;
  if (a.st === 0) { // resting, head up when something is near, now and then for no reason
    if (d < 20 && !a.seen) { a.seen = 1; a.mood = !a.pup && rnd() < 0.4 ? 1 : 0; }   // some are bold, some shy; pups never
    let up = d < 20 ? 0.9 : 0; a.tm -= dt;
    if (a.tm < 0) { a.tm = 6 + rnd() * 12; a.idle = 2.5 + rnd() * 2; }
    if (a.idle > 0) { a.idle -= dt; if (up < 0.7) up = 0.7; }
    a.amt += (up - a.amt) * min(1, dt * 2.5); a.mv = 0;
    if (d < 14) turnTo(a, atan2(dz, -dx), 1.2, dt);
    a.cd -= dt; if (d < 13 && a.cd < 0 && rnd() < dt * 0.3) { barkAt(a, 0); a.cd = 8 + rnd() * 8; }
    if (a.al > 0) { a.al -= dt; if (a.al <= 0) { a.al = -1; a.st = a.mood ? 0 : 1; } }
    a.vc -= dt;
    if (!a.pup && a.vc < 0 && d > 28 && hypot(a.x - a.hx, a.z - a.hz) < 1) { a.vc = 40 + rnd() * 80; a.vol = 1; a.st = 1; }   // now and then one goes for a swim
    if (a.mood && d < 8.5 && a.bc < 0) { a.st = 3; a.tm = 0; a.bk = 0; }
    else if (!a.mood && d < (a.pup ? 3.5 : 5.2)) a.st = 1;
    a.bc -= dt;
    if (a.st === 1 && !a.pup) for (const b of ACT) if (b !== a && b.k === 'L' && b.st === 0 && !b.mood && !b.pup && hypot(b.x - a.x, b.z - a.z) < 8 && b.al < 0) b.al = 0.1 + rnd() * 0.7;
    if (a.pup) { // a pup is left behind when the grown-ups near its spot take off: it calls for them and shuffles about
      let gone = 0, here = 0;
      for (const b of ACT) if ((b.k === 'L' || b.k === 'S') && b.home && !b.pup && hypot(b.hx - a.hx, b.hz - a.hz) < 6.5) { if (b.k === 'L' && b.st === 0) here++; else gone++; }
      a.ab = gone > 0 && here === 0 ? 1 : 0;
      if (a.ab) {
        a.amt += (1 - a.amt) * min(1, dt * 4); a.cd -= dt;
        if (a.cd < 0 && d < 35) { BARK && BARK(clamp(((a.x - px) * F[RX] + (a.z - pz) * F[RZ]) / (d + 1), -1, 1), 0.4 * clamp(1.2 - d / 35, 0, 1), 3); a.cd = 2.5 + rnd() * 4; }
        a.wq -= dt; if (a.wq < 0) { a.wq = 3 + rnd() * 3; a.tx = a.hx + rr(-2.2, 2.2); a.tz = a.hz + rr(-2.2, 2.2); }
      } else if (hypot(a.hx - a.x, a.hz - a.z) > 0.6) { a.tx = a.hx; a.tz = a.hz; }
      const tx = a.tx - a.x, tz = a.tz - a.z;
      if (hypot(tx, tz) > 0.35 && (a.ab || a.tx === a.hx)) { sp = 0.7; a.mv = 1; stepActor(a, tx, tz, sp, dt, -0.3); turnTo(a, atan2(-a.mz, a.mx), 3, dt); }
    }
  } else if (a.st === 1) { // gallop to the water: aim well out, so the water is deep enough to dive
    sp = a.pup ? 1.7 : 2.9; a.amt += (1 - a.amt) * min(1, dt * 4); a.mv = 1;
    if (!stepActor(a, wlX(a.z) - 16 - a.x, 0, sp, dt, -3)) { // boxed in by a step: slide straight on
      a.x -= sp * dt; a.mx = -1; a.mz = 0; a.y += (ground(a.x, a.y + 1.5, a.z) - a.y) * min(1, dt * 8);
    }
    turnTo(a, atan2(-a.mz, a.mx), 5, dt);
    if (ground(a.x, 2, a.z) < -0.65) { a.k = 'S'; a.st = 0; a.y = -0.35; a.hd = atan2(a.mz, a.mx); a.dv = 1.2; a.tm = 0; a.away = 0; a.vtm = a.vol ? 30 + rnd() * 40 : 0; }
  } else if (a.st === 2) { // back from the water: walk up the beach to the spot
    const hx = a.hx - a.x, hz = a.hz - a.z; sp = 1.6; a.mv = 1; a.amt += (0.5 - a.amt) * min(1, dt * 3);
    if (hypot(hx, hz) < 0.5) { a.st = 0; a.yaw = a.hyaw; a.mv = 0; sp = 0; a.hd = a.yaw; } else { stepActor(a, hx, hz, sp, dt, -3); turnTo(a, atan2(-a.mz, a.mx), 4, dt); }
    if (d < 5.2 && !a.mood) a.st = 1;
  } else if (a.st === 3) { // warning: rears up facing the camera and barks, then charges
    a.tm += dt; a.amt += (0.2 - a.amt) * min(1, dt * 6); turnTo(a, atan2(dz, -dx), 3.5, dt); sp = 0.4;
    if (a.tm > a.bk * 0.85 + 0.15 && a.bk < 3) { barkAt(a, 1); a.bk++; }
    if (d > 15) { a.st = 0; a.bc = 6; }
    else if (a.tm > 2.7 || d < 3) a.st = 4;
  } else if (a.st === 4) { // charge
    sp = 3.4; a.amt += (0 - a.amt) * min(1, dt * 6);
    stepActor(a, -dx, -dz, sp, dt, -0.4); turnTo(a, atan2(dz, -dx), 6, dt);
    if (d < 1.9) { a.st = 5; a.tm = 0; a.hit = 0; }
    else if (d > 16 || hypot(a.x - a.hx, a.z - a.hz) > 14) { a.st = 2; a.bc = 6; a.mood = 0; }
  } else { // bite: a quick lunge with the head
    a.tm += dt; turnTo(a, atan2(dz, -dx), 6, dt); lunge = sin(clamp(a.tm / 0.5, 0, 1) * PI);
    if (!a.hit && a.tm > 0.2) { a.hit = 1; barkAt(a, 2); if (d < 2.8) hurt(a.x, a.z); }
    if (a.tm > 0.55) { if (d > 10) { a.st = 0; a.bc = 8; } else { a.st = 3; a.tm = 1.4; a.bk = 3; } }
  }
  a.lg = lunge;
  a.ph += (sp * 5.5 + (a.st === 3 ? 6 : 0)) * dt;
}
// swimmers keep to the cove: x 96..128; heading hd (radians in the XZ plane), speed sp
const angTo = (a, ang, rate, dt) => { let d = ang - a.hd; d = atan2(sin(d), cos(d)); const m = rate * dt; a.hd += d < -m ? -m : d > m ? m : d; };
function updSwimmer(a, dt, px, pz, py) {
  const lion = a.k === 'S', dx = px - a.x, dz = pz - a.z, d = hypot(dx, dz);
  let tx = a.x, tz = a.z, sp = lion ? 1.6 : 0.5;
  if (lion) {
    if (a.home) { a.away = d > 30 && hypot(px - a.hx, pz - a.hz) > 28 ? a.away + dt : 0; if (a.away > 18) a.ret = 1; if (hypot(px - a.hx, pz - a.hz) < 22) a.ret = 0; }
    if (a.vol) { a.vtm -= dt; if (a.vtm < 0) a.ret = 1; }
    if (a.ret) { tx = wlX(a.hz) - 0.5; tz = a.hz; sp = 1.8; }
    else if (d < 32 && py < 2) { // curious: circle the camera, closer when it is underwater
      const rad = py > -0.5 ? 6.5 : 3.5, an = atan2(a.z - pz, a.x - px) + 0.7;
      tx = px + cos(an) * rad; tz = pz + sin(an) * rad; sp = d > rad + 3 ? 2.4 : 1.5;
      a.cd -= dt; if (d < 16 && a.cd < 0 && rnd() < dt * 0.15) { barkAt(a, 0); a.cd = 10 + rnd() * 10; }
    } else {
      a.tm -= dt; if (a.tm < 0 || hypot(a.wx - a.x, a.wz - a.z) < 3) { a.wx = rr(99, 127); a.wz = rr(-44, 44); a.tm = 8 + rnd() * 8; }
      tx = a.wx; tz = a.wz;
    }
  } else if (d < 2.4) { tx = a.x - dx * 3; tz = a.z - dz * 3; sp = 0.9; }
  else if (d < 8) { sp = 0; a.amt += (1 - a.amt) * min(1, dt * 3); }
  else { a.tm -= dt; if (a.tm < 0 || hypot(a.wx - a.x, a.wz - a.z) < 3) { a.wx = rr(102, 126); a.wz = rr(-44, 44); a.tm = 10 + rnd() * 10; } tx = a.wx; tz = a.wz; }
  if (!lion && d >= 8) a.amt += (0 - a.amt) * min(1, dt * 2);
  let want = atan2(tz - a.z, tx - a.x);
  const g0 = ground(a.x, 2, a.z), ah = ground(a.x + cos(a.hd) * 3.5, 2, a.z + sin(a.hd) * 3.5);
  if (!a.ret && ah > -1.5) want = PI;                       // too shallow ahead: head out to sea
  if (lion && a.ret && g0 > -0.45) { a.k = 'L'; a.st = 2; a.vol = 0; a.yaw = atan2(-sin(a.hd), cos(a.hd)); a.mx = cos(a.hd); a.mz = sin(a.hd); a.y = g0; a.amt = 0.5; return; }
  angTo(a, want, lion ? 1.6 : 0.9, dt);
  a.x += cos(a.hd) * sp * dt; a.z += sin(a.hd) * sp * dt;
  a.dv += dt * (lion ? 0.55 : 1);
  const near = lion && d < 10 && py < 2;
  let ty = lion ? (near ? -0.5 + 0.2 * sin(a.dv * 2) : -1.7 + 1.5 * sin(a.dv)) : -0.1 + 0.03 * sin(a.dv * 1.7);
  if (g0 > -1e8 && ty < g0 + 0.5) ty = g0 + 0.5;
  if (ty > -0.12) ty = -0.12;
  const py0 = a.y; a.y += (ty - a.y) * min(1, dt * 2.5); a.pitch += (atan2((a.y - py0) / dt, max(sp, 0.5)) - a.pitch) * min(1, dt * 4);
  a.ph += dt * (lion ? 3 + sp * 1.5 : sp > 0 ? 3.2 : 0.8);
  a.yaw = atan2(-sin(a.hd), cos(a.hd)); a.mv = sp;
}
// Nothing overlaps: pairs that come closer than their radii are pushed apart, and land animals and people are pushed out of boulders.
const actRad = (a) => (a.k === 'P' || a.k === 'V' ? [0.34, 0.5, 0.78, 0.42][a.pose] * (a.pose === 2 ? 1 : a.sc) : a.k === 'N' ? 0.6 : a.k === 'X' ? 0.14 * a.sc : a.k === 'Q' ? 0.5 : a.k === 'K' ? 1.6 : a.k === 'U' ? 1.1 : a.k === 'R' ? 1.0 : a.k === 'F' ? 0.3 : a.k === 'G' ? 0.22 : a.k === 'C' ? 0.1 : a.k === 'E' ? 0.6 * a.sc : 0.85 * a.sc);
function separate() {
  for (let it = 0; it < 2; it++) {
    for (let i = 0; i < NACT; i++) {
      const a = ACT[i], ra = actRad(a), land = a.k === 'P' || a.k === 'L' || a.k === 'V' || a.k === 'X';
      if ((a.k === 'G' || a.k === 'Q') && a.st >= 2 && a.st !== 5) continue;
      for (let j = i + 1; j < NACT; j++) {
        const b = ACT[j]; if ((b.k === 'G' || b.k === 'Q') && b.st >= 2 && b.st !== 5) continue;
        const dx = a.x - b.x, dz = a.z - b.z, m = ra + actRad(b);
        if (dx > m || dx < -m || dz > m || dz < -m || a.y - b.y > 1.4 || b.y - a.y > 1.4) continue;
        const d = hypot(dx, dz); if (d >= m) continue;
        const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0, p = (m - d) * 0.5;
        a.x += nx * p; a.z += nz * p; b.x -= nx * p; b.z -= nz * p;
      }
      if (land) for (const o of Wd.blockers) { const dx = a.x - o[0], dz = a.z - o[1], m = ra + o[2], d = hypot(dx, dz); if (d < m && d > 1e-3) { a.x += dx / d * (m - d); a.z += dz / d * (m - d); } }
    }
  }
}
// quaternion for yaw (about Y), then pitch (about Z), then roll (about the forward X axis), written straight into an instance
function setQ(f, o, yaw, pitch, roll) {
  const sy = sin(yaw * 0.5), cy = cos(yaw * 0.5), sp = sin(pitch * 0.5), cp = cos(pitch * 0.5), sr = sin(roll * 0.5), cr = cos(roll * 0.5);
  const ax = sy * sp, ay = sy * cp, az = cy * sp, aw = cy * cp;
  f[o + 4] = aw * sr + ax * cr; f[o + 5] = ay * cr + az * sr; f[o + 6] = -ay * sr + az * cr; f[o + 7] = aw * cr - ax * sr;
}
// harbour seals: shy and quiet; they keep away from the camera (and dive when it comes close), otherwise drift about at the surface
function updSeal(a, dt, px, pz, py) {
  const dx = px - a.x, dz = pz - a.z, d = hypot(dx, dz), shy = d < 11 && py < 3;
  let sp = 0.9, tx, tz;
  if (shy) { tx = a.x - dx * 4; tz = a.z - dz * 4; sp = 2.1; }
  else { a.tm -= dt; if (a.tm < 0 || hypot(a.wx - a.x, a.wz - a.z) < 3) { a.wx = rr(94, 124); a.wz = rr(-44, 44); a.tm = 9 + rnd() * 9; } tx = a.wx; tz = a.wz; }
  let want = atan2(tz - a.z, tx - a.x);
  const g0 = ground(a.x, 2, a.z), ah = ground(a.x + cos(a.hd) * 3.5, 2, a.z + sin(a.hd) * 3.5);
  if (ah > -1.5 || a.x > 128) want = PI;
  angTo(a, want, 1.3, dt);
  a.x += cos(a.hd) * sp * dt; a.z += sin(a.hd) * sp * dt; a.dv += dt * 0.6;
  let ty = shy ? -2.2 : -0.3 + 0.22 * sin(a.dv);
  if (g0 > -1e8 && ty < g0 + 0.5) ty = g0 + 0.5;
  if (ty > -0.12) ty = -0.12;
  const y0 = a.y; a.y += (ty - a.y) * min(1, dt * 2.5); a.pitch += (atan2((a.y - y0) / dt, max(sp, 0.5)) - a.pitch) * min(1, dt * 4);
  a.ph += dt * (2.2 + sp * 1.8); a.yaw = atan2(-sin(a.hd), cos(a.hd)); a.mv = sp;
}
// gulls: st 0 strut and peck on the sand, 1 float on the sea, 2 fly (circling over the cove), 3 glide down to land
function pickLanding(a, px, pz) {
  for (let k = 0; k < 8; k++) {
    const sea = rnd() < 0.5, x = sea ? rr(100, 128) : rr(142, 166), z = sea ? rr(-40, 40) : rr(-36, 34);
    if (hypot(x - px, z - pz) < 10) continue;
    if (sea) { a.tx = x; a.tz = z; a.ty = -0.15; return; }
    const g = ground(x, 4, z); if (g > 0.2 && g < 2.5) { a.tx = x; a.tz = z; a.ty = g; return; }
  }
  a.tx = rr(100, 128); a.tz = rr(-30, 30); a.ty = -0.15;
}
function updGull(a, dt, px, pz, py) {
  const dx = a.x - px, dz = a.z - pz, d = hypot(dx, dz);
  let sp = 0, flying = a.st >= 2;
  if (a.st === 0 || a.st === 1) {
    if (a.st === 0) { // on the sand
      a.tm -= dt;
      if (a.tm < 0) { a.pk2 = !a.pk2; a.tm = a.pk2 ? 0.7 + rnd() * 1.2 : 1 + rnd() * 2.5; if (!a.pk2) a.hd += rr(-2, 2); }
      if (a.pk2) a.pk = max(0, sin(F[TIME] * 9 + a.seed * 20)); else { a.pk *= 1 - min(1, dt * 8); sp = 0.55; }
      if (sp > 0) { const nx = a.x + cos(a.hd) * sp * dt, nz = a.z + sin(a.hd) * sp * dt, g = ground(nx, a.y + 1.5, nz); if (g > 0.15 && abs(g - a.y) < 0.4) { a.x = nx; a.z = nz; a.y += (g - a.y) * min(1, dt * 10); } else a.hd += 2.5; }
    } else { // afloat
      a.hd += rr(-0.6, 0.6) * dt; sp = 0.12; a.x += cos(a.hd) * sp * dt; a.z += sin(a.hd) * sp * dt;
      if (ground(a.x, 2, a.z) > -0.8) a.hd = PI;
      a.y = -0.15 + 0.02 * sin(F[TIME] * 1.7 + a.seed * 9); a.pk = 0;
    }
    a.mv = sp > 0 ? 1 : 0; a.ph += sp * 9 * dt;
    if (d < (a.st ? 7 : 5) && py > -2) { // take off, away from the camera, with a squawk
      a.st = 2; a.hd = atan2(dz, dx); a.sp = 2; a.fy = 8 + rnd() * 5; a.tm = 12 + rnd() * 14; a.dir = rnd() < 0.5 ? -1 : 1; a.amt = 1;
      if (BARK) BARK(clamp(((a.x - px) * F[RX] + (a.z - pz) * F[RZ]) / (d + 1), -1, 1), 0.3 * clamp(1.2 - d / 40, 0, 1), 4);
    }
    a.pitch = 0; a.roll = 0;
  } else {
    let want = a.hd, rate = a.sp / 24, bank = 0;
    if (a.st === 2) { // circle over the cove, keeping near it; after a while come down somewhere
      a.sp += (7 - a.sp) * min(1, dt * 0.8); a.tm -= dt;
      want = a.hd + a.dir; rate = a.sp / 24; bank = a.dir * 0.3;
      if (hypot(a.x - 132, a.z) > 55) { want = atan2(-a.z, 132 - a.x); rate = 1; }
      a.amt = a.y < a.fy - 1 ? 1 : 0.25 + 0.2 * sin(F[TIME] * 0.3 + a.seed * 9);
      if (a.tm < 0) { pickLanding(a, px, pz); a.st = 3; }
    } else { // glide down to the landing spot
      const ex = a.tx - a.x, ez = a.tz - a.z, dd = hypot(ex, ez);
      want = atan2(ez, ex); rate = 1.8; a.sp += (max(2.5, min(7, dd * 0.8)) - a.sp) * min(1, dt * 2); a.amt = dd < 6 ? 0.8 : 0.2;
      a.y += (a.ty + dd * 0.3 - a.y) * min(1, dt * 2.5);
      if (dd < 1.1 && a.y < a.ty + 0.6) { a.st = a.ty < 0 ? 1 : 0; a.x = a.tx; a.z = a.tz; a.y = a.ty; a.tm = 1; a.pk = 0; a.sp = 0; }
      bank = 0;
    }
    let da = atan2(sin(want - a.hd), cos(want - a.hd)); const m = rate * dt; a.hd += da < -m ? -m : da > m ? m : da;
    if (a.st === 2) a.y += clamp((a.fy - a.y) * 0.6, -3, 4) * dt;
    const vx = cos(a.hd) * a.sp, vz = sin(a.hd) * a.sp; a.x += vx * dt; a.z += vz * dt;
    a.pitch += (atan2(a.st === 2 ? (a.fy - a.y) * 0.3 : -0.25 * a.sp, max(a.sp, 1)) - a.pitch) * min(1, dt * 3); a.pitch = clamp(a.pitch, -0.5, 0.6);
    a.roll += (bank - a.roll) * min(1, dt * 3);
    a.ph += dt * (5 + 9 * a.amt); a.mv = 0;
  }
  a.yaw = atan2(-sin(a.hd), cos(a.hd));
}
// chipmunks: friendly. They run up to you, or to a tourist on the cliff, and sit up begging for food; alone they dash about the grass and nibble.
function updChip(a, dt, px, pz, py) {
  let tx = 0, tz = 0, best = 14, has = 0;
  if (py > 8) { const d = hypot(px - a.x, pz - a.z); if (d < best) { best = d; tx = px; tz = pz; has = 1; } }
  for (const b of ACT) if (b.k === 'P' && b.high && b.pose !== 2) { const d = hypot(b.x - a.x, b.z - a.z); if (d < best) { best = d; tx = b.x; tz = b.z; has = 1; } }
  let sp = 0;
  if (has) {
    if (best > 0.7) { a.pose = 0; sp = best > 4 ? 3.4 : 1.9; if (!stepActor(a, tx - a.x, tz - a.z, sp, dt, 9)) sp = 0; else turnTo(a, atan2(-a.mz, a.mx), 10, dt); }
    else { a.pose = 1; turnTo(a, atan2(-(tz - a.z), tx - a.x), 6, dt); a.ph += dt * 5; }
  } else {
    a.tm -= dt;
    if (a.tm < 0) { if (rnd() < 0.5) { a.pose = 1; a.tm = 2 + rnd() * 3; } else { a.pose = 0; a.tx = a.x + rr(-5, 5); a.tz = a.z + rr(-5, 5); a.tm = 1 + rnd() * 2; } }
    if (a.pose === 0) { sp = 2.6; if (hypot(a.tx - a.x, a.tz - a.z) < 0.3 || !stepActor(a, a.tx - a.x, a.tz - a.z, sp, dt, 9)) { sp = 0; a.tm = min(a.tm, 0.1); } else turnTo(a, atan2(-a.mz, a.mx), 10, dt); }
    else a.ph += dt * 4;
  }
  a.amt += ((a.pose === 1 ? 1 : sp > 0 ? 1 : 0) - a.amt) * min(1, dt * (a.pose === 1 ? 5 : 10));
  if (a.pose === 0) a.ph += sp * 11 * dt;
}
// the lifeguard in the tower shouts at anyone who gets too close to the sea lions: a caption, a whistle and a voice (where the browser has one)
const GUARD_LINES = ['Hey! Please keep back from the sea lions!', 'That is too close! Back away, please!', 'Give the sea lions some space!', 'Sir! Step back from the animals!'];
const CAPT = document.createElement('div');
CAPT.style.cssText = 'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);padding:.5em 1em;max-width:80vw;background:#000a;color:#fff;font:600 1.1em system-ui,sans-serif;border-radius:.5em;pointer-events:none;opacity:0;transition:opacity .3s;z-index:5';
document.body.append(CAPT);
let captT = 0;
function shout(txt, vol) {
  CAPT.textContent = 'Lifeguard: "' + txt + '"'; CAPT.style.opacity = 1; clearTimeout(captT); captT = setTimeout(() => { CAPT.style.opacity = 0; }, 3800);
  if (!muted && window.speechSynthesis) { try { const u = new SpeechSynthesisUtterance(txt); u.rate = 1.05; u.pitch = 0.8; u.volume = vol; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { /* no voice */ } }
}
function updGuard(a, dt, px, pz, py) {
  if (ROLE === 3) return;
  let ox = 0, oz = 0, who = 0, bd = 1e9;
  for (const b of ACT) {
    if (b.k !== 'L' || b.st === 1) continue;
    const d = hypot(px - b.x, pz - b.z);
    if (py > -2.5 && d < 9 && d < bd) { bd = d; ox = px; oz = pz; who = 1; }
    for (const c of ACT) if ((c.k === 'P' && !c.high && c.pose === 0 && hypot(c.x - b.x, c.z - b.z) < 4.5) || (c.k === 'V' && c.st === 1 && hypot(c.x - b.x, c.z - b.z) < 9)) { ox = c.x; oz = c.z; who = 2; }
  }
  turnTo(a, who ? atan2(ox - a.x, oz - a.z) : -0.8, 2.5, dt);
  a.amt += ((who ? 1 : 0) - a.amt) * min(1, dt * 5);
  a.cd -= dt;
  if (who && a.cd < 0) {
    const d = hypot(a.x - px, a.z - pz), pan = clamp(((a.x - px) * F[RX] + (a.z - pz) * F[RZ]) / (d + 1), -1, 1);
    if (a.fresh && WHISTLE) WHISTLE(pan, 0.25 * clamp(1.3 - d / 150, 0.2, 1));
    shout(GUARD_LINES[rnd() * GUARD_LINES.length | 0], clamp(1.1 - d / 160, 0.25, 1)); a.cd = 7.5; a.fresh = 0;
    if (who === 2) warnVisitors(a.x, a.z, 90, false);
  }
  if (!who) a.fresh = 1;
}
// boats, boards and surfers keep to the open water well away from the cove: x 56..90
function steerWater(a, tx, tz, sp, rate, dt) { angTo(a, atan2(tz - a.z, tx - a.x), rate, dt); a.x += cos(a.hd) * sp * dt; a.z += sin(a.hd) * sp * dt; }
function updPaddler(a, dt) { // kayak (K) and paddle board (U)
  a.tm -= dt; if (a.tm < 0 || hypot(a.wx - a.x, a.wz - a.z) < 4) { a.wx = rr(58, 90); a.wz = rr(-44, 58); a.tm = 14 + rnd() * 10; }
  const sp = a.k === 'K' ? 1.15 : 0.8;
  steerWater(a, a.wx, a.wz, sp, 0.5, dt);
  a.ph += dt * (a.k === 'K' ? 3.4 : 2.4);
  a.y = -0.05 + 0.02 * sin(F[TIME] * 1.3 + a.seed * 9); a.yaw = atan2(-sin(a.hd), cos(a.hd));
}
// a surfer: sits on the board waiting (0), paddles out to the start of a ride (1), rides along the swell (2), paddles back (3)
function updSurfer(a, dt) {
  const sx = a.hx - 10, sz = a.hz - 3, ex = a.hx + 4, ez = a.hz + 28;
  let sp = 0, tx = a.hx, tz = a.hz;
  a.y = -0.04 + 0.025 * sin(F[TIME] * 1.1 + a.seed * 9); a.roll = 0;
  if (a.st === 0) { a.tm -= dt; if (a.tm < 0) a.st = 1; }
  else if (a.st === 1) { tx = sx; tz = sz; sp = 1.0; if (hypot(sx - a.x, sz - a.z) < 3) a.st = 2; }
  else if (a.st === 2) { tx = ex; tz = ez; sp = 5.5; a.roll = sin(F[TIME] * 2 + a.seed * 9) * 0.12; a.y = -0.02; if (hypot(ex - a.x, ez - a.z) < 3) a.st = 3; }
  else { sp = 1.0; if (hypot(a.hx - a.x, a.hz - a.z) < 3) { a.st = 0; a.tm = 6 + rnd() * 12; } }
  if (sp > 0) steerWater(a, tx, tz, sp, a.st === 2 ? 2 : 1.2, dt);
  a.ph += dt * (a.st === 1 || a.st === 3 ? 3.2 : 1); a.yaw = atan2(-sin(a.hd), cos(a.hd)); a.sp = sp;
}
// one instance into a slot
function emit(slot, x, y, z, yaw, pitch, roll, seed, ph, w, sc = 1, mat = 10) {
  const o = SLN[slot]++ * 12, f = SLI[slot];
  setQ(f, o, yaw, pitch, roll); f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = sc; f[o + 8] = mat; f[o + 9] = seed; f[o + 10] = ph; f[o + 11] = w;
}
function emitCraft(a) {
  const hd = a.hd, yk = a.yaw, yp = atan2(cos(hd), sin(hd)), fx = cos(hd), fz = sin(hd), k = a.k;
  if (k === 'F') { if (ROLE === 3) return; emit(0, a.x, a.y + a.lift, a.z, a.yaw, 0, 0, a.seed, 0, 5 + a.amt * 0.99); return; }
  if (k === 'K') {
    emit(12, a.x, a.y, a.z, yk, 0, 0, a.seed, 0, 0); emit(1, a.x, a.y + 0.05, a.z, yp, 0, 0, a.seed, a.ph, 6);
    emit(14, a.x + fx * 0.35, a.y + 0.55, a.z + fz * 0.35, yk, 0, sin(a.ph) * 0.45, a.seed, 0, 0);
  } else if (k === 'U') {
    emit(11, a.x, a.y, a.z, yk, 0, 0, a.seed, 0, 0); emit(0, a.x, a.y + 0.1, a.z, yp, 0, 0, a.seed, a.ph, 7);
    emit(13, a.x + fx * 0.3 - fz * 0.3, a.y + 1.0, a.z + fz * 0.3 + fx * 0.3, yk, sin(a.ph) * 0.35, -0.15, a.seed, 0, 0);
  } else {
    emit(10, a.x, a.y, a.z, yk, 0, a.roll, a.seed, 0, 0);
    if (a.st === 0) emit(1, a.x, a.y + 0.1, a.z, yp, 0, 0, a.seed, a.ph, 1);
    else if (a.st === 2) { emit(0, a.x, a.y + 0.07, a.z, yp, 0, a.roll, a.seed, a.ph, 9); emit(15, a.x - fx * 0.7, 0.01, a.z - fz * 0.7, yk, 0, 0, a.seed, 0, 0, 1 + 0.15 * sin(F[TIME] * 9)); }
    else emit(4, a.x, a.y + 0.17, a.z, yk, 0, 0, a.seed, a.ph, 8);
  }
}
// ---------------------------------------------------------------- roles: swim as yourself, or be a sea lion, a gull or the lifeguard
// T changes role, V swaps between the chase camera and the animal's own eyes, B calls: a bark, a squawk, or the lifeguard's warning.
const ROLES = ['Swimmer', 'Sea lion', 'Gull', 'Lifeguard', 'Pelican', 'Crab', 'Seal'], CALLS = ['', 'bark  ·  E charge and bite', 'squawk', 'warn the visitors', 'plunge-dive for fish', 'pinch  ·  E dig in / out', 'grunt'];
let ROLE = 0, TPV = true, swapped = false, score = 0, callCd = 0, callT = 0, fishCaught = 0, pinched = 0;
const PL = new Float64Array(3), EY = new Float64Array(3), DV = new Float64Array(7);
// avatar: mode 0 on the ground (sea lion on land, gull walking), 1 in the water (swimming, floating), 2 in the air (gull)
const AV = { x: 0, y: 0, z: 0, hd: PI, pitch: 0, roll: 0, sp: 0, ph: 0, mode: 0, vx: 0, vy: 0, vz: 0, mv: 0, alert: 0.9, fl: 0.3, idle: 0, yawp: 0, tm: 0, swal: 0, held: false, dig: 0, digT: 0, pinchT: 0, byaw: 0 };
const HUDR = document.createElement('div');
HUDR.style.cssText = 'position:fixed;top:1em;left:50%;transform:translateX(-50%);padding:.35em .9em;background:#0008;color:#e8fbff;font:600 .85em system-ui,sans-serif;border-radius:2em;pointer-events:none;z-index:5;white-space:nowrap';
document.body.append(HUDR);
function roleHud() { if (typeof tbUpdate === 'function') tbUpdate(); HUDR.textContent = ROLES[ROLE] + (TOUCHUI ? '' : ROLE ? '  ·  T next role  ·  V view  ·  B ' + CALLS[ROLE] : '  ·  T: play as an animal or the lifeguard') + (ROLE === 3 ? '  ·  visitors turned back: ' + score : '') + (ROLE === 4 ? '  ·  fish caught: ' + fishCaught : '') + (ROLE === 5 ? '  ·  people pinched: ' + pinched : ''); }
function setRole(r) {
  if (ROLE === 0) { DV[0] = F[CX]; DV[1] = F[CY]; DV[2] = F[CZ]; DV[3] = F[YAW]; DV[4] = F[PIT]; DV[5] = walk ? 1 : 0; DV[6] = above ? 1 : 0; }
  ROLE = r; if (!PERCH.length) buildPerches(); perchOn = r === 2 || r === 4; walk = above = false; F[VX] = F[VY] = F[VZ] = 0; TPV = true; swapped = false; AV.vx = AV.vy = AV.vz = AV.sp = AV.mv = AV.pitch = AV.roll = 0;
  if (r === 0) { F[CX] = DV[0]; F[CY] = DV[1]; F[CZ] = DV[2]; F[YAW] = DV[3]; F[PIT] = DV[4]; walk = !!DV[5]; above = !!DV[6]; }
  else if (r === 1) { AV.x = 143.5; AV.z = 12; AV.y = ground(AV.x, 4, AV.z); AV.hd = PI; AV.mode = 0; AV.alert = 0.9; F[YAW] = -PI / 2; F[PIT] = -0.2; }
  else if (r === 2) { AV.x = 136; AV.y = 11; AV.z = 4; AV.hd = PI; AV.mode = 2; AV.sp = 6; F[YAW] = -PI / 2; F[PIT] = -0.1; }
  else if (r === 4) { AV.x = 132; AV.y = 10; AV.z = -6; AV.hd = PI; AV.mode = 2; AV.sp = 6.5; F[YAW] = -PI / 2; F[PIT] = -0.1; }
  else if (r === 6) { AV.x = 143.5; AV.z = 12; AV.y = ground(AV.x, 4, AV.z); AV.hd = PI; AV.mode = 0; F[YAW] = -PI / 2; F[PIT] = -0.2; }
  else if (r === 5) { AV.x = 147; AV.z = -10; AV.y = ground(AV.x, 4, AV.z); AV.hd = PI; AV.dig = AV.digT = 0; AV.byaw = 0; AV.pinchT = 0; F[YAW] = -PI / 2; F[PIT] = -0.25; }
  else { F[CX] = 182.5; F[CZ] = -14; F[CY] = ground(182.5, 12, -14) + 1.7; walk = true; F[YAW] = -PI / 2; F[PIT] = -0.1; }
  if (r === 1) { BB.x = AV.x - 1.6; BB.z = AV.z + 0.6; BB.y = ground(BB.x, 4, BB.z); BB.mode = 0; BB.hd = PI; }
  roleHud();
}
const avTurn = (want, rate, dt) => { let d = want - AV.hd; d = atan2(sin(d), cos(d)); const m = rate * dt; AV.hd += d < -m ? -m : d > m ? m : d; };
function lionMove(dt, yaw, pitch, mf, mr, fast) {
  const A = AV, sy = sin(yaw), cw = cos(yaw), cp = cos(pitch), SEAL_ = ROLE === 6;
  if (A.mode === 0) { // on land: waddle, or gallop (a seal humps along on its belly, much slower)
    let dx = sy * mf + cw * mr, dz = -cw * mf + sy * mr; let l = hypot(dx, dz), sp = SEAL_ ? (fast ? 2.2 : 1.1) : fast ? 5 : 2.4;
    A.mv = 0;
    if (A.chg > 0 && !SEAL_) { // aggressive charge: rush the nearest person, then bite
      A.chg -= dt; let bd = 16, tb = null;
      for (const b of ACT) if ((b.k === 'P' || b.k === 'V') && b.pose !== 2) { const d = hypot(b.x - A.x, b.z - A.z); if (d < bd) { bd = d; tb = b; } }
      if (tb) { dx = tb.x - A.x; dz = tb.z - A.z; l = hypot(dx, dz); sp = 7; if (bd < 1.5 && !(A.biteT > 0)) { A.biteT = 0.6; if (BARK) BARK(0, 0.8, 2); crabPinchPerson(tb, A.x, A.z); tb.ft = 5; bitten++; roleHud(); toast(['Aaah! It bit me!', 'Run! Sea lion!', 'Ow! Get away!'][bitten % 3], 1); A.chg = 0.3; } }
      else sp = 6;
    }
    if (A.biteT > 0) A.biteT -= dt;
    if (l > 0.05) {
      dx /= l; dz /= l;
      for (let k = 0; k < 3; k++) {
        const an = k === 0 ? 0 : k === 1 ? 0.7 : -0.7, c = cos(an), s = sin(an), ex = dx * c - dz * s, ez = dx * s + dz * c;
        let nx = A.x + ex * sp * dt, nz = A.z + ez * sp * dt; const r = hypot(nx, nz); if (r > 186) { nx *= 186 / r; nz *= 186 / r; } if (nx > 120) nz = nz < -72 ? -72 : nz > 72 ? 72 : nz;
        const gh = ground(nx, A.y + 1.5, nz);
        if (gh > -3 && gh < A.y + 0.5 && gh > A.y - 0.6) { A.x = nx; A.z = nz; A.y += (gh - A.y) * min(1, dt * 12); A.mv = sp; avTurn(atan2(ez, ex), 5, dt); break; }
      }
    }
    A.idle = A.mv ? 0 : A.idle + dt; A.alert += ((A.mv || A.idle < 6 ? 0.9 : 0.1) - A.alert) * min(1, dt * 2.5);
    A.ph += A.mv * 5.5 * dt;
    if (ground(A.x, 2, A.z) < -0.65) { A.mode = 1; A.y = -0.35; }
    F[CX] = A.x; F[CY] = A.y + 0.9; F[CZ] = A.z;
  } else { // swimming: fast and free, rowing with the fore flippers
    const sp = SEAL_ ? (fast ? 6.5 : 3.4) : fast ? 8 : 4, k = 1 - exp(-dt * 3);
    A.vx += ((sy * cp * mf + cw * mr) * sp - A.vx) * k; A.vz += ((-cw * cp * mf + sy * mr) * sp - A.vz) * k; A.vy += ((sin(pitch) * mf + (ku - kd)) * sp - A.vy) * k;
    let nx = A.x + A.vx * dt, ny = A.y + A.vy * dt, nz = A.z + A.vz * dt; const r = hypot(nx, nz); if (r > 150) { nx *= 150 / r; nz *= 150 / r; } if (nx > 120) nz = nz < -72 ? -72 : nz > 72 ? 72 : nz;
    const g0 = ground(nx, 2, nz);
    if (g0 > -0.3 && (mf > 0 || mr)) { A.mode = 0; A.y = g0; A.x = nx; A.z = nz; A.vx = A.vz = A.vy = 0; }
    else {
      if (sdp(nx, ny, nz) > -0.05) { A.vx = A.vz = A.vy = 0; } else { A.x = nx; A.z = nz; if (g0 > -1e8 && ny < g0 + 0.4) ny = g0 + 0.4; A.y = ny > -0.12 ? -0.12 : ny < -50 ? -50 : ny; }
      const hs = hypot(A.vx, A.vz); if (hs > 0.3) avTurn(atan2(A.vz, A.vx), 4, dt);
      A.pitch += (atan2(A.vy, max(hs, 1)) - A.pitch) * min(1, dt * 4); A.mv = hs; A.ph += dt * (2.5 + hs * 1.2);
    }
    F[CX] = A.x; F[CY] = A.y; F[CZ] = A.z;
  }
}
function lookMove(dt, yaw, pitch) {
  const fast = ks || tN > 1, mf = tId >= 0 && !TOUCHUI ? 0.7 : kf - kb, mr = kr - kl;
  if (ROLE === 1 || ROLE === 6) lionMove(dt, yaw, pitch, mf, mr, fast); else if (ROLE === 5) crabMove(dt, yaw, mf, mr, fast); else gullMove(dt, yaw, pitch, mf, mr, fast);
}
function gullMove(dt, yaw, pitch, mf, mr, fast) {
  const A = AV, sy = sin(yaw), cw = cos(yaw), P = ROLE === 4;
  A.swal -= dt;
  if (A.mode === 3) { // plunge dive: wings folded, straight down at the water
    A.pitch += (-1.25 - A.pitch) * min(1, dt * 6); A.sp = 10; A.x += cos(A.hd) * 3.5 * dt; A.z += sin(A.hd) * 3.5 * dt; A.y -= 12 * dt;
    if (A.y <= 0.05) { splash(A.x, A.z); A.mode = 4; A.tm = 2.6; }
  } else if (A.mode === 4) { // under the surface, after a fish: swim about, or come up early with E
    A.tm -= dt; A.pitch += (0.3 - A.pitch) * min(1, dt * 4);
    const g0 = ground(A.x, 2, A.z); let ty = -1.8; if (g0 > -1e8 && ty < g0 + 0.5) ty = g0 + 0.5;
    A.y += (ty - A.y) * min(1, dt * 4); avTurn(atan2(-cw, sy), 2, dt);
    const sp2 = mf > 0 ? 3.5 : 1.2, nx = A.x + cos(A.hd) * sp2 * dt, nz = A.z + sin(A.hd) * sp2 * dt; if (sdp(nx, A.y, nz) < -0.1 && ground(nx, 2, nz) < -0.6) { A.x = nx; A.z = nz; }
    if (A.tm <= 0 || ku) { A.mode = 1; A.y = -0.15; A.swal = 2.5; A.sp = 0; A.pitch = 0; A.held = rnd() < 0.6; if (A.held) { fishCaught++; roleHud(); toast('You caught a fish!'); } else toast('Nothing this time…'); }
  } else if (A.mode === 2) { // flying: always moving; W speeds up, S slows to land; look up and down to climb and dive, E / Q for a flap up or down
    const want = atan2(-cw, sy); avTurn(want, P ? 1.7 : 2.2, dt);
    const dd = atan2(sin(want - A.hd), cos(want - A.hd));
    A.sp += ((mf > 0 ? (fast ? 12 : 8.5) : mf < 0 ? 3.5 : 6) * (P ? 0.92 : 1) - A.sp) * min(1, dt * 1.5);
    A.pitch += (clamp(pitch * 0.9, -0.75, 0.7) - A.pitch) * min(1, dt * 3); A.roll += (clamp(dd * 1.2, -0.6, 0.6) - A.roll) * min(1, dt * 3);
    const hs = A.sp * cos(A.pitch), nx = A.x + cos(A.hd) * hs * dt, nz = A.z + sin(A.hd) * hs * dt; let ny = A.y + (A.sp * sin(A.pitch) + (ku - kd) * 3 - (mf < 0 ? 1.8 : 0)) * dt;   // S also settles you down gently
    if (sdp(nx, ny, nz) > -0.1) { A.sp *= 0.6; ny = A.y + dt; } else { A.x = nx; A.z = nz; }
    // touching down: on the sand or rock, or on the water, as long as you are not pressing W
    const g = ground(A.x, min(ny + 1, 13), A.z);
    if (g > -1e8 && ny < g + 0.3) { if (mf <= 0) { A.mode = g > 0.15 ? 0 : 1; ny = g > 0.15 ? g : -0.15; A.sp = 0; A.pitch = A.roll = 0; } else ny = g + 0.3; }
    else if (g < -0.3 && ny < 0.3) { if (mf <= 0) { A.mode = 1; ny = -0.15; A.sp = 0; A.pitch = A.roll = 0; } else ny = 0.3; }
    A.y = ny > 45 ? 45 : ny; const r = hypot(A.x, A.z); if (r > 178) { A.x *= 178 / r; A.z *= 178 / r; }
    A.fl = mf > 0 || ku ? 0.9 : 0.3; A.ph += dt * (5 + 9 * A.fl) * (P ? 0.55 : 1); A.mv = 0;
  } else { // on the ground (0) or afloat (1): walk, paddle, and E takes off again
    let dx = sy * mf + cw * mr, dz = -cw * mf + sy * mr; const l = hypot(dx, dz), sp = A.mode === 0 ? (fast ? 3.2 : 1.5) : 0.9;
    A.mv = 0; A.pitch = A.roll = 0;
    if (l > 0.05) {
      dx /= l; dz /= l; const nx = A.x + dx * sp * dt, nz = A.z + dz * sp * dt;
      if (A.mode === 0) { const gh = ground(nx, A.y + 1.5, nz); if (gh > -0.3 && abs(gh - A.y) < 0.5) { A.x = nx; A.z = nz; A.y += (gh - A.y) * min(1, dt * 10); A.mv = 1; } else if (gh <= -0.3 && gh > -1e8) { A.mode = 1; A.x = nx; A.z = nz; } }
      else { const gh = ground(nx, 2, nz); A.x = nx; A.z = nz; if (gh > -0.3) { A.mode = 0; A.y = gh; } A.mv = 1; }
      avTurn(atan2(dz, dx), 5, dt);
    }
    if (A.mode === 1) A.y = -0.15 + 0.02 * sin(F[TIME] * 1.7);
    A.ph += A.mv * 9 * dt;
    if (ku) { A.mode = 2; A.sp = 5.5; A.pitch = 0.35; A.y += 0.6; }
  }
  F[CX] = A.x; F[CY] = A.y + 0.2; F[CZ] = A.z;
}
const toast = (t) => { CAPT.textContent = t; CAPT.style.opacity = 1; clearTimeout(captT); captT = setTimeout(() => { CAPT.style.opacity = 0; }, 2500); };
// the baby sea lion that tags along behind you when you are a sea lion: on the sand, in the water, and out again
const BB = { x: 0, y: 0, z: 0, hd: PI, mode: 0, ph: 0, mv: 0, pitch: 0, cd: 3 };
function updBaby(dt) {
  if (ROLE !== 1) return;
  const A = AV, tx = A.x - cos(A.hd) * 1.7 - sin(A.hd) * 0.6, tz = A.z - sin(A.hd) * 1.7 + cos(A.hd) * 0.6, dx = tx - BB.x, dz = tz - BB.z, dd = hypot(dx, dz);
  if (dd > 30) { BB.x = tx; BB.z = tz; BB.mode = A.mode; BB.y = A.y; return; }
  BB.mv = 0;
  if (BB.mode === 0) {
    const sp = min(dd * 1.8, 3.2 + (ks ? 3 : 0)); 
    if (dd > 0.3) {
      for (let k = 0; k < 3; k++) {
        const an = k === 0 ? 0 : k === 1 ? 0.7 : -0.7, c = cos(an), s = sin(an), ex = (dx * c - dz * s) / dd, ez = (dx * s + dz * c) / dd, nx = BB.x + ex * sp * dt, nz = BB.z + ez * sp * dt, gh = ground(nx, BB.y + 1.5, nz);
        if (gh > -3 && gh < BB.y + 0.5 && gh > BB.y - 0.6) { BB.x = nx; BB.z = nz; BB.y += (gh - BB.y) * min(1, dt * 12); BB.mv = sp; let d = atan2(ez, ex) - BB.hd; d = atan2(sin(d), cos(d)); BB.hd += clamp(d, -6 * dt, 6 * dt); break; }
      }
    }
    BB.ph += BB.mv * 5.5 * dt;
    if (ground(BB.x, 2, BB.z) < -0.65) { BB.mode = 1; BB.y = -0.3; }
  } else {
    const sp = min(dd * 2, ks ? 8 : 6);
    if (dd > 0.3) { const nx = BB.x + dx / dd * sp * dt, nz = BB.z + dz / dd * sp * dt, g0 = ground(nx, 2, nz); if (g0 > -0.3 && A.mode === 0) { BB.mode = 0; BB.y = g0; } BB.x = nx; BB.z = nz; BB.mv = sp; let d = atan2(dz, dx) - BB.hd; d = atan2(sin(d), cos(d)); BB.hd += clamp(d, -6 * dt, 6 * dt); }
    const g0 = ground(BB.x, 2, BB.z); let ty = A.mode === 1 ? A.y : -0.3; if (g0 > -1e8 && ty < g0 + 0.3) ty = g0 + 0.3; if (ty > -0.12) ty = -0.12;
    const y0 = BB.y; BB.y += (ty - BB.y) * min(1, dt * 3); BB.pitch += (atan2((BB.y - y0) / dt, max(BB.mv, 0.5)) - BB.pitch) * min(1, dt * 4); BB.ph += dt * (2.5 + BB.mv * 1.2);
  }
  BB.cd -= dt; if (dd > 9 && BB.cd < 0) { if (BARK) BARK(0, 0.35, 3); BB.cd = 3 + rnd() * 3; }
  const yaw = atan2(-sin(BB.hd), cos(BB.hd));
  if (BB.mode === 0) emit(5, BB.x, BB.y, BB.z, yaw, 0, 0, 0.62, BB.ph, 0.9 * 0.49 + (BB.mv ? 0.5 : 0), 0.5, 11); else emit(6, BB.x, BB.y, BB.z, yaw, BB.pitch, 0, 0.62, BB.ph, 1, 0.5, 11);
}
// the chase camera: behind the avatar along the view direction, pulled in where rock is in the way
// a crab you can steer: it scuttles sideways over the sand and along the seabed, E digs it in (and out again), B snaps the claws at anyone within reach
function crabMove(dt, yaw, mf, mr, fast) {
  const A = AV, sy = sin(yaw), cw = cos(yaw);
  A.dig += clamp(A.digT - A.dig, -dt / 0.9, dt / 1.1); A.pinchT -= dt; A.mv = 0;
  let dx = sy * mf + cw * mr, dz = -cw * mf + sy * mr; const l = hypot(dx, dz), sp = fast ? 3.6 : 1.7;
  if (A.dig < 0.05 && l > 0.05) {
    dx /= l; dz /= l;
    for (let k = 0; k < 3; k++) {
      const an = k === 0 ? 0 : k === 1 ? 0.7 : -0.7, c = cos(an), s = sin(an), ex = dx * c - dz * s, ez = dx * s + dz * c;
      let nx = A.x + ex * sp * dt, nz = A.z + ez * sp * dt; const r = hypot(nx, nz); if (r > 150) { nx *= 150 / r; nz *= 150 / r; } if (nx > 120) nz = nz < -72 ? -72 : nz > 72 ? 72 : nz;
      const gh = ground(nx, A.y + 1.5, nz);
      if (gh > -3.5 && gh < A.y + 0.5 && gh > A.y - 0.6) { A.x = nx; A.z = nz; A.y += (gh - A.y) * min(1, dt * 12); A.mv = sp; let d = atan2(ex, ez) - A.byaw; d = atan2(sin(d), cos(d)); A.byaw += clamp(d, -10 * dt, 10 * dt); break; }
    }
  }
  if (A.pinchT > 0) { // turn the claws on whoever is nearest
    let bd = 3, bx = 0, bz = 0; for (const b of ACT) if (b.k === 'P' || b.k === 'V') { const d = hypot(b.x - A.x, b.z - A.z); if (d < bd) { bd = d; bx = b.x; bz = b.z; } }
    if (bd < 3) { let d = atan2(-(bz - A.z), bx - A.x) - A.byaw; d = atan2(sin(d), cos(d)); A.byaw += clamp(d, -12 * dt, 12 * dt); }
  }
  A.ph += (A.mv * 9 + (A.pinchT > 0 ? 9 : 0)) * dt;
  F[CX] = A.x; F[CY] = A.y + 0.4 - A.dig * 0.15; F[CZ] = A.z;
}
let camClose = false, bitten = 0;
function placeCamera() {
  const pit = F[PIT], yw = F[YAW], cp = cos(pit), fx = cp * sin(yw), fy = sin(pit), fz = -cp * cos(yw);
  const D = ROLE === 5 ? 1.9 : ROLE === 6 ? 3 : ROLE === 4 ? 5 : ROLE === 2 ? 4.2 : ROLE === 1 ? 3.6 : 3.2, up = 0.5, ex = F[CX], ey = F[CY], ez = F[CZ];
  let t = D;
  for (let s = 0.5; s <= D; s += 0.5) if (sdp(ex - fx * s, ey - fy * s + up * s / D, ez - fz * s) > -0.4) { t = max(s - 0.5, 0.3); break; }
  EY[0] = ex; EY[1] = ey; EY[2] = ez; camClose = t < 1.1; F[CX] = ex - fx * t; F[CY] = ey - fy * t + up * t / D; F[CZ] = ez - fz * t; swapped = true;
}
const GUARDSEED = (() => { for (const a of Wd.actors) if (a.k === 'F') return a.seed; return 0.3; })();
function emitAvatar() {
  if (!ROLE || !TPV || camClose) return;
  const A = AV;
  if (ROLE === 1) {
    const yaw = atan2(-sin(A.hd), cos(A.hd));
    if (A.mode === 0) emit(5, A.x, A.y, A.z, yaw, 0, 0, 0.4, A.ph, A.chg > 0 || A.biteT > 0 ? 2 + (A.biteT > 0 ? 0.99 : 0.5) : A.alert * 0.49 + (A.mv ? 0.5 : 0), 1.1, 11); else emit(6, A.x, A.y, A.z, yaw, A.pitch, 0, 0.4, A.ph, 1, 1.1, 11);
  } else if (ROLE === 6) {
    const yaw = atan2(-sin(A.hd), cos(A.hd));
    if (A.mode === 0) emit(7, A.x, A.y + 0.1, A.z, yaw, 0, 0, 10.4, A.ph, 3 + (A.mv ? 0.99 : 0), 1.1, 11); else emit(7, A.x, A.y, A.z, yaw, A.pitch, 0, 10.4, A.ph, 1, 1.1, 11);
  } else if (ROLE === 5) {
    emit(17, A.x, A.y - A.dig * 0.07 * 1.3, A.z, A.byaw, 0, 0, 0.35, A.ph, A.dig > 0.1 ? 2 + (A.digT !== A.dig ? 0.99 : 0) : A.pinchT > 0 ? 1.99 : A.mv ? 0.99 : 0, 1.3, 15);
  } else if (ROLE === 2 || ROLE === 4) {
    const yaw = atan2(-sin(A.hd), cos(A.hd)), air = A.mode === 2, dive = A.mode >= 3, pk = A.swal > 0 ? 0.5 + 0.5 * sin(F[TIME] * 6) : 0;
    const w = dive ? 2 : air ? 1 + A.fl * 0.99 : pk * 0.49 + (A.mv ? 0.5 : 0);
    if (ROLE === 4 && A.held && A.swal > 1.0 && A.mode === 1) emitBillFish(A.x, A.y, A.z, yaw, 1.3, 0.37);
    if (ROLE === 2) emit(8, A.x, A.y, A.z, yaw, air ? A.pitch : 0, air ? A.roll : 0, 0.4, A.ph, w, 1.25, 13); else emit(16, A.x, A.y, A.z, yaw, air || dive ? A.pitch : 0, air ? A.roll : 0, 5.4, A.ph, w, 1.3, 13);
  } else {
    const spd = hypot(F[VX], F[VZ]);
    if (walk) emit(0, PL[0], PL[1] - 1.7, PL[2], A.yawp, 0, 0, GUARDSEED, A.ph, callT > 0 ? 5.99 : min(1, spd / 3.6) * 0.99);
    else emit(4, PL[0], PL[1] - 0.25, PL[2], atan2(-F[VZ], F[VX]), 0, 0, GUARDSEED, A.ph, 8);
  }
}
// visitors: wander over to the sea lions (1), until somebody warns them off (2) or they get too close and the sea lions bolt (3)
function updVisitor(a, dt, px, pz, py) {
  let sp = 0; a.tm -= dt;
  if (a.st === 0) { if (a.tm < 0) { a.st = 1; a.sc2 = 0; } }
  else if (a.st === 1) {
    let bx = a.x, bz = a.z, bd = 1e9;
    for (const b of ACT) if (b.k === 'L') { const d = hypot(b.x - a.x, b.z - a.z); if (d < bd) { bd = d; bx = b.x; bz = b.z; } }
    if (bd > 4.5) { sp = 1.25; stepActor(a, bx - a.x, bz - a.z, sp, dt, -0.4); turnTo(a, atan2(a.mx, a.mz), 4, dt); } else turnTo(a, atan2(bx - a.x, bz - a.z), 3, dt);
    if (bd < 7) { a.sc2 += dt; if (a.sc2 > 3.5) { for (const b of ACT) if (b.k === 'L' && b.st === 0 && !b.pup && b.al < 0 && hypot(b.x - a.x, b.z - a.z) < 9) b.al = 0.1 + rnd() * 0.5; a.st = 3; a.tm = 4; } }
  } else if (a.st === 2) {
    const hx = a.hx - a.x, hz = a.hz - a.z;
    if (hypot(hx, hz) < 0.6) { a.st = 0; a.tm = 25 + rnd() * 40; } else { sp = 1.7; stepActor(a, hx, hz, sp, dt, -0.4); turnTo(a, atan2(a.mx, a.mz), 6, dt); }
  } else if (a.tm < 0) a.st = 2;
  a.pose = 0; a.amt += ((sp > 0 ? 1 : 0) - a.amt) * min(1, dt * 8); a.ph += sp * 4.2 * dt;
}
function warnVisitors(x, z, r, mine) {
  let n = 0;
  for (const b of ACT) if (b.k === 'V' && b.st === 1 && hypot(b.x - x, b.z - z) < r) { b.st = 2; n++; if (mine) score++; }
  if (n && mine) { roleHud(); setTimeout(() => { CAPT.textContent = 'Visitor: "Oh, sorry! We will keep our distance."'; CAPT.style.opacity = 1; clearTimeout(captT); captT = setTimeout(() => { CAPT.style.opacity = 0; }, 3000); }, 1400); }
}
roleHud();
function doCall() {
  if (callCd > 0 || !ROLE) return;
  if (ROLE === 1) { callCd = 1; if (BARK) BARK(0, 0.7, 0); for (const b of ACT) if ((b.k === 'P' || b.k === 'V') && b.pose !== 2 && hypot(b.x - AV.x, b.z - AV.z) < 22) { crabPinchPerson(b, AV.x, AV.z); b.ft = 3 + rnd() * 1.5; } }
  else if (ROLE === 2) { callCd = 1; if (BARK) BARK(0, 0.35, 4); }
  else if (ROLE === 6) { callCd = 1.5; if (BARK) BARK(0, 0.2, 0); }
  else if (ROLE === 5) {
    if (AV.dig > 0.3) return;
    callCd = 0.7; AV.pinchT = 0.7; if (CLICK) CLICK(0, 0.5);
    for (const b of ACT) if ((b.k === 'P' || b.k === 'V') && b.pose !== 2 && hypot(b.x - AV.x, b.z - AV.z) < 1.2) { crabPinchPerson(b, AV.x, AV.z); pinched++; roleHud(); toast(['Ouch!', 'Yow! Something pinched me!', 'Hey! A crab!'][rnd() * 3 | 0]); }
  }
  else if (ROLE === 4) {
    callCd = 1;
    if (AV.mode === 2 && AV.y > 2 && ground(AV.x, 2, AV.z) < -2) { AV.mode = 3; AV.sp = 10; } else if (AV.mode === 1) { AV.mode = 4; AV.tm = 2.6; splash(AV.x, AV.z); } else toast('Fly out over deeper water, then B to dive');
  }
  else { callCd = 2; callT = 2; if (WHISTLE) WHISTLE(0, 0.3); shout('Please stay back from the sea lions!', 1); warnVisitors(PL[0], PL[2], 55, true); }
}

// splashes where a pelican hits the water: white patches that spread and shrink again
const SPLASH = Array.from({ length: 8 }, () => ({ x: 0, z: 0, t: 9 })); let splI = 0;
function splash(x, z) { const s = SPLASH[splI++ & 7]; s.x = x; s.z = z; s.t = 0; }
function emitSplashes(dt) {
  for (let i = 0; i < 8; i++) {
    const s = SPLASH[i]; if (s.t > 1.3) continue; s.t += dt;
    const k = s.t < 0.4 ? 0.3 + s.t * 3.2 : max(1.58 * (1.3 - s.t) / 0.9, 0.01);
    emit(15, s.x, 0.01, s.z, 0, 0, 0, 0.3, 0, 0, k); emit(15, s.x, 0.012, s.z, 1.5708, 0, 0, 0.3, 0, 0, k);
  }
}
// pelicans: 0 perched, 1 afloat, 2 flying and looking for fish, 3 plunge-diving, 4 under the water, 5 back up swallowing, 6 gliding down to land
function updPelican(a, dt, px, pz, py) {
  const dx = a.x - px, dz = a.z - pz, d = hypot(dx, dz), t = F[TIME];
  a.tm -= dt;
  if (a.st === 0 || a.st === 1) {
    a.mv = 0;
    if (a.st === 0) { a.y = a.hy; a.pk = 0.3 * max(0, sin(t * 0.7 + a.seed * 9)); }
    else { a.hd += rr(-0.4, 0.4) * dt; a.x += cos(a.hd) * 0.1 * dt; a.z += sin(a.hd) * 0.1 * dt; if (ground(a.x, 2, a.z) > -0.8) a.hd = PI; a.y = -0.15 + 0.02 * sin(t * 1.5 + a.seed * 9); a.pk = max(0, sin(t * 0.9 + a.seed * 7) - 0.7) * 3; }
    if ((d < 6.5 && py > -2) || a.tm < 0) { a.st = 2; a.hd = d < 6.5 && py > -2 ? atan2(dz, dx) : a.hd; a.sp = 2; a.fy = 8 + rnd() * 4; a.fish = 1 + (rnd() * 3 | 0); a.tm = 4 + rnd() * 5; a.dir = rnd() < 0.5 ? -1 : 1; a.amt = 1; a.pk = 0; }
    a.pitch = a.roll = 0;
  } else if (a.st === 2 || a.st === 6) {
    let want = a.hd, rate = a.sp / 26, bank = 0;
    if (a.st === 2) {
      a.sp += (7 - a.sp) * min(1, dt * 0.8); want = a.hd + a.dir; bank = a.dir * 0.28;
      if (hypot(a.x - 130, a.z) > 52) { want = atan2(-a.z, 130 - a.x); rate = 1; }
      a.amt = a.y < a.fy - 1 ? 1 : 0.2 + 0.15 * sin(t * 0.3 + a.seed * 9);
      a.y += clamp((a.fy - a.y) * 0.6, -3, 4) * dt;
      if (a.tm < 0) {
        if (a.fish > 0) { // look for deep water ahead and drop onto it
          let ok = 0;
          for (let k = 0; k < 6 && !ok; k++) { const h = a.hd + rr(-1.2, 1.2), ax = a.x + cos(h) * 7, az = a.z + sin(h) * 7; if (ax < 128 && ax > 70 && abs(az) < 55 && ground(ax, 2, az) < -3) { a.hd = h; ok = 1; } }
          if (ok && a.y > 5) { a.st = 3; a.fish--; } else a.tm = 1.5;
        } else { // done: back to the perch or onto the sea
          if (a.hx && rnd() < 0.6 && a.hy > 0.5) { a.tx = a.hx; a.tz = a.hz; a.ty = a.hy; } else { a.tx = rr(98, 126); a.tz = rr(-40, 40); a.ty = -0.15; }
          a.st = 6;
        }
      }
    } else {
      const ex = a.tx - a.x, ez = a.tz - a.z, dd = hypot(ex, ez);
      want = atan2(ez, ex); rate = 1.8; a.sp += (max(2.5, min(7, dd * 0.8)) - a.sp) * min(1, dt * 2); a.amt = dd < 6 ? 0.8 : 0.2;
      a.y += (a.ty + dd * 0.3 - a.y) * min(1, dt * 2.5);
      if (dd < 1.1 && a.y < a.ty + 0.6) { a.st = a.ty < 0 ? 1 : 0; a.x = a.tx; a.z = a.tz; a.y = a.ty; a.tm = a.st ? 10 + rnd() * 15 : 30 + rnd() * 50; a.sp = 0; a.pk = 0; }
    }
    const da = atan2(sin(want - a.hd), cos(want - a.hd)), m = rate * dt; a.hd += da < -m ? -m : da > m ? m : da;
    a.x += cos(a.hd) * a.sp * dt; a.z += sin(a.hd) * a.sp * dt;
    a.pitch += (atan2(a.st === 2 ? (a.fy - a.y) * 0.3 : -0.25 * a.sp, max(a.sp, 1)) - a.pitch) * min(1, dt * 3); a.pitch = clamp(a.pitch, -0.5, 0.6);
    a.roll += (bank - a.roll) * min(1, dt * 3); a.ph += dt * (4 + 6 * a.amt); a.mv = 0;
  } else if (a.st === 3) { // wings folded, straight down
    a.pitch += (-1.25 - a.pitch) * min(1, dt * 6); a.sp = 5; a.y -= 12 * dt; a.x += cos(a.hd) * 3.5 * dt; a.z += sin(a.hd) * 3.5 * dt; a.roll = 0;
    if (a.y <= 0.05) { splash(a.x, a.z); a.st = 4; a.tm = 1.2 + rnd() * 0.9; }
  } else if (a.st === 4) { // under the surface after a fish
    a.pitch += (0.3 - a.pitch) * min(1, dt * 3); const g0 = ground(a.x, 2, a.z); let ty = -1.8 - 0.6 * sin(t * 2 + a.seed * 9); if (g0 > -1e8 && ty < g0 + 0.5) ty = g0 + 0.5;
    a.y += (ty - a.y) * min(1, dt * 4); a.x += cos(a.hd) * 1.4 * dt; a.z += sin(a.hd) * 1.4 * dt;
    if (a.tm < 0) { a.st = 5; a.y = -0.15; a.tm = 3; a.caught = rnd() < 0.6; a.pitch = 0; }
  } else { // 5: up again, shaking the water out of the pouch and swallowing
    a.y = -0.15 + 0.02 * sin(t * 1.5); a.pk = 0.5 + 0.5 * sin(t * 6 + a.seed * 9); a.mv = 0;
    if (a.tm < 0) { a.st = 2; a.sp = 2; a.fy = 8 + rnd() * 4; a.tm = 3 + rnd() * 4; a.amt = 1; a.pk = 0; a.dir = rnd() < 0.5 ? -1 : 1; }
  }
  a.yaw = atan2(-sin(a.hd), cos(a.hd));
}
// the fish in a pelican's bill: at the tip, hanging down and wriggling
function emitBillFish(x, y, z, yaw, sc, seed) {
  const t = F[TIME] * 14 + seed * 9, fx = cos(yaw), fz = -sin(yaw);
  emit(18, x + fx * 1.12 * sc, y + 0.66 * sc, z + fz * 1.12 * sc, yaw, -0.9 + sin(t) * 0.35, sin(t * 0.7) * 0.4, seed, 0, 0, 1.15, 10);
}
function emitPelican(a) {
  const st = a.st, w = st === 3 || st === 4 ? 2 : st === 2 || st === 6 ? 1 + a.amt * 0.99 : a.pk * 0.49;
  emit(16, a.x, a.y, a.z, a.yaw, st >= 2 && st !== 5 ? a.pitch : 0, st === 2 || st === 6 ? a.roll : 0, a.seed, a.ph, w, a.sc, 13);
  if (st === 5 && a.caught && a.tm > 1.1) emitBillFish(a.x, a.y, a.z, a.yaw, a.sc, a.seed);
}
// crabs: 0 scurrying about sideways, 1 digging in, 2 buried (eyes peeking out), 3 digging out, 4 standing its ground with the claws up and pinching, 5 running off.
// A timid crab runs from a human and buries itself; a bold one threatens it, and pinches if it comes too close.
function crabPinchPerson(b, cx, cz) { b.ft = 2.6; b.fx = cx; b.fz = cz; if (b.k === 'V') b.st = 2; else { b.st = 1; b.pose = 0; } }
function updCrab(a, dt, px, pz, py) {
  const dp = hypot(a.x - px, a.z - pz); let td = dp, tx = px, tz = pz, who = null;
  for (const b of ACT) if ((b.k === 'P' || b.k === 'V') && b.pose !== 2) { const d = hypot(b.x - a.x, b.z - a.z); if (d < td) { td = d; tx = b.x; tz = b.z; who = b; } }
  if (py < -3.5 && who === null) td = 1e5;   // somebody swimming deep does not bother it
  a.tm -= dt; a.cd -= dt; let sp = 0;
  if (td > 9) a.seen = 0;
  if (a.st === 0) { // scurry about
    if (td < 3 && !a.seen) { a.seen = 1; a.mood = rnd() < 0.45 ? 1 : 0; }
    if (td < 3) { if (a.mood) { a.st = 4; a.cl = 0; } else { a.st = 5; a.tm = 1.6; } }
    else {
      if (a.tm < 0) { if (rnd() < 0.25) { a.st = 1; } else { a.wx = a.x + rr(-5, 5); a.wz = a.z + rr(-5, 5); a.tm = 2 + rnd() * 3; } }
      if (hypot(a.wx - a.x, a.wz - a.z) > 0.25) { sp = 0.55; if (!stepActor(a, a.wx - a.x, a.wz - a.z, sp, dt, -2.8)) { sp = 0; a.tm = 0; } else turnTo(a, atan2(a.mx, a.mz), 8, dt); }
    }
  } else if (a.st === 5) { // run, sideways and fast, away from the human, then dig in
    sp = 1.5; if (!stepActor(a, a.x - tx, a.z - tz, sp, dt, -2.8)) sp = 0; else turnTo(a, atan2(a.mx, a.mz), 12, dt);
    if (a.tm < 0) a.st = 1;
  } else if (a.st === 1) { a.dig += dt / 1.1; if (a.dig >= 1) { a.dig = 1; a.st = 2; a.tm = 8 + rnd() * 18; } }
  else if (a.st === 2) { if (a.tm < 0 || td < 0.8) { a.st = 3; a.mood = td < 2 ? 1 : a.mood; } }
  else if (a.st === 3) { a.dig -= dt / 0.9; if (a.dig <= 0) { a.dig = 0; a.st = td < 3 ? 4 : 0; a.tm = 1; } }
  else { // 4: face the human, claws up, snap; pinch whoever comes within reach
    turnTo(a, atan2(-(tz - a.z), tx - a.x), 9, dt); a.cl += (1 - a.cl) * min(1, dt * 8); a.ph += dt * 9;
    if (td < 0.7 && a.cd < 0) {
      a.cd = 1.7; const pan = clamp(((a.x - px) * F[RX] + (a.z - pz) * F[RZ]) / (dp + 1), -1, 1); if (CLICK) CLICK(pan, 0.5 * clamp(1.2 - dp / 12, 0, 1));
      if (who) crabPinchPerson(who, a.x, a.z); else { hurt(a.x, a.z, 3.5); toast('Ouch! A crab pinched you!'); }
    }
    if (td > 3.2) { a.st = 0; a.cl = 0; a.tm = 1; a.seen = 0; }
    if (td > 1.6 && a.mood === 0) { a.st = 5; a.tm = 1.4; a.cl = 0; }
  }
  if (a.st !== 4) a.cl *= 1 - min(1, dt * 6);
  a.amt += ((sp > 0 ? 1 : 0) - a.amt) * min(1, dt * 10); a.ph += sp * 9 * dt;
}
function emitCrab(a) {
  const st = a.st, w = st === 4 ? 1 + a.cl * 0.99 : st >= 1 && st <= 3 ? 2 + (st === 1 || st === 3 ? 0.99 : 0) : a.amt * 0.99;
  emit(17, a.x, a.y - a.dig * 0.07 * a.sc, a.z, a.yaw, 0, 0, a.seed, a.ph, w, a.sc, 15);
}
// contact shadows: a soft dark disc under every person and animal on the ground (round, or long for sea lions and people lying down)
const BLM = [BLOB, BLOBL], BLI = BLM.map(() => new Float32Array((NACT + 12) * 12)), BLN = new Uint32Array(2);
const BLB = BLM.map(() => device.createBuffer({ size: (NACT + 12) * 48, usage: BU.VERTEX | BU.COPY_DST }));
const drawBlobs = (r) => { r.setPipeline(pBlob); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32'); for (let s = 0; s < 2; s++) if (BLN[s]) { r.setVertexBuffer(1, BLB[s]); r.drawIndexed(BLM[s].ib.length, BLN[s], BLM[s].i0, BLM[s].v0, 0); } };
function shadowBlob(long, x, y, z, sc, yaw, h) {
  const s = long ? 1 : 0, o = BLN[s]++ * 12, f = BLI[s];
  setQ(f, o, yaw, 0, 0); f[o] = x - 0.13 * h; f[o + 1] = y + 0.04; f[o + 2] = z + 0.12 * h; f[o + 3] = sc; f[o + 8] = 12; f[o + 9] = 0.5; f[o + 10] = 0; f[o + 11] = 0;
}
function addBlobs() {
  for (let i = 0; i < NACT; i++) {
    const a = ACT[i], k = a.k;
    if (k === 'P' || k === 'V') { if (a.pose === 2 && k === 'P') shadowBlob(1, a.x, a.y, a.z, 1.0, a.yaw - PI / 2, 0.3); else shadowBlob(0, a.x, a.y + (a.st === 0 && a.pose === a.hpose ? a.lift : 0), a.z, (a.pose === 1 ? 0.55 : 0.4) * a.sc, 0, 1.7 * a.sc * (a.pose === 0 ? 1 : 0.4)); }
    else if (k === 'L') shadowBlob(1, a.x, a.y, a.z, 0.8 * a.sc, a.yaw, 0.6 * a.sc);
    else if (k === 'X') { if (a.dig < 0.5) shadowBlob(0, a.x, a.y, a.z, 0.12 * a.sc, 0, 0.1); }
    else if (k === 'C') shadowBlob(0, a.x, a.y, a.z, 0.1 * a.sc, 0, 0.1);
    else if ((k === 'G' && a.st === 0) || (k === 'Q' && a.st === 0)) shadowBlob(0, a.x, a.y, a.z, (k === 'Q' ? 0.4 : 0.22) * a.sc, 0, 0.5);
  }
  if (ROLE === 1 && TPV) { if (AV.mode === 0) shadowBlob(1, AV.x, AV.y, AV.z, 0.9, atan2(-sin(AV.hd), cos(AV.hd)), 0.6); if (BB.mode === 0) shadowBlob(1, BB.x, BB.y, BB.z, 0.45, atan2(-sin(BB.hd), cos(BB.hd)), 0.3); }
  else if (ROLE === 2 && TPV && AV.mode === 0) shadowBlob(0, AV.x, AV.y, AV.z, 0.26, 0, 0.5);
  else if (ROLE === 4 && TPV && AV.mode === 0) shadowBlob(0, AV.x, AV.y, AV.z, 0.42, 0, 0.5);
  else if (ROLE === 5 && TPV) shadowBlob(0, AV.x, AV.y, AV.z, 0.16, 0, 0.1);
  else if (ROLE === 6 && TPV && AV.mode === 0) shadowBlob(1, AV.x, AV.y, AV.z, 0.65, atan2(-sin(AV.hd), cos(AV.hd)), 0.3);
  else if (ROLE === 3 && TPV && walk) shadowBlob(0, PL[0], PL[1] - 1.7, PL[2], 0.4, 0, 1.7);
  for (let s = 0; s < 2; s++) if (BLN[s]) Q.writeBuffer(BLB[s], 0, BLI[s], 0, BLN[s] * 12);
}
function updateActors(dt) {
  if (!ACTINIT) { ACTINIT = true; for (const a of ACT) {
    if (a.k === 'P' || a.k === 'L' || a.k === 'C' || a.k === 'F' || a.k === 'V') { a.y = ground(a.x, a.high || a.k === 'C' ? 12 : 4, a.z); if (a.k === 'V') a.tm = 6 + a.seed * 30; }
    else if (a.k === 'K' || a.k === 'U' || a.k === 'R') { a.y = -0.05; a.sp = 0; a.tm = 2 + a.seed * 10; }
    else if (a.k === 'X') { a.y = ground(a.x, 4, a.z); if (a.y < -2.7) { a.x += 5; a.y = ground(a.x, 4, a.z); } if (a.st === 2) { a.dig = 1; a.tm = 5 + a.seed * 20; } else a.tm = a.seed * 4; }
    else if (a.k === 'Q') {
      if (a.st === 0) { a.y = a.hy = ground(a.x, a.y0, a.z); a.tm = 20 + a.seed * 40; } else if (a.st === 1) { a.y = -0.15; a.tm = 8 + a.seed * 12; }
      else { const f = a.seed % 1; a.y = a.fy = 9 + f * 3; a.hd = f * 20; a.dir = f < 0.5 ? -1 : 1; a.sp = 7; a.tm = 5 + f * 5; a.fish = 2; }
    }
    else if (a.k === 'G') { if (a.st === 0) a.y = ground(a.x, 4, a.z); else if (a.st === 1) a.y = -0.15; else { a.y = a.fy = 9 + a.seed * 4; a.hd = a.seed * 20; a.dir = a.seed < 0.5 ? -1 : 1; a.sp = 7; a.tm = 6 + a.seed * 12; } }
    else a.y = -0.3;
  } }
  const far = ROLE === 1 || ROLE === 2 || ROLE === 4 || ROLE === 5 || ROLE === 6 ? 1e5 : 0, px = PL[0] + far, pz = PL[2], py = PL[1];
  SLN.fill(0); BLN.fill(0);
  for (let i = 0; i < NACT; i++) {
    const a = ACT[i], k = a.k;
    if (k === 'V') updVisitor(a, dt, px, pz, py); else if (k === 'P') updPerson(a, dt, px, pz, py); else if (k === 'L') updLion(a, dt, px, pz, py); else if (k === 'E') updSeal(a, dt, px, pz, py);
    else if (k === 'G') updGull(a, dt, px, pz, py); else if (k === 'C') updChip(a, dt, px, pz, py); else if (k === 'F') updGuard(a, dt, px, pz, py);
    else if (k === 'K' || k === 'U') updPaddler(a, dt); else if (k === 'R') updSurfer(a, dt); else if (k === 'Q') updPelican(a, dt, px, pz, py); else if (k === 'X') updCrab(a, dt, px, pz, py); else updSwimmer(a, dt, px, pz, py);
  }
  separate();
  for (let i = 0; i < NACT; i++) {
    const a = ACT[i], k = a.k;
    if (k === 'F' || k === 'K' || k === 'U' || k === 'R') { emitCraft(a); continue; }
    if (k === 'Q') { emitPelican(a); continue; }
    if (k === 'X') { emitCrab(a); continue; }
    // swimmers just turned into land lions (or back) are drawn this frame in their new slot
    const slot = k === 'P' ? a.pose : k === 'V' ? 0 : k === 'N' ? 4 : k === 'L' ? 5 : k === 'S' ? 6 : k === 'E' ? 7 : k === 'G' ? 8 : 9, o = SLN[slot]++ * 12, f = SLI[slot];
    if (k === 'P' || k === 'V') { f[o + 4] = 0; f[o + 5] = sin(a.yaw * 0.5); f[o + 6] = 0; f[o + 7] = cos(a.yaw * 0.5); } else setQ(f, o, a.yaw, k === 'S' || k === 'E' || k === 'G' ? a.pitch : 0, k === 'G' ? a.roll : 0);
    f[o] = a.x; f[o + 1] = a.y + (k === 'P' && a.st === 0 && a.pose === a.hpose ? a.lift : 0); f[o + 2] = a.z; f[o + 3] = a.sc;
    f[o + 8] = k === 'P' || k === 'N' || k === 'V' ? 10 : k === 'G' ? 13 : k === 'C' ? 14 : 11; f[o + 9] = a.seed; f[o + 10] = a.ph;
    f[o + 11] = k === 'P' ? a.pose + a.amt * 0.99 : k === 'V' ? a.amt * 0.99 : k === 'N' ? 4 + a.amt * 0.99 : k === 'L' ? (a.st >= 3 ? 2 + a.lg * 0.99 : a.amt * 0.49 + (a.mv ? 0.5 : 0)) : k === 'G' ? (a.st >= 2 ? 1 + a.amt * 0.99 : a.pk * 0.49 + (a.mv ? 0.5 : 0)) : k === 'C' ? a.pose + a.amt * 0.99 : 1;
  }
  emitAvatar(); updBaby(dt); emitSplashes(dt); addBlobs();
  for (let s = 0; s < SLM.length; s++) if (SLN[s]) Q.writeBuffer(SLB[s], 0, SLI[s], 0, SLN[s] * 12);
}
const ibChunk = Wd.chunks.map((c) => buf(c.data, BU.VERTEX)), ibProp = Wd.props.map((c) => buf(c.data, BU.VERTEX));
const ibBig = buf(new Uint8Array(Wd.big.buf), BU.VERTEX), ibBigF = buf(new Uint8Array(Wd.bigF.buf), BU.VERTEX), ibSmall = buf(new Uint8Array(Wd.small.buf), BU.VERTEX);
const ibGar = buf(Wd.gar, BU.VERTEX), nGar = Wd.gar.length / 8;
const ibFish = buf(Wd.fish, BU.VERTEX), ibManta = buf(Wd.mantas, BU.VERTEX), ibBubbles = buf(Wd.bubbles, BU.VERTEX), ibSnowB = buf(Wd.snow, BU.VERTEX);
const ibGl = buf(Wd.glints, BU.VERTEX), nGl = Wd.glints.length / 8;
const nFish = Wd.fish.length / 8, nManta = Wd.mantas.length / 8, nBub = Wd.bubbles.length / 8, nSnow = Wd.snow.length / 4;
const MANTA = meshes[12], FISH = meshes[13];
Q.writeTexture({ texture: tVol }, Wd.volD, { bytesPerRow: NX, rowsPerImage: NY / 2 }, [NX / 2, NY / 2, NZ / 2]);
Q.writeTexture({ texture: tMap }, Wd.gm, { bytesPerRow: 2048 }, [512, 512]);

// ---------------------------------------------------------------- one-time bakes: detail texture, shadow map
{
  const m = mod(W_DETAIL), p = device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const e = device.createCommandEncoder();
  let r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: 0, mipLevelCount: 1 }), true)] });
  r.setPipeline(p); r.draw(3); r.end();
  for (let i = 1; i < 11; i++) {
    r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: i, mipLevelCount: 1 }), true)] });
    r.setPipeline(pMip8); r.setBindGroup(0, blitBG(tDetail.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }))); r.draw(3); r.end();
  }
  r = e.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: tShadow.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
  r.setBindGroup(0, bg0s);
  r.setPipeline(pTerrSh);
  r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
  r.drawIndexed(T.ib.length, 1, 0, 0, nSolid);
  r.setPipeline(pSolidSh); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  for (let i = 0; i < 12; i++) { const g = Wd.solids.ranges[i]; if (g[1]) r.drawIndexed(meshes[i].ib.length, g[1], meshes[i].i0, meshes[i].v0, g[0]); }
  drawDeco(r);
  // small rocks, sponges and corals (~35M triangles) only on High: too much for a phone's driver
  if (!LV) for (let i = 0; i < NCHUNK; i++) { r.setVertexBuffer(1, ibChunk[i]); r.drawIndexed(meshes[14 + i].ib.length, Wd.chunks[i].n, meshes[14 + i].i0, meshes[14 + i].v0, 0); }
  if (!LV) for (let i = 0; i < 6; i++) if (Wd.props[i].n) { r.setVertexBuffer(1, ibProp[i]); r.drawIndexed(meshes[4 + i].ib.length, Wd.props[i].n, meshes[4 + i].i0, meshes[4 + i].v0, 0); }
  r.setPipeline(pLeafSh); r.setVertexBuffer(0, ibBig); r.draw(6, Wd.big.n);
  r.end();
  Q.submit([e.finish()]);
}
// the GPU has its own copies now: let go of the generator's (about 300 MB)
for (const o of [Wd.big, Wd.bigF, Wd.small, ...Wd.chunks, ...Wd.props]) o.buf = o.data = 0;
Wd.glints = Wd.volD = Wd.gm = T.vb = T.ib = T.wp = T.wn = 0;

// ---------------------------------------------------------------- render targets (rebuilt on resize)
// The scene is drawn at `pix` pixels and scaled up to the window. frame() tunes it and the draw distance scale `det`
// for 60 fps; both start where the last visit left them.
const PIXMAX = 2560 * 1440, PIXMIN = mob ? 25e4 : 5e5, DETMIN = 0.4;
let W = 0, H = 0, DW = 0, DH = 0, pix = +SV[1] || (LV > 1 ? 41e4 : mob ? 1280 * 720 : PIXMAX), det = +SV[2] || 1, dynN = 0, dynT = 0, dynG = 0, dynGN = 0, dynBad = 0, dynOk = 0, dynWait = 3;
let passScene, passRays, passBlur, bgBlur, passPost, bgRays, bgPost, bloomPass = [], bloomBG = [], targets = [];
const NB = 6;
function resize() {
  DW = max(2, round(canvas.clientWidth * devicePixelRatio)); DH = max(2, round(canvas.clientHeight * devicePixelRatio));
  const s = min(1, sqrt(pix / (DW * DH)));
  const w = max(2, round(DW * s) & ~1), h = max(2, round(DH * s) & ~1);
  if (w === W && h === H) return;
  dynN = dynG = dynGN = 0; dynT = -300; // let the new size settle before measuring again
  W = w; H = h; canvas.width = W; canvas.height = H;
  ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
  for (const t of targets) t.destroy();
  const tMS = tex(AA > 1 ? W : 1, H, HDR, TU.RENDER_ATTACHMENT, { samples: AA }), tDp = tex(W, H, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { samples: AA });
  const tRes = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay = tex(W / 2, H / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay2 = tex(W / 2, H / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  targets = [tMS, tDp, tRes, tRay, tRay2];
  const bl = [];
  for (let i = 0; i < NB; i++) { const t = tex(max(1, W >> (i + 1)), max(1, H >> (i + 1)), HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); bl.push(t); targets.push(t); }
  const vDp = tDp.createView(), vRes = tRes.createView(), vRay = tRay.createView(), vRay2 = tRay2.createView(), vBl = bl.map((t) => t.createView());
  // without anti-aliasing (Low) the scene goes straight into the resolve target, and tMS is one unused column
  passScene = { colorAttachments: [{ view: AA > 1 ? tMS.createView() : vRes, resolveTarget: AA > 1 ? vRes : undefined, loadOp: 'clear', storeOp: AA > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1] }],
    depthStencilAttachment: { view: vDp, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
  passRays = { colorAttachments: [colorAtt(vRay, true)] };
  passBlur = { colorAttachments: [colorAtt(vRay2, true)] };
  bgBlur = device.createBindGroup({ layout: pRB.getBindGroupLayout(0), entries: [{ binding: 0, resource: vRay }] });
  passPost = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  bgRays = device.createBindGroup({ layout: pRays.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sRep }, { binding: 2, resource: sCmp },
    { binding: 3, resource: tShadow.createView() }, { binding: 4, resource: tWater.createView() }, { binding: 5, resource: vDp }, { binding: 6, resource: tVol.createView() }, { binding: 7, resource: sClamp }] });
  bgPost = device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sClamp }, { binding: 2, resource: vRes },
    { binding: 3, resource: vRay2 }, { binding: 4, resource: vBl[0] }, { binding: 5, resource: vDp }] });
  bloomPass = []; bloomBG = [];
  // down: res -> b0 -> ... -> b5 ; up: b5 -> b4 (additive) ... -> b0
  for (let i = 0; i < NB; i++) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i], true)] }); bloomBG.push(blitBG(i ? vBl[i - 1] : vRes)); }
  for (let i = NB - 1; i > 0; i--) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i - 1], false)] }); bloomBG.push(blitBG(vBl[i])); }
  UB[52] = W; UB[53] = H; UB[54] = 1 / W; UB[55] = 1 / H;
}
resize();
addEventListener('resize', resize);

// ---------------------------------------------------------------- timing (GPU timestamp queries)
let qs, qResolve, qRead = [], tsBegin, tsEnd;
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolve = device.createBuffer({ size: 16, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
  for (let i = 0; i < 6; i++) {
    const b = device.createBuffer({ size: 16, usage: BU.MAP_READ | BU.COPY_DST });
    const o = { b, busy: false, done: null };
    o.done = () => {
      const a = new BigInt64Array(b.getMappedRange());
      const ms = Number(a[1] - a[0]) / 1e6; F[GPU] = ms; b.unmap(); o.busy = false;
      if (dynT > 0 && ms > 0 && ms < 1e3) { dynG += ms; dynGN++; }
    };
    qRead.push(o);
  }
  tsBegin = { querySet: qs, beginningOfPassWriteIndex: 0 }; tsEnd = { querySet: qs, endOfPassWriteIndex: 1 };
}

// ---------------------------------------------------------------- frame
let hud = false;
let kf = 0, kb = 0, kl = 0, kr = 0, ku = 0, kd = 0, ks = 0, mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0, hN = 0, hMax = 0, hMin = 1e9, hPer = 1e9, hLate = 0, hTot = 0, tId = -1, tN = 0, tx0 = 0, ty0 = 0, tx = 0, ty = 0;
const TANH = 0.6, NEAR = 0.1, EXPO = 0.62, RAYS = 0.54;
var AIREXP = 0.336;   // brightness above the water; ?tune lets [ and ] change it
const submitList = [null];
const rowOrd = new Uint8Array(CELLS);
// Draws the cells of a cell-sorted buffer that are in view and within [minD, maxD) (scaled by `det`, but not for the
// terrain) as merged runs, nearest rows first.
function drawCells(r, start, lo, hi, mar, indexed, verts, minD, maxD) {
  const cx = F[CX], cy = F[CY], cz = F[CZ], fx = F[FX], fy = F[FY], fz = F[FZ], rx = F[RX], rz = F[RZ], ux = F[UX], uy = F[UY], uz = F[UZ];
  const ds = indexed === 1 ? 1 : det * det;
  const tx = TANH * W / H, hw = CELLW * 0.5, ex = hw + mar, min2 = minD * minD * ds, max2 = maxD * maxD * ds;
  for (let k = 0; k < CELLS; k++) {
    const rw = rowOrd[k], row = rw * CELLS, pz = OZ + (rw + 0.5) * CELLW - cz, hz = max(abs(pz) - hw, 0);
    let run = -1;
    for (let x = 0; x <= CELLS; x++) {
      const c = row + x; let v = false;
      if (x < CELLS) {
        const l = lo[c], h = hi[c];
        if (l <= h) {
          const px = OX + (x + 0.5) * CELLW - cx, py = (l + h) * 0.5 - cy, ey = (h - l) * 0.5 + mar, hx = max(abs(px) - hw, 0), h2 = hx * hx + hz * hz;
          if (h2 < max2 && h2 >= min2) {
            const lim = px * fx + py * fy + pz * fz + ex * abs(fx) + ey * abs(fy) + ex * abs(fz);
            if (lim >= 0 && abs(px * rx + pz * rz) - ex * (abs(rx) + abs(rz)) <= lim * tx) v = abs(px * ux + py * uy + pz * uz) - ex * (abs(ux) + abs(uz)) - ey * abs(uy) <= lim * TANH;
          }
        }
      }
      if (v) { if (run < 0) run = c; } else if (run >= 0) {
        const a = start[run], n = start[c] - a;
        if (n > 0) { if (indexed === 1) r.drawIndexed(n * 6, 1, a * 6, 0, nSolid); else if (indexed) r.drawIndexed(indexed.ib.length, n, indexed.i0, indexed.v0, a); else r.draw(verts, n, 0, a); }
        run = -1;
      }
    }
  }
}
function render() {
  // camera basis (right vector is horizontal)
  const cx = F[CX], cy = F[CY], cz = F[CZ], pitch = F[PIT], yaw = F[YAW];
  const cp = cos(pitch), fy = sin(pitch), rx = cos(yaw), rz = sin(yaw), fx = cp * rz, fz = -cp * rx;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  F[FX] = fx; F[FY] = fy; F[FZ] = fz; F[RX] = rx; F[RZ] = rz; F[UX] = ux; F[UY] = uy; F[UZ] = uz;
  const asp = W / H, sx = 1 / (TANH * asp), sy = 1 / TANH, m = UB;
  m[0] = rx * sx; m[4] = 0; m[8] = rz * sx; m[12] = -(rx * cx + rz * cz) * sx;
  m[1] = ux * sy; m[5] = uy * sy; m[9] = uz * sy; m[13] = -(ux * cx + uy * cy + uz * cz) * sy;
  m[2] = 0; m[6] = 0; m[10] = 0; m[14] = NEAR;
  m[3] = fx; m[7] = fy; m[11] = fz; m[15] = -(fx * cx + fy * cy + fz * cz);
  m[32] = cx; m[33] = cy; m[34] = cz; m[35] = F[TIME];
  m[36] = rx; m[37] = 0; m[38] = rz; m[39] = TANH * asp;
  m[40] = ux; m[41] = uy; m[42] = uz; m[43] = TANH;
  m[44] = fx; m[45] = fy; m[46] = fz; m[47] = NEAR;
  const zx = cx - PURPLE[0], zz = cz - PURPLE[1]; let zt = (44 - sqrt(zx * zx + zz * zz)) / 18; zt = zt < 0 ? 0 : zt > 1 ? 1 : zt;
  m[51] = zt * zt * (3 - 2 * zt);
  let ek = (-cy - 8) / 26; ek = ek < 0 ? 0 : ek > 1 ? 1 : ek;
  const air = cy > 0;
  m[56] = air ? EXPO * AIREXP : EXPO * (0.6 + 0.4 * ek); m[57] = air ? 0 : RAYS; m[58] = det;
  Q.writeBuffer(ubo, 0, UB);
  WT[0] = F[TIME]; Q.writeBuffer(uboW, 0, WT);

  { let cr = floor((cz - OZ) / CELLW) | 0; cr = cr < 0 ? 0 : cr > CELLS - 1 ? CELLS - 1 : cr; let n = 0; rowOrd[n++] = cr; for (let d = 1; d < CELLS; d++) { if (cr - d >= 0) rowOrd[n++] = cr - d; if (cr + d < CELLS) rowOrd[n++] = cr + d; } }
  const e = device.createCommandEncoder();
  let slot = null;
  if (hasTS) { for (let i = 0; i < qRead.length; i++) if (!qRead[i].busy) { slot = qRead[i]; break; } }
  waterPass[0].timestampWrites = slot ? tsBegin : undefined;
  passPost.timestampWrites = slot ? tsEnd : undefined;
  // animated water texture + mips
  let r = e.beginRenderPass(waterPass[0]); r.setPipeline(pWater); r.setBindGroup(0, bgWater); r.draw(3); r.end();
  for (let i = 1; i < 5; i++) { r = e.beginRenderPass(waterPass[i]); r.setPipeline(pMip16); r.setBindGroup(0, waterBG[i - 1]); r.draw(3); r.end(); }
  // scene
  passScene.colorAttachments[0].clearValue = air ? [1.2, 1.8, 2.4, 1] : [0, 0, 0, 1];   // anything the sky pass misses is sky-coloured, not black
  r = e.beginRenderPass(passScene);
  r.setBindGroup(0, bg0);
  r.setPipeline(pTerrain); r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
  drawCells(r, T.start, T.lo, T.hi, 1.5, 1, 0, 0, 240);
  r.setPipeline(pSolid); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  for (let i = 0; i < 12; i++) { const g = Wd.solids.ranges[i]; if (g[1]) r.drawIndexed(meshes[i].ib.length, g[1], meshes[i].i0, meshes[i].v0, g[0]); }
  if (cy > -6) drawDeco(r);
  drawActors(r); drawBlobs(r);
  for (let i = 0; i < NCHUNK; i++) {
    const c = Wd.chunks[i], big = i > 2 && i < 6; r.setVertexBuffer(1, ibChunk[i]);
    drawCells(r, c.start, c.lo, c.hi, 3, meshes[14 + i], 0, 0, i > 5 ? 30 : big ? 40 : 96);
    if (big) drawCells(r, c.start, c.lo, c.hi, 3, meshes[20 + i], 0, 40, 150);
  }
  for (let i = 0; i < 6; i++) {
    const lod = i === 3 || i === 4; r.setVertexBuffer(1, ibProp[i]);
    drawCells(r, Wd.props[i].start, Wd.props[i].lo, Wd.props[i].hi, 3, meshes[4 + i], 0, 0, lod ? 6 : 110);
    if (lod) drawCells(r, Wd.props[i].start, Wd.props[i].lo, Wd.props[i].hi, 3, meshes[18 + i], 0, 6, 110);
  }
  r.setPipeline(pManta); r.setVertexBuffer(1, ibManta); r.drawIndexed(MANTA.ib.length, nManta, MANTA.i0, MANTA.v0, 0);
  r.setPipeline(pFish); r.setVertexBuffer(1, ibFish); r.drawIndexed(FISH.ib.length, nFish, FISH.i0, FISH.v0, 0);
  if (nGar) { r.setVertexBuffer(1, ibGar); r.drawIndexed(GAR.ib.length, nGar, GAR.i0, GAR.v0, 0); }
  // kelp and plants: 9-row blades up close, 5 rows mid-range, a decimated set far away
  r.setPipeline(pLeaf); r.setVertexBuffer(0, ibBig); drawCells(r, Wd.big.start, Wd.big.lo, Wd.big.hi, 5, false, 18, 0, 24);
  r.setPipeline(pLeaf5); drawCells(r, Wd.big.start, Wd.big.lo, Wd.big.hi, 5, false, 10, 24, 58);
  r.setPipeline(pLeafF); r.setVertexBuffer(0, ibBigF); drawCells(r, Wd.bigF.start, Wd.bigF.lo, Wd.bigF.hi, 5, false, 6, 58, 150);
  r.setPipeline(pLeafS); r.setVertexBuffer(0, ibSmall); drawCells(r, Wd.small.start, Wd.small.lo, Wd.small.hi, 1.5, false, 6, 0, 70);
  r.setPipeline(pSurf); r.draw(4);
  r.setPipeline(pBack); r.draw(4);
  if (!air) {
    r.setPipeline(pBub); r.setVertexBuffer(0, ibBubbles); r.draw(4, nBub);
    r.setPipeline(pGl); r.setVertexBuffer(0, ibGl); r.draw(4, nGl);
    r.setPipeline(pSnow); r.setVertexBuffer(0, ibSnowB); r.draw(4, nSnow);
  }
  r.end();
  // light shafts
  r = e.beginRenderPass(passRays); r.setPipeline(pRays); r.setBindGroup(0, bgRays); r.draw(3); r.end();
  r = e.beginRenderPass(passBlur); r.setPipeline(pRB); r.setBindGroup(0, bgBlur); r.draw(3); r.end();
  // bloom
  for (let i = 0; i < bloomPass.length; i++) {
    r = e.beginRenderPass(bloomPass[i]); r.setPipeline(i === 0 ? pDown0 : i < NB ? pDown : pUp); r.setBindGroup(0, bloomBG[i]); r.draw(3); r.end();
  }
  // composite
  passPost.colorAttachments[0].view = ctx.getCurrentTexture().createView();
  r = e.beginRenderPass(passPost); r.setPipeline(pPost); r.setBindGroup(0, bgPost); r.draw(3); r.end();
  if (slot) { e.resolveQuerySet(qs, 0, 2, qResolve, 0); e.copyBufferToBuffer(qResolve, 0, slot.b, 0, 16); }
  submitList[0] = e.finish();
  Q.submit(submitList);
  if (slot) { slot.busy = true; slot.b.mapAsync(GPUMapMode.READ).then(slot.done); }
}

// CS[j] = distance to the rock (metres, < 0 in water) at the camera + CE[3j..3j+2]: the camera, then ±0.375 m on
// each axis for the gradient
const CE = new Float64Array([0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375]), CS = new Float64Array(7);
const cv = (x, y, z) => { const b = CI[(x >> 2) + CN * ((y >> 2) + NY / 4 * (z >> 2))]; return b > 1 ? CG[b * 64 - 128 + (x & 3) + 4 * (y & 3) + 16 * (z & 3)] : b * 254 - 127; };
function sd(j) { CS[j] = sdp(F[CX] + CE[j * 3], F[CY] + CE[j * 3 + 1], F[CZ] + CE[j * 3 + 2]); }
// distance to the rock (m, > 0 inside) at a world position; water outside the grid
function sdp(wx, wy, wz) {
  const x = (wx - OX) / VS - CO, y = (wy - OY) / VS, z = (wz - OZ) / VS - CO;
  if (x < 0 || y < 0 || z < 0 || x >= CN * 4 - 1 || y >= NY - 1 || z >= CN * 4 - 1) return -1;
  const ix = x | 0, iy = y | 0, iz = z | 0, u = x - ix, v = y - iy, a = cv(ix, iy, iz), b = cv(ix, iy + 1, iz), c = cv(ix, iy, iz + 1), d = cv(ix, iy + 1, iz + 1);
  const p = a + (cv(ix + 1, iy, iz) - a) * u, q = b + (cv(ix + 1, iy + 1, iz) - b) * u, r = c + (cv(ix + 1, iy, iz + 1) - c) * u, s = d + (cv(ix + 1, iy + 1, iz + 1) - d) * u;
  const e = p + (q - p) * v; return (e + (r + (s - r) * v - e) * (z - iz)) / 127;
}
// flat perches (tree crowns, the lifeguard tower's roof and deck) that birds can stand on: [x, topY, z, radius] discs and [x0, x1, z0, z1, topY] boxes
var PERCH = [], PERCHB = [], perchOn = false;
function buildPerches() {
  const D = Wd.deco;
  for (const [k, key] of [[0, 'p'], [1, 't1'], [2, 't2']]) for (let i = 0; i < D[k].length; i += 12) {
    const x = D[k][i], y = D[k][i + 1], z = D[k][i + 2], sc = D[k][i + 3], a = 2 * atan2(D[k][i + 5], D[k][i + 7]), c = cos(a), s = sin(a);
    for (const q of CROWN[key]) PERCH.push([x + (q[0] * c + q[2] * s) * sc, y + q[1] * sc, z + (-q[0] * s + q[2] * c) * sc, q[3] * sc]);
  }
  for (let i = 0; i < D[10].length; i += 12) {
    const x = D[10][i], y = D[10][i + 1], z = D[10][i + 2], sc = D[10][i + 3];
    PERCHB.push([x - 4.9 * sc, x + 2.1 * sc, z - 2.5 * sc, z + 2.5 * sc, y + 3.8 * sc], [x - 4.2 * sc, x - 1.7 * sc, z - 2.3 * sc, z + 2.3 * sc, y + 1.05 * sc]);
  }
}
// height of the ground under (x, z), searching down from y0; -1e9 where there is none within 9 m
function ground(x, y0, z) {
  const g = ground0(x, y0, z); if (!perchOn) return g;
  let best = g;
  for (const p of PERCH) if (p[1] <= y0 + 0.05 && p[1] > best && (x - p[0]) ** 2 + (z - p[2]) ** 2 < p[3] * p[3]) best = p[1];
  for (const b of PERCHB) if (b[4] <= y0 + 0.05 && b[4] > best && x > b[0] && x < b[1] && z > b[2] && z < b[3]) best = b[4];
  return best;
}
function ground0(x, y0, z) {
  const s0 = sdp(x, y0, z); if (s0 > 0) return y0 + s0;
  let p = s0;
  for (let y = y0 - 0.25; y > y0 - 9; y -= 0.25) { const s = sdp(x, y, z); if (s > 0) return y + 0.25 * s / (s - p); p = s; }
  return -1e9;
}
// Moves the camera by F[MX..MZ] in steps shorter than its radius CR (so it can't pass through thin rock), pushing it
// back out after each step and dropping velocity into the rock, so it slides along.
const CR = 0.5;
function collide() {
  const n = floor(sqrt(F[MX] * F[MX] + F[MY] * F[MY] + F[MZ] * F[MZ]) / 0.4) + 1;
  for (let i = 0; i < n; i++) {
    F[CX] += F[MX] / n; F[CY] += F[MY] / n; F[CZ] += F[MZ] / n;
    for (let k = 0; k < 2; k++) {
      sd(0); const s = CS[0] + CR; if (s <= 0) break;
      for (let j = 1; j < 7; j++) sd(j);
      let gx = CS[1] - CS[2], gy = CS[3] - CS[4], gz = CS[5] - CS[6]; const l = sqrt(gx * gx + gy * gy + gz * gz);
      if (l < 0.075) break; // flat: deep in rock
      gx /= l; gy /= l; gz /= l; const vn = F[VX] * gx + F[VY] * gy + F[VZ] * gz;
      F[CX] -= gx * s; F[CY] -= gy * s; F[CZ] -= gz * s;
      if (vn > 0) { F[VX] -= gx * vn; F[VY] -= gy * vn; F[VZ] -= gz * vn; }
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtr = now - F[LAST]; F[LAST] = now;
  let dt = dtr / 1000; if (dt > 0.1) dt = 0.1;
  // Dynamic resolution for 60 fps: every second (0.4 s behind the menu) scale the load by k
  if (dtr < 1e3 && (dynT += dtr) > 0 && (dynN++, dynT > (menu ? 400 : 1000))) {
    const a = dynT / dynN, g = dynGN ? dynG / dynGN : 0; let k = 1;
    // with GPU timing: keep it between 9.8 and 13.6 ms
    if (g) { if (g > 13.6 || g < 9.8) k = 11.7 / g; }
    // without: slow for two periods in a row means fewer pixels, and twice as long before trying to go back up
    else if (a > 17.6) { dynOk = 0; if (++dynBad > 1) { k = 15 / a; dynBad = 0; dynWait = min(dynWait * 2, 60); } }
    // at the display's rate there is no telling if there is room, so try a little more now and then
    else { dynBad = 0; if (a < 12.5) k = 15 / a; else if (++dynOk > dynWait) { k = 1.17; dynOk = 0; } }
    k = k < 0.5 ? 0.5 : k > 1.7 ? 1.7 : k; const top = min(PIXMAX, DW * DH), mid = max(top / 2, PIXMIN), was = pix + det;
    // too slow: pixels down to `mid` first, then draw distance, then the remaining pixels; faster goes back the same way
    if (k < 1 ? pix > mid || det <= DETMIN : pix < mid || det >= 1) {
      const end = k < 1 ? (det > DETMIN ? mid : PIXMIN) : det < 1 ? mid : top;
      pix *= k; if (k < 1 ? pix < end : pix > end) pix = end;
    } else { det *= sqrt(k); det = det < DETMIN ? DETMIN : det > 1 ? 1 : det; }
    if (was !== pix + det) keep('cq', [LV, pix < top ? pix | 0 : '', det]); // nothing kept at full resolution
    dynN = dynT = dynG = dynGN = 0; resize();
  }
  F[TIME] += dt;
  if (swapped) { F[CX] = EY[0]; F[CY] = EY[1]; F[CZ] = EY[2]; swapped = false; }
  callCd -= dt; callT -= dt;
  {
    // touch: holding the finger away from where it went down keeps turning, like a joystick
    if (tId >= 0) {
      const tr = 4 / (innerWidth < innerHeight ? innerWidth : innerHeight); let jx = (tx - tx0) * tr, jy = (ty - ty0) * tr;
      jx = jx > 1 ? 1 : jx < -1 ? -1 : jx; jy = jy > 1 ? 1 : jy < -1 ? -1 : jy;
      lkx += jx * 1.5 * dt; lky += jy * dt;
    }
    // mouse look through two cascaded low-pass stages
    const kq = 1 - exp(-dt * 30); lkx += mdx * 0.0022; lky += mdy * 0.0022; mdx = 0; mdy = 0;
    const ax = lkx * kq, ay = lky * kq; lkx -= ax; lky -= ay; l2x += ax; l2y += ay;
    const dyw = l2x * kq, dpt = l2y * kq; l2x -= dyw; l2y -= dpt;
    const yaw = F[YAW] + dyw; let pitch = F[PIT] - dpt; pitch = pitch < -1.55 ? -1.55 : pitch > 1.55 ? 1.55 : pitch;
    if (ROLE === 1 || ROLE === 2 || ROLE === 4 || ROLE === 5 || ROLE === 6) { F[YAW] = yaw; F[PIT] = pitch; lookMove(dt, yaw, pitch); } else {
    // three ways to move: swimming, treading water with the head out (`above`), and walking (`walk`), where forward
    // follows the ground and the eye stays 1.7 m over it
    const flat = walk || above, fast = ks || tN > 1;
    const sp = walk ? (fast ? 7.5 : 3.6) * (1 - 0.45 * sstep(-0.2, -1.2, F[GH])) : above ? (fast ? 9 : 4) : fast ? 26 : 7;
    const k = 1 - exp(-dt * 4.5), mf = tId >= 0 && !TOUCHUI ? 0.7 : kf - kb, mr = kr - kl, mu = ku - kd, cp = flat ? 1 : cos(pitch), sy = sin(yaw), cw = cos(yaw);
    const vx = F[VX] + ((sy * cp * mf + cw * mr) * sp - F[VX]) * k, vz = F[VZ] + ((-cw * cp * mf + sy * mr) * sp - F[VZ]) * k;
    let vy = flat ? 0 : F[VY] + ((sin(pitch) * mf + mu) * sp - F[VY]) * k;
    let x = F[CX] + vx * dt, y = F[CY] + vy * dt, z = F[CZ] + vz * dt, xv = vx, zv = vz;
    const rad = sqrt(x * x + z * z), lim = walk ? 186 : 150; if (rad > lim) { x *= lim / rad; z *= lim / rad; }
    if (x > 120) z = z < -72 ? -72 : z > 72 ? 72 : z; // the collision grid ends there
    let gh = flat || y > -3 ? ground(x, F[CY] + 1, z) : -1e9;
    if (walk) {
      const feet = F[CY] - 1.7;
      if (gh > feet + 0.7 || (gh < feet - 1 && feet > 1)) { // a wall, a step too high, or a drop off a cliff: slide along it
        const gx = ground(x, F[CY] + 1, F[CZ]), gz = ground(F[CX], F[CY] + 1, z);
        if (gx <= feet + 0.7 && gx >= feet - 1) { z = F[CZ]; gh = gx; zv = 0; } else if (gz <= feet + 0.7 && gz >= feet - 1) { x = F[CX]; gh = gz; xv = 0; } else { x = F[CX]; z = F[CZ]; gh = ground(x, F[CY] + 1, z); xv = zv = 0; }
      }
      F[GH] = gh;
      if (gh < -1.45) { walk = false; above = true; y = F[CY]; } else y = F[CY] + (gh + 1.7 - F[CY]) * (1 - exp(-dt * 10));
    } else {
      F[GH] = gh;
      if (gh > -1 && y - gh < 2.4 && (above || y > -1)) { walk = true; above = false; }
      else if (above) { // treading water; Q or looking down while swimming forward dives
        if (kd || (mf > 0 && pitch < -0.5)) { above = false; y = -0.45; vy = -3; } else y = F[CY] + (0.35 + 0.05 * sin(F[TIME] * 1.7) - F[CY]) * (1 - exp(-dt * 6));
      } else {
        // the surface: E, or looking up while swimming forward, breaks it
        if (y > -0.3) { y = -0.3; if (ku || (mf > 0 && pitch > 0.35)) above = true; }
        y = y < -52 ? -52 : y;
      }
    }
    F[YAW] = yaw; F[PIT] = pitch; F[VX] = xv; F[VY] = vy; F[VZ] = zv; F[MX] = x - F[CX]; F[MY] = y - F[CY]; F[MZ] = z - F[CZ];
    collide();
    }
  }
  PL[0] = F[CX]; PL[1] = F[CY]; PL[2] = F[CZ];
  if (ROLE === 3) { const spd = hypot(F[VX], F[VZ]); AV.ph += spd * 4.2 * dt; if (spd > 0.4) AV.yawp = atan2(F[VX], F[VZ]); }
  updateActors(dt);
  if (ROLE && TPV) placeCamera();
  render();
  if (hud) {
    hN++; if (dtr > hMax) hMax = dtr; if (dtr < hMin) hMin = dtr; if (dtr > hPer * 1.5) { hLate++; hTot++; }
    F[HUDT] += dtr / 1000;
    if (F[HUDT] > 0.5) { info.textContent = `${(hN / F[HUDT]).toFixed(0)} fps  ·  worst frame ${hMax.toFixed(1)} ms  ·  late frames ${hLate} (total ${hTot})  ·  GPU ${F[GPU].toFixed(2)} ms  ·  ${W}x${H} (${W * 100 / DW | 0}%)`; F[HUDT] = 0; hPer = hMin; hN = 0; hMax = 0; hMin = 1e9; hLate = 0; }
  }
}

// ---------------------------------------------------------------- input
const key = (e, v) => {
  switch (e.code) {
    case 'KeyW': kf = v; break; case 'KeyS': kb = v; break; case 'KeyA': kl = v; break; case 'KeyD': kr = v; break;
    case 'KeyE': ku = v; if (v && !e.repeat && ROLE === 5) AV.digT = AV.digT ? 0 : 1; if (v && !e.repeat && ROLE === 1 && AV.mode === 0 && !(AV.chg > 0)) { AV.chg = 1.6; if (BARK) BARK(0, 0.8, 1); } break; case 'KeyQ': kd = v; break; case 'ShiftLeft': case 'ShiftRight': ks = v; break;
    default: if (v && !e.repeat) {
      if (e.code === 'KeyH') { hud = !hud; hTot = 0; hPer = 1e9; info.textContent = ''; }
      else if (e.code === 'KeyM') mute();
      else if (e.code === 'KeyT') setRole((ROLE + 1) % 7);
      else if (e.code === 'KeyV') { if (ROLE) TPV = !TPV; }
      else if (e.code === 'KeyB') doCall();
      else if (e.code === 'Escape') ui(true);
      else if (e.code >= 'Digit1' && e.code <= 'Digit8') { if (ROLE) setRole(0); vpI = e.code.charCodeAt(5) - 49; lookAt(...POSES[vpI]); }
    }
  }
};
// behind the menu only the stats and mute keys work
addEventListener('keydown', (e) => { if (menu && e.code !== 'KeyH' && e.code !== 'KeyM') return; sound(); key(e, 1); });
addEventListener('keyup', (e) => key(e, 0));
if (TOUCHUI) document.documentElement.classList.add('tc');
// direction pad: held buttons drive W A S D, the middle one toggles running
const hold = (b, f) => { const on = (e) => { e.preventDefault(); e.stopPropagation(); sound(); b.setPointerCapture?.(e.pointerId); f(1); }, off = (e) => { e.preventDefault(); f(0); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off); };
hold($('dU'), (v) => { kf = v; }); hold($('dD'), (v) => { kb = v; }); hold($('dL'), (v) => { kl = v; }); hold($('dR'), (v) => { kr = v; });
$('dS').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); sound(); ks = ks ? 0 : 1; $('dS').className = ks ? 'on' : ''; });
// with ?touch on a computer, dragging the mouse over the scene looks around
if (TOUCHUI && !mob) { let dn = false; canvas.addEventListener('mousedown', () => { dn = true; }); addEventListener('mouseup', () => { dn = false; }); addEventListener('mousemove', (e) => { if (dn) { mdx += e.movementX; mdy += e.movementY; } }); }
// touch buttons: next viewpoint, next role, view, the animal's call (B) and its special action (E: charge, dig, take off)
var vpI = 7;
const TB = [1, 2, 3, 4, 5].map((i) => $('t' + i)), SPECIAL = { 1: 'Charge', 2: 'Take off', 4: 'Take off', 5: 'Dig' };
const TLAB = ['', 'Bark', 'Squawk', 'Warn', 'Dive', 'Pinch', 'Grunt'];
var tbUpdate = () => { TB[1].textContent = ROLE ? 'Role: ' + ROLES[ROLE] : 'Role'; TB[2].hidden = !ROLE; TB[3].hidden = !ROLE; TB[3].textContent = TLAB[ROLE]; TB[4].hidden = !SPECIAL[ROLE]; TB[4].textContent = SPECIAL[ROLE] || ''; };
const tbOn = (b, f) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); sound(); f(e); });
tbOn(TB[0], () => { if (ROLE) setRole(0); vpI = (vpI + 1) % 8; lookAt(...POSES[vpI]); });
tbOn(TB[1], () => setRole((ROLE + 1) % 7));
tbOn(TB[2], () => { if (ROLE) TPV = !TPV; });
tbOn(TB[3], () => doCall());
tbOn(TB[4], () => { key({ code: 'KeyE', repeat: false }, 1); const up = () => { key({ code: 'KeyE' }, 0); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); }; addEventListener('pointerup', up); addEventListener('pointercancel', up); });
tbUpdate();
const release = () => { kf = kb = kl = kr = ku = kd = ks = 0; $('dS').className = ''; tId = -1; tN = 0; };
const capture = () => { sound(); if (TOUCHUI) return; const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()).catch(() => 0); };
canvas.addEventListener('click', capture);
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; } });
addEventListener('blur', release);
const touch = (e) => {
  e.preventDefault(); sound(); tN = e.touches.length;
  let f = null, first = false; for (let i = 0; i < tN; i++) if (e.touches[i].identifier === tId) f = e.touches[i];
  if (!f) { tId = -1; if (tN) { f = e.touches[0]; tId = f.identifier; first = true; } }
  if (f) {
    // the touch axes turn with the page when it lies on its side
    const x = rot.matches ? f.clientY : f.clientX, y = rot.matches ? -f.clientX : f.clientY, s = 1100 / min(innerWidth, innerHeight);
    if (first) { tx0 = x; ty0 = y; } else { mdx += (x - tx) * s; mdy += (y - ty) * s; } // the view follows the finger at once
    tx = x; ty = y;
  }
};
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) canvas.addEventListener(n, touch, { passive: false });

// ---------------------------------------------------------------- menu
// The scene keeps rendering (blurred by CSS) behind the menu. Esc, losing the mouse or the corner button open it.
let menu = true;
const bDive = $('d');
const ui = (m) => {
  if (dead) return;
  menu = m; body.className = m ? 'm' : document.pointerLockElement ? 'g p' : 'g';
  // focus the dive button so Enter works (delayed: it can't take focus while still hidden)
  if (m) { release(); setTimeout(() => menu && bDive.focus(), 100); } else document.activeElement.blur();
};
const go = () => {
  sound(); ui(false); bDive.textContent = 'Resume';
  // phones: go fullscreen and ask for landscape; where that is refused the CSS rotation still applies
  if (mob) document.documentElement.requestFullscreen?.()?.then(() => screen.orientation.lock('landscape')).catch(() => 0);
  if (!mob) capture();
};
bDive.onclick = go; $('o').onclick = () => ui(true);
// detail buttons: the current level is lit, the others reload the page with theirs
$('q').querySelectorAll('button').forEach((b, i) => { if (i === 2 - LV) b.className = 'on'; else b.onclick = () => { keep('cq', 2 - i); location.reload(); }; });
document.addEventListener('pointerlockchange', () => ui(!document.pointerLockElement));

// draw the first frame and wait for the GPU to finish it (pipelines get compiled on first use) before the reveal
lookAt(...POSES[7]); vpI = 7;
await say('Letting the light in…', 1, 400);
render(); await Q.onSubmittedWorkDone();
setTimeout(keep, 15e3, 'cqLoad', ''); // the load counts as survived after 15 s of frames
ui(true);
requestAnimationFrame((t) => { F[LAST] = t; requestAnimationFrame(frame); });
