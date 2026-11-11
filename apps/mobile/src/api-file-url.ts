/** Resolve backend file references without forwarding credentials outside the API. */
export function resolveApiFileUrl(base: string, reference: string, kind = 'invoice'): string {
  let api: URL, file: URL;
  try {
    api = new URL(base);
    file = new URL(reference, `${api.origin}/`);
  } catch { throw new Error(`The ${kind} download URL is invalid.`); }
  const root = api.pathname.replace(/\/+$/, '');
  if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.search || api.hash ||
      file.origin !== api.origin || file.username || file.password || file.hash ||
      !file.pathname.startsWith(`${root}/`) || /%(?:2f|5c)/i.test(file.pathname) || reference.includes('\\')) {
    throw new Error(`The ${kind} download URL must remain within the configured API.`);
  }
  return file.href;
}
