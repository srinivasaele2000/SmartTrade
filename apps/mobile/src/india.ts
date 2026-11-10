export const INDIAN_MOBILE = /^\+91[6-9][0-9]{9}$/;
export const INDIAN_PIN = /^[1-9][0-9]{5}$/;
export const MOBILE_HELP = 'Enter a valid 10-digit mobile number';
export const PIN_HELP = 'Enter 6-digit postal PIN code';

export function indianMobileDigits(value: string): string {
  if (value.trim().startsWith('+') && !value.trim().startsWith('+91')) return '';
  const digits = value.replace(/\D/g, '');
  return (digits.startsWith('91') && (value.trim().startsWith('+91') || digits.length === 12)
    ? digits.slice(2) : digits).slice(0, 10);
}

export function displayIndianMobile(digits: string): string {
  return [digits.slice(0, 5), digits.slice(5)].filter(Boolean).join(' ');
}

export const indianPinDigits = (value: string) => value.replace(/\D/g, '').slice(0, 6);
export const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const INDIAN_STATES = [
  'Andaman and Nicobar Islands','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jammu and Kashmir','Jharkhand','Karnataka','Kerala','Ladakh','Lakshadweep','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
] as const;

export function indianNumber(value: string, minimumDecimals = 0): string {
  const [wholeRaw, decimalRaw = ''] = value.split('.');
  const negative = wholeRaw.startsWith('-');
  const digits = (negative ? wholeRaw.slice(1) : wholeRaw).replace(/^0+(?=\d)/, '') || '0';
  const tail = digits.slice(-3), head = digits.slice(0, -3);
  const groupedHead = head.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const decimal = decimalRaw.replace(/0+$/, '').padEnd(minimumDecimals, '0');
  return `${negative ? '-' : ''}${groupedHead ? `${groupedHead},` : ''}${tail}${decimal ? `.${decimal}` : ''}`;
}
export const inr = (value: string) => `₹${indianNumber(value, 2)}`;
export function istDateTime(value: string): string {
  if (typeof value !== 'string' || !value) return 'Date unavailable';
  // Hermes accepts millisecond ISO precision; Django emits microseconds.
  const date = new Date(value.replace(/(\.\d{3})\d+(?=Z|[+-]\d{2}:?\d{2}$)/, '$1'));
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('day')}-${part('month')}-${part('year')} ${part('hour')}:${part('minute')} IST`;
}
