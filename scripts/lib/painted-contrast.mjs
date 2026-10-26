// The contrast a category tile's text and icon actually get, read from the painted page rather than
// computed from the stylesheet (#875). The wash behind them is a gradient, so how strong it is under a
// line depends on the tile's shape, and only the rendering knows that shape. The palette gate measures
// each icon against the wash at its strongest, which is the right bound for the icon and says nothing
// about the text further along. Measured this way before #875 capped the wash, hovering took the count
// on five of Home's six cards below 4.5:1 in the dark theme at 620px, the lowest to 4.06:1.
import { inflateSync } from 'node:zlib';

import { ratio } from '../check-palette.mjs';

// What a tile draws over its wash, and the floor each is held to: the eyebrow and the count are 12px
// text, and the icon is a graphic.
export const TILE_PARTS = [
  ['eyebrow', '.home-path-label', 4.5],
  ['count', '.home-path-count', 4.5],
  ['icon', '.home-path-icon', 3],
];

// Enough PNG to read a screenshot: eight bits a channel, RGB or RGBA and not interlaced, which is what
// Chromium writes. Anything else is refused rather than misread.
export function decodePng(png) {
  let at = 8;
  let width = 0;
  let height = 0;
  let type = -1;
  const data = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const kind = png.toString('ascii', at + 4, at + 8);
    if (kind === 'IHDR') {
      width = png.readUInt32BE(at + 8);
      height = png.readUInt32BE(at + 12);
      if (png[at + 16] !== 8 || ![2, 6].includes(png[at + 17]) || png[at + 20] !== 0) {
        throw new Error('decodePng reads only 8-bit, non-interlaced RGB or RGBA');
      }
      type = png[at + 17];
    }
    if (kind === 'IDAT') data.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= bpp ? out[y * stride + x - bpp] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const corner = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - corner;
        const [a, b, c] = [left, up, corner].map((n) => Math.abs(estimate - n));
        predicted = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      out[y * stride + x] = (value + predicted) & 255;
    }
  }
  return {
    width,
    height,
    pixel(x, y) {
      const i = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * bpp;
      return [out[i], out[i + 1], out[i + 2]];
    },
  };
}

// Every tile matching `selector`, at rest or pointed at, with each part measured against the painted
// pixel two before its first mark and one below its top. The wash fades away from the tile's top left
// corner, so that pixel carries more of it than anything under the part does: a pass there is a pass
// for the whole line. Captures never reach beyond the screen: on a landscape phone at 200% text a tile
// is taller than the screen, and a capture beyond it resized the page, which scrolled the tile out
// from under the pointer. Such a tile is measured a part at a time instead, each brought on screen and
// pointed at in turn. A phone also applies hover a frame after the pointer arrives. Each row says
// whether the tile really was pointed at, since a miss would measure the weaker wash and pass for the
// wrong reason.
export async function tileContrast(page, selector, { hover = false, parts = TILE_PARTS } = {}) {
  const keys = await page.$$eval(selector, (tiles) => tiles.map((tile) => tile.dataset.category));
  const rows = [];
  const settle = (tile, wanted) => page.$eval(tile, async (node, partSelectors) => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    await Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
    const points = partSelectors.map((partSelector) => {
      const part = node.querySelector(partSelector);
      let box = part.getBoundingClientRect();
      if (!part.matches('svg')) {
        const range = document.createRange();
        range.selectNodeContents(part);
        box = [...range.getClientRects()].find((rect) => rect.width && rect.height);
      }
      return { x: Math.round(box.left) - 2, y: Math.round(box.top) + 1, colour: getComputedStyle(part).color };
    });
    const { pageLeft, pageTop, width, height } = visualViewport;
    const tileBox = node.getBoundingClientRect();
    return {
      points, pointed: node.matches(':hover'), scrollX, scrollY,
      onScreen: points.every(({ x, y }) => x >= 0 && y >= 0 && x < width && y < height),
      view: { x: pageLeft, y: pageTop, width, height },
      context: { top: tileBox.top, height: tileBox.height, shown: document.querySelector('.view:not([hidden])')?.id, hash: location.hash },
    };
  }, wanted);
  const aim = (tile, partSelector) => page.$eval(tile, (node, wanted) => {
    const target = wanted ? node.querySelector(wanted) : node;
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    const box = target.getBoundingClientRect();
    const [left, right] = [Math.max(box.left, 0), Math.min(box.right, innerWidth)];
    const [top, bottom] = [Math.max(box.top, 0), Math.min(box.bottom, innerHeight)];
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }, partSelector);
  const measure = async (key, sample, chosen) => {
    const xs = sample.points.map(({ x }) => x);
    const ys = sample.points.map(({ y }) => y);
    const [left, top] = [Math.min(...xs), Math.min(...ys)];
    const clip = { x: left + sample.scrollX, y: top + sample.scrollY, width: Math.max(...xs) - left + 1, height: Math.max(...ys) - top + 1 };
    const { view } = sample;
    if (clip.x < view.x || clip.y < view.y || clip.x + clip.width > view.x + view.width || clip.y + clip.height > view.y + view.height) {
      throw new Error(`${key}: the pixels to measure are not all on screen ${JSON.stringify({ clip, view, points: sample.points, tile: sample.context })}`);
    }
    const shot = decodePng(await page.screenshot({ clip, captureBeyondViewport: false }));
    sample.points.forEach((point, index) => {
      const [name, , floor] = chosen[index];
      const background = shot.pixel(point.x - left, point.y - top);
      const colour = point.colour.match(/\d+/g).slice(0, 3).map(Number);
      rows.push({ key, part: name, floor, pointed: sample.pointed, colour, background, ratio: ratio(colour, background) });
    });
  };
  for (const key of keys) {
    const tile = `${selector}[data-category="${key}"]`;
    const target = await aim(tile);
    await page.mouse.move(hover ? target.x : 0, hover ? target.y : 0);
    const whole = await settle(tile, parts.map(([, partSelector]) => partSelector));
    if (whole.onScreen) {
      await measure(key, whole, parts);
      continue;
    }
    for (const part of parts) {
      const spot = await aim(tile, part[1]);
      await page.mouse.move(hover ? spot.x : 0, hover ? spot.y : 0);
      await measure(key, await settle(tile, [part[1]]), [part]);
    }
  }
  await page.mouse.move(0, 0);
  return rows;
}
