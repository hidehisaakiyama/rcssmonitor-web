// Renders a frame with rcssmonitor-web at the size of an rcssmonitor
// screenshot and writes the web image, a side-by-side image and a diff.
//
//   node tools/parity/compare.mjs --ref qt.png --log LOG --out DIR
//        [--frame N] [--options JSON] [--select N] [--prefix NAME]
//        [--crop X,Y,W,H ...] [--zoom N] [--font FAMILY]
//        [--actions zoomIn,toggleFocusBall,...]   (ViewState methods, run after the first draw)
//   node tools/parity/compare.mjs --ref qt.png --live HOST:PORT --out DIR [...]
//
// --live connects to rcssserver (server::ws_port) instead of opening a log
// and draws the newest frame 2 seconds later, e.g. for a game stopped before
// the kick off, which both monitors show the same.
//
// --ref is a capture of rcssmonitor (tools/parity/capture.sh). The field
// canvas is found as the area below the toolbar that starts with the field
// color. --options sets ViewState options, e.g. '{"showViewArea":true}'.
// Build the single-file HTML first (npm run build:single).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values: args } = parseArgs({
  options: {
    ref: { type: 'string' },
    log: { type: 'string' },
    live: { type: 'string' },
    out: { type: 'string' },
    frame: { type: 'string', default: '0' },
    options: { type: 'string', default: '{}' },
    select: { type: 'string', default: '0' },
    prefix: { type: 'string', default: 'compare' },
    crop: { type: 'string', multiple: true, default: [] },
    zoom: { type: 'string', default: '6' },
    font: { type: 'string', default: '' },
    actions: { type: 'string', default: '' },
  },
});
if (!args.ref || !(args.log || args.live) || !args.out) {
  console.error(
    'usage: compare.mjs --ref qt.png (--log LOG | --live HOST:PORT) --out DIR [--frame N] [--options JSON]',
  );
  process.exit(1);
}
mkdirSync(args.out, { recursive: true });

const html = pathToFileURL(resolve('dist-single/rcssmonitor-web.html')).href;
const refUrl = `data:image/png;base64,${readFileSync(args.ref).toString('base64')}`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.goto(html);

  // Size of the reference canvas.
  const ref = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(2, 0, 1, img.height).data;
    let top = 0;
    while (
      top < img.height &&
      !(d[top * 4] === 31 && d[top * 4 + 1] === 160 && d[top * 4 + 2] === 31)
    ) {
      ++top;
    }
    return { width: img.width, height: img.height, top };
  }, refUrl);
  const width = ref.width;
  const height = ref.height - ref.top;

  if (args.live) {
    const [host, port] = args.live.split(':');
    await page.goto(`${html}?connect=1&host=${host}&port=${port}`);
    await page.locator('#connection-status').filter({ hasText: 'Connected' }).waitFor();
    await page.waitForTimeout(2000);
  } else {
    await page.setInputFiles('#rcg-file', resolve(args.log));
    await page.locator('#load-result').filter({ hasText: 'frames' }).waitFor();
  }
  await page.evaluate(
    ({ width, height, frame, options, select, font, actions }) => {
      const hook = window.rcssmonitorWeb;
      const el = hook.field.element;
      el.style.flex = 'none';
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      Object.assign(hook.view.options, options);
      if (font) {
        for (const f of Object.values(hook.view.fonts)) {
          f.family = font;
        }
      }
      if (select > 0) {
        hook.view.selectPlayer(select);
      }
      hook.view.changed();
      if (frame >= 0) {
        hook.showFrame(frame);
      }
      hook.renderNow();
      for (const a of actions) {
        const [name, arg] = a.split(':');
        const value =
          arg === undefined || arg === '' || Number.isNaN(Number(arg)) ? arg : Number(arg);
        hook.view[name](value);
        hook.renderNow();
      }
    },
    {
      width,
      height,
      // Live: the newest frame.
      frame: args.live ? -1 : Number(args.frame),
      options: JSON.parse(args.options),
      select: Number(args.select),
      font: args.font,
      actions: args.actions ? args.actions.split(',') : [],
    },
  );

  const webPng = await page.locator('.field-view').screenshot();
  const webPath = resolve(args.out, `${args.prefix}-web.png`);
  writeFileSync(webPath, webPng);

  // Side by side (rcssmonitor | web) and the difference, amplified.
  const result = await page.evaluate(
    async ({ refUrl, webUrl, top, width, height }) => {
      const load = async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return img;
      };
      const [qt, web] = await Promise.all([load(refUrl), load(webUrl)]);
      const pixels = (img, sy) => {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, sy, width, height, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height);
      };
      const a = pixels(qt, top);
      const b = pixels(web, 0);
      const diff = new ImageData(width, height);
      let changed = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        const d = Math.max(
          Math.abs(a.data[i] - b.data[i]),
          Math.abs(a.data[i + 1] - b.data[i + 1]),
          Math.abs(a.data[i + 2] - b.data[i + 2]),
        );
        if (d > 48) {
          ++changed;
        }
        const v = Math.min(255, d * 3);
        diff.data[i] = v;
        diff.data[i + 1] = v;
        diff.data[i + 2] = v;
        diff.data[i + 3] = 255;
      }
      const out = document.createElement('canvas');
      out.width = width * 2;
      out.height = height * 2;
      const ctx = out.getContext('2d');
      ctx.putImageData(a, 0, 0);
      ctx.putImageData(b, width, 0);
      ctx.putImageData(diff, 0, height);
      // Web drawn over rcssmonitor at half opacity.
      ctx.putImageData(a, width, height);
      const tmp = document.createElement('canvas');
      tmp.width = width;
      tmp.height = height;
      tmp.getContext('2d').putImageData(b, 0, 0);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(tmp, width, height);
      return { url: out.toDataURL('image/png'), changed, total: width * height };
    },
    {
      refUrl,
      webUrl: `data:image/png;base64,${webPng.toString('base64')}`,
      top: ref.top,
      width,
      height,
    },
  );
  // Magnified crops: rcssmonitor on the left, web on the right.
  for (const [n, crop] of args.crop.entries()) {
    const [cx, cy, cw, ch] = crop.split(',').map(Number);
    const url = await page.evaluate(
      async ({ refUrl, webUrl, top, cx, cy, cw, ch, zoom }) => {
        const load = async (src) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          return img;
        };
        const [qt, web] = await Promise.all([load(refUrl), load(webUrl)]);
        const out = document.createElement('canvas');
        out.width = cw * zoom * 2 + zoom;
        out.height = ch * zoom;
        const ctx = out.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#f0f';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(qt, cx, cy + top, cw, ch, 0, 0, cw * zoom, ch * zoom);
        ctx.drawImage(web, cx, cy, cw, ch, cw * zoom + zoom, 0, cw * zoom, ch * zoom);
        return out.toDataURL('image/png');
      },
      {
        refUrl,
        webUrl: `data:image/png;base64,${webPng.toString('base64')}`,
        top: ref.top,
        cx,
        cy,
        cw,
        ch,
        zoom: Number(args.zoom),
      },
    );
    const cropPath = resolve(args.out, `${args.prefix}-crop${n}.png`);
    writeFileSync(cropPath, Buffer.from(url.split(',')[1], 'base64'));
    console.log(cropPath);
  }

  const sidePath = resolve(args.out, `${args.prefix}-side.png`);
  writeFileSync(sidePath, Buffer.from(result.url.split(',')[1], 'base64'));
  const pct = ((100 * result.changed) / result.total).toFixed(2);
  console.log(`canvas ${width}x${height} (rcssmonitor toolbar ${ref.top}px)`);
  console.log(`pixels differing by more than 48: ${result.changed} (${pct}%)`);
  console.log(`${webPath}\n${sidePath}`);
} finally {
  await browser.close();
}
