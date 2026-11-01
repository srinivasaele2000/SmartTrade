import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
      {creating && <><Text style={s.label}>Choose your account type</Text><View style={s.row}>{(['PERSONAL', 'BUSINESS', 'COMPANY'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: type === value, disabled: busy }} disabled={busy} onPress={() => setType(value)} style={[s.choice, type === value && s.selected]}><Text>{value === 'PERSONAL' ? 'Personal' : value === 'BUSINESS' ? 'Dealer / Business' : 'Company'}</Text></Pressable>)}</View><Text style={s.body}>One mobile number, one immutable account type. Business and company verification are separate from sign-in.</Text></>}
      <Text style={s.label}>Mobile number with country code</Text>
      <TextInput accessibilityLabel="Mobile number with country code" style={s.input} value={mobile} onChangeText={setMobile} editable={!busy && !requested} keyboardType="phone-pad" autoComplete="tel" autoCorrect={false} maxLength={16} placeholder="+ followed by country code and number" />
      {requested && <><Text style={s.label}>Verification code</Text><TextInput accessibilityLabel="Verification code" style={s.input} value={code} onChangeText={setCode} editable={!busy} autoCorrect={false} autoCapitalize="none" maxLength={256} onSubmitEditing={() => { if (!busy) void submit(); }} /></>}
      {message !== '' && <Text accessibilityLiveRegion="polite" style={s.notice}>{message}</Text>}
      {error !== '' && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {busy && <ActivityIndicator accessibilityLabel="Signing in" />}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit()} style={[s.primary, busy && s.disabled]}><Text style={s.primaryText}>{busy ? 'Please wait…' : requested ? 'Verify and continue' : creating ? 'Register and send OTP' : 'Send OTP'}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} style={s.choice} onPress={() => { setRequested(false); setCreating(!creating); setCode(''); setMessage(''); setError(''); }}><Text>{requested ? 'Start again / register a new account' : creating ? 'Already registered? Sign in' : 'New here? Create an account'}</Text></Pressable>
    </View>
    <Text style={s.body}>Tokens stay in memory. Closing or reloading the app requires sign-in again. Development OTP never verifies phone ownership or grants staff permissions.</Text>
  </ScrollView>;
}
const s = StyleSheet.create({
  content: { padding: 22, gap: 16, paddingBottom: 60 }, kicker: { color: '#087f5b', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 }, title: { fontSize: 32, color: '#17392d', fontWeight: '800' }, body: { color: '#52675c', fontSize: 15, lineHeight: 23 },
  card: { backgroundColor: '#fff', padding: 20, gap: 14, borderRadius: 18, borderColor: '#dce7e0', borderWidth: 1 }, label: { fontSize: 15, fontWeight: '700', color: '#294b3a' }, input: { borderWidth: 1, borderColor: '#9fb7aa', padding: 12, borderRadius: 10, fontSize: 16, minHeight: 50, color: '#17392d' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { borderWidth: 1, borderColor: '#b4d4c2', borderRadius: 10, padding: 13, minHeight: 46 }, selected: { backgroundColor: '#bde5ce', borderColor: '#176c46' }, primary: { backgroundColor: '#126743', borderRadius: 10, padding: 16 }, primaryText: { color: '#fff', fontWeight: '700', textAlign: 'center', fontSize: 16 }, disabled: { opacity: 0.5 }, notice: { backgroundColor: '#edf7f0', padding: 12, color: '#294b3a', lineHeight: 22 }, error: { color: '#9c2820', lineHeight: 22 },
});
