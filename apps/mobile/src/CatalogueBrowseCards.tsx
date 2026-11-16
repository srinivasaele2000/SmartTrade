import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Cable, LayoutGrid, Lightbulb, Package, Pipette, ToggleLeft, Waves} from 'lucide-react-native';
import type {Product} from './api';
import {Button} from './Button';
import type {Availability} from './catalogue-browse';
import {CatalogueImage} from './CatalogueMedia';
import {inr} from './india';
import {trade, tradeType} from './trade-theme';

export function CategoryTile({name, all = false, selected, onPress}: {
  name: string; all?: boolean; selected: boolean; onPress: () => void;
}) {
  const Icon = all ? LayoutGrid : /wire|cable/i.test(name) ? Cable : /switch|breaker/i.test(name) ? ToggleLeft
    : /light|lamp/i.test(name) ? Lightbulb : /conduit|fitting|pipe/i.test(name) ? Pipette
    : /motor|pump/i.test(name) ? Waves : Package;
  return <Pressable accessibilityRole="button" accessibilityLabel={name} accessibilityState={{selected}} hitSlop={{top: 6, bottom: 6}} onPress={onPress}
    style={({pressed}) => [styles.tile, selected && styles.tileSelected, pressed && styles.pressed]}>
    <Icon size={14} color={trade.accent} aria-hidden={true} />
    <Text style={styles.tileTitle}>{name}</Text>
  </Pressable>;
}

export function ProductBrowseCard({product, apiBase, availability, onOpen}: {
  product: Product; apiBase: string; availability?: Availability; onOpen: () => void;
}) {
  return <View style={styles.card}>
    <CatalogueImage apiBase={apiBase} reference={product.primary_image_url} name={product.name} compact />
    <View style={styles.details}>
      <Text accessibilityRole="header" style={styles.productName}>{product.name}</Text>
      <Text style={tradeType.meta}>{product.brand_name} · Code {product.code}
        {typeof product.specifications.HSN === 'string' && product.specifications.HSN ? ' · HSN ' + product.specifications.HSN : ''}</Text>
      {(availability?.authorized || product.catalogue_pdf_url) && <View style={styles.tags}>
        {availability?.authorized && <Text style={[styles.tag, styles.verifiedTag]}>Authorized dealer</Text>}
        {availability?.inStock && <Text style={[styles.tag, styles.verifiedTag]}>In stock at a dealer</Text>}
        {product.catalogue_pdf_url && <Text style={styles.tag}>PDF available</Text>}
      </View>}
    </View>
    <View style={styles.actions}>
      <Text style={styles.price}>{product.catalogue_price === null ? 'Price not listed' : inr(product.catalogue_price)}</Text>
      {product.catalogue_price !== null && <Text style={tradeType.meta}>GST not specified</Text>}
      <Button variant="tertiary" compact title="View Details" accessibilityLabel={`View details for ${product.name}`} onPress={onOpen} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  tile: {flexDirection: 'row', alignItems: 'center', minHeight: 28, gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, borderWidth: 1, borderColor: trade.border, backgroundColor: trade.surface},
  tileSelected: {borderColor: trade.accent, backgroundColor: trade.accentTint}, pressed: {opacity: 0.76},
  tileTitle: {fontWeight: '600', fontSize: 12, color: trade.heading},
  card: {flexDirection: 'row', alignItems: 'center', backgroundColor: trade.surface, borderBottomWidth: 1, borderColor: trade.border, paddingVertical: 9, paddingHorizontal: trade.gutter, gap: 10},
  details: {flex: 1, minWidth: 0, gap: 3},
  productName: tradeType.row,
  actions: {minWidth: 84, maxWidth: '34%', alignItems: 'flex-end', gap: 3},
  price: {...tradeType.price, textAlign: 'right'},
  tags: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  tag: {color: '#304a3d', backgroundColor: '#edf2ef', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3, fontSize: 11, fontWeight: '700'},
  verifiedTag: {backgroundColor: trade.successTint, color: trade.success},
});
