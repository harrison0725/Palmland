export default async function run({ page, frame }) {
  try { await page.setViewportSize({ width: 1280, height: 720 }); } catch (e) { /* ignore */ }
  await frame.evaluate(() => {
    localStorage.removeItem('palmlands.v1');
    const u = new URL(location.href);
    u.search = '?film';
    location.href = u.toString();
  });
  return { ok: true };
}
