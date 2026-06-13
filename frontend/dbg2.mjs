import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true,
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport:{width:1100,height:720} });
const p = await ctx.newPage();
p.on('pageerror', e=>console.log('PAGEERROR:', e.message));
p.on('console', m=>{ if(m.type()==='error') console.log('CONSOLE_ERR:', m.text()); });
p.on('response', r=>{ if(r.url().includes('/api/rooms')) console.log('RESP', r.url(), r.status()); });
await p.goto('http://localhost:5173/', { waitUntil:'domcontentloaded' });
await p.waitForTimeout(4000);
console.log('room-card count:', await p.locator('.room-card').count());
console.log('roomlist html len:', (await p.locator('#room-list').innerHTML()).length);
await b.close();
