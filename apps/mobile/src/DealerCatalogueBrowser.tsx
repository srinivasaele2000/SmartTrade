import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {ActivityIndicator, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View} from 'react-native';
import {Boxes, Cable, Lightbulb, Plug, Store, Wrench} from 'lucide-react-native';
import type {ApiClient, Brand} from './api';
import {Button} from './Button';
import {type CatalogueItem, estimatePage} from './dealer-estimates';
import {HistoryPager} from './HistoryPager';
import {useHistoryPage} from './useHistoryPage';
import {useDebouncedSearch} from './useDebouncedSearch';
import {useResource} from './useResource';
import {trade, tradeType} from './trade-theme';

type Choice = {id: string; name: string; categories?: Brand['categories']};
const emptyPage = {count: 0, results: [], next: null, previous: null};

function categoryIcon(name: string) {
  if (/light/i.test(name)) return Lightbulb;
  if (/wire|cable/i.test(name)) return Cable;
  if (/switch|socket|distribution/i.test(name)) return Plug;
  if (/pipe|conduit|fitting/i.test(name)) return Wrench;
  return Boxes;
}

function ChoiceCard({api, token, kind, choice, width, onPress}: {
  api: ApiClient; token: string; kind: 'brand' | 'category'; choice: Choice;
  width: number; onPress: () => void;
}) {
  const count = useResource(useCallback(async signal => {
    const params = new URLSearchParams({[kind]: choice.id, page_size: '1'});
    const page = await api.get('/catalogue/items/?' + params, signal, token) as {count: number};
    return page.count;
  }, [api, token, kind, choice.id]));
  const Icon = kind === 'brand' ? Store : categoryIcon(choice.name);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Browse ${choice.name}`}
    onPress={onPress} style={({pressed}) => [styles.card, {width}, pressed && styles.pressed]}>
    <View style={styles.badge}>{kind === 'brand'
      ? <Text style={styles.initials}>{choice.name.replace(/[^a-z0-9 ]/gi, '').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase()}</Text>
      : <Icon size={23} color="#166534" />}</View>
    <Text style={tradeType.row}>{choice.name}</Text>
    {count.state.status === 'ready' ? <Text style={tradeType.meta}>{count.state.data} items</Text>
      : count.state.status === 'error' ? <Text style={tradeType.meta}>Count unavailable</Text>
      : <Text style={tradeType.meta}>Loading count…</Text>}
  </Pressable>;
}

export default function DealerCatalogueBrowser({api, token, renderItems}: {
  api: ApiClient; token: string; renderItems: (items: CatalogueItem[]) => ReactNode;
}) {
  const search = useDebouncedSearch();
  const [brand, setBrand] = useState<Choice>();
  const [category, setCategory] = useState<Choice>();
  const [browseAll, setBrowseAll] = useState(false);
  const inResults = Boolean(browseAll || brand || category || search.text.trim());
  const marker = useRef('smarttrade-catalogue-' + Math.random().toString(36).slice(2));
  const {width} = useWindowDimensions();
  const columns = width >= 1100 ? 4 : width >= 720 ? 3 : 2;
  const cardWidth = Math.floor((Math.min(width, 1440) - 24 - (columns - 1) * 10) / columns);
  const reset = useCallback(() => {
    setBrand(undefined); setCategory(undefined); setBrowseAll(false); search.change('');
  }, [search.change]);
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => {
    if (!inResults) return;
    if (Platform.OS !== 'web') {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {resetRef.current(); return true;});
      return () => subscription.remove();
    }
    const previous = window.history.state;
    window.history.pushState({...previous, dealerCatalogue: marker.current}, '');
    const back = () => resetRef.current();
    window.addEventListener('popstate', back);
    return () => {
      window.removeEventListener('popstate', back);
      if (window.history.state?.dealerCatalogue === marker.current) window.history.back();
    };
  }, [inResults]);
  const itemQuery = new URLSearchParams({
    search: search.query, brand: brand?.id ?? '', category: category?.id ?? '',
  }).toString();
  const loadItems = useCallback((page: number, signal: AbortSignal) => inResults && !search.pending
    ? estimatePage<CatalogueItem>(api, '/catalogue/items/?' + itemQuery, page, token, signal)
    : Promise.resolve(emptyPage), [api, token, itemQuery, inResults, search.pending]);
  const products = useHistoryPage(loadItems, itemQuery);
  const loadBrands = useCallback((page: number, signal: AbortSignal) =>
    api.brands({scope: 'priced', category: category?.id}, page, signal), [api, category?.id]);
  const loadCategories = useCallback((page: number, signal: AbortSignal) =>
    api.categories(page, signal, 'priced'), [api]);
  const brands = useHistoryPage(loadBrands, category?.id);
  const categories = useHistoryPage(loadCategories);
  const brandChoices = brands.state.status === 'ready' ? brands.state.data.results : [];
  const categoryChoices = brand?.categories ?? (categories.state.status === 'ready'
    ? categories.state.data.results.filter(value => value.active) : []);
  const heading = [brand?.name, category?.name].filter(Boolean).join(' · ') || (search.text.trim() ? 'Search results' : 'All catalog items');

  return <View style={styles.container}>
    {inResults && <View style={styles.heading}>
      <Button variant="tertiary" icon="back" title="Back to Brands & Categories" onPress={reset} />
      <Text accessibilityRole="header" style={tradeType.title}>{heading}</Text>
      {!search.pending && products.state.status === 'ready' && <Text style={tradeType.meta} accessibilityLiveRegion="polite">
        {products.state.data.count} matching items
      </Text>}
    </View>}
    <View style={styles.search}>
      <TextInput accessibilityLabel="Search catalogue items" placeholder={brand ? 'Search this brand by name, code or HSN' : 'Search all items by name, code, HSN or brand'}
        style={styles.input} value={search.text} onChangeText={search.change}
        autoCorrect={false} returnKeyType="search" onSubmitEditing={search.submit} />
      {!!search.text && <Button variant="tertiary" compact title="×" accessibilityLabel="Clear item search" onPress={() => search.change('')} />}
      <Button variant="primary" compact title="Search" onPress={search.submit} />
    </View>
    {!inResults ? <>
      <View style={styles.heading}><Text accessibilityRole="header" style={tradeType.section}>Shop by brand</Text>
        <Button variant="secondary" compact title="Browse All Items" onPress={() => setBrowseAll(true)} /></View>
      {brands.state.status === 'loading' && <ActivityIndicator accessibilityLabel="Loading brands" />}
      {brands.state.status === 'error' && <><Text>{brands.state.message}</Text><Button variant="secondary" title="Retry brands" onPress={brands.retry} /></>}
      {brands.state.status === 'ready' && !brandChoices.length && <Text>No priced catalogue brands are available yet.</Text>}
      <View style={styles.grid}>{brandChoices.map(value => <ChoiceCard key={value.id} api={api} token={token} kind="brand"
        choice={{...value, id: String(value.id)}} width={cardWidth} onPress={() => setBrand({...value, id: String(value.id)})} />)}</View>
      <HistoryPager {...brands} />
      <Text accessibilityRole="header" style={tradeType.section}>Shop by category</Text>
      {categories.state.status === 'loading' && <ActivityIndicator accessibilityLabel="Loading categories" />}
      {categories.state.status === 'error' && <><Text>{categories.state.message}</Text><Button variant="secondary" title="Retry categories" onPress={categories.retry} /></>}
      <View style={styles.grid}>{categoryChoices.map(value => <ChoiceCard key={value.id} api={api} token={token} kind="category"
        choice={{id: String(value.id), name: value.name}} width={cardWidth} onPress={() => setCategory({id: String(value.id), name: value.name})} />)}
        {categories.state.status === 'ready' && categories.state.data.has_uncategorized && <ChoiceCard api={api} token={token} kind="category"
          choice={{id: 'uncategorized', name: 'Uncategorized'}} width={cardWidth} onPress={() => setCategory({id: 'uncategorized', name: 'Uncategorized'})} />}
      </View>
      <HistoryPager {...categories} />
    </> : <>
      {brands.state.status === 'error' && <Button variant="secondary" title="Retry brands" onPress={brands.retry} />}
      {categories.state.status === 'error' && <Button variant="secondary" title="Retry categories" onPress={categories.retry} />}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <Button variant="navigation" compact title="All categories" selected={!category} onPress={() => setCategory(undefined)} />
        {categoryChoices.map(value => <Button key={value.id} variant="navigation" compact title={value.name}
          selected={category?.id === String(value.id)} onPress={() => setCategory({id: String(value.id), name: value.name})} />)}
        {!brand && <HistoryPager {...categories} />}
      </ScrollView>
      {brand && <Button variant="tertiary" compact title="All brands" onPress={() => {
        setBrand(undefined); setBrowseAll(true);
      }} />}
      {!brand && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <Button variant="navigation" compact title="All brands" selected={!brand} onPress={() => setBrand(undefined)} />
        {brandChoices.map(value => <Button key={value.id} variant="navigation" compact title={value.name}
          onPress={() => setBrand({...value, id: String(value.id)})} />)}
        <HistoryPager {...brands} />
      </ScrollView>}
      {search.pending || products.state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading catalogue items" />
        : products.state.status === 'error' ? <><Text accessibilityRole="alert">{products.state.message}</Text>
          <Button variant="secondary" title="Retry items" onPress={products.retry} /></>
        : products.state.data.results.length ? renderItems(products.state.data.results)
        : <Text>No catalogue items match these filters. Try another search or clear the category.</Text>}
      <HistoryPager {...products} disabled={search.pending} />
    </>}
  </View>;
}

const styles = StyleSheet.create({
  container: {gap: 12, maxWidth: 1440, width: '100%', alignSelf: 'center'},
  heading: {gap: 8, alignItems: 'flex-start'},
  search: {flexDirection: 'row', alignItems: 'center', gap: 6},
  input: {flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13,
    borderWidth: 1, borderColor: trade.border, borderRadius: 8, backgroundColor: trade.surface, color: trade.ink},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  card: {minHeight: 132, padding: 12, gap: 8, borderWidth: 1, borderColor: trade.border,
    borderRadius: 12, backgroundColor: trade.surface, elevation: 1},
  pressed: {backgroundColor: '#ECFDF5', borderColor: '#166534'},
  badge: {width: 40, height: 40, borderRadius: 10, backgroundColor: '#ECFDF5', alignItems: 'center', justifyContent: 'center'},
  initials: {fontSize: 16, fontWeight: '700', color: '#166534'},
  filters: {alignItems: 'center', gap: 6, paddingVertical: 4},
});
