// Seed a finished first session and reload with ?debug&hands (optionally &wishes=N via WISHES env).
export default async function run({ frame }) {
  await frame.evaluate(() => {
    const save = { step: 6, trees: [[0.01, 0.02, 7], [-0.015, 0.0, 9], [0.0, -0.025, 11]], lastVisit: Date.now(), days: 1, villagers: 3, wishes: 0 };
    localStorage.setItem('palmlands.v1', JSON.stringify(save));
    const u = new URL(location.href);
    u.search = '?debug&hands&wish=play';
    location.href = u.toString();
  });
  return { ok: true };
}
