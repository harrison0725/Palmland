// Like film-open, but starts from a finished first session (for rehearsing act two).
export default async function run({ page, frame }) {
  try { await page.setViewportSize({ width: 1280, height: 720 }); } catch (e) { /* ignore */ }
  await frame.evaluate(() => {
    const save = { step: 6, trees: [[-0.012, -0.024, 7], [0.03, 0.0, 9], [-0.035, -0.002, 11], [0.008, 0.02, 5]], lastVisit: Date.now(), days: 1, villagers: 3, wishes: 0 };
    localStorage.setItem('palmlands.v1', JSON.stringify(save));
    const u = new URL(location.href);
    u.search = '?film';
    location.href = u.toString();
  });
  return { ok: true };
}
