import {type ReactNode} from 'react';
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

export function CatalogueGrid<T extends {id: number | string}>({items, render, label}: {
  items: T[]; label?: string; render: (item: T) => ReactNode;
}) {
  const columns = 8;
  return <View accessibilityLabel={label} style={styles.grid}>
    {Array.from({length: Math.ceil(items.length / columns)}, (_, row) => {
      const cells = items.slice(row * columns, (row + 1) * columns);
      return <View key={row} style={styles.gridRow}>
        {cells.map(item => <View key={item.id} style={styles.cell}>{render(item)}</View>)}
        {Array.from({length: columns - cells.length}, (_, index) => <View key={`empty-${index}`} style={styles.cell} />)}
      </View>;
    })}
  </View>;
}

export function ProductGridCard({name, brand, code, hsn, pack, price, apiBase, image, badge, children}: {
  name: string; brand: string; code: string; hsn?: string; pack?: string; price: string;
  apiBase: string; image?: string | null; badge?: string; children: ReactNode;
}) {
  return <View style={styles.card}>
    <View style={styles.stage}>
      <CatalogueImage apiBase={apiBase} reference={image} name={name} gridBrand={brand} />
      {!!badge && <Text accessibilityLabel={badge} numberOfLines={1} style={styles.badge}>{badge}</Text>}
    </View>
    <View style={styles.details}>
      <Text numberOfLines={1} style={styles.brand}>{brand}</Text>
      <Text accessibilityRole="header" accessibilityLabel={name} numberOfLines={2} style={styles.productName}>{name}</Text>
      <Text numberOfLines={1} style={styles.code}>Code {code}</Text>
      <Text numberOfLines={1} style={styles.meta}>{[hsn && 'HSN ' + hsn, pack && 'Pack ' + pack].filter(Boolean).join(' · ') || ' '}</Text>
      <Text style={styles.price}>{price}</Text>
      <View style={styles.actions}>{children}</View>
    </View>
  </View>;
}

export function ProductBrowseCard({product, apiBase, availability, onOpen}: {
  product: Product; apiBase: string; availability?: Availability; onOpen: () => void;
}) {
  const pack = product.specifications['Pack size'];
  return <ProductGridCard name={product.name} brand={product.brand_name} code={product.code}
    hsn={String(product.specifications.HSN ?? '')}
    pack={pack && typeof pack === 'object' ? Object.values(pack).join(' / ') : String(pack ?? '')}
    apiBase={apiBase} image={product.primary_image_url}
    badge={availability?.inStock ? 'In stock at a dealer' : product.category_name}
    price={product.catalogue_price === null ? 'Price not listed' : inr(product.catalogue_price)}>
    <Text style={styles.meta} numberOfLines={2}>{[
      availability?.authorized && 'Authorized dealer',
      product.catalogue_pdf_url && 'PDF available',
      product.catalogue_price !== null && 'GST not specified',
    ].filter(Boolean).join(' · ')}</Text>
    <Button variant="tertiary" gridIconOnly icon="view" title="View Details" accessibilityLabel={`View details for ${product.name}`} onPress={onOpen} />
  </ProductGridCard>;
}

const styles = StyleSheet.create({
  tile: {flexDirection: 'row', alignItems: 'center', minHeight: 28, gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, borderWidth: 1, borderColor: trade.border, backgroundColor: trade.surface},
  tileSelected: {borderColor: trade.accent, backgroundColor: trade.accentTint}, pressed: {opacity: 0.76},
  tileTitle: {fontWeight: '600', fontSize: 12, color: trade.heading},
  grid: {gap: 6, width: '100%'},
  gridRow: {flexDirection: 'row', alignItems: 'stretch', gap: 3},
  cell: {flex: 1, minWidth: 0},
  card: {flex: 1, backgroundColor: '#ffffff', borderRadius: 7, borderWidth: 1, borderColor: '#e2e8f0',
    elevation: 1, shadowColor: '#0f172a', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: {width: 0, height: 2}},
  stage: {aspectRatio: 4 / 3, overflow: 'hidden', borderTopLeftRadius: 6, borderTopRightRadius: 6,
    backgroundColor: '#f8fafc', borderBottomWidth: 1, borderColor: '#e2e8f0'},
  badge: {position: 'absolute', top: 1, left: 1, maxWidth: '95%', paddingHorizontal: 1, paddingVertical: 1,
    borderRadius: 12, backgroundColor: '#ecfdf5', color: '#14532d', fontSize: 8, fontWeight: '700'},
  details: {flex: 1, minWidth: 0, padding: 2, gap: 2},
  brand: {color: '#475569', textTransform: 'uppercase', fontSize: 9, fontWeight: '700'},
  productName: {minHeight: 28, lineHeight: 14, fontSize: 11, fontWeight: '600', color: '#0f172a'},
  code: {alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: '#f1f5f9', color: '#334155',
    borderRadius: 5, paddingHorizontal: 1, paddingVertical: 1, fontSize: 9, fontVariant: ['tabular-nums']},
  meta: {...tradeType.meta, fontSize: 9, lineHeight: 12},
  price: {...tradeType.price, color: '#14532d', fontSize: 10, lineHeight: 13},
  actions: {marginTop: 'auto', paddingTop: 2, gap: 2},
});
