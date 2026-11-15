#!/usr/bin/env node
// Renders the Chrome Web Store images from store/images/src/screens.html into
// store/images/. Needs Google Chrome and puppeteer-core:
//
//   npm install --no-save puppeteer-core
//   node scripts/render-store-images.js [path-to-chrome]
//
// Then flatten alpha (the store wants 24-bit PNGs):
//   python3 -c "from PIL import Image; import glob; [Image.open(p).convert('RGB').save(p) for p in glob.glob('store/images/*.png')]"
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'store', 'images');
const SRC = path.join(OUT, 'src', 'screens.html');
const CHROME = process.argv[2] || '/usr/bin/google-chrome';

const TARGETS = [
  ['screenshot-1-color-by-list.png', '1', 1280, 800],
  ['screenshot-2-task-color.png', '2', 1280, 800],
  ['screenshot-3-tasks-panel.png', '3', 1280, 800],
  ['screenshot-4-popup.png', '4', 1280, 800],
  ['promo-small-440x280.png', 'promo', 440, 280],
  ['promo-marquee-1400x560.png', 'marquee', 1400, 560],
];

// Sample data for the toolbar popup capture.
const SAMPLE = {
  enabled: true,
  taskIndex: {
    lists: { '~default': 'Personal', W0rkL1stA1b2C3d4: 'Work', Sch00lL1stE5f6G7: 'School' },
    tasks: Object.fromEntries([
      ['t1', 'Send weekly report', 'W0rkL1stA1b2C3d4', '2026-11-10'],
      ['t2', 'Review pull request', 'W0rkL1stA1b2C3d4', '2026-11-11'],
      ['t3', 'Prep team sync', 'W0rkL1stA1b2C3d4', '2026-11-13'],
      ['t4', 'Call dentist', '~default', '2026-11-13'],
      ['t5', 'Pay rent', '~default', '2026-11-14'],
      ['t6', 'Grocery run', '~default', '2026-11-15'],
      ['t7', 'Read chapter 4', 'Sch00lL1stE5f6G7', '2026-11-11'],
      ['t8', 'Essay draft due', 'Sch00lL1stE5f6G7', '2026-11-12'],
      ['t9', 'Study for quiz', 'Sch00lL1stE5f6G7', '2026-11-16'],
    ].map(([id, title, listId, date]) => [`${id}AAAAAAAAAAAA`, { id: `${id}AAAAAAAAAAAA`, title, listId, date }])),
  },
  listColors: { W0rkL1stA1b2C3d4: '#4285f4', '~default': '#33b679', Sch00lL1stE5f6G7: '#f4511e' },
  taskColors: { t4AAAAAAAAAAAA: '#e67c73' },
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: [ROOT] });
  try {
    // 1. Capture the real toolbar popup with sample data, "Work" expanded.
    const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker');
    const sw = await swTarget.worker();
    await sw.evaluate((data) => chrome.storage.local.set(data), SAMPLE);
    const extId = new URL(swTarget.url()).host;
    const popup = await browser.newPage();
    await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await popup.setViewport({ width: 360, height: 620, deviceScaleFactor: 2 });
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.waitForSelector('#lists .row');
    await popup.evaluate(() => {
      const work = [...document.querySelectorAll('#lists .row')].find((r) => r.textContent.includes('Work'));
      work.querySelector('.row-main').click();
    });
    await new Promise((r) => setTimeout(r, 300));
    // What the status line says on a Calendar tab (here the popup isn't on one),
    // and end the capture on a whole task row.
    await popup.evaluate(() => {
      document.getElementById('status').textContent = '3 lists · 9 tasks cached. This tab: 9 task chips recognized.';
      [...document.querySelectorAll('#tasks .row')].slice(2).forEach((r) => r.remove());
      document.body.style.maxHeight = 'none';
    });
    const body = await popup.$('body');
    await body.screenshot({ path: path.join(OUT, 'src', 'popup-capture.png') });

    // 2. Render each store image at its exact size.
    const page = await browser.newPage();
    for (const [file, s, width, height] of TARGETS) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.goto(`file://${SRC}?s=${s}`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await new Promise((r) => setTimeout(r, 250));
      await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width, height } });
      console.log('wrote', path.relative(ROOT, path.join(OUT, file)));
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
