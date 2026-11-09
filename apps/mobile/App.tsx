import {Button} from './src/Button';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiClient, ApiError, type CatalogueFilters, type DealerFilters, type Product } from './src/api';
import { inventoryLabel, matchLabel, variantListings, type Resource } from './src/resource';
import { SessionProvider, useSession } from './src/session';
import AuthScreen from './src/AuthScreen';
import CompanyScreen from './src/CompanyScreen';
import DealerWorkspace from './src/DealerWorkspace';
import {PersonalProfile} from './src/Onboarding';
import {RoleIdentity} from './src/RoleIdentity';
import EnquiryWorkspace from './src/EnquiryWorkspace';
import OrderWorkspace from './src/OrderWorkspace';
import type { DraftLine } from './src/enquiries';
import { useResource } from './src/useResource';
import { inr, indianNumber } from './src/india';

const api = new ApiClient(process.env.EXPO_PUBLIC_API_URL ?? '');
type Screen = { name: 'personal-profile' } | { name: 'orders' } | { name: 'enquiries' } | { name: 'dealer-workspace' } | { name: 'company' } | { name: 'auth' } | { name: 'account' } | { name: 'catalogue' } | { name: 'detail'; id: number } | { name: 'dealers'; product: Product; variant: number | null };


function Field({ label, value, onChange, numeric = false }: { label: string; value: string; onChange: (value: string) => void; numeric?: boolean }) {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} style={s.input} keyboardType={numeric ? 'number-pad' : 'default'} autoCorrect={false} returnKeyType="search" /></View>;
}
function Feedback<T>({ state, retry }: { state: Resource<T>; retry: () => void }) {
  if (state.status === 'loading') return <View style={s.panel}><ActivityIndicator accessibilityLabel="Loading" /><Text accessibilityLiveRegion="polite">Loading SmartTrade…</Text></View>;
  if (state.status === 'error') return <View style={s.panel}><Text accessibilityRole="alert" style={s.error}>{state.message}</Text><Button variant="tertiary" icon="refresh" title="Retry" onPress={retry} /></View>;
  return null;
}
function Pager({ page, next, previous, onPage }: { page: number; next: string | null; previous: string | null; onPage: (page: number) => void }) {
  return <View style={s.row}><Button variant="tertiary" icon="back" title="Previous page" disabled={!previous} onPress={() => onPage(page - 1)} /><Text>Page {page}</Text><Button variant="tertiary" icon="next" title="Next page" disabled={!next} onPress={() => onPage(page + 1)} /></View>;
}

export function CatalogueScreen({ open }: { open: (id: number) => void }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<CatalogueFilters>({});
  const [page, setPage] = useState(1), [categoryPage, setCategoryPage] = useState(1), [brandPage, setBrandPage] = useState(1);
  const products = useResource(useCallback(signal => api.products(filters, page, signal), [filters, page]));
  const categories = useResource(useCallback(signal => api.categories(categoryPage, signal), [categoryPage]));
  const brands = useResource(useCallback(signal => api.brands({ category: filters.category }, brandPage, signal), [filters.category, brandPage]));
  const selectCategory = (category?: string) => { setFilters(current => ({ ...current, category, brand: undefined })); setPage(1); setBrandPage(1); };
  return <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Text style={s.eyebrow}>SMARTTRADE / CATALOGUE</Text><Text accessibilityRole="header" style={s.title}>Explore company products</Text><Text style={s.body}>Official catalogue information. Dealer prices and inventory belong to individual branches.</Text>
    <View style={s.panel}><Field label="Search products, codes or SKUs" value={search} onChange={setSearch} /><Text style={s.muted}>Search also matches descriptions, brands, categories and variant names.</Text>
      <Button variant="primary" icon="search" title="Search catalogue" onPress={() => { setFilters(current => ({ ...current, search: search.trim() })); setPage(1); }} /><Button variant="secondary" title="Clear filters" onPress={() => { setSearch(''); setFilters({}); setPage(1); setCategoryPage(1); setBrandPage(1); }} /></View>
    <Text accessibilityRole="header" style={s.heading}>Categories</Text><Feedback {...categories} />
    {categories.state.status === 'ready' && <><View style={s.wrap}><Button variant="navigation" title="All categories" selected={!filters.category} onPress={() => selectCategory()} />{categories.state.data.results.filter(c => c.active).map(c => <Button variant="navigation" key={c.id} title={c.name} selected={filters.category === String(c.id)} onPress={() => selectCategory(String(c.id))} />)}</View>{categories.state.data.count === 0 && <Text>No categories are available yet.</Text>}{(categories.state.data.next || categories.state.data.previous) && <Pager page={categoryPage} {...categories.state.data} onPage={setCategoryPage} />}</>}
    <Text accessibilityRole="header" style={s.heading}>Brands</Text><Feedback {...brands} />
    {brands.state.status === 'ready' && <><View style={s.wrap}><Button variant="navigation" title="All brands" selected={!filters.brand} onPress={() => { setFilters(current => ({ ...current, brand: undefined })); setPage(1); }} />{brands.state.data.results.map(brand => <Button variant="navigation" key={brand.id} title={`${brand.name} · ${brand.company_name}`} selected={filters.brand === String(brand.id)} onPress={() => { setFilters(current => ({ ...current, brand: String(brand.id) })); setPage(1); }} />)}</View>{brands.state.data.count === 0 && <View style={s.panel}><Text>No published brands are available for this category.</Text></View>}{(brands.state.data.next || brands.state.data.previous) && <Pager page={brandPage} {...brands.state.data} onPage={setBrandPage} />}</>}
    <Text accessibilityRole="header" style={s.heading}>Products</Text><Feedback {...products} />
    {products.state.status === 'ready' && <><Text accessibilityLiveRegion="polite">{products.state.data.count} matching products</Text>{products.state.data.results.length === 0 && <View style={s.panel}><Text>No products match this search. Clear filters or try another name.</Text></View>}{products.state.data.results.map(p => <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`View ${p.name}, ${p.brand_name}`} style={s.panel} onPress={() => open(p.id)}><Text style={s.heading}>{p.name}</Text><Text>{p.brand_name} · {p.company_name}</Text><Text style={s.muted}>{p.category_name} · {p.code}</Text><Text style={s.price}>{p.catalogue_price === null ? 'Catalogue price not provided' : inr(p.catalogue_price)}</Text><Text style={s.link}>View details and variants →</Text></Pressable>)}<Pager page={page} {...products.state.data} onPage={setPage} /></>}
  </ScrollView>;
}

export function ProductScreen({ id, findDealers }: { id: number; findDealers: (product: Product, variant: number | null) => void }) {
  const product = useResource(useCallback(signal => api.product(id, signal), [id]));
  const [variant, setVariant] = useState<number | null>(null);
  return <ScrollView contentContainerStyle={s.content}><Feedback {...product} />{product.state.status === 'ready' && (() => {
    const p = product.state.data;
    return <><Text style={s.eyebrow}>{p.company_name}</Text><Text accessibilityRole="header" style={s.title}>{p.name}</Text><Text style={s.body}>{p.brand_name} · {p.category_name} · {p.code}</Text><View style={s.panel}><Text style={s.label}>Company catalogue price</Text><Text style={s.price}>{p.catalogue_price === null ? 'Not provided' : inr(p.catalogue_price)}</Text><Text>Unit: {p.unit}</Text><Text style={s.muted}>Dealer branch prices may differ. No tax or delivery amount is inferred.</Text></View><Text style={s.body}>{p.description || 'No description provided.'}</Text>
      <Text accessibilityRole="header" style={s.heading}>Specifications</Text>{Object.keys(p.specifications).length === 0 ? <Text>No specifications provided.</Text> : Object.entries(p.specifications).map(([key, value]) => <Text key={key} style={s.body}>{key}: {typeof value === 'string' ? value : JSON.stringify(value)}</Text>)}
      <Text accessibilityRole="header" style={s.heading}>Variants / SKUs</Text><Button variant="navigation" title="Compare all product listings" selected={variant === null} onPress={() => setVariant(null)} />{p.variants.length === 0 && <View style={s.panel}><Text>No active variants are available. Product-level dealer listings may still be compared.</Text></View>}{p.variants.map(v => <View key={v.id} style={s.panel}><Button variant="navigation" title={`${v.name} · SKU ${v.sku}`} selected={variant === v.id} onPress={() => setVariant(v.id)} /><Text style={s.muted}>{Object.entries(v.attributes).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · ') || 'No variant attributes provided.'}</Text></View>)}<Button variant="primary" icon="search" title={variant === null ? "Find dealer branches for this product" : "Find dealer branches for selected SKU"} onPress={() => findDealers(p, variant)} /></>;
  })()}</ScrollView>;
}

export function DealerResults({ product, variant, token, invalidate, addToEnquiry }: { product: Product; variant: number | null; token: string; invalidate: () => void; addToEnquiry?: (line: DraftLine) => void }) {
  const [pin, setPin] = useState(''), [locality, setLocality] = useState(''), [district, setDistrict] = useState(''), [stock, setStock] = useState('');
  const [filters, setFilters] = useState<DealerFilters>({}), [page, setPage] = useState(1);
  const load = useCallback(async (signal: AbortSignal) => {
    try { return await api.dealers(product.id, { ...filters, ...(variant === null ? {} : { variant: String(variant) }) }, page, token, signal); }
    catch (error) { if (error instanceof ApiError && error.status === 401) invalidate(); throw error; }
  }, [product.id, variant, filters, page, token, invalidate]);
  const result = useResource(load);
  return <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><Text accessibilityRole="header" style={s.title}>Compare dealer branches</Text><Text style={s.body}>{product.name}{variant !== null ? ` · SKU ${product.variants.find(v => v.id === variant)?.sku ?? variant}` : ' · all product/variant listings'}</Text>
    <View style={s.panel}><Field label="PIN / postal code (searched first)" value={pin} onChange={setPin} /><Field label="Locality (fallback)" value={locality} onChange={setLocality} /><Field label="District (broader fallback)" value={district} onChange={setDistrict} /><View style={s.wrap}>{[['', 'Any stock status'], ['IN_STOCK', 'In stock'], ['OUT_OF_STOCK', 'Out of stock'], ['UNKNOWN', 'Not confirmed']].map(([value, title]) => <Button variant="navigation" key={value} title={title} selected={stock === value} onPress={() => setStock(value)} />)}</View><Button variant="primary" icon="search" title="Search dealer branches" onPress={() => { setFilters({ pin_code: pin.trim(), locality: locality.trim(), district: district.trim(), stock_status: stock }); setPage(1); }} /></View>
    <Text style={s.muted}>All prices are in Indian rupees. Listings do not reserve stock.</Text>{variant !== null && <Text style={s.muted}>Results and pagination are filtered by the selected SKU on the server.</Text>}<Feedback {...result} />
    {result.state.status === 'ready' && (() => {
      const data = result.state.data, rows = variantListings(data.results, variant);
      return <><Text accessibilityLiveRegion="polite" style={s.label}>{matchLabel(data.match_level)}</Text><Text>{data.count} matching listings{variant === null ? ' across all variants' : ' for this SKU'}; {rows.length} shown on this page.</Text>{rows.length === 0 && <View style={s.panel}><Text>{data.count === 0 ? 'No eligible listings match these filters. This does not confirm that the product is out of stock everywhere.' : 'No listings for this variant on this page. Check other pages or compare all product listings.'}</Text></View>}{rows.map(item => <View key={item.id} style={s.panel}><Text accessibilityRole="header" style={s.heading}>{item.branch.branch_name}</Text><Text>{item.business_name}</Text><Text style={s.price}>{inr(item.selling_price)}</Text><Text style={s.label}>{inventoryLabel(item)}</Text><Text>Variant: {item.variant === null ? 'Product-level listing' : product.variants.find(v => v.id === item.variant)?.sku ?? `ID ${item.variant}`}</Text><Text style={s.body}>{[item.branch.address, item.branch.locality, item.branch.district, item.branch.pin_code, item.branch.state, 'India'].join(', ')}</Text>{addToEnquiry && <Button variant="primary" icon="plus" title="Add to enquiry" onPress={() => addToEnquiry({ listing: item.id, branch: item.branch.id, branch_name: item.branch.branch_name, dealer_name: item.business_name, product_name: product.name, variant_sku: item.variant === null ? null : product.variants.find(v => v.id === item.variant)?.sku ?? null, quantity: '1', requirement: '' })} />}</View>)}<Pager page={page} {...data} onPage={setPage} /><Button variant="tertiary" icon="refresh" title="Refresh current inventory page" onPress={result.retry} /></>;
    })()}
  </ScrollView>;
}
function DealerScreen({ product, variant, signIn, addToEnquiry }: { product: Product; variant: number | null; signIn: () => void; addToEnquiry: (line: DraftLine) => void }) {
  const { token, account, revalidateSession } = useSession();
  if (!token) return <ScrollView contentContainerStyle={s.content}><Text accessibilityRole="header" style={s.title}>Sign in required</Text><Text style={s.body}>Dealer branch discovery for {product.name} requires a valid SmartTrade account session.</Text><View style={s.panel}><Text>Sign in with your SmartTrade account. Discovery remains protected by the backend.</Text><Button variant="primary" icon="check" title="Sign in to find dealers" onPress={signIn} /></View></ScrollView>;
  return <DealerResults product={product} variant={variant} token={token} invalidate={revalidateSession} addToEnquiry={account?.account_type === 'PERSONAL' ? addToEnquiry : undefined} />;
}

function ActionCompany({ open }: { open: () => void }) {
  const { account } = useSession();
  return account?.account_type === 'COMPANY' ? <Button variant="tertiary" title="Company dashboard" onPress={open} /> : null;
}

function Journey() {
  const [screen, setScreen] = useState<Screen>({ name: 'catalogue' });
  const [returnScreen, setReturnScreen] = useState<Screen>({ name: 'catalogue' });
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const session = useSession();
  const signIn = () => { setReturnScreen(screen); setScreen({ name: 'auth' }); };
  const back = useCallback(() => setScreen(current => {
    if (current.name === 'dealers') return { name: 'detail', id: current.product.id };
    return { name: current.name === 'personal-profile' ? 'account' : 'catalogue' };
  }), []);
  const addToEnquiry = (line: DraftLine) => { setDraft(current => { if (current.length && current[0].branch !== line.branch) { Alert.alert('One branch per enquiry', 'Submit or clear the current draft before selecting another dealer branch.'); return current; } return current.some(item => item.listing === line.listing) ? current : [...current, line]; }); setScreen({ name: 'enquiries' }); };
  useEffect(() => { const listener = BackHandler.addEventListener('hardwareBackPress', () => { if (screen.name === 'catalogue') return false; back(); return true; }); return () => listener.remove(); }, [screen.name, back]);
  return <SafeAreaView style={s.safe}><StatusBar barStyle="dark-content" /><KeyboardAvoidingView style={s.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={s.topbar}><View style={s.brandRow}><Text style={s.logo}>SmartTrade</Text><RoleIdentity account={session.account} /></View><View style={s.headerActions}><Button variant="tertiary" title={session.account ? 'My account' : 'Sign in'} onPress={() => session.account ? setScreen({ name: 'account' }) : signIn()} />{screen.name !== 'catalogue' && <Button variant="tertiary" icon="back" title="Back" onPress={back} />}</View></View>{session.message !== '' && <Text accessibilityRole="alert" style={s.error}>{session.message}</Text>}<View style={screen.name === 'catalogue' ? s.safe : s.hidden} accessibilityElementsHidden={screen.name !== 'catalogue'} importantForAccessibility={screen.name === 'catalogue' ? 'auto' : 'no-hide-descendants'}><CatalogueScreen open={id => setScreen({ name: 'detail', id })} /></View>{screen.name === 'detail' && <ProductScreen key={screen.id} id={screen.id} findDealers={(product, variant) => setScreen({ name: 'dealers', product, variant })} />}{screen.name === 'dealers' && <DealerScreen product={screen.product} variant={screen.variant} signIn={signIn} addToEnquiry={addToEnquiry} />}{screen.name === 'auth' && <AuthScreen api={api} done={() => setScreen(returnScreen)} />}{screen.name === 'account' && <ScrollView contentContainerStyle={s.content}><Text style={s.eyebrow}>SMARTTRADE ACCOUNT</Text>{session.account ? <RoleIdentity account={session.account} heading /> : <Text style={s.title}>Signed out</Text>}<View style={s.panel}><Text>Account status: {session.account?.access_state ?? 'No session'}</Text><Text>Phone ownership: {session.account?.mobile_verified ? 'Verified' : 'Unverified'}</Text><Text style={s.body}>Signing in does not grant company verification, dealer verification or company authorization.</Text>{session.account ? <>{session.account.account_type === 'PERSONAL' && <Button variant="tertiary" title="Personal profile" onPress={() => setScreen({ name: 'personal-profile' })} />}<ActionCompany open={() => setScreen({ name: 'company' })} />{session.account.account_type === 'BUSINESS' && <Button variant="tertiary" title="Dealer dashboard" onPress={() => setScreen({ name: 'dealer-workspace' })} />}{['PERSONAL', 'BUSINESS'].includes(session.account.account_type) && <Button variant="tertiary" title={session.account.account_type === 'BUSINESS' ? 'Incoming enquiries' : 'Enquiries and quotations'} onPress={() => setScreen({ name: 'enquiries' })} />}{['PERSONAL', 'BUSINESS'].includes(session.account.account_type) && <Button variant="tertiary" title={session.account.account_type === 'BUSINESS' ? 'Incoming orders' : 'Orders and invoices'} onPress={() => setScreen({ name: 'orders' })} />}<Button variant="destructive" icon="logout" title="Sign out" onPress={() => { void session.signOut(); setScreen({ name: 'catalogue' }); }} /></> : <Button variant="primary" icon="check" title="Sign in to your account" onPress={signIn} />}</View></ScrollView>}{screen.name === 'personal-profile' && <PersonalProfile key={session.account?.id} api={api} />}{screen.name === 'company' && <CompanyScreen api={api} />}{screen.name === 'dealer-workspace' && <DealerWorkspace api={api} />}{screen.name === 'enquiries' && <EnquiryWorkspace api={api} draft={draft} setDraft={setDraft} />}{screen.name === 'orders' && <OrderWorkspace api={api} />}</KeyboardAvoidingView></SafeAreaView>;
}
export default function App() { return <SessionProvider api={api}><Journey /></SessionProvider>; }

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f6f8f7' }, hidden: { display: 'none' }, content: { padding: 20, paddingBottom: 48, gap: 14 },
  topbar: { paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 20 : 8, paddingBottom: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#dce7e0' },
  brandRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  logo: { fontSize: 22, fontWeight: '800', color: '#12352b' }, eyebrow: { color: '#087f5b', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 }, title: { fontSize: 30, fontWeight: '700', color: '#17392d' }, heading: { fontSize: 20, fontWeight: '700', color: '#17392d' },
  body: { fontSize: 16, lineHeight: 24, color: '#344d41' }, muted: { color: '#52675c', fontSize: 14, lineHeight: 21 }, label: { fontWeight: '700', color: '#294b3a', fontSize: 15 }, price: { color: '#126743', fontSize: 22, fontWeight: '700' }, link: { color: '#126743', fontSize: 16, fontWeight: '600' },
  panel: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dce7e0', borderRadius: 14, padding: 18, gap: 12 }, field: { gap: 6 }, input: { borderWidth: 1, borderColor: '#9fb7aa', borderRadius: 9, padding: 12, minHeight: 48, fontSize: 16, color: '#17392d', backgroundColor: '#fff' },
      row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, error: { color: '#9c2820', fontSize: 16, lineHeight: 23 },
});
