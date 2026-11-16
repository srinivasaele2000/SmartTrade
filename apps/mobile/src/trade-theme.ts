export const trade = {
  screen: '#F8FAFC', surface: '#FFFFFF', ink: '#0F172A', secondary: '#475569',
  muted: '#64748B', heading: '#334155', accent: '#1D4ED8', accentTint: '#EFF6FF',
  success: '#047857', successTint: '#ECFDF5', border: '#E2E8F0',
  gutter: 12, radius: 8,
} as const;

export const tradeType = {
  title: {fontSize: 17, lineHeight: 22, fontWeight: '600', color: trade.ink},
  section: {fontSize: 14, lineHeight: 19, fontWeight: '600', color: trade.heading},
  row: {fontSize: 13, lineHeight: 17, fontWeight: '600', color: trade.ink},
  meta: {fontSize: 11, lineHeight: 14, color: trade.secondary},
  price: {fontSize: 14, lineHeight: 18, fontWeight: '700', color: trade.ink, fontVariant: ['tabular-nums']},
} satisfies Record<string, import('react-native').TextStyle>;
