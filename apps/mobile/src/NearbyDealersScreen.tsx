import {useCallback, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Button} from './Button';
import {query, type ApiClient, type Page} from './api';
import type {DraftLine} from './enquiries';
import {inr} from './india';
import {trade} from './trade-theme';
import {useCustomerLocation} from './useCustomerLocation';
import {useResource} from './useResource';

type Nearby = {
  id: number; business_name: string; branch_name: string; locality: string; city: string; pincode: string;
  distance_km: number | null; brands: string[]; category_count: number; catalogue_item_count: number;
  offer: {listing: number; product: number; name: string; sku: string | null; selling_price: string; stock_status: string} | null;
};
type Props = {
  api: ApiClient; token: string | null; item?: number; brand?: string; category?: string; initialSearch?: string;
  location: ReturnType<typeof useCustomerLocation>;
  browse: (id: number, name: string) => void; enquire?: (line: DraftLine) => void; signIn: () => void;
};
const styles = StyleSheet.create({
  content: {padding: trade.gutter, gap: 10},
  card: {backgroundColor: trade.surface, borderColor: trade.border, borderWidth: 1, borderRadius: 10, padding: 12, gap: 8},
  title: {fontSize: 16, fontWeight: '700', color: trade.heading},
  body: {fontSize: 13, color: trade.secondary},
  input: {minHeight: 44, borderWidth: 1, borderColor: trade.border, borderRadius: 8, paddingHorizontal: 10, color: trade.ink},
  pills: {gap: 6, alignItems: 'center'},
});

export default function NearbyDealersScreen({api, token, item, brand, category, initialSearch, location, browse, enquire, signIn}: Props) {
  const {bottom} = useSafeAreaInsets();
  const [area, setArea] = useState('');
  const [search, setSearch] = useState(initialSearch ?? '');
  const [filters, setFilters] = useState<{q?: string; brand_id?: string; category_id?: string}>({q: initialSearch, brand_id: brand, category_id: category});
  const [radius, setRadius] = useState('25');
  const [page, setPage] = useState(1);
  const [changing, setChanging] = useState(!location.location);
  const [brandPage, setBrandPage] = useState(1);
  const [categoryPage, setCategoryPage] = useState(1);
  const brands = useResource(useCallback(signal => api.brands({}, brandPage, signal), [api, brandPage]));
  const categories = useResource(useCallback(signal => api.categories(categoryPage, signal), [api, categoryPage]));
  const submitSearch = () => {
    setFilters(current => ({...current, q: search.trim() || undefined}));
    setPage(1);
  };
  const selected = location.location;
  const results = useResource(useCallback(async signal => {
    if (!selected) return null;
    const path = item ? `/catalogue/items/${item}/nearby-dealers/` : '/dealers/discover/';
    return api.get(path + '?' + query({...selected.filters, ...filters, radius_km: radius}, page), signal, token ?? undefined) as Promise<Page<Nearby>>;
  }, [api, token, item, selected, filters, radius, page]));
  const data = results.state.status === 'ready' ? results.state.data : null;
  const [branch, setBranch] = useState<Nearby>();
  const [branchPage, setBranchPage] = useState(1);
  const branchItems = useResource(useCallback(async signal => {
    if (!branch) return null;
    return api.get(`/dealers/discover/${branch.id}/catalogue/?page=${branchPage}`, signal, token ?? undefined) as Promise<Page<NonNullable<Nearby['offer']>>>;
  }, [api, branch, branchPage, token]));
  const request = (dealer: Nearby, offer: NonNullable<Nearby['offer']>) => {
    if (!enquire) {signIn(); return;}
    enquire({listing: offer.listing, branch: dealer.id, branch_name: dealer.branch_name, dealer_name: dealer.business_name,
      product_name: offer.name, variant_sku: offer.sku, quantity: '1', requirement: ''});
  };
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, {paddingBottom: bottom + 12}]}>
    {branch ? <>
      <Button variant="tertiary" title="Back to nearby dealers" onPress={() => setBranch(undefined)} />
      <Text style={styles.title}>{branch.business_name} · {branch.branch_name}</Text>
      {branchItems.state.status === 'loading' && <ActivityIndicator />}
      {branchItems.state.status === 'error' && <><Text accessibilityRole="alert">{branchItems.state.message}</Text>
        <Button variant="secondary" title="Retry branch catalogue" onPress={branchItems.retry} /></>}
      {branchItems.state.data?.results.length === 0 && <Text>No available catalogue listings at this branch.</Text>}
      {branchItems.state.data?.results.map(offer => <View key={offer.listing} style={styles.card}>
        <Text style={styles.title}>{offer.name}{offer.sku ? ` · ${offer.sku}` : ''}</Text>
        <Text style={styles.body}>{inr(offer.selling_price)} · {offer.stock_status === 'IN_STOCK' ? 'In stock' : 'Ask for availability'}</Text>
        <Button variant="tertiary" title="View product" onPress={() => browse(offer.product, offer.name)} />
        {(!token || enquire) && <Button variant="secondary" title="Request quote" onPress={() => request(branch, offer)} />}
      </View>)}
      {!!branchItems.state.data?.previous && <Button variant="secondary" title="Previous items" onPress={() => setBranchPage(p => p - 1)} />}
      {!!branchItems.state.data?.next && <Button variant="secondary" title="Next items" onPress={() => setBranchPage(p => p + 1)} />}
    </> : <>
      <View style={styles.card}>
        <Text style={styles.title}>{selected?.label ?? 'Choose your location'}</Text>
        {!changing && <Button variant="tertiary" title="Change location" onPress={() => setChanging(true)} />}
        {changing && <>
          <Button variant="secondary" title="Use current GPS location" loading={location.busy} onPress={() => {
            void location.gps().then(ok => {if (ok) {setPage(1); setChanging(false);}});
          }} />
          <TextInput style={styles.input} accessibilityLabel="City, area or PIN code" placeholder="City, area or PIN code" value={area} maxLength={120} onChangeText={setArea} />
          <Button variant="secondary" title="Use this location" disabled={location.busy} onPress={() => {if (location.manual(area)) {setPage(1); setChanging(false);}}} />
          <ScrollView horizontal contentContainerStyle={styles.pills}>{['Hyderabad', 'Gachibowli', 'Madhapur', 'Secunderabad'].map(value =>
            <Button key={value} variant="navigation" title={value} disabled={location.busy} onPress={() => {location.manual(value); setPage(1); setChanging(false);}} />)}</ScrollView>
        </>}
        {!!location.error && <Text accessibilityRole="alert">{location.error}</Text>}
      </View>
      {selected?.filters.lat && <ScrollView horizontal contentContainerStyle={styles.pills}>{['5', '10', '25', '50', '200'].map(value =>
        <Button key={value} variant="navigation" title={`${value} km`} selected={radius === value} onPress={() => {setRadius(value); setPage(1);}} />)}</ScrollView>}
      {!item && <>
        <TextInput style={styles.input} accessibilityLabel="Search nearby dealers" placeholder="Search dealers, brands or items" maxLength={120}
          value={search} onChangeText={setSearch} onSubmitEditing={submitSearch} />
        <Button variant="secondary" title="Search nearby dealers" onPress={submitSearch} />
        {!!(search || filters.q || filters.brand_id || filters.category_id) && <Button variant="tertiary"
          title="Clear dealer filters" onPress={() => {setSearch(''); setFilters({}); setPage(1);}} />}
        {([[brands, 'brand_id', 'All brands', setBrandPage], [categories, 'category_id', 'All categories', setCategoryPage]] as const).map(([resource, key, label, changePage]) =>
          <ScrollView key={key} horizontal contentContainerStyle={styles.pills}>
            <Button variant="navigation" title={label} selected={!filters[key]} onPress={() => {setFilters(current => ({...current, [key]: undefined})); setPage(1);}} />
            {resource.state.data?.results.map(option => <Button key={option.id} variant="navigation" title={option.name} selected={filters[key] === String(option.id)}
              onPress={() => {setFilters(current => ({...current, [key]: String(option.id)})); setPage(1);}} />)}
            {resource.state.data?.previous && <Button variant="tertiary" title={key === 'brand_id' ? 'Previous brands' : 'Previous categories'} onPress={() => changePage(value => value - 1)} />}
            {resource.state.data?.next && <Button variant="tertiary" title={key === 'brand_id' ? 'More brands' : 'More categories'} onPress={() => changePage(value => value + 1)} />}
            {resource.state.status === 'error' && <Button variant="tertiary" title={key === 'brand_id' ? 'Retry brands' : 'Retry categories'} onPress={resource.retry} />}
          </ScrollView>)}
      </>}
      {selected && results.state.status === 'loading' && <ActivityIndicator accessibilityLabel="Finding nearby dealers" />}
      {results.state.status === 'error' && <View style={styles.card}><Text accessibilityRole="alert">{results.state.message}</Text><Button variant="secondary" title="Retry" onPress={results.retry} /></View>}
      {data && <>
        <Text accessibilityRole="header" style={styles.title}>{item ? `Available at ${data.count} nearby verified dealer branches` : `${data.count} nearby verified dealer branches`}</Text>
        {data.count === 0 && <View style={styles.card}><Text>{selected?.filters.lat ? `No matching verified dealers within ${radius} km.` : 'No matching verified dealers in this area.'}</Text>
          {selected?.filters.lat && Number(radius) < 25 && <Button variant="secondary" title="Expand to 25 km" onPress={() => {setRadius('25'); setPage(1);}} />}</View>}
        {data.results.map(dealer => <View key={dealer.id} style={styles.card}>
          <Text style={styles.title}>{dealer.business_name} · Verified</Text>
          <Text style={styles.body}>{[dealer.branch_name, dealer.locality, dealer.city, dealer.pincode].filter(Boolean).join(' · ')}</Text>
          {dealer.distance_km !== null && <Text style={styles.body}>{dealer.distance_km.toFixed(1)} km away</Text>}
          <Text style={styles.body}>{dealer.catalogue_item_count} items · {dealer.category_count} categories</Text>
          {!!dealer.brands.length && <Text style={styles.body}>{dealer.brands.join(' · ')}</Text>}
          <Button variant="secondary" title="View catalogue" onPress={() => {setBranchPage(1); setBranch(dealer);}} />
          {dealer.offer && (!token || enquire) && <Button variant="primary" title="Request quote" onPress={() => request(dealer, dealer.offer!)} />}
        </View>)}
        {!!data.previous && <Button variant="secondary" title="Previous page" onPress={() => setPage(p => p - 1)} />}
        {!!data.next && <Button variant="secondary" title="Next page" onPress={() => setPage(p => p + 1)} />}
      </>}
    </>}
  </ScrollView>;
}
