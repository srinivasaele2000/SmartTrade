import {storedWebFile} from './local-files.web';

export async function openLocalPdf(uri: string) {
  const {blob, record} = await storedWebFile(uri);
  const url = URL.createObjectURL(blob);
  try {
    const previewable = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(record.mimeType);
    if (previewable) {
      const viewer = window.open('', '_blank');
      if (viewer) {
        viewer.opener = null;
        viewer.location.replace(url);
        return;
      }
    }
    // Browsers can block new tabs after an asynchronous download.
    const link = document.createElement('a');
    link.href = url;
    link.download = record.displayName;
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
