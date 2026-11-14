export default async function run({ page, frame }) {
  const t0 = Date.now();
  try { await page.setViewportSize({ width: 1280, height: 720 }); } catch (e) { /* ignore */ }
  const r = await frame.evaluate(async () => {
    const d = window.IWER_DEVICE.remote;
    await d.dispatch('set_input_mode', { mode: 'hand' });
    await d.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.1, z: -0.1 } });
    await d.dispatch('look_at', { device: 'headset', target: { x: -0.03, y: 0.99, z: -0.33 } });
    await d.dispatch('set_hand_pose', { device: 'hand-left', poseId: 'flat' });
    await d.dispatch('set_transform', { device: 'hand-left', anchor: 'wrist', position: { x: -0.05, y: 0.95, z: -0.28 }, orientation: { fingers: [0.3, 0, -1], palm: 'up' } });
    await d.dispatch('set_hand_pose', { device: 'hand-right', poseId: 'point' });
    await d.dispatch('set_transform', { device: 'hand-right', anchor: 'index-tip', position: { x: 0.03, y: 1.03, z: -0.3 }, orientation: { fingers: [-0.3, -0.8, -0.5], palm: 'down' } });
    const f = window.__film;
    const step = async (n) => { for (let i = 0; i < n; i++) { const start = f.frames; f.pending = 1; while (f.frames === start) await new Promise((r) => setTimeout(r, 5)); } };
    await step(24);
    return f.api.state();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: '/tmp/claude-0/-home-claude/7e683451-6a8e-5848-a455-384f5e96bd04/scratchpad/film-test.png' });
  return { r, ms: Date.now() - t0 };
}
