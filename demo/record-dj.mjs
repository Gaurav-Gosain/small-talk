// Record DJ Reachy in front of a chroma-key green background.
//
// Uses canvas.captureStream() + MediaRecorder inside the page itself so we
// pull frames straight from the WebGL canvas at the rate the GPU is
// painting — no screencast bottleneck, no SwiftShader fallback. Headed
// off-screen Chromium gives us actual ANGLE/Metal acceleration; the page
// records the stream to a Blob and we ship the bytes back to Node as
// base64, then transcode the resulting webm to MP4 with system ffmpeg.
//
//   node demo/record-dj.mjs
//
// Output: demo/video/dj-greenscreen.mp4   (h264, 60 fps, 1280x720)

import { spawn, spawnSync } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'video');
const FRONTEND_DIR = join(HERE, '..', 'frontend');
const URL = 'http://localhost:5173/dj-greenscreen.html';
const SECONDS = 12;
const FPS = 60;
const W = 1280;
const H = 720;
const OUT_WEBM = join(OUT_DIR, 'dj-greenscreen.webm');
const OUT_MP4 = join(OUT_DIR, 'dj-greenscreen.mp4');

const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(existsSync) || 'ffmpeg';

const { chromium } = await import(join(FRONTEND_DIR, 'node_modules/playwright/index.mjs'));

await mkdir(OUT_DIR, { recursive: true });

console.log('[record-dj] starting vite dev server…');
const vite = spawn('pnpm', ['dev', '--port', '5173'], {
  cwd: FRONTEND_DIR,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, BROWSER: 'none' },
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite startup timeout')), 30_000);
  vite.stdout.on('data', (c) => {
    const s = c.toString();
    process.stdout.write(`[vite] ${s}`);
    if (s.includes('Local:') || s.includes('ready in')) {
      clearTimeout(t);
      resolve();
    }
  });
  vite.stderr.on('data', (c) => process.stderr.write(`[vite] ${c}`));
});

try {
  console.log('[record-dj] launching browser (headed off-screen, real GPU)…');
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--window-position=-4000,-4000',
      `--window-size=${W + 100},${H + 100}`,
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(URL);
  console.log('[record-dj] waiting for DJ to mount…');
  await page.waitForFunction(() => window._djReady === true, { timeout: 30_000 });
  await page.waitForTimeout(1500); // warm-up

  console.log(`[record-dj] recording ${SECONDS}s via canvas.captureStream(${FPS})…`);
  const startInfo = await page.evaluate((fps) => window.djStartRecording(fps), FPS);
  console.log(`[record-dj] mime=${startInfo.mime} fps=${startInfo.fps}`);
  await page.waitForTimeout(SECONDS * 1000);

  console.log('[record-dj] stopping + downloading blob…');
  const result = await page.evaluate(() => window.djStopRecording());
  console.log(`[record-dj] got ${(result.bytes / 1024 / 1024).toFixed(2)} MiB of ${result.type}`);
  await ctx.close();
  await browser.close();

  await writeFile(OUT_WEBM, Buffer.from(result.b64, 'base64'));

  console.log('[record-dj] transcoding webm → mp4…');
  // Snap dimensions to even numbers for libx264.
  const ff = spawnSync(
    FFMPEG,
    [
      '-y', '-hide_banner', '-loglevel', 'warning',
      '-i', OUT_WEBM,
      '-vf', `scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=${FPS}`,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      OUT_MP4,
    ],
    { stdio: 'inherit' },
  );
  if (ff.status !== 0) throw new Error(`ffmpeg exited with ${ff.status}`);

  console.log(`[record-dj] ✓ webm: ${OUT_WEBM}`);
  console.log(`[record-dj] ✓ mp4:  ${OUT_MP4}`);
} finally {
  vite.kill('SIGTERM');
  console.log('[record-dj] stopped vite');
}
