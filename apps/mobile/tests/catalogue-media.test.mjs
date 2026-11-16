import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogueMediaUrl} from '../src/catalogue-media-url.ts';

const api = 'http://127.0.0.1:8000/api/v1';
const key = 'a5482366-e437-4cc6-a77d-a357ab2354ef';
const url = 'http://127.0.0.1:8000/media/catalogue/' + key;

test('official media accepts only the configured origin and versioned catalogue path', () => {
  assert.equal(catalogueMediaUrl(api, url)?.href, url);
  for (const reference of [
    null, 'garbage', 'https://example.test/media/catalogue/' + key,
    'http://127.0.0.1:5173/media/catalogue/' + key, url + '?arbitrary=1',
    'http://127.0.0.1:8000/media/private_uploads/company.pdf',
  ]) assert.equal(catalogueMediaUrl(api, reference), null);
});

test('catalogue thumbnails resolve through the configured API host on Android', () => {
  const emulator = 'http://10.0.2.2:8000/api/v1';
  const path = '/media/catalogue/' + key;
  assert.equal(catalogueMediaUrl(emulator, path)?.href, 'http://10.0.2.2:8000' + path);
  assert.equal(catalogueMediaUrl(emulator, url)?.href, 'http://10.0.2.2:8000' + path);
  assert.equal(catalogueMediaUrl(api, 'http://localhost:8000' + path)?.href, url);
  assert.equal(catalogueMediaUrl(emulator, '//127.0.0.1:8000' + path), null);
  assert.equal(catalogueMediaUrl(emulator, 'http://127.0.0.1:8001' + path), null);
});
