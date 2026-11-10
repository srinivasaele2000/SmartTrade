import {StyleSheet, Text, useColorScheme, View} from 'react-native';
import {Building2, ShieldCheck, ShoppingBag, Store} from 'lucide-react-native';
import type {Account} from './auth';

const identities = {
  PERSONAL: {label: 'BUYER', Icon: ShoppingBag, light: ['#E7F0FF', '#174888'], dark: ['#162E52', '#C4DAFF']},
  BUSINESS: {label: 'DEALER', Icon: Store, light: ['#DBF1E5', '#15543B'], dark: ['#17382B', '#B2E7CB']},
  COMPANY: {label: 'COMPANY', Icon: Building2, light: ['#EFE6FF', '#552780'], dark: ['#36234D', '#E8D3FF']},
  STAFF: {label: 'STAFF', Icon: ShieldCheck, light: ['#FCE9E7', '#8A241B'], dark: ['#481C1B', '#FFD1CC']},
} as const;

export function RoleIdentity({account, heading = false}: {account: Account | null; heading?: boolean}) {
  if (!account) return null;
  const admin = account.account_type === 'STAFF' && account.staff_profile?.state === 'ACTIVE' &&
    Array.isArray(account.staff_profile.roles) &&
    account.staff_profile.roles.includes('PLATFORM_ADMIN');
  return <RoleBadge role={account.account_type} admin={admin} heading={heading} />;
}

export function RoleBadge({role, heading = false, admin = false}: {role: Account['account_type']; heading?: boolean; admin?: boolean}) {
  const dark = useColorScheme() === 'dark';
  const identity = identities[role];
  if (!identity) return null;
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
  badge: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', gap: 8, borderRadius: 24, paddingHorizontal: 11, paddingVertical: 7},
  heading: {paddingHorizontal: 14, paddingVertical: 10},
  label: {fontSize: 13, fontWeight: '800', letterSpacing: 0.35, flexShrink: 1},
  headingLabel: {fontSize: 23},
});
