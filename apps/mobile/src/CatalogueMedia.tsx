import {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Image} from 'expo-image';
import {Package} from 'lucide-react-native';
import {Button} from './Button';
import {catalogueMediaUrl} from './catalogue-media-url';
import {downloadLocalFile} from './local-files';
import {openLocalPdf} from './open-local-pdf';

export function CatalogueImage({apiBase, reference, name, detail = false, browse = false}: {
  apiBase: string; reference?: string | null; name: string; detail?: boolean; browse?: boolean;
}) {
  const url = catalogueMediaUrl(apiBase, reference)?.href;
  const [failedUrl, setFailedUrl] = useState<string>();
  return <View style={[styles.frame, detail && styles.detail, browse && styles.browse]}>
    {url && url !== failedUrl
      ? <Image source={{uri: url}} cachePolicy="memory-disk" contentFit="contain" style={styles.image}
          accessible accessibilityLabel={name + ' product image'} onError={() => setFailedUrl(url)} />
      : <View style={styles.placeholder}>
          <Package color="#52675c" size={36} accessible={false} />
          <Text style={styles.placeholderText}>No product image</Text>
        </View>}
  </View>;
}

export function CataloguePdf({apiBase, reference, productId, productName}: {
  apiBase: string; reference?: string | null; productId: number; productName?: string;
}) {
  const fileUrl = catalogueMediaUrl(apiBase, reference);
  const href = fileUrl?.href;
  const [error, setError] = useState('');
  const [size, setSize] = useState<{url: string; label: string}>();
  useEffect(() => {
    if (!href) return;
    const controller = new AbortController();
    void fetch(href, {method: 'HEAD', signal: controller.signal}).then(response => {
      const bytes = Number(response.headers.get('Content-Length'));
      if (!controller.signal.aborted && response.ok && Number.isFinite(bytes) && bytes > 0) {
        const mb = bytes / 1_000_000;
        setSize({url: href, label: mb < 0.01 ? '<0.01 MB' : `${Number(mb.toFixed(2))} MB`});
      }
    }).catch(() => { /* Size is optional when the server does not supply it. */ });
    return () => controller.abort();
  }, [href]);
  if (!fileUrl) return null;

  async function open(url: URL) {
    setError('');
    try {
      const version = url.pathname.split('/').at(-1);
      const file = await downloadLocalFile(url.href, {}, 'Catalogue-' + productId + '-' + version + '.pdf',
        'catalogue_pdf', 'product-' + productId, 'application/pdf', productName);
      await openLocalPdf(file.uri);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not open the catalogue PDF.');
    }
  }

  return <View style={styles.action}>
    <Button variant="secondary" icon="file" title={`View Catalogue (PDF)${size && size.url === href ? ` • ${size.label}` : ''}`} onPress={() => open(fileUrl)} />
    {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  frame: {height: 132, borderRadius: 10, overflow: 'hidden', backgroundColor: '#edf2ef'},
  detail: {height: 220},
  browse: {height: 'auto', aspectRatio: 16 / 9},
  image: {width: '100%', height: '100%'},
  placeholder: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8},
  placeholderText: {color: '#52675c', fontSize: 14},
  action: {gap: 8},
  error: {color: '#9c2820'},
});
