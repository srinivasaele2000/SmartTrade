import {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Button} from './Button';
import type {ApiClient} from './api';
import type {Account} from './auth';
import {availableDemoPersonas, demoLogin, type DemoPersona} from './demo-roles';
import {RoleBadge} from './RoleIdentity';
import {useSession} from './session';

export default function DemoRoleSwitcher({api, configured, onSwitch}: {
  api: ApiClient; configured: DemoPersona[]; onSwitch: (account: Account) => void;
}) {
  const {account, establishSession} = useSession();
  const {bottom, left, right} = useSafeAreaInsets();
  const [personas, setPersonas] = useState<DemoPersona[]>([]);
  const [open, setOpen] = useState(false), [pending, setPending] = useState<DemoPersona['role'] | null>(null);
  const [error, setError] = useState('');
  const switching = useRef(false);

  useEffect(() => {
    if (!configured.length) return;
    const controller = new AbortController();
    void availableDemoPersonas(api, configured, controller.signal).then(available => {
      if (!controller.signal.aborted) setPersonas(available);
    });
    return () => controller.abort();
  }, [api, configured]);

  async function choose(persona: DemoPersona) {
    if (switching.current) return;
    switching.current = true;
    setPending(persona.role); setError('');
    try {
      const issued = await demoLogin(api, persona);
      const profile = await establishSession(issued, persona);
      setOpen(false);
      onSwitch(profile);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Couldn’t switch accounts. Try again.');
    } finally {switching.current = false; setPending(null);}
  }

  if (!account || !personas.length) return null;
  const close = () => {if (!switching.current) setOpen(false);};
  return <>
    <Button variant="secondary" title="Switch Role (Demo)" onPress={() => {setError(''); setOpen(true);}} />
    <Modal visible={open} transparent animationType="slide" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.overlay}>
        <View accessibilityViewIsModal style={[styles.sheet, {paddingBottom: bottom + 22,
          paddingLeft: Math.max(left, 18), paddingRight: Math.max(right, 18)}]}>
          <Text accessibilityRole="header" style={styles.title}>Switch Account Role</Text>
          <Text style={styles.body}>Select a development persona to preview role-specific workspaces and badges.</Text>
          <ScrollView contentContainerStyle={styles.list}>
            {personas.map(persona => {
              const active = account.account_type === persona.role && account.mobile_e164 === persona.mobile;
              return <Pressable key={persona.role} accessibilityRole="button" accessibilityLabel={`${persona.name}, ${persona.mobile}${active ? ', current account' : ''}`}
                accessibilityState={{selected: active, disabled: active || pending !== null, busy: pending === persona.role}}
                disabled={active || pending !== null} onPress={() => void choose(persona)} style={[styles.row, active && styles.active]}>
                <View style={styles.identity}>
                  <RoleBadge role={persona.role} />
                  <Text style={styles.name}>{persona.name}</Text><Text style={styles.body}>{persona.mobile}</Text>
                </View>
                {pending === persona.role ? <ActivityIndicator /> : active && <Text style={styles.current}>✓ Current</Text>}
              </Pressable>;
            })}
          </ScrollView>
          {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <Button variant="secondary" icon="close" title="Close" onPress={close} disabled={pending !== null} />
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  overlay: {flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008'},
  sheet: {maxHeight: '88%', paddingTop: 20, gap: 10, backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22},
  title: {fontSize: 23, fontWeight: '800', color: '#17392d'}, body: {color: '#52675c', lineHeight: 20},
  list: {gap: 8}, row: {flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: '#dce7e0', padding: 10},
  identity: {flex: 1, gap: 3}, name: {fontWeight: '700', color: '#17392d'},
  active: {backgroundColor: '#edf7f0', borderColor: '#24734f'}, current: {color: '#14553e', fontWeight: '700'}, error: {color: '#9c2820'},
});
