import test from 'node:test';
import assert from 'node:assert/strict';
import { apkDownloadUrl, loadApkMetadata } from '../src/apkDownload.ts';

test('APK metadata uses the public same-origin route and handles no release', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, {status: 404}));
  assert.equal(await loadApkMetadata(), null);
  assert.equal(fetch.mock.calls[0].arguments[0], '/downloads/apk-meta.json');
  assert.equal(fetch.mock.calls[0].arguments[1].cache, 'no-store');
  assert.equal(apkDownloadUrl, '/downloads/SmartTrade-latest.apk');

  const release = {version: '0.1.0', filename: 'SmartTrade-latest.apk', sizeBytes: 1024,
    updatedAt: '2026-11-16T00:00:00Z'};
  fetch.mock.mockImplementation(async () => Response.json(release));
  assert.deepEqual(await loadApkMetadata(), {version: release.version, updatedAt: release.updatedAt});
  fetch.mock.mockImplementation(async () => Response.json({...release, filename: 'other.apk'}));
  assert.equal(await loadApkMetadata(), null);
});
