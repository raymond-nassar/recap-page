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
