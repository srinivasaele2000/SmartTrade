import {showAlert} from './src/platform-alert';
import {SHOW_DEALER_INCOMING_COMMERCIAL_MODULES} from './src/featureFlags';
import DealerBannerCarousel, {type DealerBanner} from './src/DealerBannerCarousel';
import SupportChat, {useDealerSupportUnread} from './src/SupportChat';
import NearbyDealersScreen from './src/NearbyDealersScreen';
import {useCustomerLocation} from './src/useCustomerLocation';
import {SafeAreaProvider, SafeAreaView, initialWindowMetrics, useSafeAreaInsets} from 'react-native-safe-area-context';
import {StickyBottomBar} from './src/StickyBottomBar';
import DealerOnboardingScreen from './src/DealerOnboardingScreen';
import DealerWorkerContactsScreen from './src/DealerWorkerContactsScreen';
import DealerEstimateScreen from './src/DealerEstimateScreen';
import WorkforceProfileScreen from './src/WorkforceProfileScreen';
import {isWorkforce, workforce} from './src/workforce-profile';
import {Button} from './src/Button';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, RefreshControl, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiClient, ApiError, type Branch, type CatalogueFilters, type DealerFilters, type Product } from './src/api';
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
import { inr, indianPinDigits, INDIAN_PIN, PIN_HELP } from './src/india';
import {trade, tradeType} from './src/trade-theme';

const configuredApi = process.env.EXPO_PUBLIC_API_URL?.trim();
const api = new ApiClient(Platform.OS === 'web'
  ? new URL(configuredApi || '/api/v1', window.location.origin).href
  : configuredApi ?? '');
const demoPersonas = configuredDemoPersonas(api.base, process.env.EXPO_PUBLIC_ENABLE_DEMO_ROLES, {
  PERSONAL: process.env.EXPO_PUBLIC_DEMO_BUYER_MOBILE,
  BUSINESS: process.env.EXPO_PUBLIC_DEMO_DEALER_MOBILE,
  COMPANY: process.env.EXPO_PUBLIC_DEMO_COMPANY_MOBILE,
  STAFF: process.env.EXPO_PUBLIC_DEMO_STAFF_MOBILE,
  SERVICE_PROVIDER: process.env.EXPO_PUBLIC_DEMO_SERVICE_PROVIDER_MOBILE,
  JOB_SEEKER: process.env.EXPO_PUBLIC_DEMO_JOB_SEEKER_MOBILE,
  EMPLOYER: process.env.EXPO_PUBLIC_DEMO_EMPLOYER_MOBILE,
});
type Screen = {name: 'support'} | {name: 'nearby'; item?: number; brand?: string; category?: string; search?: string} | {name: 'dealer-estimate'; bills?: boolean; general?: boolean} | {name: 'workforce-profile'} | {name: 'dealer-onboarding'} | {name: 'offline-documents'} | { name: 'personal-profile' } | { name: 'orders'; fromDealerDashboard?: boolean } | { name: 'enquiries' } | { name: 'dealer-workspace' } | { name: 'company' } | { name: 'auth' } | { name: 'account' } | { name: 'catalogue' } | { name: 'detail'; id: number } | { name: 'dealers'; product: Product; variant: number | null };


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

export function CatalogueScreen({open, active = true, nearby, openSupport}: {open: (id: number) => void; active?: boolean; nearby?: (filters: {brand?: string; category?: string; search?: string}) => void; openSupport?: () => void}) {
  const {token, account} = useSession();
  const dealerToken = active && account?.account_type === 'BUSINESS' && account.dealer_contacts_complete ? token : null;
  const {bottom} = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<CatalogueFilters>({});
  const [quickFilter, setQuickFilter] = useState<BrowseFilter>('all');
  const [page, setPage] = useState(1), [categoryPage, setCategoryPage] = useState(1), [brandPage, setBrandPage] = useState(1);
  const products = useResource(useCallback(signal => api.products(filters, page, signal), [filters, page]));
  const categories = useResource(useCallback(signal => api.categories(categoryPage, signal), [categoryPage]));
  const brands = useResource(useCallback(signal => api.brands({category: filters.category}, brandPage, signal), [filters.category, brandPage]));
  const bannerFeed = useResource(useCallback(async signal => {
    if (!dealerToken) return {banners: [] as DealerBanner[]};
    return api.get('/banners/dealer/', signal, dealerToken) as Promise<{banners: DealerBanner[]}>;
  }, [dealerToken]));
  const refreshBanners = bannerFeed.retry;
  useEffect(() => {
    if (!dealerToken) return;
    const subscription = AppState.addEventListener('change', state => {if (state === 'active') refreshBanners();});
    return () => subscription.remove();
  }, [dealerToken, refreshBanners]);
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
  const banners = dealerToken ? bannerFeed.state?.data?.banners ?? [] : [];
  const openBanner = (banner: DealerBanner) => {
    if (banner.target_type === 'support_chat') openSupport?.();
    if (banner.target_type === 'item' && banner.target_item_id) open(banner.target_item_id);
    if (banner.target_type === 'brand' && banner.target_brand_id) {
      clearFilters();
      setFilters({brand: String(banner.target_brand_id)});
    }
    if (banner.target_type === 'category' && banner.target_category_id) {
      clearFilters();
      setFilters({category: String(banner.target_category_id)});
    }
  };
  return <ScrollView stickyHeaderIndices={banners.length ? [1] : [0]} keyboardShouldPersistTaps="handled"
    refreshControl={dealerToken ? <RefreshControl refreshing={bannerFeed.state?.status === 'loading'}
      onRefresh={() => {refreshBanners(); products.retry();}} /> : undefined}
    contentContainerStyle={{paddingBottom: Math.max(20, bottom + 8)}}>
    {dealerToken && banners.length > 0 && <DealerBannerCarousel banners={banners} base={api.base}
      token={dealerToken} onOpen={openBanner} />}
    <View style={s.browseHeader}>
      <View style={s.searchRow}>
        <TextInput accessibilityLabel="Search products, codes or SKUs" placeholder="Name, code, HSN or brand"
          value={search} onChangeText={setSearch} onSubmitEditing={submitSearch}
          autoCorrect={false} returnKeyType="search" style={[s.input, s.searchInput]} />
        {!!search && <Button variant="tertiary" compact title="×" accessibilityLabel="Clear search" onPress={() => {
          setSearch(''); setFilters(current => ({...current, search: undefined})); setPage(1);
        }} />}
        <Button variant="primary" compact title="Search" accessibilityLabel="Search catalogue" onPress={submitSearch} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.chipRow}>
        {productPage && <Text style={s.countBadge}>{productPage.count} products</Text>}
        <Text style={s.chipLabel}>Shop by category</Text>
        {categories.state.status === 'ready' && <>
          <CategoryTile name="All categories" all selected={!filters.category} onPress={() => selectCategory()} />
          {categories.state.data.results.filter(category => category.active).map(category =>
            <CategoryTile key={category.id} name={category.name} selected={filters.category === String(category.id)}
              onPress={() => selectCategory(String(category.id))} />)}
        </>}
        {brands.state.status === 'ready' && <>
          <Button variant="navigation" compact title="All brands" selected={!filters.brand}
            onPress={() => {setFilters(current => ({...current, brand: undefined})); setPage(1);}} />
          {brands.state.data.results.map(brand => <Button variant="navigation" compact key={brand.id}
            title={`${brand.name} · ${brand.company_name}`} selected={filters.brand === String(brand.id)}
            onPress={() => {setFilters(current => ({...current, brand: String(brand.id)})); setPage(1);}} />)}
        </>}
        {quickFilters.map(([value, label]) => <Pressable key={value} accessibilityRole="button"
          accessibilityState={{selected: quickFilter === value}} hitSlop={{top: 6, bottom: 6}} onPress={() => setQuickFilter(value)}
          style={[s.chip, quickFilter === value && s.chipSelected]}>
          <Text style={[s.chipLabel, quickFilter === value && s.chipLabelSelected]}>{label}</Text>
        </Pressable>)}
      </ScrollView>
    </View>
    <View style={s.browseContent}>
      <Feedback {...categories} />
      {categories.state.status === 'ready' && <>
        {categories.state.data.count === 0 && <Text>No categories are available yet.</Text>}
        {(categories.state.data.next || categories.state.data.previous) &&
          <Pager page={categoryPage} {...categories.state.data} onPage={setCategoryPage} />}
      </>}
      <Feedback {...brands} />
      {brands.state.status === 'ready' && <>
        {brands.state.data.count === 0 && <Text>No published brands are available for this category.</Text>}
        {(brands.state.data.next || brands.state.data.previous) && <Pager page={brandPage} {...brands.state.data} onPage={setBrandPage} />}
      </>}
      <View style={s.row}>
        <Text accessibilityRole="header" style={s.heading}>{productPage
          ? quickFilter === 'all' ? `${productPage.count} matching products` : `${visibleProducts.length} matches on this page`
          : 'Products'}</Text>
        {(search || filters.category || filters.brand || quickFilter !== 'all') &&
          <Button variant="tertiary" title="Clear filters" onPress={clearFilters} />}
      </View>
      {nearby && <Button variant="secondary" title="Find nearby verified dealers" onPress={() => nearby(filters)} />}
      <Feedback {...products} />
      {checksDealerAvailability && !token && <Text style={s.body}>Sign in to check stock and find listings from authorized dealers.</Text>}
      {waitingForAvailability && <View style={s.row}><ActivityIndicator /><Text>Checking dealer availability…</Text></View>}
      {incompleteAvailability && <View style={s.panel}><Text>Some dealer listings couldn’t be checked.</Text>
        <Button variant="tertiary" title="Retry availability" onPress={() => {setAvailability(undefined); retryAvailability(n => n + 1);}} />
      </View>}
      {productPage && <>
        {(!checksDealerAvailability || token) && !waitingForAvailability && <>
          {visibleProducts.length === 0 && !incompleteAvailability && <View style={s.panel}><Text>{
            quickFilter !== 'all' ? 'No products on this page match this quick filter. Try another filter or check the next page.'
              : filters.search ? `No products found for “${filters.search}”. Check the spelling or browse categories.`
              : 'No products match these filters. Clear filters or browse another category.'
          }</Text></View>}
          <View style={s.productList}>{visibleProducts.map(product => <ProductBrowseCard key={product.id} product={product} apiBase={api.base}
            availability={facts?.get(product.id)} onOpen={() => open(product.id)} />)}</View>
        </>}
        <Pager page={page} {...productPage} onPage={setPage} />
      </>}
    </View>
  </ScrollView>;
}

export function ProductScreen({ id, findDealers, nearby }: { id: number; findDealers: (product: Product, variant: number | null) => void; nearby?: () => void }) {
  const product = useResource(useCallback(signal => api.product(id, signal), [id]));
  const [variant, setVariant] = useState<number | null>(null);
  return <View style={s.safe}><ScrollView contentContainerStyle={s.content}><Feedback {...product} />{product.state.status === 'ready' && (() => {
    const p = product.state.data;
    return <><CatalogueImage apiBase={api.base} reference={p.primary_image_url} name={p.name} detail /><CataloguePdf apiBase={api.base} reference={p.catalogue_pdf_url} productId={p.id} productName={p.name} /><Text style={s.eyebrow}>{p.company_name}</Text><Text accessibilityRole="header" style={s.title}>{p.name}</Text><Text style={s.body}>{p.brand_name} · {p.category_name} · {p.code}</Text><View style={s.panel}><Text style={s.label}>Company catalogue price</Text><Text style={s.price}>{p.catalogue_price === null ? 'Not provided' : inr(p.catalogue_price)}</Text><Text>Unit: {p.unit}</Text><Text style={s.muted}>Dealer branch prices may differ. No tax or delivery amount is inferred.</Text></View><Text style={s.body}>{p.description || 'No description provided.'}</Text>
      <Text accessibilityRole="header" style={s.heading}>Specifications</Text>{Object.keys(p.specifications).length === 0 ? <Text>No specifications provided.</Text> : Object.entries(p.specifications).map(([key, value]) => <Text key={key} style={s.body}>{key}: {typeof value === 'string' ? value : JSON.stringify(value)}</Text>)}
      <Text accessibilityRole="header" style={s.heading}>Variants / SKUs</Text><Button variant="navigation" title="Compare all product listings" selected={variant === null} onPress={() => setVariant(null)} />{p.variants.length === 0 && <View style={s.panel}><Text>No active variants are available. Product-level dealer listings may still be compared.</Text></View>}{p.variants.map(v => <View key={v.id} style={s.panel}><Button variant="navigation" title={`${v.name} · SKU ${v.sku}`} selected={variant === v.id} onPress={() => setVariant(v.id)} /><Text style={s.muted}>{Object.entries(v.attributes).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · ') || 'No variant attributes provided.'}</Text></View>)}</>;
  })()}</ScrollView>{product.state.status === 'ready' && <StickyBottomBar aboveTabs>
    {nearby && <Button variant="secondary" title="Nearby verified dealers" onPress={nearby} />}
    <Button variant="primary" icon="search" title={variant === null ? "Find dealer branches for this product" : "Find dealer branches for selected SKU"}
      onPress={() => { if (product.state.status === 'ready') findDealers(product.state.data, variant); }} />
  </StickyBottomBar>}</View>;
}

function BranchCatalogue({branch, token, close, open}: {branch: Branch; token: string; close: () => void; open?: (id: number) => void}) {
  const [page, setPage] = useState(1);
  const result = useResource(useCallback(signal => api.dealers(null, {location: String(branch.id)}, page, token, signal), [branch.id, page, token]));
  return <ScrollView contentContainerStyle={s.content}>
    <Text accessibilityRole="header" style={s.title}>{branch.branch_name} catalogue</Text>
    <Button variant="tertiary" compact icon="back" title="Back to comparison" onPress={close} />
    <Feedback {...result} />
    {result.state.status === 'ready' && <>
      {result.state.data.results.length === 0 && <Text>No active listings at this branch.</Text>}
      <View style={s.productList}>{result.state.data.results.map(item => <View key={item.id} style={s.dealerRow}>
        <CatalogueImage apiBase={api.base} reference={item.primary_image_url} name={item.product_name} compact />
        <View style={s.flexColumn}>
          <Text style={tradeType.row}>{item.product_name}</Text>
          <Text style={tradeType.meta}>{inventoryLabel(item)}</Text>
        </View>
        <View style={s.dealerActions}><Text style={tradeType.price}>{inr(item.selling_price)}</Text>
          {open && <Button variant="tertiary" compact title="View product" onPress={() => open(item.product)} />}
        </View>
      </View>)}</View>
      <Pager page={page} {...result.state.data} onPage={setPage} />
    </>}
  </ScrollView>;
}

export function DealerResults({ product, variant, token, invalidate, addToEnquiry, openProduct }: { product: Product; variant: number | null; token: string; invalidate: () => void; addToEnquiry?: (line: DraftLine) => void; openProduct?: (id: number) => void }) {
  const [pin, setPin] = useState(''), [locality, setLocality] = useState(''), [district, setDistrict] = useState(''), [stock, setStock] = useState('');
  const [filters, setFilters] = useState<DealerFilters>({}), [page, setPage] = useState(1);
  const [branch, setBranch] = useState<Branch>();
  const load = useCallback(async (signal: AbortSignal) => {
    try { return await api.dealers(product.id, { ...filters, ...(variant === null ? {} : { variant: String(variant) }) }, page, token, signal); }
    catch (error) { if (error instanceof ApiError && error.status === 401) invalidate(); throw error; }
  }, [product.id, variant, filters, page, token, invalidate]);
  const result = useResource(load);
  if (branch) return <BranchCatalogue branch={branch} token={token} close={() => setBranch(undefined)} open={openProduct} />;
  return <View style={s.safe}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><Text accessibilityRole="header" style={s.title}>Compare dealer branches</Text><Text style={s.body}>{product.name}{variant !== null ? ` · SKU ${product.variants.find(v => v.id === variant)?.sku ?? variant}` : ' · all product/variant listings'}</Text>
    <View style={s.panel}>
      <View style={s.locationFields}>
        <View style={s.flexColumn}><Field label="Postal PIN code" postalPin value={pin} onChange={setPin} /></View>
        <View style={s.flexColumn}><Field label="Locality (optional)" value={locality} onChange={setLocality} /></View>
      </View>
      <Field label="District (optional)" value={district} onChange={setDistrict} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
        {[['', 'Any stock status'], ['IN_STOCK', 'In stock'], ['OUT_OF_STOCK', 'Out of stock'], ['UNKNOWN', 'Not confirmed']].map(([value, title]) =>
          <Button variant="navigation" compact key={value} title={title} selected={stock === value} onPress={() => setStock(value)} />)}
      </ScrollView>
    </View>
    <Text style={s.muted}>All prices are in Indian rupees. Listings do not reserve stock.</Text>{variant !== null && <Text style={s.muted}>Showing dealer listings for the selected variant.</Text>}<Feedback {...result} />
    {result.state.status === 'ready' && (() => {
      const data = result.state.data, rows = variantListings(data.results, variant);
      return <><Text accessibilityLiveRegion="polite" style={s.label}>{matchLabel(data.match_level)}</Text><Text>{data.count} matching listings{variant === null ? ' across all variants' : ' for this SKU'}; {rows.length} shown on this page.</Text>{rows.length === 0 && <View style={s.panel}><Text>{data.count === 0 ? 'No eligible listings match these filters. This does not confirm that the product is out of stock everywhere.' : 'No listings for this variant on this page. Check other pages or compare all product listings.'}</Text></View>}<View style={s.productList}>{rows.map(item => <View key={item.id} style={s.dealerRow}>
        <View style={s.monogram}><Text style={tradeType.row}>{item.business_name.trim().slice(0, 2).toUpperCase() || 'DL'}</Text></View>
        <View style={s.flexColumn}>
          <Text accessibilityRole="header" style={tradeType.row}>{item.business_name}</Text>
          <Text style={s.verified}>Verified</Text>
          <Text style={tradeType.meta}>{item.branch.branch_name} · {item.branch.locality} · {item.branch.pin_code}</Text>
          <Text style={tradeType.meta}>{[item.branch.address, item.branch.district, item.branch.state, 'India'].join(', ')}</Text>
          <Text style={tradeType.meta}>{inventoryLabel(item)} · {item.variant === null ? 'Product-level listing' : product.variants.find(v => v.id === item.variant)?.sku ?? `SKU ${item.variant}`}</Text>
          {item.active_product_count !== undefined && <Text style={tradeType.meta}>{item.active_product_count} active catalogue items</Text>}
          <Button variant="tertiary" compact title="Browse Catalogue" accessibilityLabel={`Browse Catalogue for ${item.branch.branch_name}`} onPress={() => setBranch(item.branch)} />
        </View>
        <View style={s.dealerActions}>
          <Text style={tradeType.price}>{inr(item.selling_price)}</Text>
          {addToEnquiry && <Button variant="primary" compact title="Add to enquiry" onPress={() => addToEnquiry({listing: item.id, branch: item.branch.id, branch_name: item.branch.branch_name, dealer_name: item.business_name, product_name: product.name, variant_sku: item.variant === null ? null : product.variants.find(v => v.id === item.variant)?.sku ?? null, quantity: '1', requirement: ''})} />}
        </View>
      </View>)}</View><Pager page={page} {...data} onPage={setPage} /><Button variant="tertiary" icon="refresh" title="Refresh current inventory page" onPress={result.retry} /></>;
    })()}
  </ScrollView><StickyBottomBar aboveTabs><Button variant="primary" icon="search" title="Search dealer branches" disabled={Boolean(pin && !INDIAN_PIN.test(pin))} onPress={() => { setFilters({ pin_code: pin.trim(), locality: locality.trim(), district: district.trim(), stock_status: stock }); setPage(1); }} /></StickyBottomBar></View>;
}
function DealerScreen({ product, variant, signIn, addToEnquiry, openProduct }: { product: Product; variant: number | null; signIn: () => void; addToEnquiry: (line: DraftLine) => void; openProduct: (id: number) => void }) {
  const { token, account, revalidateSession } = useSession();
  if (!token) return <ScrollView contentContainerStyle={s.content}><Text accessibilityRole="header" style={s.title}>Sign in required</Text><Text style={s.body}>Dealer branch discovery for {product.name} requires a valid SmartTrade account session.</Text><View style={s.panel}><Text>Sign in with your SmartTrade account. Discovery remains protected by the backend.</Text><Button variant="primary" icon="check" title="Sign in to find dealers" onPress={signIn} /></View></ScrollView>;
  return <DealerResults product={product} variant={variant} token={token} invalidate={revalidateSession} openProduct={openProduct} addToEnquiry={account?.account_type === 'PERSONAL' ? addToEnquiry : undefined} />;
}

function ActionCompany({ open }: { open: () => void }) {
  const { account } = useSession();
  return account?.account_type === 'COMPANY' ? <Button variant="tertiary" title="Company dashboard" onPress={open} /> : null;
}

const dealerHome = {name: 'dealer-estimate'} as const;
const browseHome = {name: 'catalogue'} as const;

const screenTitles: Record<Exclude<Screen['name'], 'nearby'>, string> = {
  support: 'Messages',
  catalogue: 'SmartTrade', detail: 'Product', dealers: 'Dealer discovery', auth: 'Sign in',
  account: 'My account', 'dealer-estimate': 'Catalog Items', 'dealer-workspace': 'Dealer dashboard',
  'dealer-onboarding': 'Dealer onboarding', company: 'Company', enquiries: 'Enquiries', orders: 'Orders',
  'offline-documents': 'Offline documents', 'personal-profile': 'Personal profile', 'workforce-profile': 'My profile',
};

function MenuRow({title, onPress, destructive = false}: {title: string; onPress: () => void; destructive?: boolean}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
    style={({pressed}) => [s.menuRow, pressed && s.menuPressed]}>
    <Text style={[s.label, destructive && s.error]}>{title}</Text><Text style={s.muted} aria-hidden>›</Text>
  </Pressable>;
}

function DealerAccountSummary({token}: {token: string}) {
  const [profile, setProfile] = useState<{legal_name?: string; verification_state?: string; registered_locality?: string; registered_district?: string}>();
  useEffect(() => {
    const controller = new AbortController();
    void api.get('/businesses/me', controller.signal, token).then(data => {
      if (!controller.signal.aborted) setProfile(data as typeof profile);
    }).catch(() => {});
    return () => controller.abort();
  }, [token]);
  if (!profile) return null;
  const location = [profile.registered_locality, profile.registered_district].filter(Boolean).join(', ');
  return <View style={s.profileSummary}>
    <Text style={tradeType.section}>{profile.legal_name || 'Dealer account'}</Text>
    {profile.verification_state === 'VERIFIED' && <Text style={s.verified}>Verified Dealer</Text>}
    {!!location && <Text style={tradeType.meta}>{location}</Text>}
  </View>;
}

function AppRoutes() {
  const session = useSession();
  const [finishedStep2, setFinishedStep2] = useState<number | null>(null);
  const locked = session.account?.account_type === 'BUSINESS' && session.account.dealer_contacts_complete !== true;
  useEffect(() => {
    if (Platform.OS === 'web' || (!locked && !session.restoring)) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => listener.remove();
  }, [locked, session.restoring]);
  if (session.restoring) return <SafeAreaView style={s.safe}><ActivityIndicator accessibilityLabel="Restoring your session" /></SafeAreaView>;
  if (!locked) return <Journey startAtCatalogues={finishedStep2 !== null && finishedStep2 === session.account?.id} />;
  return <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
    <KeyboardAvoidingView style={s.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.topbar}>
        <Text accessibilityRole="header" style={s.logo}>Dealer onboarding</Text>
        <Button variant="tertiary" compact title="Sign Out" onPress={() => { setFinishedStep2(null); void session.signOut(); }} />
      </View>
      <View style={s.banner}><Text style={s.body}>Complete Step 2 of 3: Add 10 unique worker contacts to unlock your dealer dashboard.</Text></View>
      {session.message !== '' && <View style={s.banner}><Text accessibilityLiveRegion="polite" style={s.body}>{session.message}</Text></View>}
      <DealerWorkerContactsScreen key={session.account?.id} api={api} token={session.token}
        done={() => { setFinishedStep2(session.account?.id ?? null); session.revalidateSession(); }}
        reloadStatus={session.revalidateSession} />
      {finishedStep2 === session.account?.id && <Button variant="secondary" title="Refresh onboarding status" onPress={session.revalidateSession} />}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function Journey({startAtCatalogues}: {startAtCatalogues: boolean}) {
  const location = useCustomerLocation();
  const {bottom} = useSafeAreaInsets();
  const session = useSession();
  const dealer = session.account?.account_type === 'BUSINESS';
  const home = dealer ? dealerHome : browseHome;
  const showCommercialModules = session.account?.account_type === 'PERSONAL' ||
    (dealer && SHOW_DEALER_INCOMING_COMMERCIAL_MODULES);
  const [requestedScreen, setScreen] = useState<Screen>(startAtCatalogues ? {name: 'dealer-onboarding'} : home);
  const screen: Screen = dealer && !showCommercialModules &&
    (requestedScreen.name === 'enquiries' || requestedScreen.name === 'orders')
    ? {name: 'account'} : requestedScreen;
  const atHome = screen.name === home.name;
  const atHomeRoot = atHome && !(screen.name === 'dealer-estimate' && (screen.bills || screen.general));
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
      PERSONAL: browseHome, BUSINESS: dealerHome, COMPANY: {name: 'company'}, STAFF: {name: 'account'},
      SERVICE_PROVIDER: {name: 'workforce-profile'}, JOB_SEEKER: {name: 'workforce-profile'}, EMPLOYER: {name: 'workforce-profile'},
    };
    setDraft([]);
    setReturnScreen({name: 'catalogue'});
    setScreen(destinations[role]);
    const label = role === 'STAFF' && Array.isArray(profile.staff_profile?.roles) && profile.staff_profile.roles.includes('PLATFORM_ADMIN') ? 'Platform Admin'
      : isWorkforce(role) ? workforce[role].title : ({PERSONAL: 'Customer', BUSINESS: 'Dealer', COMPANY: 'Company', STAFF: 'Staff'} as const)[role];
    setSwitchNotice(`Switched to ${label} mode`);
  }
  const supportUnread = useDealerSupportUnread(api, session.account?.account_type === 'BUSINESS' && session.account.dealer_contacts_complete ? session.token : null);
  const signIn = () => { setReturnScreen(screen); setScreen({ name: 'auth' }); };
  const back = useCallback(() => setScreen(current => {
    if (current.name === 'support') return {name: 'account'};
    if (current.name === 'nearby' && current.item) return {name: 'detail', id: current.item};
    if (current.name === 'dealers') return { name: 'detail', id: current.product.id };
    if (current.name === 'orders' && current.fromDealerDashboard) return {name: 'dealer-workspace'};
    if (current.name === 'personal-profile' || current.name === 'offline-documents' || current.name === 'dealer-onboarding' || current.name === 'workforce-profile' || current.name === 'dealer-estimate') return {name: 'account'};
    return home;
  }), [home]);
  const addToEnquiry = (line: DraftLine) => { setDraft(current => { if (current.length && current[0].branch !== line.branch) { showAlert('One branch per enquiry', 'Submit or clear the current draft before selecting another dealer branch.'); return current; } return current.some(item => item.listing === line.listing) ? current : [...current, line]; }); setScreen({ name: 'enquiries' }); };
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (atHomeRoot) return false;
      back();
      return true;
    });
    return () => listener.remove();
  }, [atHomeRoot, back]);
  return <SafeAreaView style={s.safe} edges={["top", "left", "right"]}><StatusBar barStyle="dark-content" /><KeyboardAvoidingView style={s.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={s.topbar}>
    <View style={s.brandRow}>
      {!atHomeRoot && <Button variant="tertiary" compact icon="back" title="Back" onPress={back} />}
      <Text accessibilityRole="header" style={s.logo}>{screen.name === 'nearby' ? 'Nearby dealers' : screenTitles[screen.name]}</Text>
    </View>
    <RoleIdentity account={session.account} />
    {(atHome || screen.name === 'catalogue') && dealer && <Button variant="tertiary" compact title={supportUnread ? `Messages (${supportUnread})` : 'Messages'} onPress={() => setScreen({name: 'support'})} />}
  </View>{switchNotice !== '' && <View style={s.switchNotice}><Text accessibilityLiveRegion="polite" style={s.label}>{switchNotice}</Text></View>}{session.message !== '' && <View style={s.banner}><Text accessibilityLiveRegion="polite" style={s.body}>{session.message}</Text></View>}<View style={screen.name === 'catalogue' ? s.safe : s.hidden} accessibilityElementsHidden={screen.name !== 'catalogue'} importantForAccessibility={screen.name === 'catalogue' ? 'auto' : 'no-hide-descendants'}><CatalogueScreen key={session.account?.id ?? 'guest'} active={screen.name === 'catalogue'} openSupport={() => setScreen({name: 'support'})} open={id => setScreen({ name: 'detail', id })} nearby={!session.account || session.account.account_type === 'PERSONAL' ? filters => setScreen({name: 'nearby', ...filters}) : undefined} /></View>{screen.name === 'nearby' && <NearbyDealersScreen api={api} token={session.token} location={location} item={screen.item} brand={screen.brand} category={screen.category} initialSearch={screen.search} browse={id => setScreen({name: 'detail', id})} signIn={signIn} enquire={session.account?.account_type === 'PERSONAL' ? addToEnquiry : undefined} />}{screen.name === 'detail' && <ProductScreen key={screen.id} id={screen.id} nearby={!session.account || session.account.account_type === 'PERSONAL' ? () => setScreen({name: 'nearby', item: screen.id}) : undefined} findDealers={(product, variant) => setScreen({ name: 'dealers', product, variant })} />}{screen.name === 'dealers' && <DealerScreen product={screen.product} variant={screen.variant} signIn={signIn} addToEnquiry={addToEnquiry} openProduct={id => setScreen({name: 'detail', id})} />}{screen.name === 'auth' && <AuthScreen api={api} done={(profile) => setScreen(isWorkforce(profile.account_type) ? {name: 'workforce-profile'} : profile.account_type === 'BUSINESS' ? dealerHome : returnScreen)} />}{screen.name === 'account' && <ScrollView contentContainerStyle={s.content}>{session.account ? <RoleIdentity account={session.account} heading /> : <Text style={s.title}>Signed out</Text>}<View style={s.accountMenu}>{session.account?.account_type === 'BUSINESS' && session.token && <DealerAccountSummary key={session.account.id} token={session.token} />}<Text style={s.muted}>Account status: {session.account?.access_state ?? 'No session'}</Text><Text style={s.muted}>Mobile number: {session.account?.mobile_e164 || (session.account?.mobile_verified ? 'Verified' : 'Unverified')}</Text>{session.account ? <>{session.account.account_type === 'PERSONAL' && <MenuRow title="Personal profile" onPress={() => setScreen({ name: 'personal-profile' })} />}<ActionCompany open={() => setScreen({ name: 'company' })} />{isWorkforce(session.account.account_type) && <MenuRow title="My profile" onPress={() => setScreen({name: 'workforce-profile'})} />}{session.account.account_type === 'BUSINESS' && <MenuRow title={supportUnread ? `Messages (${supportUnread})` : 'Messages / Admin Support'} onPress={() => setScreen({name: 'support'})} />}{session.account.account_type === 'BUSINESS' && <MenuRow title="Dealer dashboard" onPress={() => setScreen({ name: 'dealer-workspace' })} />}{session.account.account_type === 'BUSINESS' && <MenuRow title="Dealer onboarding & catalogues" onPress={() => setScreen({name: 'dealer-onboarding'})} />}{session.account.account_type === 'BUSINESS' && <><MenuRow title={screenTitles['dealer-estimate']} onPress={() => setScreen({name: 'dealer-estimate'})} /><MenuRow title="Browse public catalogue" onPress={() => setScreen({name: 'catalogue'})} /><MenuRow title="General Items" onPress={() => setScreen({name: 'dealer-estimate', general: true})} /><MenuRow title="My bills / invoices" onPress={() => setScreen({name: 'dealer-estimate', bills: true})} /></>}{showCommercialModules && <MenuRow title={dealer ? 'Incoming enquiries' : 'Enquiries and quotations'} onPress={() => setScreen({ name: 'enquiries' })} />}{showCommercialModules && <MenuRow title={dealer ? 'Incoming orders' : 'Orders and invoices'} onPress={() => setScreen({ name: 'orders' })} />}<MenuRow title="Offline Documents" onPress={() => setScreen({name: 'offline-documents'})} /><DemoRoleSwitcher api={api} configured={demoPersonas} onSwitch={onDemoSwitch} /><MenuRow destructive title="Sign out" onPress={() => { void session.signOut(); setScreen({ name: 'catalogue' }); }} /></> : <Button variant="primary" icon="check" title="Sign in to your account" onPress={signIn} />}</View></ScrollView>}{screen.name === 'support' && session.account?.account_type === 'BUSINESS' && session.account.dealer_contacts_complete && session.token && <SupportChat key={session.account.id} api={api} token={session.token} />}{screen.name === 'offline-documents' && session.account && <OfflineDocumentsScreen key={session.account.id} accountId={session.account.id} />}{screen.name === 'personal-profile' && <PersonalProfile key={session.account?.id} api={api} />}{screen.name === 'company' && <CompanyScreen api={api} />}{screen.name === 'dealer-estimate' && session.account?.account_type === 'BUSINESS' && session.token && <DealerEstimateScreen key={session.account.id} api={api} token={session.token} accountId={session.account.id} initialTab={screen.bills ? 'Bills' : screen.general ? 'General Items' : 'Items'} />}{screen.name === 'workforce-profile' && session.account && isWorkforce(session.account.account_type) && session.token && <WorkforceProfileScreen key={session.account.id} api={api} token={session.token} role={session.account.account_type} />}{screen.name === 'dealer-onboarding' && session.account?.account_type === 'BUSINESS' && <DealerOnboardingScreen key={session.account.id} api={api} token={session.token} />}{screen.name === 'dealer-workspace' && <DealerWorkspace api={api} onOpenOrders={() => setScreen({name: 'orders', fromDealerDashboard: true})} />}{screen.name === 'enquiries' && <EnquiryWorkspace api={api} draft={draft} setDraft={setDraft} />}{screen.name === 'orders' && <OrderWorkspace api={api} />}{screen.name !== 'auth' && <View style={[s.bottomTabs, {paddingBottom: bottom}]}>
    <View style={s.tabCell}><Button variant="navigation" icon="browse" title={dealer ? screenTitles['dealer-estimate'] : 'Browse'} selected={atHome}
      onPress={() => { if (!atHome) setScreen(home); }} /></View>
    <View style={s.tabCell}><Button variant="navigation" icon="account" title={session.account ? 'My account' : 'Sign in'}
      selected={screen.name === 'account'} onPress={() => session.account ? setScreen({name: 'account'}) : signIn()} /></View>
  </View>}</KeyboardAvoidingView></SafeAreaView>;
}
export default function App() { return <SafeAreaProvider initialMetrics={initialWindowMetrics}><SessionProvider api={api}><AppRoutes /></SessionProvider></SafeAreaProvider>; }

const s = StyleSheet.create({
  browseHeader: {paddingHorizontal: trade.gutter, paddingVertical: 6, gap: 6, backgroundColor: trade.surface, borderBottomWidth: 1, borderColor: trade.border},
  searchRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  searchInput: {flex: 1, minWidth: 0, minHeight: 38, paddingVertical: 6},
  chipRow: {gap: 6, alignItems: 'center', paddingVertical: 4},
  chip: {minHeight: 28, justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: trade.border, backgroundColor: trade.surface, paddingHorizontal: 10, paddingVertical: 4},
  chipSelected: {backgroundColor: trade.accent, borderColor: trade.accent},
  chipLabel: {color: '#294b3a', fontSize: 12, fontWeight: '700'},
  countBadge: {...tradeType.meta, backgroundColor: trade.accentTint, color: trade.accent, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4},
  chipLabelSelected: {color: '#fff'},
  browseContent: {paddingHorizontal: trade.gutter, gap: 6},
  locationFields: {flexDirection: 'row', gap: 8, alignItems: 'flex-start'},
  flexColumn: {flex: 1, minWidth: 0, gap: 3},
  dealerRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: trade.gutter, paddingVertical: 9,
    backgroundColor: trade.surface, borderBottomWidth: 1, borderColor: trade.border},
  dealerActions: {minWidth: 74, maxWidth: '30%', alignItems: 'flex-end', gap: 6},
  monogram: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: trade.radius, backgroundColor: trade.accentTint},
  verified: {...tradeType.meta, color: trade.success, backgroundColor: trade.successTint, alignSelf: 'flex-start', paddingHorizontal: 5, borderRadius: 5},
  productList: {marginHorizontal: -trade.gutter},
  banner: {backgroundColor: '#fff4d6', paddingVertical: 8, paddingHorizontal: 14},
  safe: { flex: 1, backgroundColor: trade.screen }, hidden: { display: 'none' }, content: {padding: trade.gutter, paddingBottom: 12, gap: 8},
  topbar: {minHeight: 48, paddingHorizontal: trade.gutter, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'space-between', backgroundColor: trade.surface, borderBottomWidth: 1, borderColor: trade.border},
  switchNotice: {position: 'absolute', top: 54, zIndex: 10, alignSelf: 'center', padding: 8, borderRadius: 12, backgroundColor: trade.successTint},
  brandRow: {flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4},
  logo: {...tradeType.title, flexShrink: 1}, eyebrow: tradeType.meta, title: tradeType.title, heading: tradeType.section,
  bottomTabs: {minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: trade.gutter, gap: 8, backgroundColor: trade.surface, borderTopWidth: 1, borderColor: trade.border},
  tabCell: {flex: 1, paddingVertical: 2},
  accountMenu: {backgroundColor: trade.surface, paddingHorizontal: trade.gutter, paddingTop: 8, borderWidth: 1, borderColor: trade.border},
  profileSummary: {gap: 4, marginBottom: 6},
  menuRow: {minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottomWidth: 1, borderColor: trade.border},
  menuPressed: {backgroundColor: trade.accentTint},
  body: { fontSize: 14, lineHeight: 20, color: '#344d41' }, muted: { color: '#52675c', fontSize: 12, lineHeight: 17 }, label: { fontWeight: '700', color: '#294b3a', fontSize: 14 }, price: { color: '#126743', fontSize: 17, fontWeight: '700' }, link: { color: '#126743', fontSize: 14, fontWeight: '600' },
  panel: { backgroundColor: '#fff', borderWidth: 1, borderColor: trade.border, borderRadius: trade.radius, padding: trade.gutter, gap: 6 }, field: { gap: 4 }, input: { borderWidth: 1, borderColor: trade.border, borderRadius: trade.radius, paddingHorizontal: 12, paddingVertical: 7, minHeight: 40, fontSize: 13, color: trade.ink, backgroundColor: '#fff' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, error: { color: '#9c2820', fontSize: 14, lineHeight: 20 },
});
