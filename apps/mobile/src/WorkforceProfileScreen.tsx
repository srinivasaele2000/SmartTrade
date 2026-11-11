import {useCallback, useState} from 'react';
import {ActivityIndicator, ScrollView, Text, TextInput, View} from 'react-native';
import {Button} from './Button';
import {onboardingStyles as s} from './DealerWorkerContactsScreen';
import {StickyBottomBar} from './StickyBottomBar';
import type {ApiClient} from './api';
import {indianPinDigits} from './india';
import {useResource} from './useResource';
import {readWorkforceProfile, saveWorkforceProfile, workforce, type ProfileDraft, type WorkforceRole} from './workforce-profile';

export function WorkforceFields({role, draft, change, disabled}: {
  role: WorkforceRole; draft: ProfileDraft; change: (draft: ProfileDraft) => void; disabled: boolean;
}) {
  return <>
    {workforce[role].fields.map(field => <View key={field.key} style={{gap: 6}}>
      <Text style={s.label}>{field.label}</Text>
      <TextInput accessibilityLabel={field.label} value={draft[field.key] ?? ''} style={s.input}
        maxLength={field.limit} editable={!disabled} keyboardType={'numeric' in field && field.numeric ? 'number-pad' : 'default'}
        onChangeText={value => change({...draft, [field.key]: field.key === 'pin_code' ? indianPinDigits(value) :
          field.key === 'experience' ? value.replace(/\D/g, '') : value})} />
    </View>)}
    {role === 'EMPLOYER' && <Text style={s.body}>Hiring trade is not available in your profile yet.</Text>}
  </>;
}

export default function WorkforceProfileScreen({api, token, role}: {api: ApiClient; token: string; role: WorkforceRole}) {
  const load = useCallback((signal: AbortSignal) => readWorkforceProfile(api, role, token, signal), [api, role, token]);
  const {state, retry} = useResource(load, {retainData: true});
  const [draft, setDraft] = useState<ProfileDraft>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fields = draft ?? state.data;
  async function save() {
    if (!fields) return;
    setBusy(true); setError(''); setMessage('');
    try {await saveWorkforceProfile(api, role, token, fields); setMessage('Profile saved.');}
    catch (failure) {setError(failure instanceof Error ? failure.message : 'Could not save your profile.');}
    finally {setBusy(false);}
  }
  return <View style={s.screen}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      <Text style={s.title} accessibilityRole="header">{workforce[role].title} profile</Text>
      <Text style={s.body}>Manage your private profile details.</Text>
      {fields ? <WorkforceFields role={role} draft={fields} change={value => {setDraft(value); setMessage('');}} disabled={busy} />
        : state.status === 'error' ? <><Text accessibilityRole="alert" style={s.error}>{state.message}</Text>
          <Button variant="secondary" title="Retry" onPress={retry} /></> : <ActivityIndicator accessibilityLabel="Loading profile" />}
      {error !== '' && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {message !== '' && <Text accessibilityLiveRegion="polite" style={s.body}>{message}</Text>}
    </ScrollView>
    {fields && <StickyBottomBar clearance={22}><Button variant="primary" icon="save" title="Save profile" loading={busy} onPress={save} /></StickyBottomBar>}
  </View>;
}
