import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--autoplay-policy=no-user-gesture-required','--no-sandbox','--use-fake-ui-for-media-stream']});
const p=await b.newPage({viewport:{width:1280,height:760}});
await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#showGroup',{timeout:20000});
await p.locator('#showGroup').click();
await p.waitForSelector('#view-call:not(.hidden) .card',{timeout:40000});
let names=[];for(let i=0;i<60;i++){names=await p.locator('.nameplate .name').allTextContents();if(names.includes('Bhai'))break;await p.waitForTimeout(400);}
console.log('names:',JSON.stringify(names));
await p.waitForTimeout(4000);
await p.screenshot({path:'/tmp/dev-card.png'});
await b.close();
