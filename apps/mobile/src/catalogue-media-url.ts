export function catalogueMediaUrl(apiBase: string, reference?: string | null): URL | null {
  if (!reference || reference.startsWith('//')) return null;
  try {
    const api = new URL(apiBase);
    const file = new URL(reference, api.origin);
    if (
      !['https:', 'http:'].includes(api.protocol) || !['https:', 'http:'].includes(file.protocol) ||
      file.username || file.password || file.search || file.hash ||
      !/^\/media\/catalogue\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(file.pathname)
    ) return null;
    if (file.origin === api.origin) return file;
    // Development responses may advertise the server's loopback address.
    // Fetch the public attachment through the same host used for API calls.
    if (file.protocol === api.protocol && file.port === api.port &&
        ['localhost', '127.0.0.1', '[::1]'].includes(file.hostname)) {
      return new URL(file.pathname, api.origin);
    }
    return null;
  } catch {
    return null;
  }
}
