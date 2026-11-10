import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import {resolveApiFileUrl} from './api-file-url';
import { offlineDocumentRecords, parseLocalFileRecords, recordsFor, safeFileName, type LocalFileCategory, type LocalFileRecord, type LocalFileStatus } from './local-file-model';

const root = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}smarttrade-private/` : null;
const contentRoot = root ? `${root}content/` : null;
const metadataPath = root ? `${root}metadata.json` : null;
let mutation = Promise.resolve();

function configured() {
  if (!root || !contentRoot || !metadataPath) throw new Error('App-private device storage is unavailable.');
  return { root, contentRoot, metadataPath };
}
async function ensureStorage() {
  const paths = configured();
  await FileSystem.makeDirectoryAsync(paths.contentRoot, { intermediates: true });
  return paths;
}
async function readAll() {
  const paths = await ensureStorage();
  const info = await FileSystem.getInfoAsync(paths.metadataPath);
  if (!info.exists) return [];
  try { return parseLocalFileRecords(await FileSystem.readAsStringAsync(paths.metadataPath)); }
  catch (error) { throw error instanceof Error ? error : new Error('Local file metadata could not be read.'); }
}
async function writeAll(records: LocalFileRecord[]) {
  const paths = await ensureStorage();
  const temporary = `${paths.metadataPath}.new`;
  const backup = `${paths.metadataPath}.bak`;
  await FileSystem.writeAsStringAsync(temporary, JSON.stringify(records));
  const current = await FileSystem.getInfoAsync(paths.metadataPath);
  try {
    await FileSystem.deleteAsync(backup, { idempotent: true });
    if (current.exists) await FileSystem.copyAsync({ from: paths.metadataPath, to: backup });
    await FileSystem.deleteAsync(paths.metadataPath, { idempotent: true });
    await FileSystem.moveAsync({ from: temporary, to: paths.metadataPath });
    await FileSystem.deleteAsync(backup, { idempotent: true });
  } catch (error) {
    const saved = await FileSystem.getInfoAsync(backup);
    if (saved.exists) {
      await FileSystem.deleteAsync(paths.metadataPath, { idempotent: true });
      await FileSystem.moveAsync({ from: backup, to: paths.metadataPath });
    }
    await FileSystem.deleteAsync(temporary, { idempotent: true });
    throw error;
  }
}
function serialized<T>(operation: () => Promise<T>) {
  const next = mutation.then(operation, operation);
  mutation = next.then(() => undefined, () => undefined);
  return next;
}
async function availableFor(size: number) {
  const free = await FileSystem.getFreeDiskStorageAsync();
  if (free < size + 5 * 1024 * 1024) throw new Error('Insufficient device space. Free storage and retry.');
}
async function copyIntoPrivateStorage(source: string, target: string, bytes?: Uint8Array) {
  if (bytes) {
    try { const file = new File(target); file.create({ overwrite: true, intermediates: true }); await file.write(bytes); return; }
    catch { throw new Error('The selected file could not be copied into private storage. Select it again or choose another file.'); }
  }
  try { await FileSystem.copyAsync({ from: source, to: target }); }
  catch {
    try {
      const encoded = await FileSystem.readAsStringAsync(source, { encoding: FileSystem.EncodingType.Base64 });
      await FileSystem.writeAsStringAsync(target, encoded, { encoding: FileSystem.EncodingType.Base64 });
    } catch { throw new Error('The selected file could not be copied into private storage. Select it again or choose another file.'); }
  }
}
function destination(category: LocalFileCategory, name: string) {
  const paths = configured();
  return `${paths.contentRoot}${category}-${Date.now()}-${Math.random().toString(36).slice(2)}-${safeFileName(name)}`;
}
async function addRecord(record: LocalFileRecord, replaceNamed = false) {
  await serialized(async () => { let records = await readAll(); if (replaceNamed) records = records.filter(item => !(item.category === record.category && item.ownerKey === record.ownerKey && item.displayName === record.displayName)); records.push(record); await writeAll(records); });
  return record;
}
export async function localFiles(category: LocalFileCategory, ownerKey: string): Promise<LocalFileStatus[]> {
  const records = recordsFor(await readAll(), category, ownerKey);
  return Promise.all(records.map(async record => ({ ...record, exists: (await FileSystem.getInfoAsync(record.uri)).exists })));
}

export async function offlineDocuments(accountId: number): Promise<LocalFileStatus[]> {
  const {contentRoot} = configured();
  const records = offlineDocumentRecords(await readAll(), accountId).filter(record =>
    record.uri.startsWith(contentRoot) && /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(record.uri.slice(contentRoot.length)));
  return Promise.all(records.map(async record => {
    const info = await FileSystem.getInfoAsync(record.uri);
    const exists = info.exists && !info.isDirectory;
    return {...record, exists, size: exists && 'size' in info ? info.size : 0};
  }));
}
export async function moveLocalFileScope(category: LocalFileCategory, fromOwnerKey: string, toOwnerKey: string) {
  if (!fromOwnerKey || fromOwnerKey === toOwnerKey) return;
  await serialized(async () => {
    const records = await readAll();
    if (!records.some(item => item.category === category && item.ownerKey === fromOwnerKey)) return;
    await writeAll(records.map(item => item.category === category && item.ownerKey === fromOwnerKey ? { ...item, ownerKey: toOwnerKey } : item));
  });
}
export async function importLocalFile(input: { uri: string; name: string; mimeType?: string; size?: number; bytes?: Uint8Array }, category: LocalFileCategory, ownerKey: string, options: { allowedMimeTypes?: string[]; maxBytes?: number } = {}) {
  if (!input.uri || !input.name) throw new Error('The selected file is invalid.');
  const mimeType = input.mimeType || 'application/octet-stream';
  if (options.allowedMimeTypes?.length && !options.allowedMimeTypes.includes(mimeType)) throw new Error('This file type is not allowed.');
  const source = await FileSystem.getInfoAsync(input.uri);
  if (!source.exists) throw new Error('The selected file is no longer available. Select it again.');
  const size = input.size ?? ('size' in source && typeof source.size === 'number' ? source.size : 0);
  if (size <= 0) throw new Error('The selected file is empty or its size cannot be determined.');
  if (options.maxBytes && size > options.maxBytes) throw new Error('The selected file exceeds the configured size limit.');
  await availableFor(size);
  await ensureStorage();
  const uri = destination(category, input.name);
  await copyIntoPrivateStorage(input.uri, uri, input.bytes);
  const record: LocalFileRecord = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, category, ownerKey, displayName: input.name, mimeType, size, uri, createdAt: new Date().toISOString() };
  try { const saved = await addRecord(record); if (FileSystem.cacheDirectory && input.uri.startsWith(FileSystem.cacheDirectory)) await FileSystem.deleteAsync(input.uri, { idempotent: true }); return saved; }
  catch (error) { await FileSystem.deleteAsync(uri, { idempotent: true }); throw error; }
}
export function downloadApiFile(base:string, reference:string, headers:Record<string,string>, name:string, category:LocalFileCategory, ownerKey:string, mimeType:string) {
  return downloadLocalFile(resolveApiFileUrl(base,reference),headers,name,category,ownerKey,mimeType);
}
export async function downloadLocalFile(url: string, headers: Record<string, string>, name: string, category: LocalFileCategory, ownerKey: string, mimeType: string, title?: string) {
  const existing = recordsFor(await readAll(), category, ownerKey).find(record => record.displayName === name);
  if (existing && (await FileSystem.getInfoAsync(existing.uri)).exists) return existing;
  await ensureStorage(); await availableFor(1);
  const uri = destination(category, name);
  try {
    const result = await FileSystem.downloadAsync(url, uri, { headers });
    if (result.status !== 200) throw new Error(`File download failed (${result.status}).`);
    const info = await FileSystem.getInfoAsync(uri);
    const size = info.exists && 'size' in info && typeof info.size === 'number' ? info.size : 0;
    if (!size) throw new Error('The downloaded file is empty.');
    const record: LocalFileRecord = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, category, ownerKey, displayName: name, mimeType, size, uri, createdAt: new Date().toISOString(), title };
    return await addRecord(record, true);
  }
  catch (error) { await FileSystem.deleteAsync(uri, { idempotent: true }); throw error; }
}
export async function deleteLocalFile(record: LocalFileRecord) {
  const paths = configured();
  if (!record.uri.startsWith(paths.contentRoot)) throw new Error('Refusing to delete a file outside SmartTrade private storage.');
  await serialized(async () => {
    await FileSystem.deleteAsync(record.uri, { idempotent: true });
    await writeAll((await readAll()).filter(item => item.id !== record.id));
  });
}
