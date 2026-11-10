import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Cable, LayoutGrid, Lightbulb, Package, Pipette, ToggleLeft, Waves} from 'lucide-react-native';
import type {Product} from './api';
import {Button} from './Button';
import type {Availability} from './catalogue-browse';
import {CatalogueImage} from './CatalogueMedia';
import {inr} from './india';

export function CategoryTile({name, all = false, selected, onPress}: {
  name: string; all?: boolean; selected: boolean; onPress: () => void;
}) {
  const Icon = all ? LayoutGrid : /wire|cable/i.test(name) ? Cable : /switch|breaker/i.test(name) ? ToggleLeft
    : /light|lamp/i.test(name) ? Lightbulb : /conduit|fitting|pipe/i.test(name) ? Pipette
    : /motor|pump/i.test(name) ? Waves : Package;
  return <Pressable accessibilityRole="button" accessibilityLabel={name} accessibilityState={{selected}} onPress={onPress}
    style={({pressed}) => [styles.tile, selected && styles.tileSelected, pressed && styles.pressed]}>
    <View style={styles.tileIcon}><Icon size={23} color="#14553e" accessible={false} /></View>
    <Text style={styles.tileTitle}>{name}</Text>
    <Text style={styles.tileBadge}>{selected ? 'Selected' : 'Browse'}</Text>
  </Pressable>;
}

export function ProductBrowseCard({product, apiBase, availability, onOpen}: {
  product: Product; apiBase: string; availability?: Availability; onOpen: () => void;
}) {
  return <View style={styles.card}>
    <CatalogueImage apiBase={apiBase} reference={product.primary_image_url} name={product.name} browse />
    <Text style={styles.brand}>{product.brand_name}</Text>
    <Text accessibilityRole="header" numberOfLines={2} style={styles.productName}>{product.name}</Text>
    <Text style={styles.meta}>{product.company_name} · {product.category_name} · {product.code}</Text>
    <View style={styles.priceBox}>
      <Text style={styles.meta}>Company catalogue price</Text>
      <Text style={styles.price}>{product.catalogue_price === null ? 'Price not listed' : inr(product.catalogue_price)}</Text>
      {product.catalogue_price !== null && <Text style={styles.meta}>GST not specified</Text>}
    </View>
    {(availability?.authorized || product.catalogue_pdf_url) && <View style={styles.tags}>
      {availability?.authorized && <Text style={[styles.tag, styles.verifiedTag]}>Authorized dealer</Text>}
      {availability?.inStock && <Text style={[styles.tag, styles.verifiedTag]}>In stock at a dealer</Text>}
      {product.catalogue_pdf_url && <Text style={styles.tag}>PDF available</Text>}
    </View>}
    <Button variant="primary" icon="next" title="View Details" accessibilityLabel={`View details for ${product.name}`} onPress={onOpen} />
  </View>;
}

const styles = StyleSheet.create({
  tile: {flexBasis: '47%', flexGrow: 1, maxWidth: '50%', minHeight: 114, gap: 6, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#dce7e0', backgroundColor: '#fff'},
  tileSelected: {borderColor: '#24734f', backgroundColor: '#edf7f0'}, pressed: {opacity: 0.76},
  tileIcon: {alignSelf: 'flex-start', backgroundColor: '#edf4ef', padding: 6, borderRadius: 8},
  tileTitle: {fontWeight: '800', fontSize: 15, color: '#17392d'}, tileBadge: {fontSize: 12, color: '#52675c'},
  card: {backgroundColor: '#fff', borderWidth: 1, borderColor: '#dce7e0', borderRadius: 16, padding: 14, gap: 8},
  brand: {fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: '#356550', fontSize: 12},
  productName: {color: '#17392d', fontSize: 20, fontWeight: '800', lineHeight: 26}, meta: {color: '#52675c', fontSize: 13},
  priceBox: {backgroundColor: '#f3f7f4', borderRadius: 10, padding: 10, gap: 3}, price: {color: '#14553e', fontSize: 19, fontWeight: '800'},
  tags: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  tag: {color: '#304a3d', backgroundColor: '#edf2ef', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, fontSize: 12, fontWeight: '700'},
  verifiedTag: {backgroundColor: '#def0e5', color: '#124b35'},
});
