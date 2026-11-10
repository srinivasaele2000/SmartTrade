export function catalogueMediaUrl(apiBase: string, reference?: string | null): URL | null {
  if (!reference) return null;
  try {
    const api = new URL(apiBase);
    const file = new URL(reference);
    if (
      !['https:', 'http:'].includes(file.protocol) || file.origin !== api.origin ||
      file.username || file.password || file.search || file.hash ||
      !/^\/media\/catalogue\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(file.pathname)
    ) return null;
    return file;
  } catch {
    return null;
  }
}
