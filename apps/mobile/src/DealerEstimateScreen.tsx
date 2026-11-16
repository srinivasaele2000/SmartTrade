import {showAlert} from './platform-alert';
import {useCallback, useState} from 'react';
import {ActivityIndicator, Platform, Share, Modal, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import {printBrowserHtml} from './print-browser-html';
import {printSavedPdf} from './print-document';
import {DocumentHeader, DocumentLedgerRow, DocumentTable, DocumentTotals} from './TradeDocument';
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
import {estimateLineKey, estimateNetRate, estimatePage, estimateTotals, generalItemPrice, validItemDiscount, type Bill, type CatalogueItem, type Estimate, type EstimateLine, type GeneralItem} from './dealer-estimates';
import GeneralItems from './GeneralItems';
import {customerPdfHtml} from './customer-estimate-pdf';
import {trade, tradeType} from './trade-theme';
import {useDebouncedSearch} from './useDebouncedSearch';

const estimatesPath = '/dealers/estimates/';
const billsPath = '/dealers/bills/';
const quantityPattern = /^\d{1,6}(?:\.\d{1,3})?$/;
const ratePattern = /^\d{1,3}(?:\.\d{1,2})?$/;
type Tab = 'Items' | 'General Items' | 'Estimate' | 'Bills';

const estimateStatus = (status: string) => ({
  DRAFT: 'Draft', SHARED: 'Confirmed', CONVERTED_TO_BILL: 'Converted', CANCELLED: 'Cancelled',
}[status] ?? status);

function financialFields(totals: Estimate['totals'], mode: Estimate['gst_type']): [string, string | undefined][] {
  return [
    ['Item Subtotal', totals.sub_total], ['Discount', totals.discount_amount], ['Taxable Amount', totals.taxable_amount],
    ...(mode === 'IGST' ? [['IGST', totals.igst_amount]] : [['CGST', totals.cgst_amount], ['SGST', totals.sgst_amount]]) as [string, string | undefined][],
  ];
}

function documentLines(items: EstimateLine[], amounts: string[], rate: string) {
  return items.map((line, index) => ({
    id: estimateLineKey(line), name: line.product_name, code: line.product_code, hsn: line.hsn_sac_code, general: Boolean(line.dealer_custom_item),
    quantity: line.quantity, rate: estimateNetRate(line), gst: rate, amount: amounts[index],
  }));
}

export default function DealerEstimateScreen({api, token, accountId, initialTab = 'Items'}: {
  api: ApiClient; token: string; accountId: number; initialTab?: Tab;
}) {
  const {bottom} = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [addingGeneral, setAddingGeneral] = useState(false);
  const [items, setItems] = useState<EstimateLine[]>([]);
  const [customer, setCustomer] = useState(''), [mobile, setMobile] = useState('');
  const [discount, setDiscount] = useState('0'), [rate, setRate] = useState('0');
  const [mode, setMode] = useState<Estimate['gst_type']>('CGST_SGST');
  const [saved, setSaved] = useState<Estimate>();
  const [selectedBill, setSelectedBill] = useState<Bill>();
  const [estimateListOnly, setEstimateListOnly] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<CatalogueItem>();
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const search = useDebouncedSearch();
  const [category, setCategory] = useState(''), [brand, setBrand] = useState('');
  const itemQuery = new URLSearchParams({search: search.query, category, brand}).toString();
  const loadCategories = useCallback((page: number, signal: AbortSignal) => api.categories(page, signal), [api]);
  const loadBrands = useCallback((page: number, signal: AbortSignal) => api.brands({category}, page, signal), [api, category]);
  const categories = useHistoryPage(loadCategories);
  const brands = useHistoryPage(loadBrands, category);
  const loadItems = useCallback((page: number, signal: AbortSignal) => estimatePage<CatalogueItem>(
    api, '/catalogue/items/?' + itemQuery, page, token, signal), [api, token, itemQuery]);
  const loadBills = useCallback((page: number, signal: AbortSignal) => estimatePage<Bill>(api, billsPath, page, token, signal), [api, token]);
  const loadEstimates = useCallback((page: number, signal: AbortSignal) => estimatePage<Estimate>(api, estimatesPath, page, token, signal), [api, token]);
  const catalogue = useHistoryPage(loadItems, itemQuery);
  const bills = useHistoryPage(loadBills);
  const estimates = useHistoryPage(loadEstimates);
  const totals = estimateTotals(items, discount, mode, rate);
  const finalized = saved?.status === 'CONVERTED_TO_BILL' || saved?.status === 'CANCELLED';
  const editable = !finalized && (saved?.status !== 'SHARED' || dirty);
  const estimateNumber = saved ? 'EST-' + saved.id : 'New estimate';
  const estimateDate = saved?.created_at ? istDateTime(saved.created_at) : undefined;
  const estimateAmounts = saved && !dirty ? saved.totals : {
    total_amount: totals.total, sub_total: totals.subtotal, discount_amount: totals.discount,
    taxable_amount: totals.taxable, cgst_amount: totals.cgst, sgst_amount: totals.sgst, igst_amount: totals.igst,
  };

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try {await action();}
    catch (failure) {setError(failure instanceof Error ? failure.message : 'Could not complete this action.');}
    finally {setBusy(false);}
  }

  function changeTab(value: Tab) {
    setAddingGeneral(false);
    setTab(value); setError(''); setMessage(''); setPending(undefined); setSelectedBill(undefined); setEstimateListOnly(false);
  }

  function setGeneralQuantity(item: GeneralItem, amount: number) {
    const value = String(Math.round(amount * 1000) / 1000);
    if (finalized || !quantityPattern.test(value) || Number(value) < 0) return;
    if (items.length >= 100 && !items.some(row => row.dealer_custom_item === item.id)) {
      setError('An estimate can contain up to 100 items.'); return;
    }
    setItems(current => {
      const line = current.find(row => row.dealer_custom_item === item.id);
      if (amount === 0) return current.filter(row => row.dealer_custom_item !== item.id);
      if (line) return current.map(row => row === line ? {...row, quantity: value} : row);
      return [...current, {product: null, dealer_custom_item: item.id, product_name: item.product_name,
        product_code: item.product_code, hsn_sac_code: item.hsn_sac_code,
        list_price_per_unit: item.list_price_per_unit, unit_price: item.list_price_per_unit, quantity: value}];
    });
    setDirty(true);
  }

  function addItem() {
    if (finalized || !pending || !quantityPattern.test(quantity) || Number(quantity) <= 0) return;
    const line: EstimateLine = {product: pending.id, product_name: pending.name, product_code: pending.product_code, hsn_sac_code: pending.hsn_sac_code,
      unit_price: pending.price_per_unit, quantity};
    setItems(current => current.some(row => row.product === line.product)
      ? current.map(row => row.product === line.product ? {...row, quantity} : row)
      : [...current, line]);
    setDirty(true);
    setPending(undefined);
  }

  function restore(estimate: Estimate) {
    setEstimateListOnly(false); setSaved(estimate);
    setItems(estimate.items.map(line => line.dealer_custom_item
      ? {...line, unit_price: line.unit_price.replace(/(\.\d{2})00$/, '$1')} : line));
    setCustomer(estimate.customer_name);
    setMobile(indianMobileDigits(estimate.customer_mobile)); setDiscount(estimate.discount_percentage);
    setRate(estimate.gst_rate_percentage); setMode(estimate.gst_type); setDirty(false);
  }

  function resetEstimate() {
    setItems([]); setSaved(undefined); setDirty(false); setCustomer(''); setMobile('');
    setDiscount('0'); setRate('0'); setMode('CGST_SGST');
  }

  async function save(status: 'DRAFT' | 'SHARED') {
    if (items.some(line => line.dealer_custom_item && !generalItemPrice.test(line.unit_price))) {
      throw new Error('Enter a valid unit price for every General Item.');
    }
    if (items.some(line => !quantityPattern.test(line.quantity) || Number(line.quantity) <= 0)) {
      throw new Error('Enter a positive quantity for every item.');
    }
    if (![discount, rate].every(value => ratePattern.test(value) && Number(value) <= 100)) {
      throw new Error('Enter discount and GST percentages between 0 and 100.');
    }
    if (items.some(line => !validItemDiscount(line))) {
      throw new Error('Enter an item discount up to 100% or up to its unit price, with at most two decimal places.');
    }
    if (Number(discount) && items.some(line => Number(line.discount_value))) {
      throw new Error('Use either item discounts or an estimate-wide discount.');
    }
    const body = {customer_name: customer.trim(), customer_mobile: mobile ? '+91' + mobile : '',
      discount_percentage: discount, gst_type: mode, gst_rate_percentage: rate,
      status, items: items.map(({product, dealer_custom_item, unit_price, quantity, discount_mode, discount_value}) =>
        ({...(dealer_custom_item ? {dealer_custom_item, unit_price} : {product}),
          quantity, discount_mode: discount_mode ?? 'PERCENT', discount_value: discount_value ?? '0'}))};
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

  async function shareCustomerPdf(estimate: Estimate, bill?: Bill) {
    const html = customerPdfHtml(estimate, bill?.bill_number ?? 'EST-' + estimate.id,
      bill ? 'INVOICE' : 'ESTIMATE / QUOTATION', bill?.issued_at ?? estimate.created_at,
      bill?.snapshot.dealer_name, bill?.snapshot.dealer_gstin);
    if (Platform.OS === 'web') return printBrowserHtml(html);
    if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device.');
    const file = await Print.printToFileAsync({html, width: 595, height: 842});
    await Sharing.shareAsync(file.uri, {mimeType: 'application/pdf', UTI: 'com.adobe.pdf'});
  }

  function convert() {
    if (!saved || dirty || saved.status !== 'SHARED') return;
    showAlert('Convert estimate to bill?', 'This will finalize the bill at the confirmed totals.', [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Convert', onPress: () => void perform(async () => {
        await api.post(estimatesPath + saved.id + '/convert-to-bill/', {}, token);
        resetEstimate();
        bills.refresh(); estimates.refresh(); setTab('Bills'); setMessage('Bill created.');
      })},
    ]);
  }

  return <View style={s.screen}>
    <ScrollView stickyHeaderIndices={[0]} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      <View style={itemStyles.header}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>{(['Items', 'General Items', 'Estimate', 'Bills'] as const).map(value =>
        <Button key={value} variant="navigation" compact selected={tab === value} disabled={busy}
          title={value === 'Items' ? 'Catalog Items' : value === 'Estimate' ? 'Estimate (' + items.length + ' items)' : value === 'Bills' ? 'Invoices' : value} onPress={() => changeTab(value)} />)}</ScrollView>
      {tab === 'Items' && <>
        <View style={s.row}>
          <TextInput style={[s.input, itemStyles.search]} accessibilityLabel="Search catalogue items" placeholder="Name, code, HSN or brand"
            value={search.text} onChangeText={search.change} returnKeyType="search" onSubmitEditing={search.submit} />
          {!!(search.text || category || brand) && <Button variant="tertiary" compact title="×" accessibilityLabel="Clear item search"
            onPress={() => {search.change(''); setCategory(''); setBrand('');}} />}
          <Button variant="primary" compact title="Search" onPress={search.submit} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={itemStyles.filters}>
          {!search.pending && catalogue.state.status === 'ready' && <Text style={tradeType.meta} accessibilityLiveRegion="polite">
            {catalogue.state.data.count} items
          </Text>}
          <Button variant="navigation" compact title="All categories" selected={!category}
            onPress={() => {setCategory(''); setBrand('');}} />
          {categories.state.status === 'ready' && categories.state.data.results.filter(value => value.active).map(value =>
            <Button key={value.id} variant="navigation" compact title={value.name} selected={category === String(value.id)}
              onPress={() => {setCategory(String(value.id)); setBrand('');}} />)}
          {categories.state.status === 'ready' && categories.state.data.previous && <Button variant="tertiary" compact title="Previous categories" onPress={categories.previous} />}
          {categories.state.status === 'ready' && categories.state.data.next && <Button variant="tertiary" compact title="More categories" onPress={categories.next} />}
          {categories.state.status === 'error' && <Button variant="tertiary" compact title="Retry categories" onPress={categories.retry} />}
          <Button variant="navigation" compact title="All brands" selected={!brand} onPress={() => setBrand('')} />
          {brands.state.status === 'ready' && brands.state.data.results.map(value =>
            <Button key={value.id} variant="navigation" compact title={value.name} selected={brand === String(value.id)}
              onPress={() => setBrand(String(value.id))} />)}
          {brands.state.status === 'ready' && brands.state.data.previous && <Button variant="tertiary" compact title="Previous brands" onPress={brands.previous} />}
          {brands.state.status === 'ready' && brands.state.data.next && <Button variant="tertiary" compact title="More brands" onPress={brands.next} />}
          {brands.state.status === 'error' && <Button variant="tertiary" compact title="Retry brands" onPress={brands.retry} />}
        </ScrollView>
      </>}
      </View>
      {error !== '' && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
      {message !== '' && <Text style={s.body} accessibilityLiveRegion="polite">{message}</Text>}
      {tab === 'General Items' && <GeneralItems api={api} token={token} items={items} initiallyAdding={addingGeneral}
        disabled={busy} canAdd={!finalized} onQuantity={setGeneralQuantity}
        addAndOpen={item => {changeTab('Estimate'); setGeneralQuantity(item, Number(items.find(row => row.dealer_custom_item === item.id)?.quantity ?? 1));}}
        onArchive={id => {
          if (!saved?.items.some(row => row.dealer_custom_item === id) && items.some(row => row.dealer_custom_item === id)) {
            setItems(current => current.filter(row => row.dealer_custom_item !== id)); setDirty(true);
          }
        }} />}
      {tab === 'Items' && <>
        {search.pending || catalogue.state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading catalogue items" />
          : catalogue.state.status === 'error' ? <><Text style={s.error}>{catalogue.state.message}</Text><Button variant="secondary" title="Retry" onPress={catalogue.retry} /></>
          : !catalogue.state.data.results.length ? <Text>{search.query || category || brand ? 'No catalogue items match these filters.' : 'No priced catalogue items are available.'}</Text>
          : <View style={itemStyles.list}>{catalogue.state.data.results.map(item => <View key={item.id} style={itemStyles.card}>
            <CatalogueImage apiBase={api.base} reference={item.image_url} name={item.name} compact />
            <View style={itemStyles.details}>
              <Text style={tradeType.row}>{item.name}</Text>
              <Text style={tradeType.meta}>{item.brand_name} · Code {item.product_code} · HSN {item.hsn_sac_code || '—'}</Text>
            </View>
            <View style={itemStyles.priceColumn}>
              <Text style={tradeType.price}>{inr(item.price_per_unit)}</Text>
              <Button variant="primary" compact title="+ Add" disabled={finalized} accessibilityLabel={`Add ${item.name} to estimate`} onPress={() => {
                setPending(item); setQuantity(items.find(row => row.product === item.id)?.quantity ?? '1');
              }} />
            </View>
          </View>)}</View>}
        <HistoryPager {...catalogue} disabled={search.pending} />
      </>}
      {tab === 'Estimate' && <>
        {!estimateListOnly && <>
        <View style={itemStyles.actions}>
          <Text style={tradeType.section}>Estimate builder · {items.length} items</Text>
          {(saved || items.length > 0) && <Button variant="tertiary" compact title="New estimate" disabled={busy} onPress={() => {
            if (!dirty) {resetEstimate(); return;}
            showAlert('Discard unsaved estimate changes?', '', [{text: 'Cancel', style: 'cancel'},
              {text: 'New estimate', onPress: resetEstimate}]);
          }} />}
        </View>
        <DocumentHeader kind="ESTIMATE / QUOTATION" number={estimateNumber}
          status={editable ? 'Draft' : estimateStatus(saved?.status ?? 'DRAFT')} date={estimateDate}
          party={editable ? [] : [['Customer', customer || 'Walk-in customer'], ['Phone', mobile ? '+91 ' + displayIndianMobile(mobile) : undefined]]}
          meta={[[ 'Date', estimateDate ], ['Reference', saved ? String(saved.id) : undefined]]}>
          {editable && <>
            <TextInput style={s.input} accessibilityLabel="Customer name" placeholder="Customer name (optional)" maxLength={200} value={customer}
              editable={!busy} onChangeText={value => {setCustomer(value); setDirty(true);}} />
            <TextInput style={s.input} accessibilityLabel="Customer mobile" placeholder="+91 mobile (optional)" keyboardType="phone-pad"
              value={mobile ? '+91 ' + displayIndianMobile(mobile) : ''} editable={!busy}
              onChangeText={value => {setMobile(indianMobileDigits(value)); setDirty(true);}} />
          </>}
        </DocumentHeader>
        {!finalized && <Button variant="secondary" title="+ Add General Item" disabled={busy}
          onPress={() => {changeTab('General Items'); setAddingGeneral(true);}} />}
        {!items.length && <Text>Choose catalogue items or General Items to start an estimate.</Text>}
        {!!items.length && <>
          <DocumentTable lines={documentLines(items, items.map((line, index) => saved && !dirty ? line.line_total ?? totals.lines[index] : totals.lines[index]), rate)}
            subtotal={estimateAmounts.sub_total ?? totals.subtotal}
            editPrice={editable ? line => {
              const item = items.find(row => estimateLineKey(row) === line.id);
              if (!item) return null;
              const amountMode = item.discount_mode === 'AMOUNT';
              const change = (fields: Partial<EstimateLine>) => {
                setItems(current => current.map(row => estimateLineKey(row) === line.id ? {...row, ...fields} : row));
                setDirty(true);
              };
              return <>
                {item.dealer_custom_item && <TextInput style={s.input} accessibilityLabel={'Unit price for ' + item.product_name}
                  keyboardType="decimal-pad" editable={!busy} value={item.unit_price}
                  onChangeText={value => {if (/^\d{0,10}(?:\.\d{0,2})?$/.test(value)) change({unit_price: value});}} />}
                <Text style={tradeType.meta}>Base {inr(item.unit_price)} · Net {inr(line.rate)}</Text>
                <View style={s.row}>
                  <Button variant="secondary" compact title={amountMode ? '₹ / unit' : 'Disc %'} disabled={busy}
                    accessibilityLabel={'Change discount type for ' + item.product_name}
                    onPress={() => change({discount_mode: amountMode ? 'PERCENT' : 'AMOUNT', discount_value: '0'})} />
                  <TextInput style={itemStyles.quantityInput} accessibilityLabel={'Discount for ' + item.product_name}
                    keyboardType="decimal-pad" editable={!busy} value={item.discount_value ?? '0'}
                    onChangeText={value => {if (/^\d{0,14}(?:\.\d{0,2})?$/.test(value)) change({discount_value: value});}}
                    onBlur={() => {if (!item.discount_value) change({discount_value: '0'});}} />
                </View>
                {!validItemDiscount(item) && !!item.discount_value && <Text style={s.error}>{amountMode ? 'Enter up to the base rate.' : 'Enter 0 to 100%.'}</Text>}
              </>;
            } : undefined}
            editQuantity={editable ? line => {
              const updateQuantity = (value: string) => {
                if (value && !quantityPattern.test(value)) return;
                setItems(current => current.map(row => estimateLineKey(row) === line.id ? {...row, quantity: value} : row));
                setDirty(true);
              };
              const step = (delta: number) => {
                const next = Math.round((Number(line.quantity) + delta) * 1000) / 1000;
                if (next > 0) updateQuantity(String(next));
              };
              return <View style={itemStyles.quantityCell}>
                <View style={itemStyles.quantity}>
                  <Button variant="tertiary" compact title="−" accessibilityLabel={`Decrease quantity for ${line.name}`}
                    disabled={busy || Number(line.quantity) <= 1} onPress={() => step(-1)} />
                  <TextInput style={itemStyles.quantityInput} accessibilityLabel={`Quantity for ${line.name}`}
                    keyboardType="decimal-pad" value={line.quantity} editable={!busy} maxLength={10} onChangeText={updateQuantity}
                    onBlur={() => {if (Number(line.quantity) <= 0) updateQuantity('1');}} />
                  <Button variant="tertiary" compact title="+" accessibilityLabel={`Increase quantity for ${line.name}`}
                    disabled={busy} onPress={() => step(1)} />
                </View>
                <Button variant="tertiary" compact title="Remove" disabled={busy} onPress={() => {
                  setItems(current => current.filter(row => estimateLineKey(row) !== line.id)); setDirty(true);
                }} />
              </View>;
            } : undefined} />
          {editable && <View style={s.card}>
            <View style={itemStyles.actions}>
              <View style={itemStyles.details}><Text style={tradeType.meta}>Estimate-wide discount (%)</Text>
                <TextInput style={s.input} accessibilityLabel="Discount percentage" keyboardType="decimal-pad" value={discount}
                  editable={!busy} onChangeText={value => {setDiscount(value); setDirty(true);}} /></View>
              <View style={itemStyles.details}><Text style={tradeType.meta}>GST rate (%)</Text>
                <TextInput style={s.input} accessibilityLabel="GST rate percentage" keyboardType="decimal-pad" value={rate}
                  editable={!busy} onChangeText={value => {setRate(value); setDirty(true);}} /></View>
            </View>
            <View style={[s.row, {flexWrap: 'wrap'}]}>{(['CGST_SGST', 'IGST'] as const).map(value =>
              <Button key={value} variant="navigation" compact title={value === 'IGST' ? 'IGST (inter-state)' : 'CGST + SGST (intra-state)'}
                selected={mode === value} disabled={busy} onPress={() => {setMode(value); setDirty(true);}} />)}</View>
          </View>}
          <DocumentTotals amount={estimateAmounts.total_amount} fields={financialFields(estimateAmounts, mode)}
            notes="Estimate for review. The final invoice is issued separately." />
          <View style={itemStyles.actions}>
            {!finalized && !editable && <Button variant="secondary" title="Edit estimate" disabled={busy} onPress={() => setDirty(true)} />}
            {editable && <Button variant="secondary" title="Save draft" disabled={busy} onPress={() => perform(async () => {
              await save('DRAFT'); setMessage('Draft saved.');
            })} />}
            <Button variant="secondary" icon="download" title="Download PDF" disabled={busy} onPress={() => perform(async () => {
              await openLocalPdf((await estimatePdf()).uri);
            })} />
            <Button variant="tertiary" title={Platform.OS === 'web' ? 'Save customer PDF' : 'Share PDF'} disabled={busy} onPress={() => perform(async () => {
              await shareCustomerPdf(saved && !dirty ? saved : await save('DRAFT'));
            })} />
            <Button variant="tertiary" title="Print" disabled={busy} onPress={() => perform(async () => {
              await printSavedPdf((await estimatePdf()).uri);
            })} />
            <Button variant="tertiary" title="Copy summary" disabled={busy} onPress={() => perform(async () => {
              await Clipboard.setStringAsync(`${estimateNumber} · ${customer || 'Walk-in customer'} · ${inr(estimateAmounts.total_amount)}`);
              setMessage('Estimate summary copied.');
            })} />
          </View>
        </>}
        </>}
        <Text style={s.label}>Saved estimates</Text>
        {estimates.state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading saved estimates" />
          : estimates.state.status === 'error' ? <><Text style={s.error}>{estimates.state.message}</Text>
            <Button variant="secondary" title="Retry estimates" onPress={estimates.retry} /></>
          : estimates.state.data.results.map(value =>
            <DocumentLedgerRow key={value.id} disabled={busy} party={value.customer_name || 'Walk-in customer'}
              reference={['EST-' + value.id, value.created_at && istDateTime(value.created_at), value.items.length + ' items'].filter(Boolean).join(' · ')}
              amount={value.totals.total_amount} status={estimateStatus(value.status)}
              onPress={() => {
                if (!dirty) {restore(value); return;}
                showAlert('Discard unsaved estimate changes?', '', [{text: 'Cancel', style: 'cancel'},
                  {text: 'Open estimate', onPress: () => restore(value)}]);
              }} />)}
        <HistoryPager {...estimates} disabled={busy} />
      </>}
      {tab === 'Bills' && (selectedBill ? (() => {
        const {snapshot} = selectedBill;
        const billItems = snapshot.items ?? [];
        const billTotals = snapshot.totals;
        return <>
          <DocumentHeader kind="INVOICE" number={selectedBill.bill_number}
            status={selectedBill.payment_status === 'PAID' ? 'Paid' : 'Unpaid'} date={istDateTime(selectedBill.issued_at)}
            party={[[ 'Customer', snapshot.customer_name || 'Walk-in customer' ], ['Phone', snapshot.customer_mobile]]}
            meta={[[ 'Issued', istDateTime(selectedBill.issued_at) ], ['Supplier', snapshot.dealer_name],
              ['Supplier GSTIN', snapshot.dealer_gstin], ['Estimate', snapshot.id ? 'EST-' + snapshot.id : undefined]]} />
          {billItems.length > 0 && <DocumentTable
            lines={documentLines(billItems, billItems.map(line => line.line_total ?? '—'), snapshot.gst_rate_percentage)}
            subtotal={billTotals.sub_total ?? billTotals.total_amount} />}
          <DocumentTotals amount={billTotals.total_amount} fields={financialFields(billTotals, snapshot.gst_type)} />
          <View style={itemStyles.actions}>
            <Button variant="tertiary" title={Platform.OS === 'web' ? 'Save customer PDF' : 'Share PDF'} disabled={busy}
              onPress={() => perform(() => shareCustomerPdf(snapshot, selectedBill))} />
            <Button variant="secondary" icon="download" title="Download Invoice PDF" disabled={busy}
              onPress={() => perform(() => openPdf(billsPath + selectedBill.id + '/pdf/', selectedBill.bill_number, 'dealer-bill-' + selectedBill.id))} />
            <Button variant="tertiary" title="Print" disabled={busy} onPress={() => perform(async () => {
              const file = await savePdf(billsPath + selectedBill.id + '/pdf/', selectedBill.bill_number, 'dealer-bill-' + selectedBill.id);
              await printSavedPdf(file.uri);
            })} />
            <Button variant="tertiary" title="Copy summary" disabled={busy} onPress={() => perform(async () => {
              await Clipboard.setStringAsync(`${selectedBill.bill_number} · ${snapshot.customer_name || 'Walk-in customer'} · ${inr(billTotals.total_amount)}`);
              setMessage('Invoice summary copied.');
            })} />
          </View>
        </>;
      })() : <>
        <Text style={tradeType.section}>Invoices</Text>
        {bills.state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading invoices" />
          : bills.state.status === 'error' ? <><Text style={s.error}>{bills.state.message}</Text>
            <Button variant="secondary" title="Retry invoices" onPress={bills.retry} /></>
          : !bills.state.data.results.length ? <Text>No invoices have been generated yet.</Text>
          : bills.state.data.results.map(bill => <DocumentLedgerRow key={bill.id}
            party={bill.snapshot.customer_name || 'Walk-in customer'}
            reference={`${bill.bill_number} · ${istDateTime(bill.issued_at)} · ${bill.snapshot.items?.length ?? '—'} items`}
            amount={bill.snapshot.totals.total_amount} status={bill.payment_status === 'PAID' ? 'Paid' : 'Unpaid'}
            onPress={() => {setSelectedBill(bill); setError(''); setMessage('');}} />)}
        <HistoryPager {...bills} disabled={busy} />
      </>)}
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
    {(tab === 'Items' || tab === 'General Items') && !!items.length && <StickyBottomBar aboveTabs>
      <View style={itemStyles.actions}>
        <Text style={tradeType.price}>{items.length} items · {inr(totals.total)}</Text>
        <Button variant="primary" compact icon="next" title="Review Estimate" onPress={() => changeTab('Estimate')} />
      </View>
    </StickyBottomBar>}
    {tab === 'Estimate' && !estimateListOnly && <StickyBottomBar aboveTabs>
      <View style={itemStyles.actions}>
        {saved && !dirty && !editable
          ? <Button variant="secondary" title="Back to List" disabled={busy} onPress={() => setEstimateListOnly(true)} />
          : <Button variant="secondary" title="+ Add Items" disabled={busy} onPress={() => changeTab('Items')} />}
        {!finalized && !!items.length && (saved?.status === 'SHARED' && !dirty
          ? <Button variant="primary" title="Convert to Invoice" loading={busy} onPress={convert} />
          : <Button variant="primary" title="Finalize Estimate" loading={busy} onPress={() => perform(async () => {
            await save('SHARED'); setMessage('Estimate confirmed and ready to convert.');
          })} />)}
      </View>
    </StickyBottomBar>}
    {tab === 'Bills' && selectedBill && <StickyBottomBar aboveTabs><View style={itemStyles.actions}>
      <Button variant="secondary" title="Back to List" disabled={busy} onPress={() => setSelectedBill(undefined)} />
      <Button variant="primary" title={Platform.OS === 'web' && typeof navigator.share !== 'function' ? 'Copy Summary' : 'Share Summary'}
        disabled={busy} onPress={() => perform(async () => {
          const message = `${selectedBill.bill_number} · ${selectedBill.snapshot.customer_name || 'Walk-in customer'} · ${inr(selectedBill.snapshot.totals.total_amount)}`;
          if (Platform.OS === 'web' && typeof navigator.share !== 'function') {
            if (!await Clipboard.setStringAsync(message)) throw new Error('Clipboard access is unavailable in this browser.');
            setMessage('Invoice summary copied.');
          } else await Share.share({message});
        })} />
    </View></StickyBottomBar>}
  </View>;
}

const itemStyles = StyleSheet.create({
  header: {backgroundColor: trade.screen, gap: 6, paddingBottom: 6},
  filters: {alignItems: 'center', gap: 6, paddingVertical: 4},
  list: {marginHorizontal: -trade.gutter},
  card: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: trade.gutter, paddingVertical: 9,
    backgroundColor: trade.surface, borderBottomWidth: 1, borderColor: trade.border},
  details: {flex: 1, minWidth: 0, gap: 3},
  search: {flex: 1, minWidth: 0},
  priceColumn: {minWidth: 84, maxWidth: '34%', alignItems: 'flex-end', gap: 5},
  quantityCell: {width: '100%', alignItems: 'center'},
  quantity: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center'},
  quantityInput: {width: 28, minHeight: 40, textAlign: 'center', paddingHorizontal: 0, fontSize: 11, color: trade.ink},
  actions: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 6},
});
