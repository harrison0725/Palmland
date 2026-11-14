// After entering XR: hold the left hand out palm up and look at it.
export default async function run({ frame, page }) {
  await frame.evaluate(async () => {
    const R = window.IWER_DEVICE.remote;
    window.IWER_DEVICE.fovy = 1.0;
    await R.dispatch('set_input_mode', { mode: 'hand' });
    await R.dispatch('set_transform', { device: 'headset', position: { x: 0.0, y: 1.13, z: -0.1 }, orientation: { pitch: -42, yaw: 3, roll: 0 } });
    await R.dispatch('set_transform', { device: 'hand-left', anchor: 'wrist', position: { x: -0.05, y: 0.95, z: -0.28 }, orientation: { fingers: [0.287, 0, -0.958], palm: [0, 1, 0] } });
    await R.dispatch('set_transform', { device: 'hand-right', anchor: 'wrist', position: { x: 0.25, y: 0.8, z: -0.2 }, orientation: { fingers: [0, 0, -1], palm: [-1, 0, 0] } });
  });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: '/tmp/claude-0/nd.png' });
  return { ok: true };
}
