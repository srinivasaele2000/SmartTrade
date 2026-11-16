import type {ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {inr} from './india';
import {trade, tradeType} from './trade-theme';

const small = 'Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen'.split(' ');
const tens = 'Zero Ten Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety'.split(' ');

function indianWords(value: bigint): string {
  for (const [size, label] of [[10_000_000n, 'Crore'], [100_000n, 'Lakh'], [1_000n, 'Thousand'], [100n, 'Hundred']] as const) {
    if (value >= size) {
      const remainder = value % size;
      return indianWords(value / size) + ' ' + label + (remainder ? ' ' + indianWords(remainder) : '');
    }
  }
  return value < 20n ? small[Number(value)] :
    tens[Number(value / 10n)] + (value % 10n ? ' ' + small[Number(value % 10n)] : '');
}

export function amountInWords(amount: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) return '—';
  const [whole, fraction = ''] = amount.split('.');
  const paise = BigInt(fraction.padEnd(2, '0'));
  return 'Rupees ' + indianWords(BigInt(whole)) + (paise ? ' and ' + indianWords(paise) + ' Paise' : '') + ' Only';
}

type Fields = [label: string, value: string | undefined][];
function Details({fields}: {fields: Fields}) {
  return <>{fields.filter(([, value]) => Boolean(value)).map(([label, value]) =>
    <Text key={label} style={tradeType.meta}>{label} {value}</Text>)}</>;
}

export function DocumentHeader({kind, number, status, date, party, meta, children}: {
  kind: string; number: string; status: string; date?: string; party: Fields; meta: Fields; children?: ReactNode;
}) {
  return <View style={styles.frame}>
    <View style={styles.strip}><View style={styles.flex}><Text style={styles.badge}>{kind}</Text>
      <Text accessibilityRole="header" style={tradeType.section}>{number}</Text>{date && <Text style={tradeType.meta}>{date}</Text>}</View>
      <Text style={styles.status}>{status}</Text></View>
    <View style={styles.split}>
      <View style={styles.column}><Text style={tradeType.row}>Bill To / Party</Text><Details fields={party} />{children}</View>
      <View style={[styles.column, styles.divider]}><Text style={tradeType.row}>Document info</Text><Details fields={meta} /></View>
    </View>
  </View>;
}

export type DocumentLine = {id: number; name: string; code?: string; hsn?: string; general?: boolean; quantity: string;
  unit?: string; rate: string; gst?: string; amount: string};
const widths = [26, 152, 56, 70, 48, 84];

function totalQuantity(lines: DocumentLine[]) {
  const total = lines.reduce((sum, {quantity}) => {
    if (!/^\d+(?:\.\d{0,4})?$/.test(quantity)) return sum;
    const [whole, fraction = ''] = quantity.split('.');
    return sum + BigInt(whole + fraction.padEnd(4, '0'));
  }, 0n);
  const fraction = String(total % 10000n).padStart(4, '0').replace(/0+$/, '');
  return String(total / 10000n) + (fraction ? '.' + fraction : '');
}

export function DocumentTable({lines, subtotal, editQuantity, editPrice}: {
  lines: DocumentLine[]; subtotal: string; editQuantity?: (line: DocumentLine) => ReactNode;
  editPrice?: (line: DocumentLine) => ReactNode;
}) {
  const cell = (index: number, content: ReactNode) =>
    <View key={index} style={[styles.cell, {width: index === 2 && editQuantity ? 112 : widths[index]},
      index === 1 && styles.description, index === 0 && styles.center, index > 1 && styles.numericCell]}>{content}</View>;
  const label = (value: string, bold = false) => <Text style={[styles.numeric, bold && styles.bold]}>{value}</Text>;
  return <ScrollView horizontal keyboardShouldPersistTaps="handled" accessibilityLabel="Line items table">
    <View style={styles.frame}>
      <View style={[styles.tableRow, styles.tableHeader]}>
        {['#', 'Item Description & Code', 'Qty', 'Rate (₹)', 'GST %', 'Amount (₹)'].map((heading, index) => cell(index, label(heading, true)))}
      </View>
      {lines.map((line, index) => <View key={line.id} style={[styles.tableRow, index % 2 === 1 && styles.zebra]}>
        {cell(0, label(String(index + 1)))}
        {cell(1, <><Text style={tradeType.row}>{line.name}</Text>
          {line.general && <Text style={tradeType.meta}>General</Text>}
          {editPrice?.(line)}
          {(line.code || line.hsn) && <Text style={tradeType.meta}>{[line.code && 'Code: ' + line.code, line.hsn && 'HSN: ' + line.hsn].filter(Boolean).join(' | ')}</Text>}</>)}
        {cell(2, editQuantity ? editQuantity(line) : label([line.quantity, line.unit].filter(Boolean).join(' ')))}
        {cell(3, label(inr(line.rate)))}
        {cell(4, label(line.gst === undefined ? '—' : line.gst + '%'))}
        {cell(5, label(inr(line.amount), true))}
      </View>)}
      <View style={[styles.tableRow, styles.tableHeader]}>
        {cell(0, null)}{cell(1, label('Total Qty / Item Subtotal', true))}
        {cell(2, label(totalQuantity(lines), true))}{cell(3, null)}{cell(4, null)}{cell(5, label(inr(subtotal), true))}
      </View>
    </View>
  </ScrollView>;
}

export function DocumentTotals({amount, fields, notes}: {amount: string; fields: Fields; notes?: string}) {
  return <View style={[styles.frame, styles.split]}>
    <View style={styles.column}><Text style={tradeType.row}>Amount in Words</Text>
      <Text style={tradeType.meta}>{amountInWords(amount)}</Text>
      {notes && <Text style={tradeType.meta}>{notes}</Text>}
    </View>
    <View style={[styles.column, styles.divider, styles.financial]}>
      {fields.filter(([, value]) => value !== undefined).map(([label, value]) =>
        <View key={label} style={styles.totalRow}><Text style={tradeType.meta}>{label}</Text>
          <Text style={styles.numeric}>{value === undefined ? '—' : inr(value)}</Text></View>)}
      <View style={[styles.totalRow, styles.grand]}><Text style={tradeType.row}>Grand Total (₹)</Text>
        <Text style={styles.grandValue}>{inr(amount)}</Text></View>
    </View>
  </View>;
}

export function DocumentLedgerRow({party, reference, amount, status, onPress, disabled}: {
  party: string; reference: string; amount: string; status: string; onPress: () => void; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    accessibilityLabel={[party, reference, inr(amount), status].join(', ')}
    style={({pressed}) => [styles.ledger, pressed && styles.grand]}>
    <View style={styles.flex}><Text style={tradeType.row}>{party}</Text><Text style={tradeType.meta}>{reference}</Text></View>
    <View style={styles.ledgerAmount}><Text style={tradeType.price}>{inr(amount)}</Text><Text style={styles.status}>{status}</Text></View>
  </Pressable>;
}

const styles = StyleSheet.create({
  frame: {borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: trade.surface},
  strip: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 10, backgroundColor: '#F1F5F9', borderBottomWidth: 1, borderColor: trade.border},
  badge: {...tradeType.meta, color: trade.accent, fontWeight: '700', letterSpacing: 0.6},
  status: {...tradeType.meta, color: trade.accent, backgroundColor: trade.accentTint, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8},
  flex: {flex: 1, minWidth: 0, gap: 4},
  split: {flexDirection: 'row'},
  column: {flex: 1, minWidth: 0, padding: 8, gap: 4},
  divider: {borderLeftWidth: 1, borderColor: trade.border},
  tableRow: {flexDirection: 'row'},
  tableHeader: {backgroundColor: '#F1F5F9'},
  zebra: {backgroundColor: trade.screen},
  cell: {borderRightWidth: 1, borderBottomWidth: 1, borderColor: trade.border, justifyContent: 'center', paddingHorizontal: 4, paddingVertical: 6},
  description: {gap: 3},
  center: {alignItems: 'center'},
  numericCell: {alignItems: 'flex-end'},
  numeric: {fontSize: 11, lineHeight: 15, color: trade.ink, fontVariant: ['tabular-nums']},
  bold: {fontWeight: '700'},
  financial: {flex: 1.4, padding: 0, gap: 0},
  totalRow: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 3, padding: 6, borderBottomWidth: 1, borderColor: trade.border},
  grand: {backgroundColor: trade.accentTint},
  grandValue: {...tradeType.price, fontSize: 15, color: trade.accent},
  ledger: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: trade.border, backgroundColor: trade.surface},
  ledgerAmount: {maxWidth: '43%', alignItems: 'flex-end', gap: 4},
});
