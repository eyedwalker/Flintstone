import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://pm-ci.eyefinity.com/EPM/login', { waitUntil: 'networkidle', timeout: 30000 });

const inputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('input, select, textarea')).map(el => {
    const attrs = {};
    for (const a of el.attributes) attrs[a.name] = a.value;
    const id = el.id;
    const label = id ? document.querySelector('label[for="' + id + '"]')?.textContent?.trim() : null;
    return { tag: el.tagName, attrs, label, outerHTML: el.outerHTML.substring(0, 500) };
  });
});
console.log(JSON.stringify(inputs, null, 2));

const formHtml = await page.evaluate(() => {
  const form = document.querySelector('form');
  return form ? form.innerHTML.substring(0, 5000) : 'No form found';
});
console.log('\n--- FORM HTML ---\n', formHtml);

await browser.close();
