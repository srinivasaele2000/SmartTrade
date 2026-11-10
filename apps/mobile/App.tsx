import {SafeAreaProvider, SafeAreaView, initialWindowMetrics, useSafeAreaInsets} from 'react-native-safe-area-context';
import {StickyBottomBar} from './src/StickyBottomBar';
import {Button} from './src/Button';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiClient, ApiError, type CatalogueFilters, type DealerFilters, type Product } from './src/api';
import { inventoryLabel, matchLabel, variantListings, type Resource } from './src/resource';
import { SessionProvider, useSession } from './src/session';
import AuthScreen from './src/AuthScreen';
import CompanyScreen from './src/CompanyScreen';
import DealerWorkspace from './src/DealerWorkspace';
import {PersonalProfile} from './src/Onboarding';
import {RoleIdentity} from './src/RoleIdentity';
import {CatalogueImage, CataloguePdf} from './src/CatalogueMedia';
import {CategoryTile, ProductBrowseCard} from './src/CatalogueBrowseCards';
import {loadBrowseAvailability, matchesBrowseFilter, type Availability, type BrowseFilter} from './src/catalogue-browse';
import EnquiryWorkspace from './src/EnquiryWorkspace';
import OrderWorkspace from './src/OrderWorkspace';
import OfflineDocumentsScreen from './src/OfflineDocumentsScreen';
import DemoRoleSwitcher from './src/DemoRoleSwitcher';
import {configuredDemoPersonas} from './src/demo-roles';
import type {Account} from './src/auth';
import type { DraftLine } from './src/enquiries';
import { useResource } from './src/useResource';
import { inr, indianNumber, indianPinDigits, INDIAN_PIN, PIN_HELP } from './src/india';

const api = new ApiClient(process.env.EXPO_PUBLIC_API_URL ?? '');
const demoPersonas = configuredDemoPersonas(api.base, process.env.EXPO_PUBLIC_ENABLE_DEMO_ROLES, {
  PERSONAL: process.env.EXPO_PUBLIC_DEMO_BUYER_MOBILE,
  BUSINESS: process.env.EXPO_PUBLIC_DEMO_DEALER_MOBILE,
  COMPANY: process.env.EXPO_PUBLIC_DEMO_COMPANY_MOBILE,
  STAFF: process.env.EXPO_PUBLIC_DEMO_STAFF_MOBILE,
});
type Screen = {name: 'offline-documents'} | { name: 'personal-profile' } | { name: 'orders'; fromDealerDashboard?: boolean } | { name: 'enquiries' } | { name: 'dealer-workspace' } | { name: 'company' } | { name: 'auth' } | { name: 'account' } | { name: 'catalogue' } | { name: 'detail'; id: number } | { name: 'dealers'; product: Product; variant: number | null };


function Field({ label, value, onChange, postalPin = false }: { label: string; value: string; onChange: (value: string) => void; postalPin?: boolean }) {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={postalPin ? text => onChange(indianPinDigits(text)) : onChange} maxLength={postalPin ? 6 : undefined} style={s.input} keyboardType={postalPin ? 'number-pad' : 'default'} autoCorrect={false} returnKeyType="search" />{postalPin && <Text style={value && !INDIAN_PIN.test(value) ? s.error : s.muted}>{PIN_HELP}</Text>}</View>;
}
function Feedback<T>({ state, retry }: { state: Resource<T>; retry: () => void }) {
  if (state.status === 'loading') return <View style={s.panel}><ActivityIndicator accessibilityLabel="Loading" /><Text accessibilityLiveRegion="polite">Loading SmartTrade…</Text></View>;
  if (state.status === 'error') return <View style={s.panel}><Text accessibilityRole="alert" style={s.error}>{state.message}</Text><Button variant="tertiary" icon="refresh" title="Retry" onPress={retry} /></View>;
  return null;
}
function Pager({ page, next, previous, onPage }: { page: number; next: string | null; previous: string | null; onPage: (page: number) => void }) {
  return <View style={s.row}><Button variant="tertiary" icon="back" title="Previous page" disabled={!previous} onPress={() => onPage(page - 1)} /><Text>Page {page}</Text><Button variant="tertiary" icon="next" title="Next page" disabled={!next} onPress={() => onPage(page + 1)} /></View>;
}

const quickFilters = [
  ['all', 'All'], ['stock', 'In Stock'], ['pdf', 'With Catalogue'], ['authorized', 'Authorized Only'],
] as const;

export function CatalogueScreen({open, active = true}: {open: (id: number) => void; active?: boolean}) {
  const {token} = useSession();
  const {bottom} = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<CatalogueFilters>({});
  const [quickFilter, setQuickFilter] = useState<BrowseFilter>('all');
  const [page, setPage] = useState(1), [categoryPage, setCategoryPage] = useState(1), [brandPage, setBrandPage] = useState(1);
  const products = useResource(useCallback(signal => api.products(filters, page, signal), [filters, page]));
  const categories = useResource(useCallback(signal => api.categories(categoryPage, signal), [categoryPage]));
  const brands = useResource(useCallback(signal => api.brands({category: filters.category}, brandPage, signal), [filters.category, brandPage]));
  const productPage = products.state.status === 'ready' ? products.state.data : null;
  const [availability, setAvailability] = useState<{
    page: typeof productPage; token: string; items: Map<number, Availability>;
  }>();
  const [attempt, retryAvailability] = useState(0);
  useEffect(() => {
    if (!active || !token || !productPage?.results.length) return;
    const controller = new AbortController();
    const ids = productPage.results.map(product => product.id);
    void loadBrowseAvailability(api, ids, token, controller.signal).then(items => {
      if (!controller.signal.aborted) setAvailability({page: productPage, token, items});
    });
    return () => controller.abort();
  }, [active, productPage, token, attempt]);

  const facts = availability && availability.page === productPage && availability.token === token ? availability.items : undefined;
  const checksDealerAvailability = quickFilter === 'stock' || quickFilter === 'authorized';
  const waitingForAvailability = Boolean(checksDealerAvailability && token && productPage?.results.length && !facts);
  const visibleProducts = productPage?.results.filter(product => matchesBrowseFilter(product, quickFilter, facts?.get(product.id))) ?? [];
  const incompleteAvailability = checksDealerAvailability && facts && productPage?.results.some(product =>
    !facts.has(product.id) || (quickFilter === 'stock' && facts.get(product.id)?.inStock === null));
  const selectCategory = (category?: string) => {
    setFilters(current => ({...current, category, brand: undefined}));
    setPage(1); setBrandPage(1);
  };
  const submitSearch = () => {
    setFilters(current => ({...current, search: search.trim()}));
    setPage(1);
  };
  const clearFilters = () => {
    setSearch(''); setFilters({}); setQuickFilter('all');
    setPage(1); setCategoryPage(1); setBrandPage(1);
  };
  return <ScrollView stickyHeaderIndices={[0]} keyboardShouldPersistTaps="handled"
    contentContainerStyle={{paddingBottom: Math.max(20, bottom + 8)}}>
    <View style={s.browseHeader}>
      <View style={s.searchRow}>
        <TextInput accessibilityLabel="Search products, codes or SKUs" placeholder="Search products, codes or SKUs"
          value={search} onChangeText={setSearch} onSubmitEditing={submitSearch}
          autoCorrect={false} returnKeyType="search" style={[s.input, s.searchInput]} />
        <Button variant="primary" title="Search" accessibilityLabel="Search catalogue" onPress={submitSearch} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.chipRow}>
        {quickFilters.map(([value, label]) => <Pressable key={value} accessibilityRole="button"
          accessibilityState={{selected: quickFilter === value}} onPress={() => setQuickFilter(value)}
          style={[s.chip, quickFilter === value && s.chipSelected]}>
          <Text style={[s.chipLabel, quickFilter === value && s.chipLabelSelected]}>{label}</Text>
        </Pressable>)}
      </ScrollView>
    </View>
    <View style={s.browseContent}>
      <Text style={s.eyebrow}>SMARTTRADE / CATALOGUE</Text>
      <Text accessibilityRole="header" style={s.title}>Explore company products</Text>
      <Text style={s.body}>Browse products from companies and compare prices and stock at dealer branches.</Text>
      <Text accessibilityRole="header" style={s.heading}>Shop by category</Text>
      <Feedback {...categories} />
      {categories.state.status === 'ready' && <>
        <View style={s.categoryGrid}>
          <CategoryTile name="All categories" all selected={!filters.category} onPress={() => selectCategory()} />
          {categories.state.data.results.filter(category => category.active).map(category =>
            <CategoryTile key={category.id} name={category.name} selected={filters.category === String(category.id)}
              onPress={() => selectCategory(String(category.id))} />)}
        </View>
        {categories.state.data.count === 0 && <Text>No categories are available yet.</Text>}
        {(categories.state.data.next || categories.state.data.previous) &&
          <Pager page={categoryPage} {...categories.state.data} onPage={setCategoryPage} />}
      </>}
      <Text accessibilityRole="header" style={s.heading}>Brands</Text>
      <Feedback {...brands} />
      {brands.state.status === 'ready' && <>
        <View style={s.wrap}>
          <Button variant="navigation" title="All brands" selected={!filters.brand}
            onPress={() => {setFilters(current => ({...current, brand: undefined})); setPage(1);}} />
          {brands.state.data.results.map(brand => <Button variant="navigation" key={brand.id}
            title={`${brand.name} · ${brand.company_name}`} selected={filters.brand === String(brand.id)}
            onPress={() => {setFilters(current => ({...current, brand: String(brand.id)})); setPage(1);}} />)}
        </View>
        {brands.state.data.count === 0 && <Text>No published brands are available for this category.</Text>}
        {(brands.state.data.next || brands.state.data.previous) && <Pager page={brandPage} {...brands.state.data} onPage={setBrandPage} />}
      </>}
      <View style={s.row}>
        <Text accessibilityRole="header" style={s.heading}>Products</Text>
        {(search || filters.category || filters.brand || quickFilter !== 'all') &&
          <Button variant="tertiary" title="Clear filters" onPress={clearFilters} />}
      </View>
      <Feedback {...products} />
      {checksDealerAvailability && !token && <Text style={s.body}>Sign in to check stock and find listings from authorized dealers.</Text>}
      {waitingForAvailability && <View style={s.row}><ActivityIndicator /><Text>Checking dealer availability…</Text></View>}
      {incompleteAvailability && <View style={s.panel}><Text>Some dealer listings couldn’t be checked.</Text>
        <Button variant="tertiary" title="Retry availability" onPress={() => {setAvailability(undefined); retryAvailability(n => n + 1);}} />
      </View>}
      {productPage && <>
        {(!checksDealerAvailability || token) && !waitingForAvailability && <>
          <Text accessibilityLiveRegion="polite">{quickFilter === 'all' ? `${productPage.count} matching products` : `${visibleProducts.length} matches on this page`}</Text>
          {visibleProducts.length === 0 && !incompleteAvailability && <View style={s.panel}><Text>{
            quickFilter !== 'all' ? 'No products on this page match this quick filter. Try another filter or check the next page.'
              : filters.search ? `No products found for “${filters.search}”. Check the spelling or browse categories.`
              : 'No products match these filters. Clear filters or browse another category.'
          }</Text></View>}
          {visibleProducts.map(product => <ProductBrowseCard key={product.id} product={product} apiBase={api.base}
            availability={facts?.get(product.id)} onOpen={() => open(product.id)} />)}
        </>}
        <Pager page={page} {...productPage} onPage={setPage} />
      </>}
    </View>
  </ScrollView>;
}

export function ProductScreen({ id, findDealers }: { id: number; findDealers: (product: Product, variant: number | null) => void }) {
  const product = useResource(useCallback(signal => api.product(id, signal), [id]));
  const [variant, setVariant] = useState<number | null>(null);
  return <View style={s.safe}><ScrollView contentContainerStyle={s.content}><Feedback {...product} />{product.state.status === 'ready' && (() => {
    const p = product.state.data;
    return <><CatalogueImage apiBase={api.base} reference={p.primary_image_url} name={p.name} detail /><CataloguePdf apiBase={api.base} reference={p.catalogue_pdf_url} productId={p.id} productName={p.name} /><Text style={s.eyebrow}>{p.company_name}</Text><Text accessibilityRole="header" style={s.title}>{p.name}</Text><Text style={s.body}>{p.brand_name} · {p.category_name} · {p.code}</Text><View style={s.panel}><Text style={s.label}>Company catalogue price</Text><Text style={s.price}>{p.catalogue_price === null ? 'Not provided' : inr(p.catalogue_price)}</Text><Text>Unit: {p.unit}</Text><Text style={s.muted}>Dealer branch prices may differ. No tax or delivery amount is inferred.</Text></View><Text style={s.body}>{p.description || 'No description provided.'}</Text>
      <Text accessibilityRole="header" style={s.heading}>Specifications</Text>{Object.keys(p.specifications).length === 0 ? <Text>No specifications provided.</Text> : Object.entries(p.specifications).map(([key, value]) => <Text key={key} style={s.body}>{key}: {typeof value === 'string' ? value : JSON.stringify(value)}</Text>)}
      <Text accessibilityRole="header" style={s.heading}>Variants / SKUs</Text><Button variant="navigation" title="Compare all product listings" selected={variant === null} onPress={() => setVariant(null)} />{p.variants.length === 0 && <View style={s.panel}><Text>No active variants are available. Product-level dealer listings may still be compared.</Text></View>}{p.variants.map(v => <View key={v.id} style={s.panel}><Button variant="navigation" title={`${v.name} · SKU ${v.sku}`} selected={variant === v.id} onPress={() => setVariant(v.id)} /><Text style={s.muted}>{Object.entries(v.attributes).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · ') || 'No variant attributes provided.'}</Text></View>)}</>;
  })()}</ScrollView>{product.state.status === 'ready' && <StickyBottomBar>
    <Button variant="primary" icon="search" title={variant === null ? "Find dealer branches for this product" : "Find dealer branches for selected SKU"}
      onPress={() => { if (product.state.status === 'ready') findDealers(product.state.data, variant); }} />
  </StickyBottomBar>}</View>;
}

export function DealerResults({ product, variant, token, invalidate, addToEnquiry }: { product: Product; variant: number | null; token: string; invalidate: () => void; addToEnquiry?: (line: DraftLine) => void }) {
  const [pin, setPin] = useState(''), [locality, setLocality] = useState(''), [district, setDistrict] = useState(''), [stock, setStock] = useState('');
  const [filters, setFilters] = useState<DealerFilters>({}), [page, setPage] = useState(1);
  const load = useCallback(async (signal: AbortSignal) => {
    try { return await api.dealers(product.id, { ...filters, ...(variant === null ? {} : { variant: String(variant) }) }, page, token, signal); }
    catch (error) { if (error instanceof ApiError && error.status === 401) invalidate(); throw error; }
  }, [product.id, variant, filters, page, token, invalidate]);
  const result = useResource(load);
  return <View style={s.safe}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><Text accessibilityRole="header" style={s.title}>Compare dealer branches</Text><Text style={s.body}>{product.name}{variant !== null ? ` · SKU ${product.variants.find(v => v.id === variant)?.sku ?? variant}` : ' · all product/variant listings'}</Text>
    <View style={s.panel}><Field label="Postal PIN code" postalPin value={pin} onChange={setPin} /><Field label="Locality (optional)" value={locality} onChange={setLocality} /><Field label="District (optional)" value={district} onChange={setDistrict} /><View style={s.wrap}>{[['', 'Any stock status'], ['IN_STOCK', 'In stock'], ['OUT_OF_STOCK', 'Out of stock'], ['UNKNOWN', 'Not confirmed']].map(([value, title]) => <Button variant="navigation" key={value} title={title} selected={stock === value} onPress={() => setStock(value)} />)}</View></View>
    <Text style={s.muted}>All prices are in Indian rupees. Listings do not reserve stock.</Text>{variant !== null && <Text style={s.muted}>Showing dealer listings for the selected variant.</Text>}<Feedback {...result} />
    {result.state.status === 'ready' && (() => {
      const data = result.state.data, rows = variantListings(data.results, variant);
      return <><Text accessibilityLiveRegion="polite" style={s.label}>{matchLabel(data.match_level)}</Text><Text>{data.count} matching listings{variant === null ? ' across all variants' : ' for this SKU'}; {rows.length} shown on this page.</Text>{rows.length === 0 && <View style={s.panel}><Text>{data.count === 0 ? 'No eligible listings match these filters. This does not confirm that the product is out of stock everywhere.' : 'No listings for this variant on this page. Check other pages or compare all product listings.'}</Text></View>}{rows.map(item => <View key={item.id} style={s.panel}><Text accessibilityRole="header" style={s.heading}>{item.branch.branch_name}</Text><Text>{item.business_name}</Text><Text style={s.price}>{inr(item.selling_price)}</Text><Text style={s.label}>{inventoryLabel(item)}</Text><Text>Variant: {item.variant === null ? 'Product-level listing' : product.variants.find(v => v.id === item.variant)?.sku ?? `ID ${item.variant}`}</Text><Text style={s.body}>{[item.branch.address, item.branch.locality, item.branch.district, item.branch.pin_code, item.branch.state, 'India'].join(', ')}</Text>{addToEnquiry && <Button variant="primary" icon="plus" title="Add to enquiry" onPress={() => addToEnquiry({ listing: item.id, branch: item.branch.id, branch_name: item.branch.branch_name, dealer_name: item.business_name, product_name: product.name, variant_sku: item.variant === null ? null : product.variants.find(v => v.id === item.variant)?.sku ?? null, quantity: '1', requirement: '' })} />}</View>)}<Pager page={page} {...data} onPage={setPage} /><Button variant="tertiary" icon="refresh" title="Refresh current inventory page" onPress={result.retry} /></>;
    })()}
  </ScrollView><StickyBottomBar><Button variant="primary" icon="search" title="Search dealer branches" disabled={Boolean(pin && !INDIAN_PIN.test(pin))} onPress={() => { setFilters({ pin_code: pin.trim(), locality: locality.trim(), district: district.trim(), stock_status: stock }); setPage(1); }} /></StickyBottomBar></View>;
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
  const [switchNotice, setSwitchNotice] = useState('');
  useEffect(() => {
    if (!switchNotice) return;
    const timeout = setTimeout(() => setSwitchNotice(''), 3000);
    return () => clearTimeout(timeout);
  }, [switchNotice]);
  function onDemoSwitch(profile: Account) {
    const role = profile.account_type;
    const destinations: Record<Account['account_type'], Screen> = {
      PERSONAL: {name: 'catalogue'}, BUSINESS: {name: 'dealer-workspace'}, COMPANY: {name: 'company'}, STAFF: {name: 'account'},
    };
    setDraft([]);
    setReturnScreen({name: 'catalogue'});
    setScreen(destinations[role]);
    const label = role === 'STAFF' && Array.isArray(profile.staff_profile?.roles) && profile.staff_profile.roles.includes('PLATFORM_ADMIN') ? 'Platform Admin'
      : ({PERSONAL: 'Buyer', BUSINESS: 'Dealer', COMPANY: 'Company', STAFF: 'Staff'} as const)[role];
    setSwitchNotice(`Switched to ${label} mode`);
  }
  const session = useSession();
  const signIn = () => { setReturnScreen(screen); setScreen({ name: 'auth' }); };
  const back = useCallback(() => setScreen(current => {
    if (current.name === 'dealers') return { name: 'detail', id: current.product.id };
    if (current.name === 'orders' && current.fromDealerDashboard) return {name: 'dealer-workspace'};
    return { name: current.name === 'personal-profile' || current.name === 'offline-documents' ? 'account' : 'catalogue' };
  }), []);
  const addToEnquiry = (line: DraftLine) => { setDraft(current => { if (current.length && current[0].branch !== line.branch) { Alert.alert('One branch per enquiry', 'Submit or clear the current draft before selecting another dealer branch.'); return current; } return current.some(item => item.listing === line.listing) ? current : [...current, line]; }); setScreen({ name: 'enquiries' }); };
  useEffect(() => { const listener = BackHandler.addEventListener('hardwareBackPress', () => { if (screen.name === 'catalogue') return false; back(); return true; }); return () => listener.remove(); }, [screen.name, back]);
  return <SafeAreaView style={s.safe} edges={["top", "left", "right"]}><StatusBar barStyle="dark-content" /><KeyboardAvoidingView style={s.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={s.topbar}><View style={s.brandRow}><Text style={s.logo}>SmartTrade</Text><RoleIdentity account={session.account} /></View><View style={s.headerActions}><Button variant="tertiary" title={session.account ? 'My account' : 'Sign in'} onPress={() => session.account ? setScreen({ name: 'account' }) : signIn()} />{screen.name !== 'catalogue' && <Button variant="tertiary" icon="back" title="Back" onPress={back} />}</View></View>{switchNotice !== '' && <View style={s.switchNotice}><Text accessibilityLiveRegion="polite" style={s.label}>{switchNotice}</Text></View>}{session.message !== '' && <View style={s.banner}><Text accessibilityLiveRegion="polite" style={s.body}>{session.message}</Text></View>}<View style={screen.name === 'catalogue' ? s.safe : s.hidden} accessibilityElementsHidden={screen.name !== 'catalogue'} importantForAccessibility={screen.name === 'catalogue' ? 'auto' : 'no-hide-descendants'}><CatalogueScreen key={session.account?.id ?? 'guest'} active={screen.name === 'catalogue'} open={id => setScreen({ name: 'detail', id })} /></View>{screen.name === 'detail' && <ProductScreen key={screen.id} id={screen.id} findDealers={(product, variant) => setScreen({ name: 'dealers', product, variant })} />}{screen.name === 'dealers' && <DealerScreen product={screen.product} variant={screen.variant} signIn={signIn} addToEnquiry={addToEnquiry} />}{screen.name === 'auth' && <AuthScreen api={api} done={() => setScreen(returnScreen)} />}{screen.name === 'account' && <ScrollView contentContainerStyle={s.content}><Text style={s.eyebrow}>SMARTTRADE ACCOUNT</Text>{session.account ? <RoleIdentity account={session.account} heading /> : <Text style={s.title}>Signed out</Text>}<View style={s.panel}><Text>Account status: {session.account?.access_state ?? 'No session'}</Text><Text>Mobile number: {session.account?.mobile_verified ? 'Verified' : 'Unverified'}</Text><Text style={s.body}>You can manage your profile here. Business verification is reviewed separately.</Text>{session.account ? <>{session.account.account_type === 'PERSONAL' && <Button variant="tertiary" title="Personal profile" onPress={() => setScreen({ name: 'personal-profile' })} />}<ActionCompany open={() => setScreen({ name: 'company' })} />{session.account.account_type === 'BUSINESS' && <Button variant="tertiary" title="Dealer dashboard" onPress={() => setScreen({ name: 'dealer-workspace' })} />}{['PERSONAL', 'BUSINESS'].includes(session.account.account_type) && <Button variant="tertiary" title={session.account.account_type === 'BUSINESS' ? 'Incoming enquiries' : 'Enquiries and quotations'} onPress={() => setScreen({ name: 'enquiries' })} />}{['PERSONAL', 'BUSINESS'].includes(session.account.account_type) && <Button variant="tertiary" title={session.account.account_type === 'BUSINESS' ? 'Incoming orders' : 'Orders and invoices'} onPress={() => setScreen({ name: 'orders' })} />}<Button variant="tertiary" icon="file" title="Offline Documents" onPress={() => setScreen({name: 'offline-documents'})} /><DemoRoleSwitcher api={api} configured={demoPersonas} onSwitch={onDemoSwitch} /><Button variant="destructive" icon="logout" title="Sign out" onPress={() => { void session.signOut(); setScreen({ name: 'catalogue' }); }} /></> : <Button variant="primary" icon="check" title="Sign in to your account" onPress={signIn} />}</View></ScrollView>}{screen.name === 'offline-documents' && session.account && <OfflineDocumentsScreen key={session.account.id} accountId={session.account.id} />}{screen.name === 'personal-profile' && <PersonalProfile key={session.account?.id} api={api} />}{screen.name === 'company' && <CompanyScreen api={api} />}{screen.name === 'dealer-workspace' && <DealerWorkspace api={api} onOpenOrders={() => setScreen({name: 'orders', fromDealerDashboard: true})} />}{screen.name === 'enquiries' && <EnquiryWorkspace api={api} draft={draft} setDraft={setDraft} />}{screen.name === 'orders' && <OrderWorkspace api={api} />}</KeyboardAvoidingView></SafeAreaView>;
}
export default function App() { return <SafeAreaProvider initialMetrics={initialWindowMetrics}><SessionProvider api={api}><Journey /></SessionProvider></SafeAreaProvider>; }

const s = StyleSheet.create({
  browseHeader: {paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8, backgroundColor: '#f6f8f6', borderBottomWidth: 1, borderColor: '#dce7e0'},
  searchRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  searchInput: {flex: 1, minWidth: 0, backgroundColor: '#fff'},
  chipRow: {gap: 8},
  chip: {minHeight: 44, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: '#d3ddd7', backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 8},
  chipSelected: {backgroundColor: '#14553e', borderColor: '#14553e'},
  chipLabel: {color: '#294b3a', fontSize: 14, fontWeight: '700'},
  chipLabelSelected: {color: '#fff'},
  browseContent: {padding: 16, gap: 14},
  categoryGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  banner: {backgroundColor: '#fff4d6', paddingVertical: 10, paddingHorizontal: 18},
  safe: { flex: 1, backgroundColor: '#f6f8f7' }, hidden: { display: 'none' }, content: { padding: 20, paddingBottom: 48, gap: 14 },
  topbar: { paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 20 : 8, paddingBottom: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#dce7e0' },
  switchNotice: {position: 'absolute', top: 110, zIndex: 10, alignSelf: 'center', padding: 10, borderRadius: 20, backgroundColor: '#e0f3e7'},
  brandRow: { flexShrink: 1, maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  logo: { fontSize: 22, fontWeight: '800', color: '#12352b' }, eyebrow: { color: '#087f5b', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 }, title: { fontSize: 30, fontWeight: '700', color: '#17392d' }, heading: { fontSize: 20, fontWeight: '700', color: '#17392d' },
  body: { fontSize: 16, lineHeight: 24, color: '#344d41' }, muted: { color: '#52675c', fontSize: 14, lineHeight: 21 }, label: { fontWeight: '700', color: '#294b3a', fontSize: 15 }, price: { color: '#126743', fontSize: 22, fontWeight: '700' }, link: { color: '#126743', fontSize: 16, fontWeight: '600' },
  panel: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dce7e0', borderRadius: 14, padding: 18, gap: 12 }, field: { gap: 6 }, input: { borderWidth: 1, borderColor: '#9fb7aa', borderRadius: 9, padding: 12, minHeight: 48, fontSize: 16, color: '#17392d', backgroundColor: '#fff' },
      row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, error: { color: '#9c2820', fontSize: 16, lineHeight: 23 },
});
