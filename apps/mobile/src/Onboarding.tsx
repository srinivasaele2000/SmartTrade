import {StickyBottomBar} from './StickyBottomBar';
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {AccessibilityInfo, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {ApiClient, type Page} from './api';
import {Button} from './Button';
import {displayIndianMobile, indianMobileDigits, indianPinDigits, INDIAN_MOBILE, INDIAN_PIN, INDIAN_STATES, istDateTime, MOBILE_HELP, PIN_HELP} from './india';
import {useSession} from './session';
import {useResource} from './useResource';

const personalPath = '/auth/personal-profile';
const dealerPath = '/businesses/me';
const personalFields = {
  full_name: 'Full name', occupation: 'Occupation', pin_code: 'PIN code',
  locality: 'Area or locality', district: 'District', state: 'State or union territory',
};
const businessFields = {
  owner_name: 'Owner or authorized person', business_email: 'Business email',
  registered_address: 'Registered address', registered_pin_code: 'Registered PIN code',
  registered_locality: 'Registered area or locality', registered_district: 'Registered district',
  registered_state: 'Registered state or union territory',
};

function Field({label, value, set, disabled = false, postalPin = false, mobile = false}: {
  label: string; value: string; set: (value: string) => void; disabled?: boolean; postalPin?: boolean; mobile?: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const input = <TextInput accessibilityLabel={mobile ? label + ', country code plus 91' : label}
    value={mobile ? displayIndianMobile(indianMobileDigits(value)) : value}
    onChangeText={mobile ? text => set(text ? '+91' + indianMobileDigits(text) : '') : postalPin ? text => set(indianPinDigits(text)) : set}
    onBlur={() => setTouched(true)} editable={!disabled} maxLength={postalPin ? 6 : undefined}
    keyboardType={mobile ? 'phone-pad' : postalPin ? 'number-pad' : 'default'} placeholder={mobile ? '98765 43210' : undefined}
    autoCorrect={false} style={[styles.input, mobile && styles.phoneInput]} />;
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    {mobile ? <View style={styles.row}><Text style={styles.prefix}>+91</Text>{input}</View> : input}
    {mobile && touched && !INDIAN_MOBILE.test(value) && <Text style={styles.error}>{MOBILE_HELP}</Text>}
    {postalPin && <Text style={value && !INDIAN_PIN.test(value) ? styles.error : undefined}>{PIN_HELP}</Text>}
  </View>;
}

function ContactProgress({count, goal}: {count: number; goal: number}) {
  const percent = goal > 0 ? Math.min(100, count / goal * 100) : 0;
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(reduceMotion => {
      if (!active) return;
      if (reduceMotion) progress.setValue(percent);
      else Animated.timing(progress, {toValue: percent, duration: 300, useNativeDriver: false}).start();
    }).catch(() => {if (active) progress.setValue(percent);});
    return () => {active = false; progress.stopAnimation();};
  }, [percent, progress]);
  return <View accessibilityRole="progressbar" accessibilityLabel="Trade-worker contacts"
    accessibilityValue={{min: 0, max: goal, now: Math.min(count, goal), text: `${count} of ${goal} added`}} style={styles.progressTrack}>
    <Animated.View style={[styles.progressFill, {width: progress.interpolate({inputRange: [0, 100], outputRange: ['0%', '100%']})}]} />
  </View>;
}

function useSave() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  async function save(operation: () => Promise<unknown>, success: string) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setMessage(''); setError('');
    try { await operation(); setMessage(success); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save. Try again.'); }
    finally { running.current = false; setBusy(false); }
  }
  return {busy, message, error, save};
}

function Feedback({message, error}: {message: string; error: string}) {
  return <>{message !== '' && <Text accessibilityLiveRegion="polite">{message}</Text>}
    {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}</>;
}

export function IdentityFields({api, token, personal = false, editable = true}: {
  api: ApiClient; token: string; personal?: boolean; editable?: boolean;
}) {
  const path = personal ? personalPath : dealerPath;
  const fields: Record<string, string> = personal ? personalFields : businessFields;
  const [revision, setRevision] = useState(0);
  const load = useResource(useCallback(signal => api.get(path, signal, token) as Promise<Record<string, string>>, [api, token, path, revision]), { retainData: true });
  const record = load.state.data;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const dirty = useRef(false);
  const action = useSave();
  useEffect(() => {
    if (record && !dirty.current) {
      setDraft(Object.fromEntries(Object.keys(personal ? personalFields : businessFields).map(key => [key, record[key] ?? ''])));
    }
  }, [record, personal]);
  if (!record) return <View style={styles.card}>
    <Text accessibilityLiveRegion="polite">{load.state.status === 'error' ? load.state.message : 'Loading profile…'}</Text>
    {load.state.status === 'error' && <Button variant="secondary" title="Retry profile" onPress={() => setRevision(n => n + 1)} />}
  </View>;
  return <View style={styles.card}>
    <Text style={styles.heading}>{personal ? 'Personal profile' : 'Business identity and registered address'}</Text>
    {personal ? <Text>Account mobile: {record.mobile_e164}</Text> : <Text>Registered address is separate from operating branches. Identifiers are not government verified.</Text>}
    {Object.entries(fields).map(([key, label]) => <Field key={key} label={label} value={draft[key] ?? ''} postalPin={key.endsWith('pin_code')}
      disabled={!editable || action.busy} set={value => {
        dirty.current = true;
        setDraft(previous => ({...previous, [key]: value}));
      }} />)}
    {load.state.status === 'error' && <>
      <Text accessibilityRole="alert">{load.state.message}</Text>
      <Button variant="secondary" title="Retry profile" onPress={load.retry} />
    </>}
    <Feedback {...action} />
    <Button variant="primary" title={personal ? 'Save personal profile' : 'Save registered business details'}
      disabled={!editable || action.busy || load.state.status === 'error'} loading={action.busy} onPress={() => void action.save(async () => {
        const pin = (draft[personal ? 'pin_code' : 'registered_pin_code'] ?? '').trim();
        if (pin && !INDIAN_PIN.test(pin)) throw new Error('Use a six-digit Indian PIN code.');
        const state = (draft[personal ? 'state' : 'registered_state'] ?? '').trim();
        if (state && !INDIAN_STATES.some(name => name.toLowerCase() === state.toLowerCase())) throw new Error('Enter an Indian state or union territory.');
        const updated = await api.get(path, undefined, token, {method: 'PATCH', body: JSON.stringify(draft)}) as Record<string, string>;
        setDraft(Object.fromEntries(Object.keys(fields).map(key => [key, updated[key] ?? ''])));
        dirty.current = false;
        setRevision(n => n + 1);
      }, 'Profile saved.')} />
  </View>;
}

export function PersonalProfile({api}: {api: ApiClient}) {
  const {account, token} = useSession();
  if (account?.account_type !== 'PERSONAL' || !token) return <Text>Sign in with a Personal account.</Text>;
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <IdentityFields api={api} token={token} personal />
  </ScrollView>;
}

type Brand = {id: number; name: string; company_name: string};
type Declarations = {category_options: string[]; categories: string[]; brands: Brand[]};
type Suggestion = {id: number; name: string; context: string; status: string; canonical_brand: number | null; created_at: string};
type ContactDraft = {name: string; mobile_e164: string; trade: string; location: string};
type Contact = ContactDraft & {id: number; consent_confirmed_at: string};
const blankContact: ContactDraft = {name: '', mobile_e164: '', trade: '', location: ''};
type Props = {api: ApiClient; token: string; editable: boolean};

function Pager({value, number, change}: {value: Pick<Page<unknown>, 'next' | 'previous'>; number: number; change: (n: number) => void}) {
  return <View style={styles.row}>
    <Button variant="tertiary" title="Previous" disabled={!value.previous} onPress={() => change(number - 1)} />
    <Text>Page {number}</Text>
    <Button variant="tertiary" title="Next" disabled={!value.next} onPress={() => change(number + 1)} />
  </View>;
}

export function DealerDeclarations({api, token, editable}: Props) {
  const [revision, setRevision] = useState(0);
  const [categories, setCategories] = useState<string[]>([]), [brands, setBrands] = useState<Brand[]>([]);
  const [brandPage, setBrandPage] = useState(1), [suggestionPage, setSuggestionPage] = useState(1);
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [name, setName] = useState(''), [context, setContext] = useState('');
  const action = useSave();
  const current = useResource(useCallback(signal => api.get(dealerPath + '/declarations', signal, token) as Promise<Declarations>, [api, token, revision]), { retainData: true });
  const saved = current.state.data;
  const selectionsDirty = useRef(false);
  useEffect(() => {
    if (saved && !selectionsDirty.current) {
      setCategories(saved.categories); setBrands(saved.brands);
    }
  }, [saved]);
  const categoryQuery = categories.map(label => 'category=' + encodeURIComponent(label)).join('&');
  const choices = useResource(useCallback(signal => api.get(
    dealerPath + '/declaration-brands?page=' + brandPage + '&search=' + encodeURIComponent(query) + '&' + categoryQuery,
    signal, token,
  ) as Promise<Page<Brand>>, [api, token, brandPage, query, categoryQuery, revision]));
  const suggestions = useResource(useCallback(signal => api.get(dealerPath + '/brand-suggestions?page=' + suggestionPage, signal, token) as Promise<Page<Suggestion>>, [api, token, suggestionPage, revision]));
  const disabled = !editable || action.busy;
  return <View style={styles.card}>
    <Text style={styles.heading}>Dealer declarations</Text>
    <Text>Declare the categories and brands you sell. Company authorization is managed separately.</Text>
    <Button variant="tertiary" title="Refresh declarations" disabled={action.busy} onPress={() => setRevision(n => n + 1)} />
    {current.state.status === 'error' && <Text accessibilityRole="alert">{current.state.message}</Text>}
    {!saved ? current.state.status !== 'error' && <Text>Loading declarations…</Text> : <>
      <View style={styles.row}>{saved.category_options.map(label => <Button key={label} variant="navigation" title={label}
        disabled={disabled} selected={categories.includes(label)} onPress={() => {
          selectionsDirty.current = true;
          setCategories(previous => previous.includes(label) ? previous.filter(value => value !== label) : [...previous, label]);
          setBrandPage(1);
        }} />)}</View>
      {brands.map(brand => <Button key={brand.id} variant="navigation" selected title={brand.name + ' · ' + brand.company_name}
        disabled={disabled} onPress={() => {
          selectionsDirty.current = true;
          setBrands(previous => previous.filter(value => value.id !== brand.id));
        }} />)}
      <Text>Tap a selected brand to remove it before saving.</Text>
      <Field label="Search catalogue brands" value={search} set={setSearch} />
      <Button variant="secondary" title="Search brands" onPress={() => {setQuery(search.trim()); setBrandPage(1);}} />
      {choices.state.status === 'ready' ? <>
        {choices.state.data.results.length === 0 && <Text>No matching catalogue brands.</Text>}
        {choices.state.data.results.filter(brand => !brands.some(value => value.id === brand.id)).map(brand =>
          <Button key={brand.id} variant="tertiary" title={brand.name + ' · ' + brand.company_name}
            disabled={disabled} onPress={() => {
              selectionsDirty.current = true;
              setBrands(previous => [...previous, brand]);
            }} />)}
        <Pager value={choices.state.data} number={brandPage} change={setBrandPage} />
      </> : <Text>{choices.state.status === 'error' ? choices.state.message : 'Loading brands…'}</Text>}
      <Button variant="primary" title="Save declarations" disabled={disabled || current.state.status === 'error'} loading={action.busy}
        onPress={() => void action.save(async () => {
          const updated = await api.get(dealerPath + '/declarations', undefined, token, {
            method: 'PUT', body: JSON.stringify({categories, brands: brands.map(brand => brand.id)}),
          }) as Declarations;
          setCategories(updated.categories); setBrands(updated.brands);
          selectionsDirty.current = false;
          setRevision(n => n + 1);
        }, 'Declarations saved.')} />
    </>}
    <Text style={styles.heading}>Suggest another brand</Text>
    <Field label="Suggested brand name" value={name} set={setName} disabled={disabled} />
    <Field label="Context (optional)" value={context} set={setContext} disabled={disabled} />
    <Button variant="secondary" title="Submit brand suggestion" disabled={disabled || !name.trim()}
      onPress={() => void action.save(async () => {
        await api.post(dealerPath + '/brand-suggestions', {name, context}, token);
        setName(''); setContext(''); setSuggestionPage(1); setRevision(n => n + 1);
      }, 'Suggestion sent for review.')} />
    {suggestions.state.status === 'ready' ? <>
      {suggestions.state.data.results.length === 0 && <Text>No brand suggestions.</Text>}
      {suggestions.state.data.results.map(item => <Text key={item.id}>{item.name} · {item.status} · {istDateTime(item.created_at)}</Text>)}
      <Pager value={suggestions.state.data} number={suggestionPage} change={setSuggestionPage} />
    </> : <Text>{suggestions.state.status === 'error' ? suggestions.state.message : 'Loading suggestions…'}</Text>}
    <Feedback {...action} />
  </View>;
}

export function DealerContacts({api, token, editable, header}: Props & {header?: ReactNode}) {
  const [number, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<ContactDraft>(blankContact);
  const [editing, setEditing] = useState<number | null>(null);
  const [consent, setConsent] = useState(false), [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const action = useSave();
  const resource = useResource(useCallback(signal => api.get(dealerPath + '/trade-contacts?page=' + number, signal, token) as Promise<Page<Contact> & {minimum_required: number}>, [api, token, number, revision]));
  const disabled = !editable || action.busy;
  function reset() {setEditing(null); setDraft(blankContact); setConsent(false);}
  return <View style={styles.screen}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.contactContent}>
  {header}<View style={styles.card}>
    <Text style={styles.heading}>Private trade-worker contacts</Text>
    <Text>Only you and authorized staff can see these contacts. Confirm permission from each worker. SmartTrade does not independently verify consent or contact the worker.</Text>
    <Button variant="tertiary" title="Refresh contacts" disabled={action.busy} onPress={() => setRevision(n => n + 1)} />
    {resource.state.status === 'ready' ? <>
      {resource.state.data.minimum_required > 0 && resource.state.data.count >= resource.state.data.minimum_required
        ? <View style={[styles.milestone, styles.celebration]} accessibilityLiveRegion="polite">
          <View style={styles.row}>
            <Text accessible={false} style={styles.celebrationIcon}>✓</Text>
            <Text accessibilityRole="header" style={[styles.heading, styles.celebrationTitle]}>Network Milestone Completed</Text>
          </View>
          <Text style={styles.label}>{resource.state.data.count} of {resource.state.data.minimum_required} contacts added</Text>
          <Text>You’ve met the trade contact requirement. Keep your business details up to date for verification. Approval still requires staff review.</Text>
        </View>
        : <View style={styles.milestone}>
        {resource.state.data.count === 0 && <Text style={styles.heading}>Build your electrician &amp; contractor network</Text>}
        <Text>Add trade workers you regularly work with. Reach the minimum to submit your dealer profile for review.</Text>
        <Text style={styles.label}>{resource.state.data.count} of {resource.state.data.minimum_required} added</Text>
        <ContactProgress count={resource.state.data.count} goal={resource.state.data.minimum_required} />
      </View>}
      {resource.state.data.results.map(item => <View key={item.id} style={styles.card}>
        <Text>{item.name} · {item.trade} · {item.mobile_e164}</Text>
        <Text>{item.location || 'Location not provided'}</Text>
        <Text>Permission confirmed {istDateTime(item.consent_confirmed_at)}</Text>
        <View style={styles.row}>
          <Button variant="secondary" title="Edit contact" disabled={disabled} onPress={() => {
            const {name, mobile_e164, trade, location} = item;
            setEditing(item.id); setDraft({name, mobile_e164, trade, location}); setConsent(false);
          }} />
          <Button variant="destructive" title={confirmDelete === item.id ? 'Confirm removal' : 'Remove contact'}
            disabled={disabled} onPress={() => {
              if (confirmDelete !== item.id) {setConfirmDelete(item.id); return;}
              void action.save(async () => {
                await api.get(dealerPath + '/trade-contacts/' + item.id, undefined, token, {method: 'DELETE'});
                if (editing === item.id) reset();
                setConfirmDelete(null); setPage(1); setRevision(n => n + 1);
              }, 'Contact removed.');
            }} />
          {confirmDelete === item.id && <Button variant="secondary" title="Cancel removal" onPress={() => setConfirmDelete(null)} />}
        </View>
      </View>)}
      <Pager value={resource.state.data} number={number} change={setPage} />
    </> : <Text>{resource.state.status === 'error' ? resource.state.message : 'Loading contacts…'}</Text>}
    <Text style={styles.heading}>{editing ? 'Edit contact' : 'Add contact'}</Text>
    {(Object.entries({name: 'Worker name', mobile_e164: 'Worker mobile number', trade: 'Trade or occupation', location: 'Location (optional)'}) as [keyof ContactDraft, string][])
      .map(([key, label]) => <Field key={key} label={label} value={draft[key]} disabled={disabled} mobile={key === 'mobile_e164'}
        set={value => {setDraft(previous => ({...previous, [key]: value})); setConsent(false);}} />)}
    <Pressable accessibilityRole="checkbox" accessibilityState={{checked: consent, disabled}} disabled={disabled}
      style={styles.consent} onPress={() => setConsent(value => !value)}>
      <Text accessible={false} style={styles.label}>{consent ? '☑' : '☐'}</Text>
      <Text style={styles.consentText}>I have permission from this person to share their business contact details.</Text>
    </Pressable>
    {editing !== null && <Button variant="secondary" title="Cancel edit" disabled={action.busy} onPress={reset} />}
    <Feedback {...action} />
  </View></ScrollView><StickyBottomBar>
    <Button variant="primary" title="Save contact" disabled={disabled || !consent} loading={action.busy}
      onPress={() => void action.save(async () => {
        if (!INDIAN_MOBILE.test(draft.mobile_e164.trim())) throw new Error(MOBILE_HELP);
        const body = {...draft, mobile_e164: draft.mobile_e164.trim(), consent};
        if (editing) await api.get(dealerPath + '/trade-contacts/' + editing, undefined, token, {method: 'PATCH', body: JSON.stringify(body)});
        else await api.post(dealerPath + '/trade-contacts', body, token);
        reset(); setRevision(n => n + 1);
      }, 'Contact saved with permission confirmation.')} />
  </StickyBottomBar></View>;
}

const styles = StyleSheet.create({
  screen: {flex: 1}, contactContent: {padding: 20, gap: 16},
  phoneInput: {flex: 1}, prefix: {padding: 12, borderRadius: 8, backgroundColor: '#edf7f0', color: '#17392d', fontWeight: '700'},
  milestone: {padding: 14, gap: 8, borderRadius: 10, backgroundColor: '#edf7f0'},
  celebration: {borderColor: '#77aa8a', borderWidth: 1, backgroundColor: '#e0f3e7'},
  celebrationIcon: {color: '#fff', backgroundColor: '#14553e', borderRadius: 18, width: 36, lineHeight: 36, textAlign: 'center', fontSize: 21, fontWeight: '800'},
  celebrationTitle: {flex: 1},
  progressTrack: {height: 8, borderRadius: 4, backgroundColor: '#d0e2d7', overflow: 'hidden'},
  progressFill: {height: '100%', backgroundColor: '#24734f'},
  consent: {minHeight: 48, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 8},
  consentText: {flex: 1, color: '#17392d'},
  content: {padding: 16},
  card: {backgroundColor: '#fff', borderColor: '#dce7e0', borderWidth: 1, borderRadius: 14, padding: 16, gap: 12},
  heading: {fontSize: 19, fontWeight: '700', color: '#17392d'},
  field: {gap: 5},
  label: {fontWeight: '600', color: '#17392d'},
  input: {minHeight: 48, borderWidth: 1, borderColor: '#9fb7aa', borderRadius: 8, padding: 10, color: '#17392d'},
  row: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8},
  error: {color: '#9c2820'},
});
