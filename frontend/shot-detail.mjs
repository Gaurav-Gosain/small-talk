import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true,
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1440,height:820} });
await p.goto('http://localhost:5173/', { waitUntil:'networkidle' });
await p.mouse.move(900,420);
await p.waitForTimeout(5500);
await p.screenshot({ path:'/tmp/det-right.png', clip:{ x:760, y:70, width:680, height:700 } });
await b.close();
