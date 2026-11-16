export const apkDownloadUrl = '/downloads/SmartTrade-latest.apk';

export async function loadApkMetadata(signal?: AbortSignal) {
  const response = await fetch('/downloads/apk-meta.json', {signal, cache: 'no-store'});
  if (!response.ok) return null;
  const data = await response.json();
  if (!data || data.filename !== 'SmartTrade-latest.apk' || typeof data.version !== 'string' ||
      !data.version.trim() || !Number.isSafeInteger(data.sizeBytes) || data.sizeBytes <= 0 ||
      typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) return null;
  return {version: data.version as string, updatedAt: data.updatedAt as string};
}
