import {useCallback, useState} from 'react';
import {ActivityIndicator, Alert, StyleSheet, Text, TextInput, View} from 'react-native';
import {Button} from './Button';
import type {ApiClient} from './api';
import {estimatePage, generalItemPrice, type GeneralItem, type EstimateLine} from './dealer-estimates';
import {inr} from './india';
import {trade, tradeType} from './trade-theme';
import {useHistoryPage} from './useHistoryPage';
import {useDebouncedSearch} from './useDebouncedSearch';

const path = '/dealers/general-items/';
const blank = {product_name: '', product_code: '', hsn_sac_code: '', list_price_per_unit: ''};
const fields = [
  ['product_name', 'Product name', 200], ['product_code', 'Product code (optional)', 64],
  ['hsn_sac_code', 'HSN / SAC code (optional)', 32], ['list_price_per_unit', 'List price per unit (₹)', 13],
] as const;

export default function GeneralItems({api, token, items, initiallyAdding, disabled, canAdd, onQuantity, addAndOpen, onArchive}: {
  api: ApiClient; token: string; items: EstimateLine[]; initiallyAdding: boolean; disabled: boolean; canAdd: boolean;
  onQuantity: (item: GeneralItem, quantity: number) => void; addAndOpen: (item: GeneralItem) => void;
  onArchive: (id: number) => void;
}) {
  const [form, setForm] = useState<typeof blank | null>(initiallyAdding ? blank : null);
  const [editing, setEditing] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const search = useDebouncedSearch();
  const load = useCallback((page: number, signal: AbortSignal) => estimatePage<GeneralItem>(
    api, path + '?' + new URLSearchParams({q: search.query}), page, token, signal,
  ), [api, search.query, token]);
  const list = useHistoryPage(load, search.query);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try {await action();}
    catch (e) {setError(e instanceof Error ? e.message : 'Could not update General Items.');}
    finally {setBusy(false);}
  }
  function save(add: boolean) {
    if (!form) return;
    void run(async () => {
      const payload = {product_name: form.product_name.trim(), product_code: form.product_code.trim(),
        hsn_sac_code: form.hsn_sac_code.trim(), list_price_per_unit: form.list_price_per_unit.trim()};
      if (!payload.product_name) throw new Error('Enter a product name.');
      if (!generalItemPrice.test(payload.list_price_per_unit)) throw new Error('Enter a valid non-negative list price with up to two decimal places.');
      const item = (editing ? await api.get(path + editing + '/', undefined, token, {method: 'PATCH', body: JSON.stringify(payload)})
        : await api.post(path, payload, token)) as GeneralItem;
      setForm(null); setEditing(undefined); list.refresh();
      if (add) addAndOpen(item);
    });
  }
  return <View style={s.section}>
    <Text style={tradeType.row}>General Items</Text>
    <Text style={tradeType.meta}>General Items are private to your account and do not affect the master catalogue.</Text>
    <Button variant="primary" title="+ Add General Item" disabled={busy || disabled} onPress={() => {setEditing(undefined); setForm(blank); setError('');}} />
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {form && <View style={s.card}>
      <Text style={tradeType.row}>{editing ? 'Edit General Item' : 'New General Item'}</Text>
      {fields.map(([key, label, max]) => <View key={key}>
        <Text style={tradeType.meta}>{label}</Text>
        <TextInput style={s.input} value={form[key]} accessibilityLabel={label} maxLength={max} editable={!busy && !disabled}
          keyboardType={key === 'list_price_per_unit' ? 'decimal-pad' : 'default'}
          onChangeText={value => setForm({...form, [key]: value})} />
      </View>)}
      <Button variant="primary" title="Save Item" disabled={busy || disabled} onPress={() => save(false)} />
      {canAdd && <Button variant="secondary" title="Save & Add to Estimate" disabled={busy || disabled} onPress={() => save(true)} />}
      <Button variant="tertiary" title="Cancel" disabled={busy} onPress={() => {setForm(null); setEditing(undefined); setError('');}} />
    </View>}
    <TextInput style={s.input} value={search.text} onChangeText={search.change} onSubmitEditing={search.submit}
      accessibilityLabel="Search General Items" placeholder="Search name, code or HSN" returnKeyType="search" />
    {search.pending || list.state.status === 'loading' ? <ActivityIndicator accessibilityLabel="Loading General Items" />
      : list.state.status === 'error' ? <>
        <Text accessibilityRole="alert" style={s.error}>{list.state.message}</Text>
        <Button variant="secondary" title="Retry General Items" onPress={list.retry} />
      </> : <>
        {!list.state.data.results.length && <Text style={tradeType.meta}>{search.query ? 'No General Items match your search.' : 'No General Items yet.'}</Text>}
        {list.state.data.results.map(item => {
          const quantity = items.find(line => line.dealer_custom_item === item.id)?.quantity;
          return <View key={item.id} style={s.card}>
            <Text style={tradeType.row}>{item.product_name}</Text>
            <View style={s.row}>
              {!!item.product_code && <Text style={s.pill}>Code {item.product_code}</Text>}
              {!!item.hsn_sac_code && <Text style={s.pill}>HSN {item.hsn_sac_code}</Text>}
            </View>
            <Text style={tradeType.price}>{inr(item.list_price_per_unit)} / unit</Text>
            <View style={s.row}>
              <Button variant="secondary" compact title="Edit" disabled={busy || disabled}
                onPress={() => {setEditing(item.id); setForm(item); setError('');}} />
              <Button variant="destructive" compact title="Delete" disabled={busy || disabled} onPress={() =>
                Alert.alert('Remove General Item?', 'Saved estimates keep their item details.', [
                  {text: 'Cancel', style: 'cancel'}, {text: 'Remove', style: 'destructive', onPress: () => void run(async () => {
                    await api.get(path + item.id + '/', undefined, token, {method: 'DELETE'});
                    if (editing === item.id) {setForm(null); setEditing(undefined);}
                    onArchive(item.id);
                    list.refresh();
                  })},
                ])} />
              {canAdd && (quantity ? <>
                <Button variant="tertiary" compact title="−" accessibilityLabel={'Decrease ' + item.product_name}
                  disabled={busy || disabled} onPress={() => onQuantity(item, Math.max(0, Number(quantity) - 1))} />
                <Text>{quantity}</Text>
                <Button variant="tertiary" compact title="+" accessibilityLabel={'Increase ' + item.product_name}
                  disabled={busy || disabled} onPress={() => onQuantity(item, Number(quantity) + 1)} />
              </> : <Button variant="primary" compact title="Add to Estimate" disabled={busy || disabled} onPress={() => onQuantity(item, 1)} />)}
            </View>
          </View>;
        })}
        {list.state.data.previous && <Button variant="secondary" title="Previous General Items" onPress={list.previous} />}
        {list.state.data.next && <Button variant="secondary" title="More General Items" onPress={list.next} />}
      </>}
  </View>;
}

const s = StyleSheet.create({
  section: {gap: 9}, card: {borderWidth: 1, borderColor: trade.border, borderRadius: 10, backgroundColor: trade.surface, padding: 12, gap: 7},
  input: {minHeight: 44, paddingHorizontal: 9, color: trade.ink, borderWidth: 1, borderColor: trade.border, borderRadius: 8},
  row: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6},
  pill: {fontSize: 12, color: trade.heading, backgroundColor: '#e6f4ed', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3},
  error: {color: '#9c2820'},
});
