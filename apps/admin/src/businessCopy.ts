const labels: Record<string, string> = {
  PENDING: 'Pending review',
  APPROVE: 'Approve',
  REJECT: 'Reject',
  IN_STOCK: 'In stock',
  OUT_OF_STOCK: 'Out of stock',
  GSTIN: 'GSTIN',
  GST: 'GST',
  PAN: 'PAN',
  HSN: 'HSN',
  EMAIL: 'Email',
  SKU: 'Item code',
};

export function businessLabel(value: unknown): string {
  if (typeof value !== 'string') return 'Not provided';
  const key = value.trim().toUpperCase();
  if (Object.hasOwn(labels, key)) return labels[key];
  const words = value.trim().replaceAll('_', ' ');
  if (!words) return 'Not provided';
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export function businessDetail(value: unknown): string {
  if (value == null || value === '') return 'Not provided';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(businessDetail).join(', ') || 'None';
  if (typeof value === 'object') return Object.entries(value)
    .map(([key, item]) => `${businessLabel(key)}: ${businessDetail(item)}`).join(' · ') || 'None';
  return String(value);
}
