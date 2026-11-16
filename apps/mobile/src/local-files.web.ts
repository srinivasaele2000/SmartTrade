import {resolveApiFileUrl} from './api-file-url';
import {offlineDocumentRecords, recordsFor, type LocalFileCategory, type LocalFileRecord} from './local-file-model';

type StoredFile = {record: LocalFileRecord; blob: Blob};
const prefix = 'smarttrade-file:';
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('smarttrade-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files', {keyPath: 'record.id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database.catch(() => {
    database = undefined;
    throw new Error('Browser storage is unavailable. Check your privacy settings and try again.');
  });
}

async function read<T>(select: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = select(db.transaction('files').objectStore('files'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Saved files could not be read.'));
  });
}

async function write(update: (store: IDBObjectStore) => void) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error('Browser storage could not be updated. Free space or check your settings and retry.'));
    update(transaction.objectStore('files'));
  });
}

async function allRecords(): Promise<LocalFileRecord[]> {
  const db = await openDatabase();
  // Read through a cursor to keep only metadata in memory.
  return new Promise((resolve, reject) => {
    const records: LocalFileRecord[] = [];
    const request = db.transaction('files').objectStore('files').openCursor();
    request.onerror = () => reject(new Error('Saved files could not be read.'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(records); return; }
      records.push((cursor.value as StoredFile).record);
      cursor.continue();
    };
  });
}

function status(record: LocalFileRecord) {
  return {...record, exists: true};
}

function saveFile(blob: Blob, name: string, category: LocalFileCategory, ownerKey: string, mimeType: string, title?: string) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const record: LocalFileRecord = {id, category, ownerKey, displayName: name, mimeType, size: blob.size, uri: prefix + id, createdAt: new Date().toISOString(), title};
  return write(store => { store.add({record, blob}); }).then(() => record);
}

export async function localFiles(category: LocalFileCategory, ownerKey: string) {
  return recordsFor(await allRecords(), category, ownerKey).map(status);
}

export async function offlineDocuments(accountId: number) {
  return offlineDocumentRecords(await allRecords(), accountId).map(status);
}

export async function moveLocalFileScope(category: LocalFileCategory, fromOwnerKey: string, toOwnerKey: string) {
  if (!fromOwnerKey || fromOwnerKey === toOwnerKey) return;
  await write(store => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const file = cursor.value as StoredFile;
      if (file.record.category === category && file.record.ownerKey === fromOwnerKey) {
        cursor.update({...file, record: {...file.record, ownerKey: toOwnerKey}});
      }
      cursor.continue();
    };
  });
}

export async function importLocalFile(input: {uri: string; name: string; mimeType?: string; size?: number; bytes?: Uint8Array}, category: LocalFileCategory, ownerKey: string, options: {allowedMimeTypes?: string[]; maxBytes?: number} = {}) {
  const mimeType = input.mimeType || 'application/octet-stream';
  if (options.allowedMimeTypes?.length && !options.allowedMimeTypes.includes(mimeType)) throw new Error('This file type is not allowed.');
  if (options.maxBytes && input.size && input.size > options.maxBytes) throw new Error('The selected file exceeds the configured size limit.');
  const blob = input.bytes
    ? new Blob([new Uint8Array(input.bytes)], {type: mimeType})
    : await (await fetch(input.uri)).blob();
  if (!blob.size) throw new Error('The selected file is empty.');
  if (options.maxBytes && blob.size > options.maxBytes) throw new Error('The selected file exceeds the configured size limit.');
  return saveFile(blob, input.name, category, ownerKey, mimeType);
}

export function downloadApiFile(base: string, reference: string, headers: Record<string, string>, name: string, category: LocalFileCategory, ownerKey: string, mimeType: string) {
  return downloadLocalFile(resolveApiFileUrl(base, reference), headers, name, category, ownerKey, mimeType);
}

export async function downloadLocalFile(url: string, headers: Record<string, string>, name: string, category: LocalFileCategory, ownerKey: string, mimeType: string, title?: string) {
  const existing = (await localFiles(category, ownerKey)).find(record => record.displayName === name);
  if (existing) return existing;
  const response = await fetch(url, {headers, redirect: 'error'});
  if (!response.ok) throw new Error(`File download failed (${response.status}).`);
  const blob = await response.blob();
  if (!blob.size || blob.type.split(';')[0] !== mimeType) throw new Error('The requested document could not be downloaded.');
  return saveFile(blob, name, category, ownerKey, mimeType, title);
}

export async function deleteLocalFile(record: LocalFileRecord) {
  if (record.uri !== prefix + record.id) throw new Error('This file is outside SmartTrade browser storage.');
  await write(store => { store.delete(record.id); });
}

export async function storedWebFile(uri: string) {
  if (!/^smarttrade-file:[a-f0-9]{32}$/.test(uri)) throw new Error('This saved file is unavailable.');
  const file = await read<StoredFile | undefined>(store => store.get(uri.slice(prefix.length)));
  if (!file) throw new Error('This saved file is missing. Save a new copy and try again.');
  return file;
}
