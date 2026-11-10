const formats = {
  JPEG: {extension: '.jpg', mime: 'image/jpeg'},
  PNG: {extension: '.png', mime: 'image/png'},
  WEBP: {extension: '.webp', mime: 'image/webp'},
} as const;

const extensions = {'.jpg': 'JPEG', '.jpeg': 'JPEG', '.png': 'PNG', '.webp': 'WEBP'} as const;
const maxDimension = 4096;
const unreadable = 'The uploaded file could not be recognized as a valid image. Please verify the file is not damaged.';

export async function validateCatalogueImage(file: File): Promise<void> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const startsWith = (signature: number[]) => signature.every((byte, index) => header[index] === byte);
  let format: keyof typeof formats;
  if (startsWith([0xff, 0xd8, 0xff])) format = 'JPEG';
  else if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) format = 'PNG';
  else if (startsWith([0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...header.slice(8, 12)) === 'WEBP') format = 'WEBP';
  else throw new Error(`${unreadable} Choose a JPEG, PNG or WebP image.`);

  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  const extensionFormat = extension && extensions[extension as keyof typeof extensions];
  const {extension: expectedExtension, mime} = formats[format];
  if (extensionFormat && extensionFormat !== format) {
    throw new Error(`This image appears to be a ${format} saved with a ${extension} extension. ` +
      `Please rename it to ${expectedExtension} or re-export as ${extensionFormat}.`);
  }
  if (file.type !== mime) {
    throw new Error(`This file contains a ${format} image. Save it with the ${expectedExtension} extension and select it again.`);
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => { throw new Error(unreadable); });
    const {naturalWidth: width, naturalHeight: height} = image;
    if (width > maxDimension || height > maxDimension) {
      throw new Error(`Image dimensions (${width} × ${height} px) exceed the maximum allowed size ` +
        `(${maxDimension} × ${maxDimension} px).`);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
