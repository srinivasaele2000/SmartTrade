import {Platform} from 'react-native';
import {getContentUriAsync} from 'expo-file-system/legacy';
import {startActivityAsync} from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';

export async function openLocalPdf(fileUri: string): Promise<void> {
  const mimeType = 'application/pdf';
  if (Platform.OS === 'android') {
    const contentUri = await getContentUriAsync(fileUri);
    const grantReadUriPermission = 1;
    try {
      await startActivityAsync('android.intent.action.VIEW', {
        data: contentUri, type: mimeType, flags: grantReadUriPermission,
      });
    } catch {
      throw new Error('The PDF is saved on this device. Install a PDF viewer to open it.');
    }
    return;
  }

  if (!await Sharing.isAvailableAsync()) {
    throw new Error('The PDF is saved on this device. A document viewer is unavailable.');
  }
  await Sharing.shareAsync(fileUri, {mimeType});
}
