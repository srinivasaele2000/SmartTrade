import {Button} from './Button';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { deleteLocalFile, importLocalFile, localFiles, moveLocalFileScope } from './local-files';
import { selectedFileName, type LocalFileCategory, type LocalFileStatus } from './local-file-model';


export default function LocalFileVault({ category, ownerKey, legacyOwnerKey, title, description, allowedMimeTypes, maxBytes, selectable = true }: { category: LocalFileCategory; ownerKey: string; legacyOwnerKey?: string; title: string; description: string; allowedMimeTypes?: string[]; maxBytes?: number; selectable?: boolean }) {
  const [files, setFiles] = useState<LocalFileStatus[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const refresh = useCallback(async () => { setLoading(true); setError(''); try { if (legacyOwnerKey) await moveLocalFileScope(category, legacyOwnerKey, ownerKey); setFiles(await localFiles(category, ownerKey)); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Local files could not be loaded.'); } finally { setLoading(false); } }, [category, ownerKey, legacyOwnerKey]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function pick() {
    setBusy(true); setError(''); setNotice('');
    try {
      const picked = await File.pickFileAsync({ mimeTypes: allowedMimeTypes?.length ? allowedMimeTypes : '*/*' });
      if (!picked.canceled) {
        const selected = picked.result;
        const name = selectedFileName(selected.uri, selected.type || 'application/octet-stream');
        await importLocalFile({ uri: selected.uri, name, mimeType: selected.type || undefined, size: selected.size, bytes: await selected.bytes() }, category, ownerKey, { allowedMimeTypes, maxBytes });
        setNotice('Saved only in this device’s private SmartTrade storage.'); await refresh();
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'File selection failed.'); }
    finally { setBusy(false); }
  }
  async function open(file: LocalFileStatus) {
    setError(''); setNotice(''); setBusy(true);
    try {
      const current = await localFiles(category, ownerKey);
      if (!file.exists || !current.find(item => item.id === file.id)?.exists) { setError('This local file is missing. Remove its metadata or select the file again.'); return; }
      if (!await Sharing.isAvailableAsync()) { setError('No compatible local viewer is available on this device.'); return; }
      await Sharing.shareAsync(file.uri, { mimeType: file.mimeType, dialogTitle: `Open ${file.displayName}` });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The local file could not be opened.'); }
    finally { setBusy(false); }
  }
  function remove(file: LocalFileStatus) {
    Alert.alert('Delete local file?', 'This removes the file only from this device. It cannot be recovered by SmartTrade.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { setBusy(true); void deleteLocalFile(file).then(() => { setNotice('Local file deleted.'); return refresh(); }).catch(caught => setError(caught instanceof Error ? caught.message : 'Local deletion failed.')).finally(() => setBusy(false)); } }]);
  }
  return <View style={s.card}><Text style={s.heading}>{title}</Text><Text style={s.body}>{description}</Text><Text style={s.warning}>LOCAL ONLY: these files are not uploaded, synchronized, backed up, or visible to SmartTrade staff or another device.</Text>{selectable && <Button variant="secondary" title="Select file for this device" disabled={busy} onPress={() => void pick()} />}{loading && <ActivityIndicator accessibilityLabel="Loading local files" />}{notice !== '' && <Text style={s.notice}>{notice}</Text>}{error !== '' && <><Text accessibilityRole="alert" style={s.error}>{error}</Text><Button variant="tertiary" icon="refresh" title="Retry local files" disabled={busy} onPress={() => void refresh()} /></>}{!loading && !error && files.length === 0 && <Text>No files saved on this device.</Text>}{files.map(file => <View style={s.file} key={file.id}><Text style={s.label}>{file.displayName}</Text><Text>{file.mimeType} · {Math.ceil(file.size / 1024)} KB</Text><Text>{file.exists ? 'Available offline on this device' : 'File missing; metadata retained'}</Text><View style={s.row}><Button variant="tertiary" icon="view" title={`Open ${file.displayName}`} disabled={busy || !file.exists} onPress={() => void open(file)} /><Button variant="destructive" icon="delete" loading={Boolean(busy)} title={`Delete ${file.displayName}`} disabled={busy} onPress={() => remove(file)} /></View></View>)}</View>;
}
const s = StyleSheet.create({ card: { backgroundColor: '#fff', padding: 18, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: '#dce7e0' }, heading: { fontSize: 19, fontWeight: '700', color: '#17392d' }, body: { color: '#52675c', lineHeight: 22 }, warning: { backgroundColor: '#fff4d6', color: '#694d00', padding: 10, lineHeight: 20 },    file: { borderTopWidth: 1, borderColor: '#dce7e0', paddingTop: 10, gap: 7 }, label: { fontWeight: '700', color: '#294b3a' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, notice: { color: '#126743' }, error: { color: '#9c2820' } });
