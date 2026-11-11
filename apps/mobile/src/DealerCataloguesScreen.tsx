import {useCallback, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Image} from 'expo-image';
import {FileText, ImageIcon} from 'lucide-react-native';
import {Button} from './Button';
import {onboardingStyles as s} from './DealerWorkerContactsScreen';
import {type ApiClient} from './api';
import {businessTypes, catalogueDocumentLabel, targetedCatalogues, type BusinessType, type VaultDocument} from './dealer-onboarding';
import {istDateTime} from './india';
import {downloadLocalFile} from './local-files';
import {openLocalPdf} from './open-local-pdf';
import {useHistoryPage} from './useHistoryPage';

function CatalogueCard({item}: {item: VaultDocument}) {
  const [expanded, setExpanded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [error, setError] = useState('');
  const pdf = item.content_type === 'application/pdf';
  async function view() {
    setError('');
    if (!pdf) {
      setImageFailed(false);
      setExpanded(value => !value);
      return;
    }
    try {
      const file = await downloadLocalFile(item.url, {}, 'Brand-Catalogue-' + item.key + '.pdf',
        'catalogue_pdf', 'vault-' + item.key, 'application/pdf', item.title);
      await openLocalPdf(file.uri);
    } catch (failure) {setError(failure instanceof Error ? failure.message : 'Could not open this catalogue.');}
  }
  return <View style={s.card}>
    <View style={s.row}>
      {pdf ? <FileText color="#14553e" /> : <ImageIcon color="#14553e" />}
      <Text style={s.kicker}>{item.brand_name}</Text>
    </View>
    <Text style={s.label}>{item.title}</Text>
    <Text style={s.body}>{catalogueDocumentLabel(item)} · {istDateTime(item.created_at)}</Text>
    {!pdf && expanded && (imageFailed
      ? <Text accessibilityRole="alert" style={s.error}>The preview could not load. Close it and try again.</Text>
      : <Image source={{uri: item.url}} style={styles.preview} cachePolicy="memory-disk" contentFit="contain"
          accessibilityLabel={item.title + ' preview'} accessible onError={() => setImageFailed(true)} />)}
    {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <Button variant="secondary" title={expanded ? 'Close preview' : 'View Catalogue'} icon={expanded ? 'close' : 'view'} onPress={view} />
  </View>;
}

export default function DealerCataloguesScreen({api, token, type}: {api: ApiClient; token: string; type: BusinessType}) {
  const {bottom} = useSafeAreaInsets();
  const load = useCallback((page: number, signal: AbortSignal) => targetedCatalogues(api, token, type, page, signal), [api, token, type]);
  const page = useHistoryPage(load);
  const {state} = page;
  return <ScrollView contentContainerStyle={[s.content, {paddingBottom: bottom + 22}]}>
    <Text style={s.kicker}>DEALER ONBOARDING · STEP 3 OF 3</Text>
    <Text accessibilityRole="header" style={s.title}>{businessTypes[type]} catalogues</Text>
    <Text style={s.body}>Browse catalogues for your registered business type.</Text>
    {state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading brand catalogues" />
      : state.status === 'error' ? <><Text accessibilityRole="alert" style={s.error}>{state.message}</Text>
        <Button variant="secondary" title="Retry" onPress={page.retry} /></>
      : state.data.results.length === 0 ? <View style={s.card}><Text style={s.label}>No catalogues yet</Text>
        <Text style={s.body}>Check back shortly for new {businessTypes[type].toLowerCase()} brand catalogues.</Text>
        <Button title="Refresh catalogues" icon="refresh" variant="tertiary" onPress={page.refresh} /></View>
      : <><Button title="Refresh catalogues" icon="refresh" variant="tertiary" onPress={page.refresh} />
        {state.data.results.map(item => <CatalogueCard key={item.key} item={item} />)}
        <View style={s.row}>
          <Button variant="tertiary" title="Previous page" disabled={!state.data.previous} onPress={page.previous} />
          <Text style={s.body}>Page {page.page}</Text>
          <Button variant="tertiary" title="Next page" disabled={!state.data.next} onPress={page.next} />
        </View>
      </>}
  </ScrollView>;
}

const styles = StyleSheet.create({preview: {width: '100%', height: 240, backgroundColor: '#edf2ef', borderRadius: 8}});
