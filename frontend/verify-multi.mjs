import { chromium } from 'playwright';
const b = await chromium.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--use-fake-ui-for-media-stream'],
});

async function viewer(label) {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 700 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.waitForSelector('.room-card', { timeout: 15000 });
  await p.locator('.room-card').first().click(); // join "the-podcast"
  await p.waitForSelector('#view-call:not(.hidden) .card', { timeout: 30000 });
  let talking = false;
  for (let i = 0; i < 120; i++) {
    if (await p.locator('.card.talking').count()) talking = true;
    if (talking && (await p.locator('.card').count()) >= 2) break;
    await p.waitForTimeout(200);
  }
  return { label, cards: await p.locator('.card').count(), talking, errs: errs.slice(0, 3) };
}

// two viewers joining the SAME room at (nearly) the same time
const [a, c] = await Promise.all([viewer('A'), viewer('B')]);
console.log('VIEWER A:', JSON.stringify(a));
console.log('VIEWER B:', JSON.stringify(c));
await b.close();
