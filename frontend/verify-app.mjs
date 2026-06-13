import { chromium } from 'playwright';
const b = await chromium.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--use-fake-ui-for-media-stream'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForSelector('.room-card', { timeout: 15000 });
console.log('ROOMS:', await p.locator('.room-card').count());
await p.locator('.room-card').first().click();
await p.waitForSelector('#view-call:not(.hidden) .card', { timeout: 30000 });
let talking = false;
for (let i = 0; i < 120; i++) {
  if (await p.locator('.card.talking').count()) talking = true;
  if (talking && (await p.locator('.card').count()) >= 2) break;
  await p.waitForTimeout(200);
}
console.log('CALL_CARDS:', await p.locator('.card').count(), 'TALKING:', talking);
await p.screenshot({ path: '/tmp/st-call.png' });
await p.locator('#nav button').click();
await p.waitForSelector('#view-home:not(.hidden)', { timeout: 8000 });
console.log('BACK_HOME: ok');
await p.locator('#connectBtn').click();
await p.waitForSelector('#view-connect:not(.hidden) #cfgName', { timeout: 8000 });
console.log('CONNECT_STEP1:', await p.locator('#connect-mount h2').innerText());
console.log('ERRORS:', errs.slice(0, 5).join(' | ') || 'none');
await p.screenshot({ path: '/tmp/st-home.png' });
await b.close();
