// Seed a save that finished the first session yesterday, then reload with ?debug
// so the "new villager moves in" daily event plays.
export default async function run({ frame }) {
  await frame.evaluate(() => {
    const save = { step: 6, trees: [[0.01, 0.02, 7], [-0.015, 0.0, 9], [0.0, -0.025, 11]], lastVisit: Date.now() - 86400000 * 1.5, days: 1, villagers: 3 };
    localStorage.setItem('palmlands.v1', JSON.stringify(save));
    const u = new URL(location.href);
    u.search = '?debug&hands';
    location.href = u.toString();
  });
  return { ok: true };
}
