import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { ApiClient, ApiError } from './api';
import { blankProfile, emailStatus, submissionGuidance, confirmReply, fields, loadCompany, saveProfile, statusLabel, uploadDocument, type ProfileInput, type CompanyContext } from './company';
import { useSession } from './session';
import { useResource } from './useResource';
import CompanyCatalogue from './CompanyCatalogue';
import CompanyAuthorizations from './CompanyAuthorizations';

type Tab = 'Dashboard' | 'Profile' | 'Documents' | 'Email' | 'Application' | 'Catalogue' | 'Dealers';
function Action({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[s.button, disabled && s.disabled]}><Text style={s.buttonText}>{title}</Text></Pressable>;
}
export default function CompanyScreen({ api }: { api: ApiClient }) {
  const session = useSession();
  if (session.account?.account_type !== 'COMPANY' || !session.token) return <View style={s.card}><Text accessibilityRole="alert">An active COMPANY account is required. Staff and personal accounts cannot manage company profiles.</Text></View>;
  return <Workspace api={api} token={session.token} expired={session.clearSession} />;
}
function Workspace({ api, token, expired }: { api: ApiClient; token: string; expired: () => void }) {
  const [tab, setTab] = useState<Tab>('Dashboard');
  const result = useResource(useCallback(async signal => {
    try { return await loadCompany(api, token, signal); }
    catch (error) { if (error instanceof ApiError && error.status === 401) expired(); throw error; }
  }, [api, token, expired]));
  const lastContext = useRef<CompanyContext | null>(null);
  if (result.state.status === 'ready') lastContext.current = result.state.data;
  // A token refresh must not unmount the catalogue and lose unsaved forms.
  // Keep previous context only while loading; errors and sign-out remain closed.
  const context = result.state.status === 'ready' ? result.state.data : result.state.status === 'loading' ? lastContext.current : null;
  const company = context?.company, verification = context?.verification;
  const [form, setForm] = useState<ProfileInput>(blankProfile);
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [documentType, setDocumentType] = useState(''), [percent, setPercent] = useState<number | null>(null);
  const [emailCode, setEmailCode] = useState(''), [reviewReason, setReviewReason] = useState('');
  useEffect(() => {
    setForm(company ? Object.fromEntries(fields.map(([key]) => [key, company[key]])) as ProfileInput : blankProfile());
  }, [company]);
  useEffect(() => { if (verification) setDocumentType(current => verification.document_policy.required_types.includes(current) ? current : verification.document_policy.required_types[0] ?? ''); }, [verification]);

  async function perform(name: string, operation: () => Promise<string>) {
    setBusy(name); setError(''); setMessage('');
    try { setMessage(await operation()); result.retry(); }
    catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired();
      setError(failure instanceof Error ? failure.message : 'Request failed. Please retry.');
    } finally { setBusy(''); }
  }
  async function pickAndUpload() {
    if (!verification?.can_upload) return;
    setError('');
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: verification.document_policy.allowed_mime_types, multiple: false, copyToCacheDirectory: true });
      if (picked.canceled) return;
      setPercent(null);
      await perform('upload', async () => {
        const doc = await uploadDocument(api, token, verification.document_policy, documentType, picked.assets[0], setPercent);
        return `${doc.document_type} uploaded successfully. It has not yet been approved.`;
      });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'File selection failed.'); }
  }
  const ready = result.state.status === 'ready';
  if (tab === 'Dealers' && company) return <View style={{flex:1}}><Action title="Back to company dashboard" onPress={() => { setTab('Dashboard'); result.retry(); }} /><CompanyAuthorizations api={api} token={token} writable={company.can_publish_catalogue} expired={expired} refreshCompany={result.retry} /></View>;
  if (tab === 'Catalogue' && company) return <View style={{flex:1}}><Action title="Back to company dashboard" onPress={() => { setTab('Dashboard'); result.retry(); }} /><CompanyCatalogue api={api} token={token} writable={company.can_publish_catalogue} expired={expired} refreshCompany={result.retry} /></View>;
  return <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Text style={s.kicker}>COMPANY WORKSPACE</Text><Text accessibilityRole="header" style={s.title}>{company?.trading_name || company?.legal_name || 'Your company'}</Text>
    <View style={s.tabs}>{(['Dashboard', 'Profile', 'Documents', 'Email', 'Application', 'Catalogue', 'Dealers'] as Tab[]).map(name => <Pressable key={name} accessibilityRole="button" accessibilityState={{ selected: tab === name, disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => setTab(name)} style={[s.tab, tab === name && s.selected]}><Text>{name}</Text></Pressable>)}</View>
    <Action title="Refresh company status" disabled={Boolean(busy)} onPress={() => { setMessage(''); setError(''); result.retry(); }} />
    {result.state.status === 'loading' && <ActivityIndicator accessibilityLabel="Loading company status" />}
    {result.state.status === 'error' && <View style={s.card}><Text accessibilityRole="alert" style={s.error}>{result.state.message}</Text><Action title="Retry company request" onPress={result.retry} /></View>}
    {message !== '' && <Text accessibilityLiveRegion="polite" style={s.notice}>{message}</Text>}
    {error !== '' && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {busy !== '' && <View style={s.card}><ActivityIndicator /><Text accessibilityLiveRegion="polite">{busy === 'upload' ? percent === null ? 'Uploading document…' : percent === 100 ? 'File sent. Waiting for server confirmation…' : `Uploading: ${percent}%` : 'Saving request…'}</Text></View>}
    {ready && !company && tab !== 'Profile' && <View style={s.card}><Text style={s.heading}>Register your company</Text><Text style={s.body}>This account has no company profile. One company may be linked to this account.</Text><Action title="Complete company registration" onPress={() => setTab('Profile')} /></View>}
    {ready && tab === 'Profile' && <View style={s.card}><Text accessibilityRole="header" style={s.heading}>{company ? 'Company profile' : 'Company registration'}</Text>{company && !verification?.can_edit && <Text style={s.notice}>This profile is read-only in its current review or activity state. Admin restoration does not automatically reopen an application.</Text>}
      {fields.map(([key, label, max]) => <View style={s.field} key={key}><Text style={s.label}>{label}{key === 'legal_name' || key === 'company_email' ? ' *' : ''}</Text><TextInput accessibilityLabel={label} style={[s.input, company && !verification?.can_edit && s.readonly]} value={form[key]} onChangeText={value => setForm(current => ({ ...current, [key]: value }))} maxLength={max} editable={!busy && (!company || verification?.can_edit)} autoCorrect={false} autoCapitalize={key === 'company_email' || key === 'website' ? 'none' : 'sentences'} keyboardType={key === 'company_email' ? 'email-address' : key === 'website' ? 'url' : 'default'} multiline={key === 'address_line'} /></View>)}
      <Text style={s.body}>* Required. Changing company email clears its previous verification.</Text><Action title={company ? 'Save company profile' : 'Register company'} disabled={Boolean(busy) || Boolean(company && !verification?.can_edit)} onPress={() => void perform('profile', async () => { await saveProfile(api, token, form, !company); return company ? 'Company profile saved.' : 'Company registered. Verification remains pending.'; })} />
    </View>}
    {company && verification && tab === 'Dashboard' && <>
      <View style={s.card}><Text style={s.label}>Verification status</Text><Text style={s.heading}>{statusLabel(company)}</Text><Text>Activity: {company.activity_state}</Text><Text>Publishing: {company.can_publish_catalogue ? 'Eligible under current company status' : 'Not permitted'}</Text>{company.activity_state === 'SUSPENDED' && <Text style={s.notice}>Company activity is suspended. Your account is not automatically blocked. Status and permitted review requests remain available.</Text>}</View>
      <View style={s.card}><Text style={s.heading}>Profile summary</Text><Text>{company.legal_name}</Text><Text>{company.company_email}</Text><Text>{company.registration_number || 'Registration number not provided'}</Text><Text>{[company.address_line, company.area, company.district, company.pin_code].filter(Boolean).join(', ') || 'Address not provided'}</Text></View>
      <View style={s.card}><Text style={s.heading}>Verification checklist</Text><Text>Email: {emailStatus(context!)}</Text><Text>Documents uploaded: {verification.documents.length}</Text><Text>Document policy: {verification.document_policy.configured ? 'Configured' : 'Not configured'}</Text><Text>Application: {verification.application?.status ?? 'Not submitted'}</Text>{verification.missing_document_types.length > 0 && <Text>Missing: {verification.missing_document_types.join(', ')}</Text>}</View>
    </>}
    {company && verification && tab === 'Documents' && <View style={s.card}><Text accessibilityRole="header" style={s.heading}>Private verification documents</Text><Text style={s.body}>Files are uploaded to authorized private storage. No public document URLs are displayed or shared.</Text>
      {!verification.document_policy.configured ? <Text style={s.error}>Document policy is not configured. Uploads require server-defined document types, MIME types and a size limit. No limits have been guessed.</Text> : <><Text>Maximum file size: {verification.document_policy.max_bytes} bytes</Text><Text>Allowed types: {verification.document_policy.allowed_mime_types.join(', ')}</Text><Text style={s.label}>Required document type</Text><View style={s.tabs}>{verification.document_policy.required_types.map(type => <Pressable key={type} accessibilityRole="button" accessibilityState={{ selected: type === documentType }} disabled={Boolean(busy)} style={[s.tab, type === documentType && s.selected]} onPress={() => setDocumentType(type)}><Text>{type}</Text></Pressable>)}</View></>}
      <Action title="Select and upload document" disabled={Boolean(busy) || !verification.can_upload} onPress={() => void pickAndUpload()} />
      {!verification.can_edit && <Text>Documents are locked after submission or while the company is rejected, verified or suspended.</Text>}
      {verification.documents.length === 0 ? <Text>No uploaded documents.</Text> : verification.documents.map(doc => <View key={doc.id} style={s.document}><Text style={s.label}>{doc.document_type}</Text><Text>{doc.original_filename}</Text><Text>{doc.content_type} · {doc.size_bytes} bytes</Text><Text>{doc.verification_case_id ? `Attached to application ${doc.verification_case_id}` : 'Uploaded; not yet submitted for verification'}</Text></View>)}
    </View>}
    {company && verification && tab === 'Email' && <View style={s.card}><Text style={s.heading}>Company email verification</Text><Text>{company.company_email}</Text><Text>{emailStatus(context!)}</Text>
      {!verification.email_provider_configured && !company.email_verified_at && <Text style={s.error}>Company email delivery is not configured locally. Enable the guarded local email simulation for development. No external provider is required.</Text>}
      {verification.email_verification_mode === 'development_email' && <Text style={s.notice}>LOCAL SIMULATION: no email is sent. Enter any non-empty test code. This does not verify real email ownership and is disabled outside local DEBUG mode.</Text>}
      <Action title={verification.email_verification_mode === 'development_email' ? 'Start local email simulation' : 'Send company email code'} disabled={Boolean(busy) || !verification.email_provider_configured || !verification.can_verify_email || Boolean(verification.email_ready) || company.activity_state === 'SUSPENDED'} onPress={() => void perform('email', async () => { const response = await api.post('/companies/me/email-verification/request', {}, token) as { status: string }; confirmReply(response, { status: 'string' }); return `Email request: ${response.status}.`; })} />
      <TextInput accessibilityLabel="Company email code" style={s.input} value={emailCode} onChangeText={setEmailCode} autoCapitalize="none" autoCorrect={false} editable={!busy && company.activity_state !== 'SUSPENDED'} maxLength={256} placeholder="Code from the company email" />
      <Action title="Confirm company email" disabled={Boolean(busy) || !emailCode.trim() || !verification.email_provider_configured || !verification.can_verify_email || company.activity_state === 'SUSPENDED' || Boolean(verification.email_ready)} onPress={() => void perform('email', async () => { const response = await api.post('/companies/me/email-verification/confirm', { code: emailCode.trim() }, token) as { company?: { id?: number } }; confirmReply(response.company, { id: 'number' }); setEmailCode(''); return verification.email_verification_mode === 'development_email' ? 'Local email simulation recorded. Real email ownership remains unverified.' : 'Company email verification confirmed by server.'; })} />
    </View>}
    {company && verification && tab === 'Application' && <View style={s.card}><Text accessibilityRole="header" style={s.heading}>Verification application</Text><Text>Company: {statusLabel(company)}</Text>{verification.application ? <><Text>Application {verification.application.id}: {verification.application.status}</Text><Text>Submitted: {verification.application.submitted_at}</Text>{verification.application.reviewed_at && <Text>Reviewed: {verification.application.reviewed_at}</Text>}{verification.application.decision_reason !== '' && <Text>Decision reason: {verification.application.decision_reason}</Text>}</> : <Text>No verification application has been submitted.</Text>}
      {!verification.can_submit && <Text style={s.notice}>{submissionGuidance(context!)}</Text>}
      <Action title="Submit verification application" disabled={Boolean(busy) || !verification.can_submit} onPress={() => void perform('submission', async () => { const response = await api.post('/companies/me/verification-submissions', {}, token) as { case_id: number; status: string }; confirmReply(response, { case_id: 'number', status: 'string' }); return `Application ${response.case_id} submitted: ${response.status}.`; })} />
      {verification.can_request_review && <><Text style={s.heading}>Restricted review request</Text><Text style={s.body}>A request does not restore company or account access. An authorized admin must decide restoration separately.</Text><TextInput accessibilityLabel="Review request reason" style={s.input} multiline value={reviewReason} onChangeText={setReviewReason} maxLength={4000} editable={!busy} /><Action title="Submit review request" disabled={Boolean(busy) || !reviewReason.trim()} onPress={() => void perform('review', async () => { const response = await api.post('/companies/me/review-requests', { reason: reviewReason.trim() }, token) as { id: number; state: string }; confirmReply(response, { id: 'number', state: 'string' }); setReviewReason(''); return `Review request ${response.id}: ${response.state}.`; })} /></>}
      {verification.review_requests.map(item => <View key={item.id} style={s.document}><Text>Review request {item.id}: {item.state}</Text><Text>{item.reason}</Text><Text>{item.submitted_at}</Text></View>)}
    </View>}
  </ScrollView>;
}
const s = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 64 }, kicker: { color: '#087f5b', letterSpacing: 1.5, fontWeight: '800' }, title: { fontSize: 28, fontWeight: '800', color: '#17392d' }, heading: { fontSize: 20, color: '#17392d', fontWeight: '700' }, body: { color: '#52675c', fontSize: 15, lineHeight: 23 },
  card: { backgroundColor: '#fff', padding: 18, gap: 14, borderRadius: 16, borderWidth: 1, borderColor: '#dce7e0' }, field: { gap: 6 }, label: { fontWeight: '700', color: '#294b3a' }, input: { minHeight: 48, padding: 12, borderRadius: 10, borderColor: '#9fb7aa', borderWidth: 1, color: '#17392d', fontSize: 16 }, readonly: { backgroundColor: '#f2f5f3' }, tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, tab: { padding: 12, borderRadius: 9, borderColor: '#b4d4c2', borderWidth: 1, backgroundColor: '#fff' }, selected: { backgroundColor: '#bde5ce', borderColor: '#176c46' }, button: { padding: 14, backgroundColor: '#e3f2e9', borderRadius: 10, minHeight: 48 }, buttonText: { fontWeight: '700', color: '#125335', textAlign: 'center' }, disabled: { opacity: 0.45 }, error: { color: '#9c2820', lineHeight: 22 }, notice: { padding: 12, backgroundColor: '#edf7f0', color: '#294b3a', lineHeight: 22 }, document: { gap: 6, borderTopWidth: 1, borderColor: '#dce7e0', paddingTop: 12 },
});
