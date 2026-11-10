import assert from 'node:assert/strict';
import test from 'node:test';
import {validateCatalogueImage} from '../src/catalogueImageValidation.ts';

test('a JPEG named .png gets rename guidance before browser decoding', async () => {
  const file = new File([Uint8Array.of(0xff, 0xd8, 0xff)], 'image.png', {type: 'image/png'});
  await assert.rejects(validateCatalogueImage(file), /JPEG saved with a \.png extension.*rename it to \.jpg/);
});

test('the image dimension boundary is inclusive', async (t) => {
  const file = new File([Uint8Array.of(0xff, 0xd8, 0xff)], 'image.jpg', {type: 'image/jpeg'});
  const previousImage = globalThis.Image;
  let width = 4096;
  globalThis.Image = class {
    naturalWidth = width;
    naturalHeight = 1080;
    async decode() {}
  };
  t.after(() => { globalThis.Image = previousImage; });
  await validateCatalogueImage(file);
  width = 4097;
  await assert.rejects(validateCatalogueImage(file), /4097 × 1080 px.*4096 × 4096 px/);
});
