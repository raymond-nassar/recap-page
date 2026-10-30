import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanReleaseApp } from '../packaging/ios/check-release-surface.mjs';

test('iOS Release surface requires a nonempty app and executable and scans binary resources', () => {
  const root = mkdtempSync(join(tmpdir(), 'recap-ios-release-surface-'));
  try {
    const app = join(root, 'RecapPage.app');
    assert.throws(() => scanReleaseApp(app), /app.*missing/i);
    mkdirSync(app);
    assert.throws(() => scanReleaseApp(app), /executable.*missing/i);
    const executable = join(app, 'RecapPage');
    writeFileSync(executable, '');
    assert.throws(() => scanReleaseApp(app), /executable.*empty/i);
    writeFileSync(executable, Buffer.from([0, 1, 2, 3]));
    assert.equal(scanReleaseApp(app).files, 1);
    for (const identifier of ['__recapPassiveGuard', 'passiveAuditTrackingScript']) {
      const resource = join(app, 'Assets', 'nested');
      mkdirSync(resource, { recursive: true });
      const file = join(resource, 'resource.bin');
      for (const encoded of [Buffer.from(identifier), Buffer.from(identifier, 'utf16le'),
        Buffer.from(identifier, 'utf16le').swap16()]) {
        writeFileSync(file, Buffer.concat([Buffer.from([0, 255]), encoded, Buffer.from([0, 128])]));
        assert.throws(() => scanReleaseApp(app), /Debug passive-audit instrumentation/);
      }
      writeFileSync(file, Buffer.from([0, 1]));
      writeFileSync(executable, Buffer.concat([Buffer.from([0]), Buffer.from(identifier)]));
      assert.throws(() => scanReleaseApp(app), /Debug passive-audit instrumentation/);
      writeFileSync(executable, Buffer.from([0, 1, 2, 3]));
    }
    assert.equal(scanReleaseApp(app).files, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
