// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 the Advent Calendar authors. See LICENSE.
// Renders public/share/<look>/<door>.jpg (1200x630) for every look and door, plus all.jpg.
// These are the link previews when someone shares "I opened door 7".
//   npm install --no-save playwright-core     (uses your installed Chrome)
//   node share-art/render.cjs "My Advent Calendar" "my-site.example"
// Both words are optional: the first is the small brand line, the second the address pill.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const THEMES = ['workshop', 'plum', 'jen8n', 'meadow', 'arcade'];
const [brand = '', url = ''] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  const tpl = 'file://' + path.join(__dirname, 'door.html');
  const extra = (brand ? '&brand=' + encodeURIComponent(brand) : '') + (url ? '&url=' + encodeURIComponent(url) : '');
  for (const t of THEMES) {
    const dir = path.join(__dirname, '..', 'public', 'share', t); fs.mkdirSync(dir, { recursive: true });
    for (const d of [...Array.from({ length: 24 }, (_, i) => String(i + 1)), 'all']) {
      await p.goto(`${tpl}?theme=${t}&door=${d}${extra}`, { waitUntil: 'load' });
      if (d === '1') await p.waitForTimeout(800); else await p.waitForTimeout(60);
      await p.screenshot({ path: path.join(dir, d + '.jpg'), type: 'jpeg', quality: 82 });
    }
    console.log('done', t);
  }
  // og.png: the preview for the home page and every calendar page
  await p.goto('file://' + path.join(__dirname, '..', 'og-preview.html') + '?x=1' + extra, { waitUntil: 'load' });
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(__dirname, '..', 'public', 'og.png') });
  await b.close();
})();
