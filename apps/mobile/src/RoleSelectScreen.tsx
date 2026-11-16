import {trade} from './trade-theme';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Button} from './Button';
import {RoleBadge} from './RoleIdentity';
import type {AccountType} from './auth';

export const registrationCards = [
  ['PERSONAL', 'Personal Customer', 'Browse catalogues & find local dealers · Free'],
  ['BUSINESS', 'Dealer / Shop', 'Create quotations, invoices & build your network'],
  ['COMPANY', 'Company / Manufacturer', 'Upload official product catalogues'],
  ['SERVICE_PROVIDER', 'Service Provider', 'Electrician, plumber, mechanic or technician'],
  ['JOB_SEEKER', 'Job Seeker', 'Prepare a profile for local skilled trade employment'],
  ['EMPLOYER', 'Employer', 'Prepare a business profile for hiring local trade workers'],
] as const satisfies readonly [AccountType, string, string][];

export default function RoleSelectScreen({choose, cancel}: {choose: (role: AccountType) => void; cancel: () => void}) {
  const {bottom} = useSafeAreaInsets();
  return <ScrollView contentContainerStyle={[s.content, {paddingBottom: bottom + 22}]}>
    <Text style={s.heading} accessibilityRole="header">Join SmartTrade</Text>
    <Text style={s.body}>Select your account type to continue</Text>
    <Text style={s.body}>Each mobile number can have one account type. Choose the role that fits you.</Text>
    <View style={s.cards}>{registrationCards.map(([role, title, subtitle]) =>
      <Pressable key={role} accessibilityRole="button" accessibilityLabel={title}
        accessibilityHint={subtitle} style={({pressed}) => [s.card, pressed && s.pressed]} onPress={() => choose(role)}>
        <RoleBadge role={role} />
        <Text style={s.title}>{title}</Text>
        <Text style={s.body}>{subtitle}</Text>
      </Pressable>)}</View>
    <Button variant="tertiary" title="Already registered? Sign in" onPress={cancel} />
  </ScrollView>;
}
const s = StyleSheet.create({
  content: {padding: trade.gutter, gap: 10}, heading: {fontSize: 17, lineHeight: 26, fontWeight: '800', color: trade.ink},
  cards: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  card: {flexGrow: 1, flexBasis: 145, minHeight: 104, gap: 6, padding: 10, backgroundColor: trade.surface,
    borderColor: trade.border, borderWidth: 1, borderRadius: 12},
  pressed: {backgroundColor: trade.accentTint}, title: {fontSize: 14, fontWeight: '800', color: trade.ink}, body: {color: trade.secondary, fontSize: 13, lineHeight: 19},
});
