import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--autoplay-policy=no-user-gesture-required','--no-sandbox','--use-fake-ui-for-media-stream']});
const p=await b.newPage({viewport:{width:1280,height:760}});
await p.goto('https://build-small-hackathon-small-talk.hf.space/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#showGroup',{timeout:25000});
await p.locator('#showGroup').click();
await p.waitForSelector('#view-call:not(.hidden) .card',{timeout:50000});
// sample talking state every 500ms for 45s
let talk=0,total=0,firstAt=-1,lastAt=-1;
for(let i=0;i<90;i++){
  const t=await p.locator('.card.talking').count();
  total++;
  if(t>0){talk++;if(firstAt<0)firstAt=i;lastAt=i;}
  await p.waitForTimeout(500);
}
console.log(`talking samples: ${talk}/${total} | first at ${firstAt*0.5}s | last at ${lastAt*0.5}s`);
// audio element health
const els=await p.evaluate(()=>[...document.querySelectorAll('audio')].map(a=>({paused:a.paused,ended:a.ended,ready:a.readyState,t:Math.round(a.currentTime)})));
console.log('audio els:',JSON.stringify(els));
await b.close();
