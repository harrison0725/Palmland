// Renders demo-video frames [FILM_START, FILM_END) in film mode. Game state
// persists in the page between chunks, so chunks must run in order.
import fs from 'node:fs';

const OUT = '/tmp/claude-0/-home-claude/7e683451-6a8e-5848-a455-384f5e96bd04/scratchpad/frames2';
const FPS = 15;

export default async function run({ page, frame, cdp }) {
  const range = JSON.parse(fs.readFileSync(OUT + '/range.json', 'utf8'));
  const deadline = Date.now() + 95000;
  const canvasBox = await frame.evaluate(() => {
    const c = window.IWER_DEVICE.appCanvas || document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  // Hide the dev tool overlays drawn on top of the canvas.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('body *')) {
      const txt = el.textContent?.trim() ?? '';
      if (el.children.length < 6 && /^(Remote Control Active|RuntimeEditor)$/.test(txt.replace(/\s+/g, ''))) {
        let e = el;
        while (e.parentElement && e.parentElement !== document.body && getComputedStyle(e).position !== 'fixed' && getComputedStyle(e).position !== 'absolute') e = e.parentElement;
        e.style.visibility = 'hidden';
      }
    }
  });
  let n = range.next;
  while (n < range.end && Date.now() < deadline) {
    await frame.evaluate(applyFrame, { n, fps: FPS });
    await page.waitForTimeout(20);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true, clip: { ...canvasBox, scale: 1 } });
    fs.writeFileSync(`${OUT}/f${String(n).padStart(5, '0')}.jpg`, Buffer.from(shot.data, 'base64'));
    n++;
  }
  range.next = n;
  fs.writeFileSync(OUT + '/range.json', JSON.stringify(range));
  const state = await frame.evaluate(() => window.__film.api.state());
  return { next: n, end: range.end, state };
}

// Runs in the page.
async function applyFrame({ n, fps }) {
  const d = window.IWER_DEVICE;
  const R = d.remote;
  const f = window.__film;
  const api = f.api;
  const t = n / fps;
  const S = (window.__filmState ??= {});
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const seg = (a, b) => ease((t - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const P = (v) => ({ x: v[0], y: v[1], z: v[2] });

  if (n === 0 || !S.init) {
    S.init = true;
    d.fovy = 1.0;
    await R.dispatch('set_input_mode', { mode: 'hand' });
    await R.dispatch('set_transform', { device: 'headset', position: { x: 0.0, y: 1.13, z: -0.1 }, orientation: { pitch: -42, yaw: 3, roll: 0 } });
  }

  // ---------- Left hand (the island hand) ----------
  const WRIST = [-0.05, 0.95, -0.28];
  const FING = [0.3, 0, -1];
  let wrist = WRIST.slice();
  let palm = [0, 1, 0];
  let fingers = norm(FING);
  // Rise in, later dip out and back.
  const rise = seg(0, 2.2);
  const dip = seg(64, 66.5) - seg(68.5, 71);
  wrist[1] = lerp(0.78, 0.95, rise) - 0.2 * dip;
  // Tilts toward each field, then a playful tilt later.
  const tilts = [
    [0.86, -0.17, 22], [0.4, 0.55, 26.5], [-0.33, 0.92, 31],
  ];
  // Directions are downhill in island-local XZ (fields from the pond).
  const fieldDirs = [[-0.857, 0.514], [0.54, 0.84], [-0.316, 0.949]];
  let k = 0, dir = [0, 0];
  fieldDirs.forEach((fd, i) => {
    const a = 17 + i * 4.6;
    const kk = seg(a, a + 1.2) - seg(a + 3.0, a + 4.2);
    if (kk > k) { k = kk; dir = fd; }
  });
  const play = seg(57, 58.5) - seg(61.5, 63);
  if (play > k) { k = play * 0.9; dir = [0.7, 0.714]; }
  // While rising, the palm faces inward; it turns up once in place (the reveal).
  const turn = seg(2.0, 3.2) * (1 - dip);
  if (turn < 1) {
    const a = (1 - turn) * (Math.PI / 2);
    palm = [Math.sin(a), Math.cos(a), 0];
    const f0 = norm(FING);
    const dot = f0[0] * palm[0] + f0[1] * palm[1] + f0[2] * palm[2];
    fingers = norm([f0[0] - dot * palm[0], f0[1] - dot * palm[1], f0[2] - dot * palm[2]]);
  }
  if (k > 0) {
    const a = (42 * Math.PI / 180) * k;
    palm = [dir[0] * Math.sin(a), Math.cos(a), dir[1] * Math.sin(a)];
    const f0 = [0, 0, -1];
    const dot = f0[0] * palm[0] + f0[1] * palm[1] + f0[2] * palm[2];
    fingers = norm([f0[0] - dot * palm[0], f0[1] - dot * palm[1], f0[2] - dot * palm[2]]);
  }
  await R.dispatch('set_transform', { device: 'hand-left', anchor: 'wrist', position: P(wrist), orientation: { fingers, palm } });
  // Close the hand for night, open for morning.
  const close = seg(31.5, 36) - seg(40, 42);
  const w = Math.min(1, close);
  const fist = { poseId: 'fist', weight: w };
  const wq = Math.round(w * 40) / 40;
  if (S.lw !== wq) {
    S.lw = wq;
    await R.dispatch('set_hand_pose', { device: 'hand-left', poseId: 'flat', fingers: wq > 0 ? { thumb: { poseId: 'fist', weight: wq }, index: { poseId: 'fist', weight: wq }, middle: { poseId: 'fist', weight: wq }, ring: { poseId: 'fist', weight: wq }, pinky: { poseId: 'fist', weight: wq } } : undefined });
  }

  // ---------- Right hand (the god finger) ----------
  const REST = [0.32, 0.82, -0.12];
  const pokes = [[-0.012, -0.024], [0.03, 0.0], [-0.035, -0.002], [0.008, 0.02]];
  let tip = REST.slice();
  let rightPose = 'point';
  let pinch = 0;
  const pokeStart = 5;
  if (t >= pokeStart - 1 && t < pokeStart + pokes.length * 2.8 + 1) {
    const i = Math.min(pokes.length - 1, Math.max(0, Math.floor((t - pokeStart) / 2.8)));
    const a = pokeStart + i * 2.8;
    const [x, z] = pokes[i];
    const above = api.islandToWorld(x, 0.03, z);
    const touch = api.islandToWorld(x, 0.003, z);
    const enter = i === 0 ? seg(pokeStart - 1, pokeStart) : 1;
    const down = seg(a + 0.9, a + 1.4) - seg(a + 1.7, a + 2.2);
    const prev = i > 0 ? api.islandToWorld(pokes[i - 1][0], 0.03, pokes[i - 1][1]) : REST;
    const travel = i > 0 ? seg(a, a + 0.8) : 1;
    let p = lerp3(prev, above, travel);
    p = lerp3(p, touch, down);
    tip = lerp3(REST, p, enter);
    const leave = seg(pokeStart + pokes.length * 2.8, pokeStart + pokes.length * 2.8 + 1);
    tip = lerp3(tip, REST, leave);
  }
  // Pick up a villager and carry it to the new hut.
  if (t >= 44 && t < 57) {
    rightPose = 'default';
    if (!S.grab || t < 44.05) {
      const v = api.villagerWorld(0);
      S.grab = [v[0], v[1] + 0.007, v[2]];
      S.hut = api.islandToWorld(-0.028, 0.014, -0.02);
      S.hutLow = api.islandToWorld(-0.028, 0.009, -0.02);
    }
    if (t < 47.5) {
      const v = api.villagerWorld(0); // track the walking villager until the pinch
      S.grab = [v[0], v[1] + 0.007, v[2]];
    }
    const above = [S.grab[0], S.grab[1] + 0.04, S.grab[2]];
    let p = lerp3(REST, above, seg(44, 45.5));
    p = lerp3(p, S.grab, seg(46.3, 47.3));
    pinch = seg(47.4, 47.9) - seg(53.6, 54.0);
    const lifted = [S.grab[0], S.grab[1] + 0.05, S.grab[2]];
    p = lerp3(p, lifted, seg(48.2, 49.2));
    const hutAbove = [S.hut[0], S.hut[1] + 0.04, S.hut[2]];
    p = lerp3(p, hutAbove, seg(49.2, 51.5));
    p = lerp3(p, S.hutLow, seg(52, 53.4));
    p = lerp3(p, REST, seg(54.6, 56.5));
    tip = p;
  }
  if (S.rp !== rightPose) { S.rp = rightPose; await R.dispatch('set_hand_pose', { device: 'hand-right', poseId: rightPose }); }
  const pq = Math.round(pinch * 20) / 20;
  if (S.pv !== pq) { S.pv = pq; await R.dispatch('set_select_value', { device: 'hand-right', value: pq }); }
  if (rightPose === 'point') {
    await R.dispatch('set_transform', { device: 'hand-right', anchor: 'index-tip', position: P(tip), orientation: { fingers: [-0.35, -0.5, -0.8], palm: 'down' } });
  } else {
    await R.dispatch('set_transform', { device: 'hand-right', anchor: 'grasp', position: P(tip), orientation: { fingers: [-0.35, -0.5, -0.8], palm: 'down' } });
  }

  // Advance the game by exactly one frame.
  f.dt = 1 / fps;
  const start = f.frames;
  f.pending = 1;
  while (f.frames === start) await new Promise((r) => setTimeout(r, 4));
}
