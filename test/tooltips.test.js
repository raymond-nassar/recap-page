import test from 'node:test';
import assert from 'node:assert/strict';
import { tooltipPlacement, tooltipRegions } from '../src/js/lib/tooltips.js';

test('action and rail prefer different sides without placing content over the trigger', () => {
  const box = { left: 100, right: 144, top: 100, bottom: 144 };
  for (const rail of [false, true]) {
    const regions = tooltipRegions(box, { width: 1280, height: 900 }, rail);
    assert.equal(regions[0].side, rail ? 'right' : 'top');
    for (const region of regions) {
      assert.ok(region.left >= 8 && region.top >= 8);
      assert.ok(region.left + region.width <= 1272);
      assert.ok(region.top + region.height <= 892);
      assert.ok(region.left >= box.right + 8 || region.left + region.width <= box.left - 8
        || region.top >= box.bottom + 8 || region.top + region.height <= box.top - 8);
    }
  }
});

test('edge and zoomed visual viewports omit sides with no usable room', () => {
  const regions = tooltipRegions({ left: 50, right: 94, top: 60, bottom: 104 }, {
    left: 50, top: 60, width: 320, height: 450,
  });
  assert.deepEqual(regions.map((region) => region.side), ['bottom', 'right']);
  assert.ok(regions.every((region) => region.left >= 58 && region.top >= 68
    && region.left + region.width <= 362 && region.top + region.height <= 502));
});

// #855. Done near the top of a phone with its result showing, as measured at 412x915 with 200 per cent
// text: no room above, the result directly below, and only slivers beside a full-width button.
const done = { left: 41, right: 371, top: 60, bottom: 134 };
const result = { left: 41, right: 371, top: 146, bottom: 414 };
const phone = tooltipRegions(done, { width: 412, height: 915 });
// A three-line hint 330px wide fits only a side that is at least that wide and tall; it lands where
// tooltips.js puts it, against Done on that side.
function measure(region) {
  const fits = region.width >= 330 && region.height >= 119;
  const width = Math.min(330, region.width);
  const height = fits ? 119 : Math.min(region.height, 2000);
  const left = region.side === 'right' ? done.right + 8 : region.side === 'left' ? done.left - 8 - width : region.left;
  const top = region.side === 'top' ? done.top - 8 - height : region.side === 'bottom' ? done.bottom + 8 : region.top;
  return { fits, spot: { left, top, right: left + width, bottom: top + height } };
}

test('855 without content to keep clear, a hint goes where it always has', () => {
  assert.deepEqual(phone.map((region) => region.side), ['top', 'bottom', 'right', 'left']);
  assert.equal(tooltipPlacement(phone, measure).side, 'bottom', 'the first side where it fits');
  assert.equal(tooltipPlacement(phone, measure, [{ left: 0, right: 412, top: 600, bottom: 700 }]).side, 'bottom',
    'kept content its spot does not touch changes nothing');
  const cramped = (region) => ({ fits: false, spot: measure(region).spot });
  assert.equal(tooltipPlacement(phone, cramped).side, 'bottom', 'when it fits nowhere, the roomiest side, as before');
});

test('855 a hint whose spot is over the Done result gives way rather than moving to another side', () => {
  assert.equal(tooltipPlacement(phone, measure, [result]), null, 'not over the result');
  const roomy = (region) => (region.side === 'right'
    ? { fits: true, spot: { left: done.right + 8, top: 70, right: done.right + 108, bottom: 100 } } : measure(region));
  assert.equal(tooltipPlacement(phone, roomy, [result]), null,
    'nor moved beside its control, where it would sit on whatever is there');
  const cramped = (region) => ({ fits: false, spot: measure(region).spot });
  assert.equal(tooltipPlacement(phone, cramped, [result]), null,
    'nor squeezed into a sliver when its roomiest side is over the result');
});

// #860. Read above Done at 390px, as measured on 2026-10-25: Done's hint fitted above Done, over the
// lower part of Read, and below Done the page was clear. Beside a full-width button the only other
// room is a 17px sliver, where a hint that may wrap anywhere fits only as a column.
const read = { left: 33, right: 357, top: 506, bottom: 561 };
const doneStacked = { left: 33, right: 357, top: 573, bottom: 621 };
const stacked = tooltipRegions(doneStacked, { width: 390, height: 844 });
// A 300 by 26 hint, wrapped onto as many lines as a narrower side forces, placed against its control
// as tooltips.js places it.
function hint(box, width = 300, height = 26) {
  return (region) => {
    const w = Math.min(width, region.width);
    const h = Math.ceil(width / w) * height;
    const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
    let left = clamp(box.left + (box.right - box.left - w) / 2, region.left, region.left + region.width - w);
    let top = clamp(box.top + (box.bottom - box.top - h) / 2, region.top, region.top + region.height - h);
    if (region.side === 'top') top = box.top - 8 - h;
    if (region.side === 'bottom') top = box.bottom + 8;
    if (region.side === 'left') left = box.left - 8 - w;
    if (region.side === 'right') left = box.right + 8;
    return { fits: h <= region.height, spot: { left, top, right: left + w, bottom: top + h } };
  };
}
const doneHint = hint(doneStacked);

test('860 a hint over another command in its group moves to the next side where it fits as wide', () => {
  assert.deepEqual(stacked.map((region) => region.side), ['top', 'bottom', 'right', 'left']);
  assert.equal(tooltipPlacement(stacked, doneHint).side, 'top', 'outside a group, over Read as before');
  assert.equal(tooltipPlacement(stacked, doneHint, [], [read]).side, 'bottom', 'in the group, below Done instead');
});

test('860 a moved hint takes no narrower side, and none over kept content or another command in its group', () => {
  const sliver = doneHint(stacked[2]);
  assert.ok(sliver.fits && sliver.spot.right - sliver.spot.left === 17, 'the sliver beside Done holds the hint only as a column');
  const result = { left: 33, right: 357, top: 633, bottom: 740 };
  assert.equal(tooltipPlacement(stacked, doneHint, [result], [read]), null,
    'with the result below Done, no side is clear of both, so the hint gives way');
  const below = { left: 33, right: 357, top: 633, bottom: 681 };
  assert.equal(tooltipPlacement(stacked, doneHint, [], [read, below]), null, 'nor onto another command of its group');
});

test('860 kept content under the usual spot still wins: the hint gives way rather than moving', () => {
  const strip = { left: 33, right: 357, top: 562, bottom: 572 };
  assert.equal(tooltipPlacement(stacked, doneHint, [strip], [read]), null);
});

test('860 a hint that fits nowhere moves only to a side where it fits', () => {
  const cramped = (region) => ({ fits: false, spot: doneHint(region).spot });
  assert.equal(tooltipPlacement(stacked, cramped).side, 'top', 'outside a group, the roomiest side as before');
  assert.equal(tooltipPlacement(stacked, cramped, [], [read]), null, 'in the group, with no side clear of Read');
});

test('860 side by side at 1280px, the group changes nothing', () => {
  const readWide = { left: 465, right: 539, top: 332, bottom: 380 };
  const doneWide = { left: 547, right: 623, top: 332, bottom: 380 };
  const regions = tooltipRegions(readWide, { width: 1280, height: 900 });
  assert.equal(tooltipPlacement(regions, hint(readWide, 153), [], [doneWide]).side, 'top');
});
