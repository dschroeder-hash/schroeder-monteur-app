// Renders PNG app icons from public/icons/icon.svg (run once after changing the icon; output is committed).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [size, name, pad] of [
  [192, 'icon-192.png', 0],
  [512, 'icon-512.png', 0],
  [512, 'icon-maskable-512.png', 0],
  [180, 'apple-touch-icon.png', 0],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size - pad * 2}" height="${size - pad * 2}" `)}</body></html>`,
  );
  await page.screenshot({
    path: new URL(`../public/icons/${name}`, import.meta.url).pathname,
    omitBackground: false,
  });
}
await browser.close();
