import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true,
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{ width:1280, height:760 } });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8000/', { waitUntil:'networkidle' });
await p.mouse.move(380, 300); // trigger cursor tracking
await p.waitForTimeout(6000); // robot load + bloom render
const canvas = await p.evaluate(()=>{ const c=document.querySelector('#hero3d canvas'); return c?{w:c.width,h:c.height}:null; });
console.log('hero canvas:', JSON.stringify(canvas));
console.log('h1:', await p.locator('#lobby h1').innerText());
console.log('ERRORS:', errs.join(' | ')||'none');
await p.screenshot({ path:'/tmp/reachy-landing.png' });
await b.close();
