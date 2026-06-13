// Headless check for the 5-character group chat.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: [
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--no-sandbox',
    '--use-fake-ui-for-media-stream',
  ],
});
const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`PAGEERROR ${e.message}`));

await page.goto('https://build-small-hackathon-small-talk.hf.space/', { waitUntil: 'networkidle' });
await page.click('#chaos'); // auto-joins + starts the 5-way group chat

await page.waitForSelector('.card', { timeout: 45000 });
let sawTalking = false;
for (let i = 0; i < 160; i++) {
  if (await page.locator('.card.talking').count()) sawTalking = true;
  if ((await page.locator('.card').count()) >= 5 && sawTalking) break;
  await page.waitForTimeout(200);
}
await page.waitForTimeout(3000);

console.log('CARDS:', await page.locator('.card').count());
console.log('NAMES:', (await page.locator('.card .name').allTextContents()).join(', '));
console.log('SAW_TALKING:', sawTalking);
console.log('ERRORS:', logs.join(' | ') || 'none');
await page.screenshot({ path: '/tmp/reachy-chaos.png' });
await browser.close();
