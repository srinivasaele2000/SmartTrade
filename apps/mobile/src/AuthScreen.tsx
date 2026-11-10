import {StickyBottomBar} from './StickyBottomBar';
import { useEffect, useRef, useState } from 'react';
import {Button} from './Button';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiClient } from './api';
import { login, register, requestOtp, type AccountType } from './auth';
import { useSession } from './session';
import {displayIndianMobile, indianMobileDigits, INDIAN_MOBILE, MOBILE_HELP} from './india';

export default function AuthScreen({ api, done }: { api: ApiClient; done: () => void }) {
  const { establishSession } = useSession();
  const [mobile, setMobile] = useState(''), [code, setCode] = useState('');
  const [creating, setCreating] = useState(false), [type, setType] = useState<AccountType>('PERSONAL');
  const [requested, setRequested] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [mobileTouched, setMobileTouched] = useState(false);
  const [resendAt, setResendAt] = useState(0), [seconds, setSeconds] = useState(0);
  const sending = useRef(false);
  const number = '+91' + mobile;
  const mobileError = mobileTouched && !INDIAN_MOBILE.test(number);
  useEffect(() => {
    if (!resendAt) return;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
      setSeconds(remaining);
      if (!remaining) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [resendAt]);

  async function sendCode() {
    setMessage(await requestOtp(api, number));
    setRequested(true);
    setSeconds(30);
    setResendAt(Date.now() + 30_000);
  }

  async function resend() {
    if (sending.current || Date.now() < resendAt) return;
    sending.current = true;
    setBusy(true); setError('');
    try { await sendCode(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not resend the code. Try again.'); }
    finally { sending.current = false; setBusy(false); }
  }
  async function submit() {
    if (sending.current) return;
    setMobileTouched(true);
    if (!INDIAN_MOBILE.test(number)) return;
    if (requested && !code.trim()) { setError('Enter your verification code.'); return; }
    sending.current = true;
    setBusy(true); setError('');
    let created = false;
    try {
      if (requested) {
        await establishSession(await login(api, number, code));
        done();
      } else {
        if (creating) { await register(api, number, type); created = true; setCreating(false); }
        await sendCode();
      }
    } catch (failure) {
      setError(`${created ? 'Your account was created. ' : ''}${failure instanceof Error ? failure.message : 'Could not sign in. Try again.'}`);
    } finally { sending.current = false; setBusy(false); }
  }
  return <View style={s.screen}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
    <Text style={s.kicker}>YOUR SMARTTRADE ACCOUNT</Text>
    <Text accessibilityRole="header" style={s.title}>{creating ? 'Join SmartTrade' : 'Welcome back'}</Text>
    <Text style={s.body}>Browse freely. Sign in to discover dealers and manage your business.</Text>
    <View style={s.card}>
      {creating && <><Text style={s.label}>Choose your account type</Text><View style={s.row}>{(['PERSONAL', 'BUSINESS', 'COMPANY'] as const).map(value => <Button key={value} variant="navigation" selected={type === value} disabled={busy} onPress={() => setType(value)} title={value === 'PERSONAL' ? 'Personal' : value === 'BUSINESS' ? 'Dealer / Business' : 'Company'} />)}</View><Text style={s.body}>Choose carefully. You can use one account type per mobile number, and it cannot be changed later.</Text></>}
      <Text style={s.label}>Mobile number</Text>
      <View style={s.phone}><Text style={s.prefix}>+91</Text><TextInput accessibilityLabel="Indian mobile number, country code plus 91" style={[s.input, s.phoneInput]} value={displayIndianMobile(mobile)} onChangeText={value => setMobile(indianMobileDigits(value))} onBlur={() => setMobileTouched(true)} editable={!busy && !requested} keyboardType="phone-pad" autoComplete="tel-national" autoCorrect={false} placeholder="98765 43210" /></View>
      {mobileError && <Text accessibilityLiveRegion="polite" style={s.error}>{MOBILE_HELP}</Text>}
      {requested && <><Text style={s.label}>Verification code</Text><TextInput accessibilityLabel="Verification code" style={s.input} value={code} onChangeText={setCode} editable={!busy} autoCorrect={false} autoCapitalize="none" maxLength={256} onSubmitEditing={() => { if (!busy) void submit(); }} /></>}
      {message !== '' && <Text accessibilityLiveRegion="polite" style={s.notice}>{message}</Text>}
      {error !== '' && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {requested && <Button variant="tertiary" disabled={busy || seconds > 0} onPress={resend} title={seconds > 0 ? `Resend code in ${seconds}s` : 'Resend code'} />}
      <Button variant="tertiary" disabled={busy} onPress={() => { setRequested(false); setCreating(requested ? false : !creating); setCode(''); setMessage(''); setError(''); setResendAt(0); setSeconds(0); }} title={requested ? 'Change mobile number' : creating ? 'Already registered? Sign in' : 'New here? Create an account'} />
    </View>
  </ScrollView><StickyBottomBar><Button variant="primary" icon={requested?'check':'send'} loading={busy} disabled={busy} onPress={submit} title={requested ? 'Verify and continue' : creating ? 'Create account and send code' : 'Send verification code'} /></StickyBottomBar></View>;
}
const s = StyleSheet.create({
  screen: {flex: 1},
  phone: {flexDirection: 'row', gap: 8, alignItems: 'center'}, prefix: {backgroundColor: '#edf7f0', color: '#17392d', padding: 14, borderRadius: 10, fontWeight: '700'}, phoneInput: {flex: 1},
  content: { padding: 22, gap: 16, paddingBottom: 60 }, kicker: { color: '#087f5b', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 }, title: { fontSize: 32, color: '#17392d', fontWeight: '800' }, body: { color: '#52675c', fontSize: 15, lineHeight: 23 },
  card: { backgroundColor: '#fff', padding: 20, gap: 14, borderRadius: 18, borderColor: '#dce7e0', borderWidth: 1 }, label: { fontSize: 15, fontWeight: '700', color: '#294b3a' }, input: { borderWidth: 1, borderColor: '#9fb7aa', padding: 12, borderRadius: 10, fontSize: 16, minHeight: 50, color: '#17392d' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },      notice: { backgroundColor: '#edf7f0', padding: 12, color: '#294b3a', lineHeight: 22 }, error: { color: '#9c2820', lineHeight: 22 },
});
