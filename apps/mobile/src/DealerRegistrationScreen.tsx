import {trade} from './trade-theme';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import {Button} from './Button';
import {businessTypes, type BusinessType} from './dealer-onboarding';

export type DealerRegistrationDraft = {firm: string; gstin: string; businessType: BusinessType | ''};

export function DealerRegistrationFields({draft, change, disabled}: {
  draft: DealerRegistrationDraft; change: (draft: DealerRegistrationDraft) => void; disabled: boolean;
}) {
  return <>
    <Text style={styles.label}>Firm name</Text>
    <TextInput accessibilityLabel="Firm name" style={styles.input} value={draft.firm} maxLength={200}
      editable={!disabled} onChangeText={firm => change({...draft, firm})} />
    <Text style={styles.label}>GSTIN</Text>
    <TextInput accessibilityLabel="GSTIN" style={styles.input} value={draft.gstin} maxLength={15}
      autoCapitalize="characters" autoCorrect={false} editable={!disabled}
      onChangeText={gstin => change({...draft, gstin: gstin.toUpperCase().replace(/[^A-Z0-9]/g, '')})} />
    <Text style={styles.label}>Business type</Text>
    <View style={styles.pills}>{(Object.keys(businessTypes) as BusinessType[]).map(value =>
      <Button key={value} variant="navigation" title={businessTypes[value]} selected={draft.businessType === value}
        disabled={disabled} onPress={() => change({...draft, businessType: value})} />)}</View>
  </>;
}

const styles = StyleSheet.create({
  label: {fontSize: 13, fontWeight: '700', color: trade.heading},
  input: {borderWidth: 1, borderColor: trade.border, borderRadius: 10, minHeight: 50, padding: 12, color: trade.ink},
  pills: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
});
