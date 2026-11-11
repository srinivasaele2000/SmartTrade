import {useCallback, useState} from 'react';
import {ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import {Button} from './Button';
import {CatalogueImage} from './CatalogueMedia';
import {onboardingStyles as s} from './DealerWorkerContactsScreen';
import {StickyBottomBar} from './StickyBottomBar';
import {type ApiClient} from './api';
import {inr, istDateTime, indianMobileDigits, displayIndianMobile} from './india';
import {useHistoryPage} from './useHistoryPage';
import {HistoryPager} from './HistoryPager';
import {downloadLocalFile} from './local-files';
import {openLocalPdf} from './open-local-pdf';
import {estimatePage, estimateTotals, type Bill, type CatalogueItem, type Estimate, type EstimateLine} from './dealer-estimates';

const estimatesPath = '/dealers/estimates/';
const billsPath = '/dealers/bills/';
const quantityPattern = /^\d{1,6}(?:\.\d{1,3})?$/;
const ratePattern = /^\d{1,3}(?:\.\d{1,2})?$/;
type Tab = 'Items' | 'Estimate' | 'Bills';

export default function DealerEstimateScreen({api, token, accountId, initialTab = 'Items'}: {
  api: ApiClient; token: string; accountId: number; initialTab?: Tab;
}) {
  const {bottom} = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [items, setItems] = useState<EstimateLine[]>([]);
  const [customer, setCustomer] = useState(''), [mobile, setMobile] = useState('');
  const [discount, setDiscount] = useState('0'), [rate, setRate] = useState('0');
  const [mode, setMode] = useState<Estimate['gst_type']>('CGST_SGST');
  const [saved, setSaved] = useState<Estimate>();
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<CatalogueItem>();
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const loadItems = useCallback((page: number, signal: AbortSignal) => estimatePage<CatalogueItem>(api, '/catalogue/items/', page, token, signal), [api, token]);
  const loadBills = useCallback((page: number, signal: AbortSignal) => estimatePage<Bill>(api, billsPath, page, token, signal), [api, token]);
  const loadEstimates = useCallback((page: number, signal: AbortSignal) => estimatePage<Estimate>(api, estimatesPath, page, token, signal), [api, token]);
  const catalogue = useHistoryPage(loadItems);
  const bills = useHistoryPage(loadBills);
  const estimates = useHistoryPage(loadEstimates);
  const totals = estimateTotals(items, discount, mode, rate);

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try {await action();}
    catch (failure) {setError(failure instanceof Error ? failure.message : 'Could not complete this action.');}
    finally {setBusy(false);}
  }

  function changeTab(value: Tab) {
    setTab(value); setError(''); setMessage(''); setPending(undefined);
  }

  function addItem() {
    if (!pending || !quantityPattern.test(quantity) || Number(quantity) <= 0) return;
    const line: EstimateLine = {product: pending.id, product_name: pending.name, hsn_sac_code: pending.hsn_sac_code,
      unit_price: pending.price_per_unit, quantity};
    setItems(current => current.some(row => row.product === line.product)
      ? current.map(row => row.product === line.product ? {...row, quantity} : row)
      : [...current, line]);
    setDirty(true);
    changeTab('Estimate');
  }

  function restore(estimate: Estimate) {
    setSaved(estimate); setItems(estimate.items); setCustomer(estimate.customer_name);
    setMobile(indianMobileDigits(estimate.customer_mobile)); setDiscount(estimate.discount_percentage);
    setRate(estimate.gst_rate_percentage); setMode(estimate.gst_type); setDirty(false);
  }

  function resetEstimate() {
    setItems([]); setSaved(undefined); setDirty(false); setCustomer(''); setMobile('');
    setDiscount('0'); setRate('0'); setMode('CGST_SGST');
  }

  async function save(status: 'DRAFT' | 'SHARED') {
    if (![discount, rate].every(value => ratePattern.test(value) && Number(value) <= 100)) {
      throw new Error('Enter discount and GST percentages between 0 and 100.');
    }
    const body = {customer_name: customer.trim(), customer_mobile: mobile ? '+91' + mobile : '',
      discount_percentage: discount, gst_type: mode, gst_rate_percentage: rate,
      status, items: items.map(({product, quantity: amount}) => ({product, quantity: amount}))};
    const result = (saved
      ? await api.get(estimatesPath + saved.id + '/', undefined, token, {method: 'PATCH', body: JSON.stringify(body)})
      : await api.post(estimatesPath, body, token)) as Estimate;
    restore(result);
    estimates.refresh();
    return result;
  }

  function savePdf(path: string, name: string, scope: string) {
    return downloadLocalFile(api.base + path, {Authorization: 'Bearer ' + token},
      name + '.pdf', 'invoice', 'account-' + accountId + '-invoice-' + scope, 'application/pdf');
  }

  async function openPdf(path: string, name: string, scope: string) {
    const document = await savePdf(path, name, scope);
    await openLocalPdf(document.uri);
  }

  async function estimatePdf() {
    const estimate = saved && !dirty ? saved : await save('DRAFT');
    return savePdf(estimatesPath + estimate.id + '/pdf/', 'Estimate-' + estimate.id + '-' + Date.now(), 'estimate-' + estimate.id);
  }

  function convert() {
    if (!saved || dirty || saved.status !== 'SHARED') return;
    Alert.alert('Convert estimate to bill?', 'This will finalize the bill at the confirmed totals.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Convert', onPress: () => void perform(async () => {
        await api.post(estimatesPath + saved.id + '/convert-to-bill/', {}, token);
        resetEstimate();
        bills.refresh(); estimates.refresh(); setTab('Bills'); setMessage('Bill created.');
      })},
    ]);
  }

  return <View style={s.screen}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      <Text style={s.title}>{tab === 'Items' ? 'Catalogue items' : tab === 'Estimate' ? 'Dealer estimate' : 'My bills'}</Text>
      <View style={[s.row, {flexWrap: 'wrap'}]}>{(['Items', 'Estimate', 'Bills'] as const).map(value =>
        <Button key={value} variant="navigation" selected={tab === value} disabled={busy}
          title={value === 'Estimate' ? 'Estimate (' + items.length + ' items)' : value} onPress={() => changeTab(value)} />)}</View>
      {error !== '' && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
      {message !== '' && <Text style={s.body} accessibilityLiveRegion="polite">{message}</Text>}
      {tab === 'Items' && <>
        {catalogue.state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading catalogue items" />
          : catalogue.state.status === 'error' ? <><Text style={s.error}>{catalogue.state.message}</Text><Button variant="secondary" title="Retry" onPress={catalogue.retry} /></>
          : !catalogue.state.data.results.length ? <Text>No priced catalogue items are available.</Text>
          : catalogue.state.data.results.map(item => <View key={item.id} style={s.card}>
            <CatalogueImage apiBase={api.base} reference={item.image_url} name={item.name} />
            <Text style={s.label}>{item.name}</Text>
            <Text>{item.brand_name} · {item.category_name}</Text>
            <Text>{item.product_code} · HSN/SAC {item.hsn_sac_code || '—'}</Text>
            <Text style={s.label}>{inr(item.price_per_unit)} per unit</Text>
            <Button variant="secondary" icon="plus" title="Add" onPress={() => {
              setPending(item); setQuantity(items.find(row => row.product === item.id)?.quantity ?? '1');
            }} />
          </View>)}
        <HistoryPager {...catalogue} />
      </>}
      {tab === 'Estimate' && <>
        {(saved || items.length > 0) && <Button variant="tertiary" title="New estimate" disabled={busy} onPress={() => {
          if (!dirty) {resetEstimate(); return;}
          Alert.alert('Discard unsaved estimate changes?', '', [{text: 'Cancel', style: 'cancel'},
            {text: 'New estimate', onPress: resetEstimate}]);
        }} />}
        {!items.length && <Text>Choose catalogue items to start an estimate.</Text>}
        {items.map((row, index) => <View key={row.product} style={s.card}>
          <Text style={s.label}>{row.product_name}</Text>
          <Text>HSN/SAC {row.hsn_sac_code || '—'} · {inr(row.unit_price)} × {row.quantity}</Text>
          <Text style={s.label}>{inr(totals.lines[index])}</Text>
          <Button variant="destructive" title="Remove" disabled={busy} onPress={() => {setItems(current => current.filter(item => item.product !== row.product)); setDirty(true);}} />
        </View>)}
        {!!items.length && <View style={s.card}>
          <TextInput style={s.input} accessibilityLabel="Customer name" placeholder="Customer name (optional)" maxLength={200} value={customer}
            editable={!busy} onChangeText={value => {setCustomer(value); setDirty(true);}} />
          <TextInput style={s.input} accessibilityLabel="Customer mobile" placeholder="+91 mobile (optional)" keyboardType="phone-pad"
            value={mobile ? '+91 ' + displayIndianMobile(mobile) : ''} editable={!busy} onChangeText={value => {setMobile(indianMobileDigits(value)); setDirty(true);}} />
          <Text>Subtotal {inr(totals.subtotal)}</Text>
          <Text>Discount (%)</Text>
          <TextInput style={s.input} accessibilityLabel="Discount percentage" keyboardType="decimal-pad" value={discount}
            editable={!busy} onChangeText={value => {setDiscount(value); setDirty(true);}} />
          <Text>Discount {inr(totals.discount)} · Taxable amount {inr(totals.taxable)}</Text>
          <View style={[s.row, {flexWrap: 'wrap'}]}>{(['CGST_SGST', 'IGST'] as const).map(value =>
            <Button key={value} variant="navigation" title={value === 'IGST' ? 'IGST (inter-state)' : 'CGST + SGST (intra-state)'}
              selected={mode === value} disabled={busy} onPress={() => {setMode(value); setDirty(true);}} />)}</View>
          <Text>GST rate (%)</Text>
          <TextInput style={s.input} accessibilityLabel="GST rate percentage" keyboardType="decimal-pad" value={rate}
            editable={!busy} onChangeText={value => {setRate(value); setDirty(true);}} />
          <Text>{mode === 'IGST' ? 'IGST ' + inr(totals.igst) : 'CGST ' + inr(totals.cgst) + ' · SGST ' + inr(totals.sgst)}</Text>
          <Text style={s.title}>Grand total {inr(totals.total)}</Text>
          <Button variant="secondary" title="Save draft" disabled={busy} onPress={() => perform(async () => {await save('DRAFT'); setMessage('Draft saved.');})} />
          <Button variant="secondary" icon="download" title="Download Estimate PDF" disabled={busy} onPress={() => perform(async () => {
            await openLocalPdf((await estimatePdf()).uri);
          })} />
          <Button variant="tertiary" title="Share Estimate PDF" disabled={busy} onPress={() => perform(async () => {
            if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device.');
            await Sharing.shareAsync((await estimatePdf()).uri, {mimeType: 'application/pdf'});
          })} />
        </View>}
        <Text style={s.label}>Saved estimates</Text>
        {estimates.state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading saved estimates" />
          : estimates.state.status === 'error' ? <><Text style={s.error}>{estimates.state.message}</Text>
            <Button variant="secondary" title="Retry estimates" onPress={estimates.retry} /></>
          : estimates.state.data.results.filter(value => ['DRAFT', 'SHARED'].includes(value.status)).map(value =>
            <Button key={value.id} variant="secondary" disabled={busy} title={'Estimate #' + value.id + ' · ' + (value.customer_name || value.status)}
              onPress={() => {
                if (!dirty) {restore(value); return;}
                Alert.alert('Discard unsaved estimate changes?', '', [{text:'Cancel', style:'cancel'}, {text:'Open estimate', onPress:() => restore(value)}]);
              }} />)}
        <HistoryPager {...estimates} disabled={busy} />
      </>}
      {tab === 'Bills' && <>
        {bills.state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading bills" />
          : bills.state.status === 'error' ? <><Text style={s.error}>{bills.state.message}</Text><Button variant="secondary" title="Retry bills" onPress={bills.retry} /></>
          : !bills.state.data.results.length ? <Text>No bills have been generated yet.</Text>
          : bills.state.data.results.map(bill => <View key={bill.id} style={s.card}>
            <Text style={s.label}>{bill.bill_number}</Text>
            <Text>{istDateTime(bill.issued_at)} · {bill.snapshot.customer_name || 'Customer not provided'}</Text>
            <Text style={s.label}>{inr(bill.snapshot.totals.total_amount)} · {bill.payment_status === 'PAID' ? 'Paid' : 'Unpaid'}</Text>
            <Button variant="secondary" icon="download" title="Download Bill PDF" disabled={busy}
              onPress={() => perform(() => openPdf(billsPath + bill.id + '/pdf/', bill.bill_number, 'dealer-bill-' + bill.id))} />
          </View>)}
        <HistoryPager {...bills} disabled={busy} />
      </>}
    </ScrollView>
    {pending && <Modal visible transparent animationType="slide" onRequestClose={() => setPending(undefined)}
      statusBarTranslucent navigationBarTranslucent>
      <View style={{flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008'}}>
        <View accessibilityViewIsModal style={[s.card, {paddingBottom: bottom + 22}]}>
          <Text accessibilityRole="header" style={s.label}>{pending.name}</Text>
          <Text>Quantity</Text>
          <TextInput style={s.input} accessibilityLabel="Quantity" keyboardType="decimal-pad" value={quantity} onChangeText={setQuantity} />
          <Button variant="primary" title="Add to Estimate" onPress={addItem}
            disabled={!quantityPattern.test(quantity) || Number(quantity) <= 0 || (!items.some(row => row.product === pending.id) && items.length >= 100)} />
          <Button variant="tertiary" title="Cancel" onPress={() => setPending(undefined)} />
        </View>
      </View>
    </Modal>}
    {tab === 'Estimate' && !!items.length && <StickyBottomBar clearance={22}>
      {saved?.status === 'SHARED' && !dirty
        ? <Button variant="primary" title="Convert to Bill" loading={busy} onPress={convert} />
        : <Button variant="primary" title="Confirm estimate" loading={busy} onPress={() => perform(async () => {
          await save('SHARED'); setMessage('Estimate confirmed and ready to convert.');
        })} />}
    </StickyBottomBar>}
  </View>;
}
