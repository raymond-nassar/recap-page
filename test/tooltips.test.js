import test from 'node:test';
import assert from 'node:assert/strict';
import { tooltipRegions } from '../src/js/lib/tooltips.js';

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
