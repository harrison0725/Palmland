/** Tiny WebAudio synth so the game ships with zero audio assets. */
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  plant: () => tone(520, 0.12, 'sine', 0.15, 380),
  pop: () => tone(300, 0.08, 'triangle', 0.12, 500),
  pick: () => tone(700, 0.1, 'sine', 0.1, 200),
  drop: () => tone(500, 0.12, 'sine', 0.1, -250),
  splash: () => tone(900, 0.06, 'sine', 0.04, -600),
  chime: () => {
    [660, 830, 990, 1320].forEach((f, i) => tone(f, 0.5, 'sine', 0.08, 0, i * 0.09));
  },
  grow: () => {
    [330, 440, 550, 660, 880].forEach((f, i) => tone(f, 0.35, 'triangle', 0.06, 0, i * 0.06));
  },
  unlock: () => ac(),
};
