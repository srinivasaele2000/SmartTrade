import * as Print from 'expo-print';

export async function printSavedPdf(uri: string) {
  await Print.printAsync({uri});
}
