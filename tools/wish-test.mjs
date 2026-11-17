// In XR: hold the island, then grant wishes with real emulated hand input.
export default async function run({ frame, page }) {
  const ev = (fn, arg) => frame.evaluate(fn, arg);
  const log = [];
  await ev(async () => {
    const R = window.IWER_DEVICE.remote;
    window.IWER_DEVICE.fovy = 1.0;
    await R.dispatch('set_input_mode', { mode: 'hand' });
    await R.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.13, z: -0.1 }, orientation: { pitch: -42, yaw: 3, roll: 0 } });
    await R.dispatch('set_transform', { device: 'hand-left', anchor: 'wrist', position: { x: -0.05, y: 0.95, z: -0.28 }, orientation: { fingers: [0.287, 0, -0.958], palm: [0, 1, 0] } });
    await R.dispatch('set_hand_pose', { device: 'hand-right', poseId: 'point' });
    await R.dispatch('set_transform', { device: 'hand-right', anchor: 'index-tip', position: { x: 0.32, y: 0.82, z: -0.12 }, orientation: { fingers: [-0.35, -0.5, -0.8], palm: 'down' } });
  });
  const rest = async () => ev(async () => {
    await window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-right', anchor: 'index-tip', position: { x: 0.32, y: 0.82, z: -0.12 }, orientation: { fingers: [-0.35, -0.5, -0.8], palm: 'down' } });
  });
  const pokeAt = async (dx) => {
    for (let k = 0; k < 14; k++) {
      await ev(async (dx) => {
        const w = window.__palm.wish();
        const p = window.__palm.villagerWorld(w.idx);
        await window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-right', anchor: 'index-tip', position: { x: p[0] + dx, y: p[1] - 0.004, z: p[2] }, orientation: { fingers: [-0.35, -0.5, -0.8], palm: 'down' } });
      }, dx);
      await page.waitForTimeout(250);
      const w = await ev(() => window.__palm.wish());
      if (!w.type) break;
    }
    await rest();
  };
  const deadline = Date.now() + 95000;
  let last = -1;
  while (Date.now() < deadline) {
    const w = await ev(() => window.__palm.wish());
    if (w.wishes !== last) { log.push({ ...w, t: Math.round((deadline - Date.now()) / 1000) }); last = w.wishes; }
    if (w.wishes >= 3 && w.wishes < 9) break;
    if (w.wishes >= 10) break;
    if (w.type === 'play') await pokeAt(0);
    else if (w.type === 'tree') await pokeAt(0.009);
    else if (w.type === 'sleep') {
      await ev(async () => { await window.IWER_DEVICE.remote.dispatch('set_hand_pose', { device: 'hand-left', poseId: 'flat', fingers: Object.fromEntries(['thumb','index','middle','ring','pinky'].map((f) => [f, { poseId: 'fist', weight: 1 }])) }); });
      await page.waitForTimeout(6000);
      await ev(async () => { await window.IWER_DEVICE.remote.dispatch('set_hand_pose', { device: 'hand-left', poseId: 'flat' }); });
    }
    await page.waitForTimeout(500);
  }
  if (last >= 10) { await ev(async () => { await window.IWER_DEVICE.remote.dispatch('set_hand_pose', { device: 'hand-left', poseId: 'flat', fingers: Object.fromEntries(['thumb','index','middle','ring','pinky'].map((f) => [f, { poseId: 'fist', weight: 0.8 }])) }); }); await page.waitForTimeout(5000); }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/claude-0/wish.png' });
  log.push(await ev(() => window.__palm.wish()));
  return { log };
}
