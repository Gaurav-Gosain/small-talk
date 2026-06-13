import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--autoplay-policy=no-user-gesture-required','--no-sandbox','--use-fake-ui-for-media-stream']});
const m=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
await m.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
await m.waitForSelector('#showGroup',{timeout:15000});
await m.locator('#showGroup').click();
await m.waitForSelector('#view-call:not(.hidden) .card',{timeout:40000});
try{await m.waitForFunction(()=>{const s=document.getElementById('subtitles');return s&&!s.classList.contains('hidden')&&s.querySelector('b');},{timeout:60000});}catch{}
await m.waitForTimeout(1500);
await m.screenshot({path:'/tmp/msub.png'});
console.log('done');
await b.close();
