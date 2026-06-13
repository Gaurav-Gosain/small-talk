import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true,
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--autoplay-policy=no-user-gesture-required','--no-sandbox','--use-fake-ui-for-media-stream'] });

async function open() {
  const ctx = await b.newContext({ viewport:{width:1280,height:760} });
  const p = await ctx.newPage();
  await p.goto('http://localhost:5173/', { waitUntil:'networkidle' });
  await p.waitForSelector('.room-card',{timeout:15000});
  return p;
}
const p1 = await open();
console.log('UC_BANNER:', await p1.locator('.uc-pill').count());
console.log('TUNE enabled:', await p1.locator('#tuneBtn').isEnabled(), '| connect disabled:', await p1.locator('#connectBtn').isDisabled(), '| create disabled:', await p1.locator('#createBtn').isDisabled());
await p1.screenshot({ path:'/tmp/st-uc.png' });
// open a 2nd viewer first, then tune in p1, so both are watching
const p2 = await open();
await p2.locator('#tuneBtn').click();
await p2.waitForSelector('#view-call:not(.hidden) .card',{timeout:30000});
await p1.locator('#tuneBtn').click();
await p1.waitForSelector('#view-call:not(.hidden) .card',{timeout:30000});
await p1.waitForTimeout(2500);
console.log('P1 viewers:', await p1.locator('#chViewers').innerText());
console.log('P2 viewers:', await p2.locator('#chViewers').innerText());
await b.close();
