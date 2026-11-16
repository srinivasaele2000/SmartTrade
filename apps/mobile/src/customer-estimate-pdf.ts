import {rounded, rupees, scaled, type Estimate} from './dealer-estimates';
import {istDateTime} from './india';
import {amountInWords} from './TradeDocument';

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (value: bigint) => value < 0n ? '−' + rupees(-value) : rupees(value);

export function customerPdfHtml(estimate: Estimate, number: string, kind: string, date?: string, supplier?: string, gstin?: string) {
  const totals = estimate.totals;
  const legacyPercent = scaled(estimate.discount_percentage, 2);
  let subtotal = 0n;
  const rows = estimate.items.map((line, index) => {
    const base = scaled(line.net_unit_rate ?? line.unit_price, 4);
    const net = legacyPercent ? rounded(base * (10000n - legacyPercent), 1000000n) * 100n : base;
    const amount = rounded(net * scaled(line.quantity, 3), 100000n);
    subtotal += amount;
    const rate = net % 100n ? String(net / 10000n) + '.' + String(net % 10000n).padStart(4, '0') : rupees(net / 100n);
    const description = escapeHtml(line.product_name);
    const identifiers = [line.product_code && 'Code: ' + line.product_code, line.hsn_sac_code && 'HSN: ' + line.hsn_sac_code].filter(Boolean).join(' · ');
    return `<tr><td>${index + 1}</td><td>${description}<small>${escapeHtml(identifiers)}</small></td><td>${escapeHtml(line.quantity)}</td><td>${rate}</td><td>${escapeHtml(estimate.gst_rate_percentage)}%</td><td>${money(amount)}</td></tr>`;
  }).join('');
  const adjustment = scaled(totals.taxable_amount ?? '', 2) - subtotal;
  const tax = estimate.gst_type === 'IGST' ? [['IGST', totals.igst_amount]] : [['CGST', totals.cgst_amount], ['SGST', totals.sgst_amount]];
  const summary = [...(adjustment ? [['Rate rounding', money(adjustment)]] : []),
    ['Taxable amount', totals.taxable_amount], ...tax, ['Grand total', totals.total_amount]]
    .map(([label, value]) => `<tr><th>${label}</th><td>₹ ${escapeHtml(value ?? '0.00')}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 15mm; }
    body { font: 11pt sans-serif; color: #0f172a; } h1 { font-size: 17pt; margin: 0 0 6px; }
    header { padding: 12px; border: 1px solid #cbd5e1; margin-bottom: 12px; } p { margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    thead { display: table-header-group; } tr { break-inside: avoid; }
    th,td { border: 1px solid #cbd5e1; padding: 6px; text-align: right; }
    th, tbody tr:nth-child(even) { background: #f1f5f9; }
    .items td:nth-child(2), .items th:nth-child(2) { text-align: left; }
    small { display: block; color: #475569; }
    .summary { width: 55%; margin: 12px 0 12px auto; break-inside: avoid; }
    .summary tr:last-child { font-weight: bold; background: #eff6ff; }
    </style></head><body><header><h1>${escapeHtml(kind)}</h1>
    <p>${escapeHtml(number)}${date ? ' · ' + escapeHtml(istDateTime(date)) : ''}</p>
    ${supplier ? '<p>Supplier: ' + escapeHtml(supplier) + '</p>' : ''}
    ${gstin ? '<p>Supplier GSTIN: ' + escapeHtml(gstin) + '</p>' : ''}
    <p>Bill to: ${escapeHtml(estimate.customer_name || 'Walk-in customer')}</p>
    ${estimate.customer_mobile ? '<p>Mobile: ' + escapeHtml(estimate.customer_mobile) + '</p>' : ''}</header>
    <table class="items"><thead><tr><th>#</th><th>Item description</th><th>Qty</th><th>Rate (₹)</th><th>GST %</th><th>Amount (₹)</th></tr></thead>
    <tbody>${rows}<tr><th colspan="5">Subtotal</th><th>${money(subtotal)}</th></tr></tbody></table>
    <table class="summary">${summary}</table><p><strong>Amount in words:</strong> ${escapeHtml(amountInWords(totals.total_amount))}</p>
    </body></html>`;
}
