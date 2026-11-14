export default async function run({ page, frame, cdp }) {
  const out = {};
  let t = Date.now();
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, optimizeForSpeed: true });
  out.cdpJpeg = Date.now() - t; out.bytes = r.data.length;
  t = Date.now();
  await page.screenshot({ type: 'jpeg', quality: 90, path: '/tmp/claude-0/-home-claude/7e683451-6a8e-5848-a455-384f5e96bd04/scratchpad/p.jpg' });
  out.pwJpeg = Date.now() - t;
  out.canvas = await frame.evaluate(() => window.IWER_DEVICE.canvasDimensions);
  return out;
}
