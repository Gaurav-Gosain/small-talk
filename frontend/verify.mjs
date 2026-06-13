// Headless browser smoke test: load the app, start the demo, join, and confirm
// the meeting grid renders Reachy twins (WebGL canvas) without console errors.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',
  ],
});

const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`PAGEERROR ${e.message}`));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.click('#demo'); // now auto-joins + starts the looping demo

await page.waitForSelector('.card', { timeout: 20000 });

// Watch for the audio-driven "talking" class over a few seconds.
let sawTalking = false;
for (let i = 0; i < 60; i++) {
  if (await page.locator('.card.talking').count()) {
    sawTalking = true;
    break;
  }
  await page.waitForTimeout(200);
}
await page.waitForTimeout(3000); // let twins render

const cards = await page.locator('.card').count();
const canvases = await page.evaluate(() =>
  [...document.querySelectorAll('.card canvas')].map((c) => ({ w: c.width, h: c.height })),
);
// Sample the centre pixel of the first canvas to confirm something was drawn.
const drewSomething = await page.evaluate(() => {
  const c = document.querySelector('.card canvas');
  if (!c) return null;
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  return !!gl && !gl.isContextLost();
});
const names = await page.locator('.card .name').allTextContents();

await page.screenshot({ path: '/tmp/reachy-grid.png', fullPage: false });

console.log('CARDS:', cards);
console.log('SAW_TALKING (audio drove animation):', sawTalking);
console.log('NAMES:', names);
console.log('CANVASES:', JSON.stringify(canvases));
console.log('WEBGL_OK:', drewSomething);
console.log('--- console ---');
console.log(logs.join('\n') || '(no console output)');

await browser.close();
