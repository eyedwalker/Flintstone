import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
await page.goto('https://pm-st-2.eyefinity.com/login/', { waitUntil: 'networkidle', timeout: 60000 });
console.log('URL:', page.url());

const inputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('input')).filter(e => e.type !== 'hidden').map(el => ({
    id: el.id, name: el.name, type: el.type,
    label: el.id ? document.querySelector('label[for="' + el.id + '"]')?.textContent?.trim() : null,
  }));
});
console.log('Inputs:', JSON.stringify(inputs, null, 2));

// Try filling and logging in
await page.fill('#practiceLocationId', '999');
await page.fill('#loginName', 'Admin');
await page.fill('#password', 'Ale12345');
await page.evaluate(() => {
  ['practiceLocationId', 'loginName', 'password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
  });
});
await page.click('#btnLogin');
console.log('Clicked login...');

try {
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30000 });
  console.log('SUCCESS! Post-login URL:', page.url());
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: 'screenshots/_st2-home.png', fullPage: true });
} catch {
  await page.waitForTimeout(5000);
  console.log('After wait URL:', page.url());
  await page.screenshot({ path: 'screenshots/_st2-login-result.png', fullPage: true });
}

await browser.close();
