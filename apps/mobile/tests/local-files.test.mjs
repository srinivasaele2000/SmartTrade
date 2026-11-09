import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLocalFileRecords, recordsFor, safeFileName, selectedFileName } from '../src/local-file-model.ts';

test('local file metadata stays separate and scoped by category and owner', () => {
  const records = parseLocalFileRecords(JSON.stringify([
    { id: '1', category: 'company_document', ownerKey: 'company-1', displayName: 'gst.pdf', mimeType: 'application/pdf', size: 20, uri: 'file:///private/content/1', createdAt: '2026-01-01T00:00:00Z' },
    { id: '2', category: 'product_image', ownerKey: 'product-1', displayName: 'drill.png', mimeType: 'image/png', size: 30, uri: 'file:///private/content/2', createdAt: '2026-01-02T00:00:00Z' },
  ]));
  assert.equal(recordsFor(records, 'company_document', 'company-1').length, 1);
  assert.equal(recordsFor(records, 'company_document', 'product-1').length, 0);
  assert.equal(Object.hasOwn(records[0], 'contents'), false);
});

test('unsafe filenames are normalized and damaged metadata fails closed', () => {
  assert.equal(safeFileName('../../GST proof (final).pdf'), '_.._GST_proof__final_.pdf');
  assert.throws(() => parseLocalFileRecords('{"not":"a list"}'), /damaged/);
  assert.throws(() => parseLocalFileRecords('[{"id":"1"}]'), /damaged/);
  assert.equal(selectedFileName('content://provider/document/36', 'application/pdf'), 'selected-file.pdf');
  assert.equal(selectedFileName('content://provider/document/report.png', 'image/png'), 'report.png');
});

test('mobile workflows use private durable storage and do not upload local documents', () => {
  const company = fs.readFileSync(new URL('../src/CompanyScreen.tsx', import.meta.url), 'utf8');
  const orders = fs.readFileSync(new URL('../src/OrderWorkspace.tsx', import.meta.url), 'utf8');
  const storage = fs.readFileSync(new URL('../src/local-files.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(company, /uploadDocument|Select and upload document/);
  assert.match(company, /Device-only documents cannot be submitted/);
  assert.match(orders, /downloadApiFile/);
  assert.doesNotMatch(orders, /cacheDirectory/);
  assert.match(storage, /documentDirectory/);
});

test('sessions use secure storage and logout removes persisted credentials', () => {
  const session = fs.readFileSync(new URL('../src/session.tsx', import.meta.url), 'utf8');
  assert.match(session, /expo-secure-store/);
  assert.match(session, /setItemAsync\(SESSION_KEY/);
  assert.match(session, /deleteItemAsync\(SESSION_KEY/);
  assert.doesNotMatch(session, /AsyncStorage|writeAsStringAsync/);
});
