// Renders a short crow-raid clip in film mode (open with tools/film-open2.mjs first).
import fs from 'node:fs';

const OUT = process.env.FILM_OUT || 'film-frames-raid';
const FPS = 15;

export default async function run({ page, frame, cdp }) {
  const range = JSON.parse(fs.readFileSync(OUT + '/range.json', 'utf8'));
  const deadline = Date.now() + 75000;
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
  const st = await frame.evaluate(() => ({ raid: window.__film.api.raidState(), done: !!window.__filmState?.done }));
  if (st.done) range.end = n;
  fs.writeFileSync(OUT + '/range.json', JSON.stringify(range));
  return { next: n, end: range.end, st };
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
  const lerp3 = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
  const P = (v) => ({ x: v[0], y: v[1], z: v[2] });
  if (!S.init) {
    S.init = true;
    d.fovy = 1.0;
    await R.dispatch('set_input_mode', { mode: 'hand' });
    await R.dispatch('set_hand_pose', { device: 'hand-left', poseId: 'flat' });
    await R.dispatch('set_hand_pose', { device: 'hand-right', poseId: 'point' });
    S.tip = [0.25, 0.85, 0.05];
  }
  await R.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0.05 }, orientation: { pitch: -38, yaw: 0, roll: 0 } });
  // Left hand holds the island for a moment, then it is set down and the hand rests.
  const WRIST = [-0.05, 0.95, -0.28];
  const LREST = [-0.38, 0.72, -0.02];
  if (t > 1.2 && !S.down) { S.down = true; api.setDown(); }
  const wrist = lerp3(WRIST, LREST, seg(1.6, 3));
  await R.dispatch('set_transform', { device: 'hand-left', anchor: 'wrist', position: P(wrist), orientation: { fingers: [0.3, 0, -1], palm: t > 1.2 ? 'down' : 'up' } });
  if (t > 4.5 && !S.raid) { S.raid = true; api.raid(); }
  // Right hand chases the busiest crow with a human-ish top speed.
  const REST = [0.22, 0.86, 0.02];
  const tgt = S.raid ? api.crowTarget() : null;
  const goal = tgt ? [tgt[0], tgt[1] + 0.002, tgt[2]] : REST;
  const dx = goal.map((g, i) => g - S.tip[i]);
  const dist = Math.hypot(...dx);
  const step = Math.min(dist, (tgt ? 0.75 : 0.35) / fps);
  if (dist > 1e-6) S.tip = S.tip.map((x, i) => x + (dx[i] / dist) * step);
  await R.dispatch('set_transform', { device: 'hand-right', anchor: 'index-tip', position: P(S.tip), orientation: { fingers: [-0.35, -0.5, -0.8], palm: 'down' } });
  if (S.raid && !S.end && t > 8 && !api.raidState().active) S.end = t;
  if (S.end && t > S.end + 5) S.done = true;
  f.dt = 1 / fps;
  const start = f.frames;
  f.pending = 1;
  while (f.frames === start) await new Promise((r) => setTimeout(r, 4));
}
