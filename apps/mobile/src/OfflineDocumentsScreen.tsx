import {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, AppState, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {FileText} from 'lucide-react-native';
import {Button} from './Button';
import {istDateTime} from './india';
import {fileSizeLabel, offlineDocumentTitle, type LocalFileStatus} from './local-file-model';
import {deleteLocalFile, offlineDocuments} from './local-files';
import {openLocalPdf} from './open-local-pdf';

export default function OfflineDocumentsScreen({accountId}: {accountId: number}) {
  const {bottom} = useSafeAreaInsets();
  const [files, setFiles] = useState<LocalFileStatus[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(''), [actionError, setActionError] = useState('');
  const readVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++readVersion.current;
    setLoading(true); setLoadError('');
    try {
      const latest = await offlineDocuments(accountId);
      if (readVersion.current === version) setFiles(latest);
    }
    catch {if (readVersion.current === version) setLoadError('We couldn’t load your offline documents. Please try again.');}
    finally {if (readVersion.current === version) setLoading(false);}
  }, [accountId]);
  useEffect(() => {
    void refresh();
    const listener = AppState.addEventListener('change', state => {if (state === 'active') void refresh();});
    return () => {readVersion.current++; listener.remove();};
  }, [refresh]);

  async function open(file: LocalFileStatus) {
    setBusy(true); setActionError('');
    try {
      const saved = (await offlineDocuments(accountId)).find(item => item.id === file.id && item.exists);
      if (!saved) {await refresh(); throw new Error('This file is missing. Remove this entry or download the document again.');}
      await openLocalPdf(saved.uri);
    } catch (error) {setActionError(error instanceof Error ? error.message : 'We couldn’t open this document.');}
    finally {setBusy(false);}
  }

  function remove(file: LocalFileStatus) {
    Alert.alert('Remove offline copy?', 'This removes the saved copy from this device.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Remove', style: 'destructive', onPress: () => {
        setBusy(true); setActionError('');
        void deleteLocalFile(file).then(refresh).catch(() => {
          setActionError('We couldn’t remove this copy. Please try again.');
          void refresh();
        }).finally(() => setBusy(false));
      }},
    ]);
  }

  const saved = files.filter(file => file.exists);
  const stored = saved.reduce((total, file) => total + file.size, 0);
  return <ScrollView contentContainerStyle={[styles.content, {paddingBottom: Math.max(20, bottom + 8)}]}>
    <Text accessibilityRole="header" style={styles.title}>Offline Documents</Text>
    {loading && <ActivityIndicator accessibilityLabel="Loading offline documents" />}
    {loadError !== '' && <View style={styles.card}><Text accessibilityRole="alert">{loadError}</Text>
      <Button variant="tertiary" title="Try again" onPress={refresh} /></View>}
    {actionError !== '' && <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text>}
    {!loadError && (!loading || files.length > 0) && <>
      <View style={styles.summary}>
        <Text style={styles.summaryCount}>{saved.length} {saved.length === 1 ? 'document' : 'documents'} saved to your device</Text>
        <Text>Viewable without internet · {fileSizeLabel(stored)} stored offline</Text>
      </View>
      {files.length === 0 && <View style={styles.card}>
        <FileText size={32} color="#24734f" accessible={false} />
        <Text style={styles.heading}>No offline documents saved yet</Text>
        <Text>Save an invoice from Orders or open a product catalogue PDF to keep a copy here. For older invoice copies, open the original order once while online.</Text>
      </View>}
      {files.map(file => <View key={file.id} style={styles.card}>
        <View style={styles.row}>
          <FileText size={24} color="#24734f" accessible={false} />
          <Text style={styles.tag}>{file.category === 'invoice' ? 'Invoice PDF' : 'Catalogue PDF'}</Text>
        </View>
        <Text style={styles.heading}>{offlineDocumentTitle(file)}</Text>
        <Text>{file.exists ? fileSizeLabel(file.size) : 'File missing'} · Saved {istDateTime(file.createdAt)}</Text>
        <View style={styles.row}>
          <Button variant="primary" icon="view" title="Open" accessibilityLabel={`Open ${offlineDocumentTitle(file)}`}
            disabled={busy || !file.exists} onPress={() => open(file)} />
          <Button variant="secondary" icon="delete" title="Remove" accessibilityLabel={`Remove ${offlineDocumentTitle(file)}`}
            disabled={busy} onPress={() => remove(file)} />
        </View>
      </View>)}
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: {padding: 18, gap: 14}, title: {fontSize: 28, color: '#17392d', fontWeight: '800'},
  heading: {fontSize: 17, color: '#17392d', fontWeight: '800'},
  card: {backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#dce7e0', padding: 14, gap: 8},
  summary: {padding: 14, gap: 6, borderRadius: 14, backgroundColor: '#e0f3e7'},
  summaryCount: {fontSize: 16, color: '#14553e', fontWeight: '800'},
  row: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8},
  tag: {backgroundColor: '#edf2ef', color: '#294b3a', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10},
  error: {color: '#9c2820'},
});
