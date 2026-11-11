import {StickyBottomBar} from './StickyBottomBar';
import { useEffect, useRef, useState } from 'react';
import {Button} from './Button';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiClient } from './api';
import { login, registerRole, requestOtp, type AccountType, type Account, type Tokens } from './auth';
import { useSession } from './session';
import {displayIndianMobile, indianMobileDigits, INDIAN_MOBILE, MOBILE_HELP} from './india';
import {DealerRegistrationFields, type DealerRegistrationDraft} from './DealerRegistrationScreen';
import {registerDealer} from './dealer-onboarding';
import RoleSelectScreen from './RoleSelectScreen';
import {WorkforceFields} from './WorkforceProfileScreen';
import {isWorkforce, profileInput, saveWorkforceProfile, workforce, type ProfileDraft} from './workforce-profile';

export default function AuthScreen({ api, done }: { api: ApiClient; done: (profile: Account, registered: boolean) => void }) {
  const { establishSession } = useSession();
  const [mobile, setMobile] = useState(''), [code, setCode] = useState('');
  const [creating, setCreating] = useState(false), [type, setType] = useState<AccountType>();
  const [dealer, setDealer] = useState<DealerRegistrationDraft>({firm: '', gstin: '', businessType: ''});
  const [registered, setRegistered] = useState<AccountType>();
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({});
  const dealerSignup = creating && type === 'BUSINESS';
  const [requested, setRequested] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [mobileTouched, setMobileTouched] = useState(false);
  const [resendAt, setResendAt] = useState(0), [seconds, setSeconds] = useState(0);
  const sending = useRef(false);
  const pendingTokens = useRef<Tokens | null>(null);
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
        const issued = pendingTokens.current ?? await login(api, number, code);
        if (isWorkforce(registered)) {
          pendingTokens.current = issued;
          await saveWorkforceProfile(api, registered, issued.access, profileDraft);
        }
        const profile = await establishSession(issued, registered ? {role: registered, mobile: number} : undefined);
        pendingTokens.current = null;
        done(profile, Boolean(registered));
      } else {
        if (creating && type) {
          if (isWorkforce(type)) profileInput(type, profileDraft);
          if (dealerSignup) await registerDealer(api, dealer.firm, dealer.gstin, number, dealer.businessType);
          else await registerRole(api, number, type);
          setRegistered(type);
          created = true;
          setCreating(false);
        }
        await sendCode();
      }
    } catch (failure) {
      if (pendingTokens.current && failure instanceof Error && 'status' in failure && [401, 403].includes(Number(failure.status))) {
        pendingTokens.current = null;
      }
      setError(`${created ? 'Your account was created. ' : pendingTokens.current ? 'Your profile could not be saved yet. ' : ''}${failure instanceof Error ? failure.message : 'Could not sign in. Try again.'}`);
    } finally { sending.current = false; setBusy(false); }
  }
  if (creating && !type) return <RoleSelectScreen choose={role => {setType(role); setProfileDraft({}); setError('');}}
    cancel={() => {setCreating(false); setError('');}} />;
  return <View style={s.screen}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
    <Text style={s.kicker}>{dealerSignup || registered === 'BUSINESS' ? 'DEALER ONBOARDING · STEP 1 OF 3' : 'YOUR SMARTTRADE ACCOUNT'}</Text>
    <Text accessibilityRole="header" style={s.title}>{creating && isWorkforce(type) ? workforce[type].title + ' registration' : creating ? 'Join SmartTrade' : 'Welcome back'}</Text>
    <Text style={s.body}>Browse freely. Sign in to discover dealers and manage your business.</Text>
    <View style={s.card}>
      {creating && <Button variant="tertiary" title="Change account type" disabled={busy} onPress={() => {setType(undefined); setError('');}} />}
      {dealerSignup && <DealerRegistrationFields draft={dealer} change={setDealer} disabled={busy} />}
      {creating && isWorkforce(type) && <WorkforceFields role={type} draft={profileDraft} change={setProfileDraft} disabled={busy} />}
      <Text style={s.label}>Mobile number</Text>
      <View style={s.phone}><Text style={s.prefix}>+91</Text><TextInput accessibilityLabel="Indian mobile number, country code plus 91" style={[s.input, s.phoneInput]} value={displayIndianMobile(mobile)} onChangeText={value => {setMobile(indianMobileDigits(value)); setRegistered(undefined);}} onBlur={() => setMobileTouched(true)} editable={!busy && !requested} keyboardType="phone-pad" autoComplete="tel-national" autoCorrect={false} placeholder="98765 43210" /></View>
      {mobileError && <Text accessibilityLiveRegion="polite" style={s.error}>{MOBILE_HELP}</Text>}
      {requested && <><Text style={s.label}>Verification code</Text><TextInput accessibilityLabel="Verification code" style={s.input} value={code} onChangeText={setCode} editable={!busy} autoCorrect={false} autoCapitalize="none" maxLength={256} onSubmitEditing={() => { if (!busy) void submit(); }} /></>}
      {message !== '' && <Text accessibilityLiveRegion="polite" style={s.notice}>{message}</Text>}
      {error !== '' && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {requested && <Button variant="tertiary" disabled={busy || seconds > 0} onPress={resend} title={seconds > 0 ? `Resend code in ${seconds}s` : 'Resend code'} />}
      <Button variant="tertiary" disabled={busy} onPress={() => { pendingTokens.current = null; setRequested(false); setRegistered(undefined); setType(undefined); setCreating(requested ? false : !creating); setCode(''); setMessage(''); setError(''); setResendAt(0); setSeconds(0); }} title={requested ? 'Change mobile number' : creating ? 'Already registered? Sign in' : 'New here? Create an account'} />
    </View>
  </ScrollView><StickyBottomBar clearance={22}><Button variant="primary" icon={requested?'check':'send'} loading={busy} disabled={busy} onPress={submit} title={requested ? 'Verify and continue' : creating ? 'Create account and send code' : 'Send verification code'} /></StickyBottomBar></View>;
}
const s = StyleSheet.create({
  screen: {flex: 1},
  phone: {flexDirection: 'row', gap: 8, alignItems: 'center'}, prefix: {backgroundColor: '#edf7f0', color: '#17392d', padding: 14, borderRadius: 10, fontWeight: '700'}, phoneInput: {flex: 1},
  content: { padding: 22, gap: 16, paddingBottom: 60 }, kicker: { color: '#087f5b', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 }, title: { fontSize: 32, color: '#17392d', fontWeight: '800' }, body: { color: '#52675c', fontSize: 15, lineHeight: 23 },
  card: { backgroundColor: '#fff', padding: 20, gap: 14, borderRadius: 18, borderColor: '#dce7e0', borderWidth: 1 }, label: { fontSize: 15, fontWeight: '700', color: '#294b3a' }, input: { borderWidth: 1, borderColor: '#9fb7aa', padding: 12, borderRadius: 10, fontSize: 16, minHeight: 50, color: '#17392d' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },      notice: { backgroundColor: '#edf7f0', padding: 12, color: '#294b3a', lineHeight: 22 }, error: { color: '#9c2820', lineHeight: 22 },
});
