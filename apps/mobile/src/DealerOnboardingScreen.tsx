import {useCallback, useState} from 'react';
import {ActivityIndicator, Text, View} from 'react-native';
import {ApiError, type ApiClient} from './api';
import {Button} from './Button';
import DealerCataloguesScreen from './DealerCataloguesScreen';
import DealerWorkerContactsScreen, {onboardingStyles as s} from './DealerWorkerContactsScreen';
import {onboardingProfile} from './dealer-onboarding';
import {useResource} from './useResource';

export default function DealerOnboardingScreen({api, token}: {api: ApiClient; token: string | null}) {
  const [submitted, setSubmitted] = useState(false);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!token) throw new ApiError('Sign in to continue dealer onboarding.');
    return onboardingProfile(api, token, signal);
  }, [api, token]);
  const {state, retry} = useResource(load, {retainData: true});
  if (!token) return <Text style={s.content}>Sign in to continue dealer onboarding.</Text>;
  if (!state.data) return <View style={s.content}>{state.status === 'error'
    ? <><Text accessibilityRole="alert" style={s.error}>{state.message}</Text><Button variant="secondary" title="Retry" onPress={retry} /></>
    : <ActivityIndicator accessibilityLabel="Loading dealer onboarding" />}</View>;
  if (submitted || state.data.contacts_submitted_at) return <DealerCataloguesScreen
    api={api} token={token} type={state.data.business_type} />;
  if (['REJECTED', 'SUSPENDED'].includes(state.data.verification_state)) return <Text style={s.content}>
    Your current business verification status prevents contact submission.
  </Text>;
  return <DealerWorkerContactsScreen api={api} token={token} done={() => setSubmitted(true)} reloadStatus={retry} />;
}
