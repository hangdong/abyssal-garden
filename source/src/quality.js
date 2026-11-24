// ============================================================================
// quality level, chosen before anything is built
// ============================================================================
// LV: 0 High, 1 Medium, 2 Low. Medium and Low keep every 2nd / 4th leaf, glint and pebble and bake fewer shadows;
// Low also drops anti-aliasing and uses coarser meshes, cheaper filtering and fewer light shaft steps.
// localStorage.cq = "level,pixels,detail". cqLoad is set while the world is built: still set on the next
// visit means that load crashed the tab, so this one runs a level lower.
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad;
try { SV = (localStorage.cq || '').split(','); bad = localStorage.cqLoad; } catch {}
LV = SV[0] ? +SV[0] : mob ? (mem > 7 ? 1 : 2) : mem <= 4 ? 2 : 0;
if (bad && LV < 2) { SV = [++LV]; keep('cq', LV); }
const THIN = 1 << LV, SHADOW = LV ? 2048 : 4096, AA = LV > 1 ? 1 : 4, WATER = LV > 1 ? 256 : 512, RAYN = LV > 1 ? 12 : 34;

// ?dbg=N shows an intermediate stage instead of the final image (1 composite runs, 2 scene, 3 shafts, 4 sky pass runs, 5 depth, 6 sky ray directions, 7 plain sky gradient)
const DBG = +new URLSearchParams(location.search).get('dbg') || 0;
// ?touch shows the touch controls on a computer too (the mouse drags to look)
const TOUCHUI = mob || new URLSearchParams(location.search).has('touch');
