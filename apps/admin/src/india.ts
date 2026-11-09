const numberFormat = new Intl.NumberFormat('en-IN');
const moneyFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

export function indianNumber(value: number | string): string {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? numberFormat.format(parsed) : String(value);
}

export function inr(value: number | string): string {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? moneyFormat.format(parsed) : `₹${value}`;
}

export function istDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('day')}-${part('month')}-${part('year')} ${part('hour')}:${part('minute')} IST`;
}
