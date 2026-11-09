import { useState } from 'react';
import {Button} from './Button';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiClient } from './api';
import { login, register, requestOtp, type AccountType } from './auth';
import { useSession } from './session';

export default function AuthScreen({ api, done }: { api: ApiClient; done: () => void }) {
  const { establishSession } = useSession();
  const [mobile, setMobile] = useState(''), [code, setCode] = useState('');
  const [creating, setCreating] = useState(false), [type, setType] = useState<AccountType>('PERSONAL');
  const [requested, setRequested] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  async function submit() {
    setBusy(true); setError('');
    let created = false;
    try {
      if (requested) {
        await establishSession(await login(api, mobile, code));
        done();
      } else {
        if (creating) { await register(api, mobile, type); created = true; setCreating(false); }
        setMessage(await requestOtp(api, mobile)); setRequested(true);
      }
    } catch (failure) {
      setError(`${created ? 'Account registered. ' : ''}${failure instanceof Error ? failure.message : 'Sign-in failed. Please retry.'}`);
    } finally { setBusy(false); }
  }
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
    <Text style={s.kicker}>YOUR SMARTTRADE ACCOUNT</Text>
    <Text accessibilityRole="header" style={s.title}>{creating ? 'Join SmartTrade' : 'Welcome back'}</Text>
    <Text style={s.body}>Browse freely. Sign in to discover dealers and manage your business.</Text>
    <View style={s.card}>
      {creating && <><Text style={s.label}>Choose your account type</Text><View style={s.row}>{(['PERSONAL', 'BUSINESS', 'COMPANY'] as const).map(value => <Button key={value} variant="navigation" selected={type === value} disabled={busy} onPress={() => setType(value)} title={value === 'PERSONAL' ? 'Personal' : value === 'BUSINESS' ? 'Dealer / Business' : 'Company'} />)}</View><Text style={s.body}>One mobile number, one immutable account type. Business and company verification are separate from sign-in.</Text></>}
      <Text style={s.label}>Indian mobile number</Text>
      <TextInput accessibilityLabel="Indian mobile number" style={s.input} value={mobile} onChangeText={setMobile} editable={!busy && !requested} keyboardType="phone-pad" autoComplete="tel" autoCorrect={false} maxLength={13} placeholder="+91XXXXXXXXXX" />
      {requested && <><Text style={s.label}>Verification code</Text><TextInput accessibilityLabel="Verification code" style={s.input} value={code} onChangeText={setCode} editable={!busy} autoCorrect={false} autoCapitalize="none" maxLength={256} onSubmitEditing={() => { if (!busy) void submit(); }} /></>}
      {message !== '' && <Text accessibilityLiveRegion="polite" style={s.notice}>{message}</Text>}
      {error !== '' && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <Button variant="primary" icon={requested?'check':'send'} loading={busy} disabled={busy} onPress={submit} title={requested ? 'Verify and continue' : creating ? 'Register and send OTP' : 'Send OTP'} />
      <Button variant="tertiary" disabled={busy} onPress={() => { setRequested(false); setCreating(!creating); setCode(''); setMessage(''); setError(''); }} title={requested ? 'Start again / register a new account' : creating ? 'Already registered? Sign in' : 'New here? Create an account'} />
    </View>
    <Text style={s.body}>Session tokens are stored with the device secure-store service and removed on sign-out. Development OTP never verifies phone ownership or grants staff permissions.</Text>
  </ScrollView>;
}
const s = StyleSheet.create({
  content: { padding: 22, gap: 16, paddingBottom: 60 }, kicker: { color: '#087f5b', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 }, title: { fontSize: 32, color: '#17392d', fontWeight: '800' }, body: { color: '#52675c', fontSize: 15, lineHeight: 23 },
  card: { backgroundColor: '#fff', padding: 20, gap: 14, borderRadius: 18, borderColor: '#dce7e0', borderWidth: 1 }, label: { fontSize: 15, fontWeight: '700', color: '#294b3a' }, input: { borderWidth: 1, borderColor: '#9fb7aa', padding: 12, borderRadius: 10, fontSize: 16, minHeight: 50, color: '#17392d' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },      notice: { backgroundColor: '#edf7f0', padding: 12, color: '#294b3a', lineHeight: 22 }, error: { color: '#9c2820', lineHeight: 22 },
});
