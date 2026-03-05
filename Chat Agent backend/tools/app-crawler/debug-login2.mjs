import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
await page.goto('https://pm-st-2.eyefinity.com/login/logout', { waitUntil: 'networkidle', timeout: 60000 });

console.log('URL after goto:', page.url());

// Screenshot
await page.screenshot({ path: 'screenshots/_st2-login.png', fullPage: true });

// Dump all input elements
const inputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('input, select, textarea')).map(el => {
    const attrs = {};
    for (const a of el.attributes) attrs[a.name] = a.value;
    const id = el.id;
    const label = id ? document.querySelector('label[for="' + id + '"]')?.textContent?.trim() : null;
    return { tag: el.tagName, attrs, label };
  });
});
console.log('Inputs:', JSON.stringify(inputs, null, 2));

// Dump buttons
const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('button, input[type="submit"]')).map(el => ({
    id: el.id, text: el.textContent.trim(), type: el.type, outerHTML: el.outerHTML.substring(0, 300)
  }));
});
console.log('Buttons:', JSON.stringify(buttons, null, 2));

await browser.close();
