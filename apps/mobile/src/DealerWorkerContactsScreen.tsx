import {useCallback, useState} from 'react';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {Button} from './Button';
import {StickyBottomBar} from './StickyBottomBar';
import {ApiError, type ApiClient} from './api';
import {existingWorkers, submitWorkers, workerCount, workerProgress, type Worker} from './dealer-onboarding';
import {displayIndianMobile, indianMobileDigits} from './india';
import {useResource} from './useResource';

export const onboardingStyles = StyleSheet.create({
  screen: {flex: 1},
  content: {padding: 20, gap: 14},
  title: {fontSize: 27, color: '#17392d', fontWeight: '800'},
  kicker: {fontSize: 12, color: '#14553e', fontWeight: '800', letterSpacing: 1},
  card: {backgroundColor: '#fff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#dce7e0', gap: 10},
  label: {color: '#294b3a', fontWeight: '700'},
  body: {color: '#40594d', lineHeight: 22},
  error: {color: '#9c2820'},
  input: {borderWidth: 1, borderColor: '#9fb7aa', borderRadius: 10, minHeight: 48, paddingHorizontal: 12, color: '#17392d'},
  row: {flexDirection: 'row', alignItems: 'center', gap: 10},
  checkbox: {minHeight: 52, paddingVertical: 8},
  checkboxText: {flex: 1, color: '#294b3a', lineHeight: 22},
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
    Your network already has more than ten workers. Review the existing list in Dealer dashboard before submitting the onboarding batch.
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
  const progress = workerProgress(workers);
  function update(index: number, change: Partial<Worker>) {
    setWorkers(current => current.map((worker, position) => position === index ? {...worker, ...change} : worker));
    setError('');
  }
  async function submit() {
    setBusy(true);
    setError('');
    setConflict(false);
    try {
      await submitWorkers(api, token, workers, consent);
      done();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not submit contacts. Try again.');
      setConflict(failure instanceof ApiError && failure.status === 409);
    } finally {setBusy(false);}
  }

  return <View style={s.screen}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      <Text style={s.kicker}>DEALER ONBOARDING · STEP 2 OF 3</Text>
      <Text accessibilityRole="header" style={s.title}>Add your worker contacts</Text>
      <Text style={s.body}>Enter a name, Indian mobile number and trade for each worker. Your contacts stay private.</Text>
      <Text accessibilityLiveRegion="polite" style={s.label}>{progress} of 10 workers added</Text>
      {workers.map((worker, index) => {
        const editable = !busy && index >= lockedCount;
        const label = 'Worker ' + (index + 1);
        return <View key={index} style={s.card}>
          <Text style={s.label}>{label}{index < lockedCount ? ' · Existing contact' : ''}</Text>
          <TextInput accessibilityLabel={label + ' name'} placeholder="Worker name" style={s.input}
            value={worker.name} editable={editable} maxLength={160} onChangeText={name => update(index, {name})} />
          <View style={s.row}><Text style={s.label}>+91</Text>
            <TextInput accessibilityLabel={label + ' mobile number'} placeholder="98765 43210" style={[s.input, {flex: 1}]}
              value={displayIndianMobile(worker.mobile)} keyboardType="phone-pad" editable={editable}
              onChangeText={mobile => update(index, {mobile: indianMobileDigits(mobile)})} />
          </View>
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
      loading={busy} disabled={!consent || progress !== workerCount} onPress={submit} /></StickyBottomBar>
  </View>;
}
