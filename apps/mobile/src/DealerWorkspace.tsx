import {Button} from './Button';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {DealerActivity} from './DealerActivity';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiClient, ApiError, type Product } from './api';
import { useSession } from './session';
import { useResource } from './useResource';
import { blankBranch, blankInventory, branchFields, business, canChooseProduct, ownedPage, saveBranch, saveBusiness, saveListing, withdrawListing, reactivateListing, type BranchInput, type InventoryInput, type OwnedBranch, type OwnedListing } from './dealer';
import { displayIndianMobile, indianMobileDigits, inr, indianNumber, indianPinDigits, INDIAN_MOBILE, INDIAN_PIN, istDateTime, MOBILE_HELP, PIN_HELP } from './india';
import LocalFileVault from './LocalFileVault';
import {DealerContacts, DealerDeclarations, IdentityFields} from './Onboarding';

type Tab = 'Dashboard' | 'Profile' | 'Documents' | 'Branches' | 'Authorization' | 'Listings' | 'Declarations' | 'Contacts';

function Field({ label, value, change, max = 200, numeric = false, postalPin = false, mobile = false, disabled = false }: { label: string; value: string; change: (value: string) => void; max?: number; numeric?: boolean; postalPin?: boolean; mobile?: boolean; disabled?: boolean }) {
  const [touched, setTouched] = useState(false);
  const input = <TextInput accessibilityLabel={mobile ? label + ', country code plus 91' : label}
    value={mobile ? displayIndianMobile(indianMobileDigits(value)) : value}
    onChangeText={mobile ? text => change(text ? '+91' + indianMobileDigits(text) : '') : postalPin ? text => change(indianPinDigits(text)) : change}
    onBlur={() => setTouched(true)} maxLength={mobile ? undefined : max} editable={!disabled} style={[s.input, mobile && s.phoneInput]}
    keyboardType={mobile ? 'phone-pad' : postalPin ? 'number-pad' : numeric ? 'decimal-pad' : 'default'}
    placeholder={mobile ? '98765 43210' : undefined} autoCorrect={false} autoCapitalize="none" />;
  return <View style={s.field}><Text style={s.label}>{label}</Text>
    {mobile ? <View style={s.row}><Text style={s.prefix}>+91</Text>{input}</View> : input}
    {mobile && touched && value && !INDIAN_MOBILE.test(value) && <Text style={s.error}>{MOBILE_HELP}</Text>}
    {postalPin && <Text style={value && !INDIAN_PIN.test(value) ? s.error : s.body}>{PIN_HELP}</Text>}
  </View>;
}
function Pagination({ page, next, previous, set }: { page: number; next: string | null; previous: string | null; set: (n: number) => void }) {
  return <View style={s.row}><Button variant="tertiary" icon="back" title="Previous page" disabled={!previous} onPress={() => set(page - 1)} /><Text>Page {page}</Text><Button variant="tertiary" icon="next" title="Next page" disabled={!next} onPress={() => set(page + 1)} /></View>;
}
export default function DealerWorkspace({api, onOpenOrders}: {api: ApiClient; onOpenOrders: () => void}) {
  const session = useSession();
  if (session.account?.account_type !== 'BUSINESS' || !session.token) return <View style={s.card}><Text accessibilityRole="alert">Sign in with an active dealer account to manage your business.</Text></View>;
  return <Workspace key={session.account.id} api={api} token={session.token} expired={session.revalidateSession} onOpenOrders={onOpenOrders} />;
}
function Workspace({api, token, expired, onOpenOrders}: {api: ApiClient; token: string; expired: () => void; onOpenOrders: () => void}) {
  const {bottom} = useSafeAreaInsets();
  const { account } = useSession();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [tab, setTab] = useState<Tab>('Dashboard');
  const [branchPage, setBranchPage] = useState(1), [listingPage, setListingPage] = useState(1);
  const [listingSearch,setListingSearch]=useState(''),[listingQuery,setListingQuery]=useState(''),[listingState,setListingState]=useState('');
  const [refresh, setRefresh] = useState(0);
  const profile = useResource(useCallback(async signal => {
    try { return await business(api, token, signal); }
    catch (error) { if (error instanceof ApiError && error.status === 401) expired(); throw error; }
  }, [api, token, expired, refresh]), { retainData: true });
  const branches = useResource(useCallback(signal => ownedPage<OwnedBranch>(api, token, 'locations', branchPage, signal), [api, token, branchPage, refresh]));
  const listings = useResource(useCallback(signal => ownedPage<OwnedListing>(api, token, 'listings', listingPage, signal, {search:listingQuery,state:listingState}), [api, token, listingPage, refresh, listingQuery, listingState]));
  const data = profile.state.data;
  const [name, setName] = useState(''), [registration, setRegistration] = useState(''), [gstin, setGstin] = useState(''), [pan, setPan] = useState('');
  const businessDraftDirty = useRef(false);
  const [branchForm, setBranchForm] = useState<BranchInput | null>(null), [branchId, setBranchId] = useState<number | undefined>();
  const [inventory, setInventory] = useState<InventoryInput | null>(null), [editing, setEditing] = useState<OwnedListing | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<OwnedBranch | null>(null), [selectedProduct, setSelectedProduct] = useState<Product | null>(null), [variant, setVariant] = useState<number | null>(null);
  const [brand, setBrand] = useState(''), [search, setSearch] = useState(''), [appliedSearch, setAppliedSearch] = useState(''), [productPage, setProductPage] = useState(1);
  const products = useResource(useCallback(async signal => {
    if (!brand || tab !== 'Listings' || inventory === null || editing) return null;
    return api.products({ brand, search: appliedSearch }, productPage, signal);
  }, [api, brand, appliedSearch, productPage, tab, inventory === null, Boolean(editing)]));
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    if (data && !businessDraftDirty.current) {
      setName(data.legal_name); setRegistration(data.registration_number); setGstin(data.gstin); setPan(data.pan);
    }
  }, [data]);
  function editBusinessField(set: (value: string) => void, value: string) {
    businessDraftDirty.current = true;
    set(value);
  }
  async function perform(label: string, operation: () => Promise<unknown>) {
    setBusy(label); setMessage(''); setError('');
    try { await operation(); setMessage(`${label} confirmed by the server.`); setRefresh(n => n + 1); }
    catch (failure) { if (failure instanceof ApiError && failure.status === 401) expired(); setError(failure instanceof Error ? failure.message : 'Operation failed. Please retry.'); }
    finally { setBusy(''); scroll.current?.scrollTo({y:0,animated:true}); }
  }
  const editable = profile.state.status !== 'error' && Boolean(data?.workspace.can_edit);
  const managesListings = profile.state.status !== 'error' && Boolean(data?.workspace.can_manage_listings);
  const grants = data?.workspace.authorizations ?? [];
  const allowedProduct = Boolean(selectedProduct && canChooseProduct(selectedProduct, grants));
  const editGrant = editing && grants.some(g => g.eligible && g.brand === editing.brand_id && g.company === editing.company_id);
  const branchEligible = selectedBranch?.active && selectedBranch.visibility_state === 'VISIBLE' && !selectedBranch.admin_hidden;
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: true }); }, [tab, branchId, branchForm === null, editing?.id, inventory === null]);
  async function editListing(item: OwnedListing) {
    setBusy('Loading listing branch'); setError(''); setInventory(null); setEditing(item);
    try {
      const branch = await api.get(`/businesses/me/locations/${item.location}`, undefined, token) as OwnedBranch;
      if (branch.id !== item.location) throw new ApiError('Branch response could not be confirmed.');
      setSelectedBranch(branch); setSelectedProduct(null); setVariant(null);
      setInventory({ selling_price: item.selling_price, currency: item.currency, stock_status: item.stock_status, quantity: item.quantity ?? '', state: item.state });
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired();
      setError(failure instanceof Error ? failure.message : 'Could not load listing branch.');
    } finally { setBusy(''); }
  }
  const header = <>
    <Text style={s.kicker}>DEALER WORKSPACE</Text><Text accessibilityRole="header" style={s.title}>{data?.legal_name || 'Your business'}</Text>
    <View style={s.row}>{(['Dashboard', 'Profile', 'Documents', 'Branches', 'Authorization', 'Listings', 'Declarations', 'Contacts'] as Tab[]).map(name => <Button variant="navigation" key={name} title={name} selected={tab === name} disabled={Boolean(busy)} onPress={() => setTab(name)} />)}</View>
    <Button variant="tertiary" icon="refresh" title="Refresh dealer records" disabled={Boolean(busy)} onPress={() => { setMessage(''); setError(''); setRefresh(n => n + 1); }} />
    {profile.state.status === 'loading' && <ActivityIndicator accessibilityLabel="Loading dealer workspace" />}
    {profile.state.status === 'error' && <View style={s.card}><Text accessibilityRole="alert" style={s.error}>{profile.state.message}</Text><Button variant="tertiary" icon="refresh" title="Retry dealer workspace" onPress={profile.retry} /></View>}
    {message !== '' && <Text accessibilityLiveRegion="polite" style={s.notice}>{message}</Text>}{error !== '' && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}{busy !== '' && <ActivityIndicator accessibilityLabel={busy} />}
  </>;
  const readOnlyNotice = data && !data.workspace.can_edit && <Text style={s.notice}>This business is {data.verification_state}. Editing is unavailable. Contact support if you need help restoring access.</Text>;
  if (tab === 'Contacts' && data) {
    return <DealerContacts api={api} token={token} editable={editable} header={<>{header}{readOnlyNotice}</>} />;
  }
  return <ScrollView ref={scroll} contentContainerStyle={[s.content, {paddingBottom: Math.max(64, bottom + 8)}]} keyboardShouldPersistTaps="handled">
    {header}
      {tab === 'Documents' && <LocalFileVault category="dealer_document" ownerKey={`account-${account?.id}-dealer-documents`} legacyOwnerKey={data ? `business-${data.id}` : undefined} title="Dealer documents on this device" description="Keep private business and branch working documents on this device. They are not evidence submitted to SmartTrade and cannot affect dealer verification." allowedMimeTypes={['application/pdf','image/jpeg','image/png']} />}
    {data && <>
      {readOnlyNotice}
      {tab === 'Dashboard' && <><DealerActivity api={api} token={token} revision={refresh} onExpired={expired} onOpenOrders={onOpenOrders} /><View style={s.card}><Text style={s.heading}>Business status</Text><Text>Verification: {data.verification_state}</Text><Text>Account access: {account?.access_state ?? 'Unknown'}</Text><Text>Registration: {data.registration_number || 'Not provided'}</Text><Text>Profile editing: {editable ? 'Permitted' : 'Restricted'}</Text></View><View style={s.card}><Text style={s.heading}>Your network</Text><Text>Branches: {data.workspace.branch_count}</Text><Text>Published listings: {data.workspace.published_listing_count}</Text><Text>Currently discoverable listings: {data.workspace.discoverable_listing_count}</Text><Text style={s.body}>A published listing may be hidden if its branch, product, company, or brand approval is no longer active.</Text></View></>}
      {tab === 'Declarations' && <DealerDeclarations api={api} token={token} editable={editable} />}
      {(tab === 'Profile' || tab === 'Branches') && <View style={s.card}>
        <Text accessibilityRole="header" style={s.heading}>Business locations</Text>
        <View style={s.row}>
          <Button variant="navigation" title="Registered Office" selected={tab === 'Profile'} disabled={Boolean(busy)} onPress={() => setTab('Profile')} />
          <Button variant="navigation" title="Branch Locations" selected={tab === 'Branches'} disabled={Boolean(busy)} onPress={() => setTab('Branches')} />
        </View>
        <Text style={s.body}>{tab === 'Profile' ? 'Your registered business address for verification and GST records.' : 'Locations where your team operates and fulfils orders.'}</Text>
      </View>}
      {(tab === 'Profile' || tab === 'Branches') && <View style={tab === 'Branches' ? {display: 'none'} : undefined}
        accessibilityElementsHidden={tab === 'Branches'} importantForAccessibility={tab === 'Branches' ? 'no-hide-descendants' : 'auto'}>
        <IdentityFields api={api} token={token} editable={editable} />
      </View>}
      {tab === 'Profile' && <View style={s.card}><Text style={s.heading}>Business profile</Text><Field label="Business legal name" value={name} max={200} change={value => editBusinessField(setName, value)} disabled={!editable || Boolean(busy)} /><Field label="Business registration number" value={registration} max={100} change={value => editBusinessField(setRegistration, value)} disabled={!editable || Boolean(busy)} /><Field label="GSTIN (optional)" value={gstin} max={15} change={value => editBusinessField(setGstin, value)} disabled={!editable || Boolean(busy)} /><Field label="PAN (optional)" value={pan} max={10} change={value => editBusinessField(setPan, value)} disabled={!editable || Boolean(busy)} /><Text>GSTIN and PAN are optional identity fields; SmartTrade does not calculate tax. Verification status is managed by staff.</Text><Button variant="primary" icon="save" loading={Boolean(busy)} title="Save business profile" disabled={!editable || Boolean(busy)} onPress={() => void perform('Business profile save', async () => { await saveBusiness(api, token, name, registration, gstin, pan); businessDraftDirty.current = false; })} /></View>}
      {tab === 'Authorization' && <View style={s.card}><Text style={s.heading}>Company-issued brand authorizations</Text><Text style={s.body}>Only the owning company can grant or revoke authorization. Dealers cannot authorize themselves. An active grant alone does not override business, company, branch or product restrictions.</Text>{grants.length === 0 && <Text>No brand authorizations have been issued to this business.</Text>}{grants.map(grant => <View key={grant.id} style={s.divider}><Text style={s.heading}>{grant.brand_name}</Text><Text>{grant.company_name}</Text><Text>Grant: {grant.active ? 'Active' : 'Revoked'}</Text><Text>Current listing eligibility: {grant.eligible ? 'Eligible, subject to branch/product checks' : 'Not eligible'}</Text><Text>Company: {grant.company_verification_state} / {grant.company_activity_state}</Text><Text>Updated: {istDateTime(grant.updated_at)}</Text></View>)}</View>}
      {tab === 'Branches' && <>
        <Button variant="primary" icon="plus" loading={Boolean(busy)} title="Create branch" disabled={!editable || Boolean(busy)} onPress={() => { setBranchId(undefined); setBranchForm(blankBranch()); }} />
        {branchForm && <View style={s.card}><Text style={s.heading}>{branchId ? 'Edit branch' : 'New branch'}</Text><Text style={s.body}>Add a branch in India. Private contact details stay hidden from buyers. Deactivating a branch keeps its history.</Text>{branchFields.map(([key,label,max]) => <Field key={key} label={label} max={max} postalPin={key === 'pin_code'} mobile={key === 'contact_phone'} value={branchForm[key]} change={value => setBranchForm(current => current ? { ...current, [key]: value } : null)} disabled={Boolean(busy) || !editable || key === 'country'} />)}
          <View style={s.row}><Button variant="navigation" title={branchForm.active ? 'Active branch' : 'Inactive branch'} selected={branchForm.active} disabled={Boolean(busy) || !editable} onPress={() => setBranchForm({ ...branchForm, active: !branchForm.active })} /><Button variant="navigation" title="Private draft" selected={branchForm.visibility_state === 'PRIVATE_DRAFT'} disabled={Boolean(busy) || !editable} onPress={() => setBranchForm({ ...branchForm, visibility_state: 'PRIVATE_DRAFT' })} /><Button variant="navigation" title="Visible branch" selected={branchForm.visibility_state === 'VISIBLE'} disabled={Boolean(busy) || !editable || !data.workspace.can_publish_branches} onPress={() => setBranchForm({ ...branchForm, visibility_state: 'VISIBLE' })} /></View>
          {!data.workspace.can_publish_branches && <Text>Pending businesses may save private draft branches. Verification is required to make branches visible.</Text>}<Button variant="primary" icon="save" loading={Boolean(busy)} title="Save branch" disabled={Boolean(busy) || !editable} onPress={() => void perform('Branch save', async () => { await saveBranch(api, token, branchForm, branchId); setBranchForm(null); })} /><Button variant="secondary" title="Cancel branch editing" disabled={Boolean(busy)} onPress={() => setBranchForm(null)} />
        </View>}
        {branches.state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading branches" /> : branches.state.status === 'error' ? <View style={s.card}><Text style={s.error}>{branches.state.message}</Text><Button variant="tertiary" icon="refresh" title="Retry branches" onPress={branches.retry} /></View> : <>{branches.state.data.results.length === 0 && <View style={s.card}><Text>No dealer branches yet.</Text></View>}{branches.state.data.results.map(item => <View key={item.id} style={s.card}><Text style={s.heading}>{item.branch_name}</Text><Text>{item.address}</Text><Text style={s.body}>{[item.locality, item.district, item.state, item.pin_code].filter(Boolean).join(' · ')}</Text><Text>{item.active ? 'Active' : 'Inactive'} · {item.visibility_state} · {item.admin_hidden ? 'Hidden by staff' : 'Not hidden by staff'}</Text><Text style={s.body}>Private branch contact: {[item.contact_name, item.contact_phone, item.contact_email].filter(Boolean).join(' · ') || 'Not provided'}</Text><Button variant="secondary" icon="edit" title={`Edit ${item.branch_name}`} disabled={!editable || Boolean(busy)} onPress={() => { setBranchId(item.id); setBranchForm({ ...Object.fromEntries(branchFields.map(([key]) => [key,item[key]])), active: item.active, visibility_state: item.visibility_state } as BranchInput); }} /></View>)}<Pagination page={branchPage} {...branches.state.data} set={setBranchPage} /></>}
      </>}
      {tab === 'Listings' && <>
        <View style={s.card}><Field label="Search dealer listings" value={listingSearch} change={setListingSearch} /><Button variant="secondary" icon="search" title="Search inventory" disabled={Boolean(busy)} onPress={() => { setListingQuery(listingSearch.trim()); setListingPage(1); }} /><View style={s.row}>{[['','All listing states'],['PUBLISHED','Published listings'],['WITHDRAWN','Withdrawn listings']].map(([value,label]) => <Button variant="navigation" key={label} title={label} selected={listingState===value} disabled={Boolean(busy)} onPress={() => { setListingState(value); setListingPage(1); }} />)}</View></View>
        <Button variant="primary" icon="plus" loading={Boolean(busy)} title="Create product listing" disabled={!managesListings || Boolean(busy)} onPress={() => { setEditing(null); setInventory(blankInventory()); setSelectedProduct(null); setSelectedBranch(null); setVariant(null); setBrand(''); }} />
        {!data.workspace.can_manage_listings && <Text style={s.notice}>A verified business is required for listing creation, changes and withdrawal. Company authorization is a separate requirement.</Text>}
        {inventory && <View style={s.card}><Text style={s.heading}>{editing ? `Edit ${editing.product_name}` : 'New branch listing'}</Text>
          {editing ? <><Text>{editing.branch_name} · SKU {editing.variant_sku ?? (editing.variant === null ? 'product-level' : editing.variant)}</Text><Text>Company catalogue: {editing.company_catalogue_price === null ? 'Not provided' : inr(editing.company_catalogue_price)}</Text><Text style={s.body}>Branch, product and variant are immutable. Withdraw this record to stop offering it.</Text>{!editGrant && <Text style={s.error}>Current company authorization is not eligible. Price/content edits are blocked; a verified business may still withdraw this listing.</Text>}</> : <>
            <Text style={s.label}>1. Select your branch</Text>{branches.state.status === 'ready' ? <>{branches.state.data.results.map(item => <Button variant="navigation" key={item.id} title={`${item.branch_name} · ${item.active && !item.admin_hidden && item.visibility_state === 'VISIBLE' ? 'eligible branch' : 'not eligible'}`} selected={selectedBranch?.id === item.id} disabled={!item.active || item.admin_hidden || item.visibility_state !== 'VISIBLE' || Boolean(busy)} onPress={() => setSelectedBranch(item)} />)}{branches.state.data.count === 0 && <Text>Create an active visible branch first.</Text>}<Pagination page={branchPage} {...branches.state.data} set={setBranchPage} /></> : <Text>Branches are loading or unavailable. Refresh dealer records to retry.</Text>}
            <Text style={s.label}>2. Select an eligible authorized brand</Text>{grants.filter(g => g.eligible).map(grant => <Button variant="navigation" key={grant.id} title={`${grant.brand_name} · ${grant.company_name}`} selected={brand === String(grant.brand)} disabled={Boolean(busy)} onPress={() => { setBrand(String(grant.brand)); setProductPage(1); setSelectedProduct(null); setVariant(null); }} />)}{!grants.some(g => g.eligible) && <Text>No eligible brand grants. The company must explicitly authorize this verified business.</Text>}
            {brand !== '' && <><Field label="Search authorized catalogue" value={search} change={setSearch} /><Button variant="secondary" icon="search" title="Search products" onPress={() => { setAppliedSearch(search.trim()); setProductPage(1); }} />{products.state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading authorized products" /> : products.state.status === 'error' ? <><Text style={s.error}>{products.state.message}</Text><Button variant="tertiary" icon="refresh" title="Retry products" onPress={products.retry} /></> : products.state.data && <>{products.state.data.results.length === 0 && <Text>No published catalogue products match this brand/search.</Text>}{products.state.data.results.map(product => <View key={product.id} style={s.divider}><Text>{product.name} · {product.code}</Text><Text>Company catalogue: {product.catalogue_price === null ? 'Not provided' : inr(product.catalogue_price)}</Text><Button variant="navigation" title={`Select ${product.name}`} selected={selectedProduct?.id === product.id} disabled={!canChooseProduct(product,grants) || Boolean(busy)} onPress={() => { setSelectedProduct(product); setVariant(null); }} /></View>)}<Pagination page={productPage} {...products.state.data} set={setProductPage} /></>}</>}
            {selectedProduct && <><Text style={s.label}>3. Product / variant</Text><Text>{selectedProduct.name}</Text><Button variant="navigation" title="Product-level listing (no variant)" selected={variant === null} onPress={() => setVariant(null)} />{selectedProduct.variants.map(item => <Button variant="navigation" key={item.id} title={`${item.name} · ${item.sku}`} selected={variant === item.id} onPress={() => setVariant(item.id)} />)}</>}
          </>}
          <Field label="Dealer selling price" value={inventory.selling_price} numeric change={value => setInventory({ ...inventory, selling_price: value })} disabled={Boolean(busy)} />
          <Text style={s.label}>Currency: INR (₹)</Text>
          <Text style={s.label}>Stock status</Text><View style={s.row}>{(['IN_STOCK','OUT_OF_STOCK','UNKNOWN'] as const).map(state => <Button variant="navigation" key={state} title={state === 'IN_STOCK' ? 'In stock' : state === 'OUT_OF_STOCK' ? 'Out of stock' : 'Unknown stock'} selected={inventory.stock_status === state} disabled={Boolean(busy)} onPress={() => setInventory({ ...inventory, stock_status: state })} />)}</View>
          <Field label="Optional quantity" value={inventory.quantity} numeric change={value => setInventory({ ...inventory, quantity: value })} disabled={Boolean(busy)} /><Text style={s.body}>Leave quantity empty if unknown; positive for in-stock quantities, zero for out-of-stock quantities. No tax, delivery or reservation is inferred.</Text>
          <View style={s.row}>{(['PUBLISHED','WITHDRAWN'] as const).map(state => <Button variant="navigation" key={state} title={state === 'PUBLISHED' ? 'Publish listing' : 'Withdrawn listing'} selected={inventory.state === state} disabled={Boolean(busy)} onPress={() => setInventory({ ...inventory, state })} />)}</View>
          <Button variant="primary" icon="save" loading={Boolean(busy)} title="Save product listing" disabled={Boolean(busy) || !managesListings || (editing ? !editGrant || !branchEligible : !allowedProduct || !branchEligible)} onPress={() => void perform('Listing save', async () => { await saveListing(api, token, inventory, { location: selectedBranch?.id ?? 0, product: selectedProduct?.id ?? 0, variant }, editing?.id); setInventory(null); })} />
          {editing && <Button variant="destructive" icon="close" loading={Boolean(busy)} title="Withdraw this listing" disabled={Boolean(busy)||!managesListings||editing.state==='WITHDRAWN'} onPress={() => void perform('Listing withdrawal', async () => { await withdrawListing(api,token,editing.id);setInventory(null); })} />}
          <Button variant="secondary" title="Cancel listing editing" disabled={Boolean(busy)} onPress={() => setInventory(null)} />
        </View>}
        {listings.state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading inventory" /> : listings.state.status === 'error' ? <><Text style={s.error}>{listings.state.message}</Text><Button variant="tertiary" icon="refresh" title="Retry inventory" onPress={listings.retry} /></> : <>{listings.state.data.results.length === 0 && <View style={s.card}><Text>No branch product listings yet.</Text></View>}{listings.state.data.results.map(item => <View key={item.id} style={s.card}><Text style={s.heading}>{item.product_name}</Text><Text>{item.branch_name} · {item.brand_name}</Text><Text>{item.company_name ?? 'Owning company from catalogue'} · SKU {item.variant_sku ?? (item.variant === null ? 'product-level' : item.variant)}</Text><Text>Buyer discovery: {item.eligible ? 'Visible under current eligibility' : 'Not currently eligible / not published'}</Text><Text style={s.price}>{inr(item.selling_price)}</Text><Text>{item.stock_status} · quantity {item.quantity === null ? 'not supplied' : indianNumber(item.quantity)} · {item.state}</Text><Button variant="secondary" icon="edit" title={`Edit listing ${item.id}`} disabled={!managesListings || Boolean(busy)} onPress={() => void editListing(item)} />{item.state === 'WITHDRAWN' && <Button variant="secondary" title={`Reactivate listing ${item.id}`} disabled={!managesListings || Boolean(busy) || !grants.some(g => g.eligible && g.brand === item.brand_id && g.company === item.company_id)} onPress={() => void perform('Listing reactivation', () => reactivateListing(api,token,item.id))} />}<Button variant="destructive" icon="close" loading={Boolean(busy)} title={`Withdraw listing ${item.id}`} disabled={!managesListings || Boolean(busy) || item.state === 'WITHDRAWN'} onPress={() => void perform('Listing withdrawal', () => withdrawListing(api, token, item.id))} /></View>)}<Pagination page={listingPage} {...listings.state.data} set={setListingPage} /></>}
      </>}
    </>}
  </ScrollView>;
}
const s = StyleSheet.create({phoneInput: {flex: 1}, prefix: {padding: 12, borderRadius: 8, backgroundColor: '#edf7f0', color: '#17392d', fontWeight: '700'},
  content: { padding: 20, paddingBottom: 64, gap: 14 }, kicker: { color: '#087f5b', fontWeight: '800', letterSpacing: 1.5 }, title: { color: '#17392d', fontSize: 28, fontWeight: '800' }, heading: { fontSize: 20, fontWeight: '700', color: '#17392d' }, label: { fontWeight: '700', color: '#294b3a' }, body: { fontSize: 15, lineHeight: 23, color: '#52675c' }, card: { backgroundColor: '#fff', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#dce7e0', gap: 14 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },     field: { gap: 6 }, input: { minHeight: 48, borderWidth: 1, borderColor: '#9fb7aa', borderRadius: 10, padding: 12, fontSize: 16, color: '#17392d' }, notice: { padding: 12, backgroundColor: '#edf7f0', color: '#294b3a', lineHeight: 23 }, error: { color: '#9c2820', lineHeight: 23 }, divider: { borderTopWidth: 1, borderColor: '#dce7e0', paddingTop: 12, gap: 8 }, price: { color: '#126743', fontWeight: '700', fontSize: 22 },
});
