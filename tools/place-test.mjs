// In XR with a finished save: set the island down, play on it, cover it for night, scoop it up.
export default async function run({ frame, page }) {
  const ev = (fn, arg) => frame.evaluate(fn, arg);
  const R = (action, params) => ev(async ({ action, params }) => { await window.IWER_DEVICE.remote.dispatch(action, params); }, { action, params });
  const st = () => ev(() => ({ ...window.__palm.place(), ...window.__palm.wish() }));
  const log = [];
  const snap = async (name) => { const s = await st(); log.push({ name, placed: s.placed, k: +s.k.toFixed(2), scale: +s.scale.toFixed(2), night: +s.night.toFixed(2), home: s.home, face: s.face, wishes: s.wishes, type: s.type, pos: s.pos.map((n) => +n.toFixed(2)) }); await page.screenshot({ path: `/tmp/claude-0/place-${name}.png` }); };
  const fingers = [0.287, 0, -0.958];
  const left = (pos, palm) => R('set_transform', { device: 'hand-left', anchor: 'wrist', position: pos, orientation: { fingers, palm } });
  const rightRest = () => R('set_transform', { device: 'hand-right', anchor: 'index-tip', position: { x: 0.35, y: 0.8, z: -0.1 }, orientation: { fingers: [-0.35, -0.5, -0.8], palm: 'down' } });
  await ev(() => { window.IWER_DEVICE.fovy = 1.0; });
  await R('set_input_mode', { mode: 'hand' });
  await R('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0.05 }, orientation: { pitch: -38, yaw: 0, roll: 0 } });
  await R('set_hand_pose', { device: 'hand-left', poseId: 'flat' });
  await R('set_hand_pose', { device: 'hand-right', poseId: 'point' });
  await rightRest();
  await left({ x: -0.05, y: 0.95, z: -0.28 }, [0, 1, 0]);
  await page.waitForTimeout(5000);
  await snap('1-held');
  // Flip the palm over, then take the hand away.
  await left({ x: -0.05, y: 0.95, z: -0.28 }, [0.6, -0.8, 0]);
  await page.waitForTimeout(1500);
  await left({ x: -0.35, y: 0.75, z: -0.05 }, [0, -1, 0]);
  await page.waitForTimeout(5000);
  await snap('2-placed');
  // Wait for a wish and grant a play wish by poking with the right hand.
  for (let k = 0; k < 40; k++) {
    const s = await st();
    if (s.type === 'play') {
      const p = await ev(() => window.__palm.villagerWorld(window.__palm.wish().idx));
      await R('set_transform', { device: 'hand-right', anchor: 'index-tip', position: { x: p[0], y: p[1] - 0.01, z: p[2] }, orientation: { fingers: [-0.35, -0.5, -0.8], palm: 'down' } });
      await page.waitForTimeout(300);
    } else if (s.wishes > 0) break;
    else await page.waitForTimeout(500);
  }
  await rightRest();
  await snap('3-wish');
  // Cover with a flat left hand.
  const pos = (await st()).pos;
  await left({ x: pos[0] - 0.02, y: pos[1] + 0.2, z: pos[2] + 0.08 }, [0, -1, 0]);
  await page.waitForTimeout(3500);
  await snap('4-night');
  await left({ x: -0.35, y: 0.75, z: -0.05 }, [0, -1, 0]);
  await page.waitForTimeout(2500);
  // Lean in.
  await R('set_transform', { device: 'headset', position: { x: pos[0], y: pos[1] + 0.3, z: pos[2] + 0.3 }, orientation: { pitch: -45, yaw: 0, roll: 0 } });
  await page.waitForTimeout(2500);
  await snap('5-face');
  await R('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0.05 }, orientation: { pitch: -38, yaw: 0, roll: 0 } });
  // Scoop with an open left palm under the island.
  await left({ x: pos[0] - 0.02, y: pos[1] - 0.12, z: pos[2] + 0.08 }, [0, 1, 0]);
  await page.waitForTimeout(6000);
  await snap('6-scooped');
  return { log };
}
