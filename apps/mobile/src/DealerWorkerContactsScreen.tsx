import {trade} from './trade-theme';
import {useCallback, useState} from 'react';
import {ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {Button} from './Button';
import {StickyBottomBar} from './StickyBottomBar';
import {ApiError, type ApiClient} from './api';
import {duplicateWorkerRows, existingWorkers, normalizeWorkerMobile, submitWorkers, workerCount, workerProgress, workerSubmissionErrors, type Worker} from './dealer-onboarding';
import {displayIndianMobile} from './india';
import {useResource} from './useResource';

export const onboardingStyles = StyleSheet.create({
  screen: {flex: 1},
  content: {padding: trade.gutter, gap: 10},
  title: {fontSize: 14, lineHeight: 26, color: trade.ink, fontWeight: '800'},
  kicker: {fontSize: 11, color: trade.accent, fontWeight: '800', letterSpacing: 1},
  card: {backgroundColor: trade.surface, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: trade.border, gap: 8},
  label: {color: trade.heading, fontSize: 14, lineHeight: 19, fontWeight: '700'},
  body: {color: trade.secondary, fontSize: 13, lineHeight: 19},
  error: {color: '#9c2820'},
  input: {borderWidth: 1, borderColor: trade.border, borderRadius: 9, minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: trade.ink},
  row: {flexDirection: 'row', alignItems: 'center', gap: 8},
  checkbox: {minHeight: 52, paddingVertical: 8},
  checkboxText: {flex: 1, color: trade.heading, lineHeight: 19},
});
const s = onboardingStyles;

export default function DealerWorkerContactsScreen({api, token, done, reloadStatus}: {
  api: ApiClient; token: string | null; done: () => void; reloadStatus: () => void;
}) {
  const load = useCallback(async (signal: AbortSignal) => {
    if (!token) throw new ApiError('Sign in to submit worker contacts.');
    return existingWorkers(api, token, signal);
  }, [api, token]);
  // Keep the mounted draft while the access token is refreshed.
  const {state, retry} = useResource(load, {retainData: true});
  if (!token) return <Text style={s.content}>Sign in to continue dealer onboarding.</Text>;
  if (!state.data) return <View style={s.content}>{state.status === 'error'
    ? <><Text accessibilityRole="alert" style={s.error}>{state.message}</Text><Button variant="secondary" title="Retry" onPress={retry} /></>
    : <ActivityIndicator accessibilityLabel="Loading your worker contacts" />}</View>;
  if (state.data.count > workerCount) return <View style={s.content}><Text accessibilityRole="alert" style={s.error}>
    Your network already has more than ten workers. Contact SmartTrade support to complete onboarding.
  </Text></View>;
  return <WorkerForm api={api} token={token} existing={state.data.workers} done={done} reloadStatus={reloadStatus} />;
}

function WorkerForm({api, token, existing, done, reloadStatus}: {
  api: ApiClient; token: string; existing: Worker[]; done: () => void; reloadStatus: () => void;
}) {
  const [lockedCount] = useState(existing.length);
  const [workers, setWorkers] = useState(() => Array.from({length: workerCount}, (_, index) =>
    existing[index] ?? {name: '', mobile: '', trade: ''}));
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [pickerError, setPickerError] = useState<{index: number; message: string} | null>(null);
  const progress = workerProgress(workers);
  const duplicates = duplicateWorkerRows(workers);
  function update(index: number, change: Partial<Worker>) {
    setWorkers(current => current.map((worker, position) => position === index ? {...worker, ...change} : worker));
    if (change.mobile !== undefined && normalizeWorkerMobile(change.mobile) !== normalizeWorkerMobile(workers[index].mobile)) {
      setRowErrors(current => ({...current, [index]: ''}));
    }
    if (pickerError?.index === index) setPickerError(null);
    setError('');
  }
  async function pick(index: number) {
    setPicking(index);
    setPickerError(null);
    try {
      const contacts = await import('expo-contacts/legacy');
      if (Platform.OS === 'android' && !(await contacts.requestPermissionsAsync()).granted) {
        setPickerError({index, message: 'Contacts access is off. Enter the details manually or allow access in Settings.'});
        return;
      }
      const contact = await contacts.presentContactPickerAsync();
      if (!contact) return;
      const mobile = contact.phoneNumbers?.map(phone => normalizeWorkerMobile(phone.number ?? '')).find(Boolean);
      if (!mobile) {
        setPickerError({index, message: 'This contact has no valid Indian mobile number. Pick another contact or enter it manually.'});
        return;
      }
      const name = contact.name?.trim().slice(0, 160);
      update(index, {...(name ? {name} : {}), mobile});
    } catch {
      setPickerError({index, message: 'Could not open your contacts. You can enter the details manually.'});
    } finally {
      setPicking(null);
    }
  }
  async function submit() {
    setBusy(true);
    setError('');
    setConflict(false);
    try {
      await submitWorkers(api, token, workers, consent);
      done();
    } catch (failure) {
      setRowErrors(workerSubmissionErrors(failure, workers));
      setError(failure instanceof Error ? failure.message : 'Could not submit contacts. Try again.');
      setConflict(failure instanceof ApiError && failure.status === 409);
    } finally {setBusy(false);}
  }

  return <View style={s.screen}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      <Text style={s.kicker}>DEALER ONBOARDING · STEP 2 OF 3</Text>
      <Text accessibilityRole="header" style={s.title}>Add your worker contacts</Text>
      <Text style={s.body}>Enter a name, Indian mobile number and trade for each worker. Your contacts stay private.</Text>
      {Platform.OS === 'web' && <Text style={s.body}>Enter each contact manually in your browser.</Text>}
      <Text accessibilityLiveRegion="polite" style={s.label}>{progress} of 10 workers added</Text>
      {workers.map((worker, index) => {
        const editable = !busy && picking === null && index >= lockedCount;
        const label = 'Worker ' + (index + 1);
        return <View key={index} style={s.card}>
          <Text style={s.label}>{label}{index < lockedCount ? ' · Existing contact' : ''}</Text>
          {index >= lockedCount && (Platform.OS === 'android' || Platform.OS === 'ios') &&
            <Button variant="secondary" title="Pick from Contacts" disabled={!editable}
              loading={picking === index} onPress={() => pick(index)} />}
          <TextInput accessibilityLabel={label + ' name'} placeholder="Worker name" style={s.input}
            value={worker.name} editable={editable} maxLength={160} onChangeText={name => update(index, {name})} />
          <View style={s.row}><Text style={s.label}>+91</Text>
            <TextInput accessibilityLabel={label + ' mobile number'} placeholder="98765 43210" style={[s.input, {flex: 1}]}
              value={/^[0-9]{0,10}$/.test(worker.mobile) ? displayIndianMobile(worker.mobile) : worker.mobile}
              keyboardType="phone-pad" editable={editable} maxLength={40}
              onChangeText={mobile => update(index, {mobile: normalizeWorkerMobile(mobile) || mobile.trim()})} />
          </View>
          {(duplicates[index] || rowErrors[index] || (pickerError?.index === index && pickerError.message) ||
            (worker.mobile.replace(/\D/g, '').length >= 10 && !normalizeWorkerMobile(worker.mobile) &&
              'Enter a valid 10-digit Indian mobile number.')) &&
            <Text accessibilityRole="alert" style={s.error}>{duplicates[index] || rowErrors[index] ||
              (pickerError?.index === index ? pickerError.message : 'Enter a valid 10-digit Indian mobile number.')}</Text>}
          <TextInput accessibilityLabel={label + ' trade'} placeholder="Trade, e.g. Electrician" style={s.input}
            value={worker.trade} editable={editable} maxLength={120} onChangeText={trade => update(index, {trade})} />
        </View>;
      })}
      <Pressable accessibilityRole="checkbox" accessibilityState={{checked: consent, disabled: busy}}
        disabled={busy} onPress={() => setConsent(value => !value)} style={[s.row, s.checkbox]}>
        <Text style={s.label}>{consent ? '☑' : '☐'}</Text>
        <Text style={s.checkboxText}>I confirm these trade workers have consented to being registered under my dealer network.</Text>
      </Pressable>
      {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {conflict && <Button variant="secondary" title="Refresh onboarding status" onPress={reloadStatus} />}
    </ScrollView>
    <StickyBottomBar clearance={22}><Button variant="primary" title="Submit 10 Contacts & View Catalogues"
      loading={busy} disabled={!consent || progress !== workerCount || picking !== null || Object.values(rowErrors).some(Boolean)} onPress={submit} /></StickyBottomBar>
  </View>;
}
