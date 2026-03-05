import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });

// Login
await page.goto('https://pm-st-2.eyefinity.com/login/', { waitUntil: 'networkidle', timeout: 60000 });
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
await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(3000);
console.log('Logged in:', page.url());

// Check for iframes
const iframes = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('iframe')).map(f => ({
    id: f.id, name: f.name, src: f.src, className: f.className
  }));
});
console.log('\nIframes:', JSON.stringify(iframes, null, 2));

// Click Patients to open dropdown, then get dropdown items
await page.click('text=Patients');
await page.waitForTimeout(1000);

const dropdownItems = await page.evaluate(() => {
  const items = [];
  // Look for visible dropdown/popover/menu items
  document.querySelectorAll('.dropdown-menu a, .dropdown-menu li, [class*="dropdown"] a, [class*="menu"] a, [class*="popover"] a, ul.dropdown a').forEach(el => {
    if (el.offsetParent !== null) { // visible
      items.push({ text: el.textContent.trim(), tag: el.tagName, href: el.getAttribute('href'), classes: el.className });
    }
  });
  // Also check for any visible menu-like items near the nav
  document.querySelectorAll('a, li').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.top > 60 && rect.top < 300 && rect.left < 400 && el.offsetParent !== null) {
      const text = el.textContent.trim();
      if (text && text.length < 80 && !items.find(i => i.text === text)) {
        items.push({ text, tag: el.tagName, href: el.getAttribute('href'), classes: el.className, rect: { top: rect.top, left: rect.left } });
      }
    }
  });
  return items;
});
console.log('\nDropdown items after clicking Patients:', JSON.stringify(dropdownItems, null, 2));

// Take screenshot
await page.screenshot({ path: 'screenshots/_nav-debug-patients.png', fullPage: true });

// Now click "Search / Add Patient" from the dropdown
try {
  await page.click('text=Search / Add Patient');
  await page.waitForTimeout(5000);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  console.log('\nAfter clicking Search / Add Patient:', page.url());

  // Check iframes again
  const iframes2 = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('iframe')).map(f => ({
      id: f.id, name: f.name, src: f.src, className: f.className,
      width: f.offsetWidth, height: f.offsetHeight
    }));
  });
  console.log('Iframes after nav:', JSON.stringify(iframes2, null, 2));

  await page.screenshot({ path: 'screenshots/_nav-debug-patient-search.png', fullPage: true });

  // Check page title and visible content
  const info = await page.evaluate(() => ({
    title: document.title,
    bodyText: document.body.innerText.substring(0, 1000),
  }));
  console.log('Title:', info.title);
  console.log('Content preview:', info.bodyText.substring(0, 500));
} catch (err) {
  console.error('Click failed:', err.message);
}

await browser.close();
