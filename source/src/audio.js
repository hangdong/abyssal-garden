// ============================================================================
// audio: procedural underwater ambience (no sample files)
// ============================================================================
// A fixed Web Audio graph, built on the first click / key / touch and driven by a 10 Hz timer, not the frame loop.
// Layers: rumble, surface wash, water rush (follows camera speed), drone, bubbles, chimes and distant whale calls.
let AC, OUT, BARK = null, WHISTLE = null, CLICK = null, muted = false; // BARK(pan, volume): a sea lion's bark, once the sound is running
const VOL = 0.78; // master level: about -18.5 LUFS, peaks near -5.5 dBFS
function mkSound(ac) {
  const sr = ac.sampleRate;
  // node of class C with options o, connected to every node / param in `to`; sources start at once
  const N = (C, o, ...to) => { const n = new C(ac, o); for (const d of to) n.connect(d); if (n.start) n.start(); return n; };
  const G = (gain, ...to) => N(GainNode, { gain }, ...to);
  const BQ = (type, frequency, Q, ...to) => N(BiquadFilterNode, { type, frequency, Q }, ...to);
  const lfo = (frequency, depth, to) => N(OscillatorNode, { frequency }, G(depth, to));
  const noise = (secs, f) => { const n = sr * secs | 0, b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr }); f(b.getChannelData(0), n); f(b.getChannelData(1), n); return b; };
  // seamless brown noise loop (the end cross-fades into the start)
  const nb = noise(11, (d, n) => { for (let i = 0, b = 0; i < n + 4096; i++) { b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02; if (i < n) d[i] = b * 3.5; else { const k = (i - n) / 4096; d[i - n] = d[i - n] * k + b * 3.5 * (1 - k); } } });
  // reverb impulse: 5 s of noise that fades out and gets darker
  const ir = noise(5, (d, n) => { for (let i = 0, b = 0; i < n; i++) { const t = i / sr; b += (rnd() * 2 - 1 - b) * (0.04 + 0.5 * exp(-t * 2)); d[i] = b * (1 - exp(-t * 30)) * exp(-t * 1.5) * (1 - i / n); } });

  const lim = N(DynamicsCompressorNode, { threshold: -6, knee: 6, ratio: 20, attack: 0.003, release: 0.3 }, ac.destination);
  const out = OUT = G(0, lim), wet = N(ConvolverNode, { buffer: ir }, out);
  const src = (playbackRate, ...to) => N(AudioBufferSourceNode, { buffer: nb, loop: true, playbackRate }, ...to);
  // rumble
  const rum = G(0.34, out); src(1, BQ('lowpass', 150, 0.7, rum)); lfo(0.07, 0.11, rum.gain); lfo(0.113, 0.08, rum.gain);
  // surface wash + water rush: the same noise played at another speed, so the loops never line up
  const wash = G(0.25, out), wave = G(1, wash), rush = G(0, out), rushF = BQ('bandpass', 300, 0.9, rush);
  src(0.63, BQ('bandpass', 420, 0.5, wave), rushF); lfo(0.09, 0.3, wave.gain); lfo(0.151, 0.25, wave.gain);
  // drone: stacked fifths on D, each note a pair of slightly detuned sines that slowly beat
  const pad = G(1, out, G(1.5, wet));
  // above the water: surf rolling in and out, and a breath of wind
  const surf = G(0, out); src(0.8, BQ('lowpass', 1500, 0.6, surf)); lfo(0.13, 0.3, surf.gain); lfo(0.071, 0.2, surf.gain);
  const wind = G(0, out); src(1.3, BQ('bandpass', 420, 0.5, wind)); lfo(0.05, 0.12, wind.gain);
  [73.42, 110, 164.81, 246.94, 369.99].forEach((f, i) => { const g = G(0.022 - i * 0.003, pad); N(OscillatorNode, { frequency: f }, g); N(OscillatorNode, { frequency: f + rr(0.03, 0.11) }, g); });
  // pooled voices: oscillator -> envelope -> pan -> dry + reverb
  const pool = (n, send, type) => Array.from({ length: n }, () => { const p = N(StereoPannerNode, {}, out, G(send, wet)), g = G(0, p); return { p, g, o: N(OscillatorNode, { type }, g) }; });
  const bub = pool(4, 0.12), chime = pool(3, 1.2), whale = pool(2, 2, 'triangle');
  // one note: pitch glides f0 -> f1 over dur, level rises to vol in att then dies away
  const play = (vs, t, f0, f1, dur, vol, att) => {
    const v = vs.shift(), f = v.o.frequency, g = v.g.gain; vs.push(v);
    v.p.pan.setValueAtTime(rr(-0.7, 0.7), t);
    f.setValueAtTime(f0, t); f.exponentialRampToValueAtTime(f1, t + dur);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(vol, t + att); g.setTargetAtTime(0, t + att, (dur - att) / 5);
  };
  // a sea lion: one to four sawtooth barks with a falling pitch through a throaty formant
  BARK = (pan, vol, agg = 0) => {
    if (agg === 4) { // a gull: a high, harsh, falling call, twice
      for (let k = 0, t = ac.currentTime + 0.03; k < 2; k++, t += rr(0.3, 0.45)) {
        const o = new OscillatorNode(ac, { type: 'sawtooth' }), f = new BiquadFilterNode(ac, { type: 'bandpass', frequency: 2300, Q: 3 }), g = new GainNode(ac, { gain: 0 }), p = new StereoPannerNode(ac, { pan });
        o.connect(f); f.connect(g); g.connect(p); p.connect(out); p.connect(wet);
        o.frequency.setValueAtTime(rr(1500, 1800), t); o.frequency.exponentialRampToValueAtTime(rr(900, 1200), t + 0.3);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.03); g.gain.setTargetAtTime(0, t + 0.12, 0.08);
        o.start(t); o.stop(t + 0.6);
      }
      return;
    }
    const t0 = ac.currentTime + 0.03, lo = agg === 3 ? 1.9 : agg ? 0.6 : 1, hv = agg === 3 ? 0.5 : agg ? 1.4 : 1;   // agg 3: a pup's high squeaky call
    for (let n = agg === 3 ? 2 + (rnd() * 2 | 0) : agg ? 1 + (rnd() * 2 | 0) : 1 + (rnd() * 4 | 0), k = 0; k < n; k++) {
      const t = t0 + k * rr(0.22, 0.36);
      const o = new OscillatorNode(ac, { type: 'sawtooth' }), f = new BiquadFilterNode(ac, { type: 'bandpass', frequency: rr(600, 900) * lo, Q: 1.4 }), g = new GainNode(ac, { gain: 0 }), p = new StereoPannerNode(ac, { pan });
      o.connect(f); f.connect(g); g.connect(p); p.connect(out); p.connect(wet);
      o.frequency.setValueAtTime(rr(330, 430) * lo, t); o.frequency.exponentialRampToValueAtTime(rr(160, 230) * lo, t + 0.22 + agg * 0.1);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * hv, t + 0.015); g.gain.setTargetAtTime(0, t + 0.05, agg === 3 ? 0.05 : 0.07 + agg * 0.04);
      o.start(t); o.stop(t + 0.6);
    }
  };
  // a crab's claws snapping shut: two dry clicks
  CLICK = (pan, vol) => {
    for (let k = 0, t = ac.currentTime + 0.02; k < 2; k++, t += 0.09) {
      const b = new AudioBufferSourceNode(ac, { buffer: nb, playbackRate: 6 }), f = new BiquadFilterNode(ac, { type: 'bandpass', frequency: 3200, Q: 4 }), g = new GainNode(ac, { gain: 0 }), p = new StereoPannerNode(ac, { pan });
      b.connect(f); f.connect(g); g.connect(p); p.connect(out);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 3, t + 0.004); g.gain.setTargetAtTime(0, t + 0.01, 0.012);
      b.start(t, rnd() * 5); b.stop(t + 0.12);
    }
  };
  // the lifeguard's whistle: two sharp blasts
  WHISTLE = (pan, vol) => {
    for (let k = 0, t = ac.currentTime + 0.03; k < 2; k++, t += 0.45) {
      const o = new OscillatorNode(ac, { type: 'sine' }), v = new OscillatorNode(ac, { frequency: 38 }), vg = new GainNode(ac, { gain: 90 }), g = new GainNode(ac, { gain: 0 }), p = new StereoPannerNode(ac, { pan });
      v.connect(vg); vg.connect(o.frequency); o.connect(g); g.connect(p); p.connect(out); p.connect(wet);
      o.frequency.setValueAtTime(2900, t); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.setValueAtTime(vol, t + 0.26); g.gain.linearRampToValueAtTime(0, t + 0.32);
      o.start(t); v.start(t); o.stop(t + 0.4); v.stop(t + 0.4);
    }
  };
  const NOTES = [0, 2, 5, 7, 9, 12, 14, 17, 19]; // D major pentatonic, in semitones above A4
  let lt = ac.currentTime, tG = lt + 4, tS = lt + 12, tB = lt + 1.5, tC = lt + 5, tW = lt + 12, lx = F[CX], ly = F[CY], lz = F[CZ];
  out.gain.setTargetAtTime(VOL, lt, 1);
  return () => {
    const now = ac.currentTime, t = now + 0.05, dt = now - lt;
    if (dt <= 0) return;
    let v = hypot(F[CX] - lx, F[CY] - ly, F[CZ] - lz) / dt; if (v > 60) v = 0; // ignore jumps to a viewpoint
    lt = now; lx = F[CX]; ly = F[CY]; lz = F[CZ];
    rush.gain.setTargetAtTime(0.5 * pow(min(v / 26, 1), 1.2), t, 0.3); rushF.frequency.setTargetAtTime(220 + v * 14, t, 0.3);
    const air = ly > 0.05, s = clamp(1 + ly / 30, 0, 1); wash.gain.setTargetAtTime(air ? 0.04 : 0.25 + 0.55 * s * s, t, 0.5);
    rum.gain.setTargetAtTime(air ? 0.03 : 0.34, t, 0.6); pad.gain.setTargetAtTime(air ? 0.08 : 1, t, 0.8);
    surf.gain.setTargetAtTime(air ? 0.34 : 0.03, t, 0.5); wind.gain.setTargetAtTime(air ? 0.1 + 0.05 * clamp(ly / 12, 0, 1) : 0, t, 0.8);
    if (air) { // gulls overhead and the sea lions down the beach
      if (t > tG) { BARK(rr(-0.8, 0.8), 0.1, 4); tG = t + rr(6, 18); }
      if (t > tS && lx > 90) { BARK(rr(-0.8, 0.8), 0.12, 0); tS = t + rr(14, 40); }
    }
    if (t > tB && !air) { // a burst of 1-6 bubbles: short rising blips, smaller bubbles higher and shorter
      let tt = t;
      for (let n = 1 + rnd() * rnd() * 6 | 0; n--;) { const f = rr(380, 1300); play(bub, tt, f, f * rr(1.4, 2.2), 0.05 + 40 / f, rr(0.03, 0.08), 0.006); tt += rr(0.07, 0.2); }
      tB = tt + rr(0.5, 5);
    }
    if (t > tC && !air) { const f = 440 * pow(2, NOTES[rnd() * 9 | 0] / 12); play(chime, t, f, f, 5, rr(0.02, 0.04), 0.03); tC = t + rr(2.5, 9); }
    if (t > tW && !air) { // a phrase of 2-3 slow glides
      let tt = t;
      for (let n = 2 + rnd() * 2 | 0; n--;) { const f = rr(170, 380), d = rr(1.6, 3.2); play(whale, tt, f, f * rr(0.6, 1.7), d, 0.08, d * 0.4); tt += d * 0.8; }
      tW = tt + rr(20, 50);
    }
  };
}
// called on every click / key / touch: builds the graph once and resumes it when the browser allows
function sound() {
  if (!AC) { AC = new AudioContext({ latencyHint: 'playback' }); setInterval(mkSound(AC), 100); }
  if (AC.state === 'suspended' && !document.hidden) AC.resume();
}
const mute = () => { muted = !muted; OUT.gain.setTargetAtTime(muted ? 0 : VOL, AC.currentTime, 0.08); };
document.addEventListener('visibilitychange', () => { if (AC) document.hidden ? AC.suspend() : AC.resume(); });
