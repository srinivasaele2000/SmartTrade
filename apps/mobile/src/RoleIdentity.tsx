import {StyleSheet, Text, useColorScheme, View} from 'react-native';
import {Building2, ShieldCheck, ShoppingBag, Store} from 'lucide-react-native';
import type {Account} from './auth';

const identities = {
  PERSONAL: {label: 'BUYER', Icon: ShoppingBag, light: ['#E7F0FF', '#174888'], dark: ['#162E52', '#C4DAFF']},
  BUSINESS: {label: 'DEALER', Icon: Store, light: ['#DBF1E5', '#15543B'], dark: ['#17382B', '#B2E7CB']},
  COMPANY: {label: 'COMPANY', Icon: Building2, light: ['#EFE6FF', '#552780'], dark: ['#36234D', '#E8D3FF']},
  STAFF: {label: 'STAFF', Icon: ShieldCheck, light: ['#FFEBD5', '#843D0B'], dark: ['#4B2B17', '#FFD3A7']},
} as const;

export function RoleIdentity({account, heading = false}: {account: Account | null; heading?: boolean}) {
  const dark = useColorScheme() === 'dark';
  if (!account) return null;
  const identity = identities[account.account_type];
  if (!identity) return null;
  const admin = account.account_type === 'STAFF' && account.staff_profile?.state === 'ACTIVE' &&
    Array.isArray(account.staff_profile.roles) &&
    account.staff_profile.roles.includes('PLATFORM_ADMIN');
  const label = admin ? 'PLATFORM ADMIN' : identity.label;
  const [backgroundColor, color] = dark ? identity.dark : identity.light;
  const Icon = identity.Icon;

  return <View style={[styles.badge, heading && styles.heading, {backgroundColor}]}>
    <Icon size={heading ? 24 : 18} color={color} accessible={false} />
    <Text accessibilityRole={heading ? 'header' : undefined}
      accessibilityLabel={'Account role: ' + label}
      style={[styles.label, heading && styles.headingLabel, {color}]}>{label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  badge: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', gap: 8, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7},
  heading: {paddingHorizontal: 14, paddingVertical: 10},
  label: {fontSize: 13, fontWeight: '800', flexShrink: 1},
  headingLabel: {fontSize: 23},
});
