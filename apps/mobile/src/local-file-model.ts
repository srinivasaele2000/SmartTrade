export type LocalFileCategory = 'company_document' | 'dealer_document' | 'product_image' | 'invoice';
export type LocalFileRecord = {
  id: string;
  category: LocalFileCategory;
  ownerKey: string;
  displayName: string;
  mimeType: string;
  size: number;
  uri: string;
  createdAt: string;
};
export type LocalFileStatus = LocalFileRecord & { exists: boolean };

const categories = new Set<LocalFileCategory>(['company_document', 'dealer_document', 'product_image', 'invoice']);
export function safeFileName(value: string) {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(-120);
  return cleaned || 'file';
}
export function selectedFileName(uri: string, mimeType: string) {
  const raw = decodeURIComponent(uri.split('/').pop() || 'selected-file');
  const candidate = raw.split(/[/:]/).pop() || 'selected-file';
  if (/\.[A-Za-z0-9]{1,8}$/.test(candidate)) return candidate;
  const extension: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
  return `selected-file.${extension[mimeType] || 'bin'}`;
}
export function parseLocalFileRecords(value: string): LocalFileRecord[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Local file metadata is damaged. Files were not deleted.');
  return parsed.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Local file metadata is damaged. Files were not deleted.');
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || !categories.has(record.category as LocalFileCategory) || typeof record.ownerKey !== 'string' || typeof record.displayName !== 'string' || typeof record.mimeType !== 'string' || typeof record.size !== 'number' || record.size < 0 || typeof record.uri !== 'string' || typeof record.createdAt !== 'string') throw new Error('Local file metadata is damaged. Files were not deleted.');
    return record as LocalFileRecord;
  });
}
export function recordsFor(records: LocalFileRecord[], category: LocalFileCategory, ownerKey: string) {
  return records.filter(record => record.category === category && record.ownerKey === ownerKey).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
