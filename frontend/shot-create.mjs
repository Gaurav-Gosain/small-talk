import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true,
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1280,height:760} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:5173/', { waitUntil:'networkidle' });
await p.waitForSelector('.room-card',{timeout:15000});
await p.locator('#createBtn').click();
await p.waitForSelector('#nrFmt .chip',{timeout:5000});
// click the 'duo' chip and check it gets .on
await p.locator('#nrFmt .chip[data-t="duo"]').click();
const onCount = await p.locator('#nrFmt .chip.on').count();
const onIsDuo = await p.locator('#nrFmt .chip.on').getAttribute('data-t');
console.log('CHIP_ON_COUNT:', onCount, 'SELECTED:', onIsDuo);
console.log('ERRORS:', errs.join(' | ')||'none');
await p.screenshot({ path:'/tmp/st-create.png' });
await b.close();
