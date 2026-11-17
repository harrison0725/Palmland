// Renders a short clip of the island landing on the real table and a villager exploring it in film mode (open with tools/film-open2.mjs first).
import fs from 'node:fs';

const OUT = process.env.FILM_OUT || 'film-frames-roam';
const FPS = process.env.FILM_TEST ? 3 : 15;

export default async function run({ page, frame, cdp }) {
  const range = JSON.parse(fs.readFileSync(OUT + '/range.json', 'utf8'));
  const deadline = Date.now() + 75000;
  const TEST = !!process.env.FILM_TEST;
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
    if (TEST && n % 6) { n++; continue; }
    await page.waitForTimeout(20);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true, clip: { ...canvasBox, scale: 1 } });
    fs.writeFileSync(`${OUT}/f${String(n).padStart(5, '0')}.jpg`, Buffer.from(shot.data, 'base64'));
    n++;
  }
  range.next = n;
  const st = await frame.evaluate(() => ({ roam: window.__film.api.roamState(), done: !!window.__filmState?.done }));
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
  // Seated in front of the coffee table; lean in once the explorer is out.
  const lean = S.lean ? seg(S.lean, S.lean + 3) * (1 - seg(S.leanEnd ?? 1e9, (S.leanEnd ?? 1e9) + 2.5)) : 0;
  const head = lerp3([0, 1.12, -0.95], [0.02, 0.8, -1.42], lean);
  await R.dispatch('set_transform', { device: 'headset', position: P(head), orientation: { pitch: -40 - 14 * lean, yaw: 0, roll: 0 } });
  // Left hand holds the island over the table, sets it down and moves away.
  const WRIST = [-0.04, 0.8, -1.72];
  const LREST = [-0.42, 0.62, -1.2];
  if (t > 1.4 && !S.down) { S.down = true; api.setDown(); }
  const wrist = lerp3(WRIST, LREST, seg(1.8, 3.4));
  await R.dispatch('set_transform', { device: 'hand-left', anchor: 'wrist', position: P(wrist), orientation: { fingers: [0.3, 0, -1], palm: t > 1.4 ? 'down' : 'up' } });
  await R.dispatch('set_transform', { device: 'hand-right', anchor: 'index-tip', position: P([0.4, 0.62, -1.15]), orientation: { fingers: [-0.35, -0.5, -0.8], palm: 'down' } });
  if (t > 5 && !S.roam) { S.roam = true; api.roam(); }
  const st = api.roamState();
  if (S.roam && !S.lean && st.phase >= 2) S.lean = t;
  if (S.roam && !S.end && t > 7 && st.idx < 0) { S.end = t; S.leanEnd = t - 1.5; }
  if (S.end && t > S.end + 3) S.done = true;
  f.dt = 1 / fps;
  const start = f.frames;
  f.pending = 1;
  while (f.frames === start) await new Promise((r) => setTimeout(r, 4));
}
