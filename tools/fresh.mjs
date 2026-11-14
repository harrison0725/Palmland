export default async function run({ frame }) {
  await frame.evaluate(() => {
    localStorage.removeItem('palmlands.v1');
    const u = new URL(location.href);
    u.searchParams.set('debug', '');
    location.href = u.toString();
  });
  return { ok: true };
}
