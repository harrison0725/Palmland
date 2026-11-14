export default async function run({ frame }) {
  const visible = await frame.locator('#enter').isVisible();
  const hint = await frame.locator('#hint').textContent();
  if (visible) await frame.locator('#enter').click();
  return { buttonVisible: visible, hint, url: frame.url() };
}
