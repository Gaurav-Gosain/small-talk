import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true,
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--autoplay-policy=no-user-gesture-required','--no-sandbox','--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport:{width:1000,height:700} });
await ctx.addInitScript(() => localStorage.setItem('userReachy', JSON.stringify({name:'Nova',color:'#a78bfa',persona:'a hopeful astronomer',voice:'soft and bright'})));
const p = await ctx.newPage();
await p.goto('http://localhost:5173/', { waitUntil:'networkidle' });
await p.waitForSelector('.room-card',{timeout:15000});
await p.locator('.room-card').first().click(); // the-podcast (ada+bode) + my guest Nova = 3
await p.waitForSelector('#view-call:not(.hidden) .card',{timeout:30000});
await p.waitForTimeout(4000);
const names = await p.locator('.card .name').allTextContents();
console.log('CARDS_WITH_GUEST:', names.join(', '));
await p.locator('#nav button').click(); // leave -> should drop guest
await p.waitForSelector('#view-home:not(.hidden)',{timeout:8000});
await p.waitForTimeout(2000);
console.log('LEFT: ok');
await b.close();
