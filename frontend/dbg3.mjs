import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true,
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--autoplay-policy=no-user-gesture-required','--no-sandbox','--use-fake-ui-for-media-stream'] });
async function tune() {
  const ctx = await b.newContext({ viewport:{width:1100,height:720} });
  const p = await ctx.newPage();
  await p.goto('http://localhost:5173/', { waitUntil:'domcontentloaded' });
  await p.waitForSelector('.room-card',{timeout:20000});
  await p.locator('#tuneBtn').click();
  await p.waitForSelector('#view-call:not(.hidden) .card',{timeout:30000});
  return p;
}
const p1 = await tune();
await p1.waitForTimeout(1500);
const p2 = await tune();
await p2.waitForTimeout(4000);
console.log('P1:', await p1.locator('#chViewers').innerText());
console.log('P2:', await p2.locator('#chViewers').innerText());
await b.close();
