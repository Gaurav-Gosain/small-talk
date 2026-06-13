import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true,
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--autoplay-policy=no-user-gesture-required','--no-sandbox','--use-fake-ui-for-media-stream'] });
const p = await b.newPage({ viewport:{width:1280,height:760} });
p.on('pageerror', e=>console.log('PAGEERROR:', e.message));
p.on('console', m=>{ if(m.type()==='error') console.log('CONSOLE_ERR:', m.text()); });
await p.goto('http://localhost:5173/', { waitUntil:'networkidle' });
await p.waitForSelector('.room-card',{timeout:15000});
console.log('allRooms via tune click...');
await p.locator('#tuneBtn').click();
await p.waitForTimeout(1500);
console.log('view-call hidden?', await p.locator('#view-call').getAttribute('class'));
console.log('status text:', await p.locator('#status').innerText().catch(()=>'(n/a)'));
try { await p.waitForSelector('#view-call:not(.hidden) .card',{timeout:25000}); console.log('CARD appeared'); } catch { console.log('NO CARD'); }
console.log('chViewers:', await p.locator('#chViewers').innerText().catch(()=>'(n/a)'));
await b.close();
