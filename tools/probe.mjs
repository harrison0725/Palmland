export default async function run({ page, frame }) {
  const find = () => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const sr = el.shadowRoot;
        const kids = [...sr.querySelectorAll('div')].filter((d) => (d.textContent || '').includes('Remote Control Active') && d.textContent.length < 40).map((d) => d.textContent);
        out.push({ host: el.tagName + '#' + el.id, open: true, kids: kids.slice(0, 3) });
      }
    }
    return out;
  };
  return { page: await page.evaluate(find), frame: await frame.evaluate(find) };
}
