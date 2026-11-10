import {useCallback} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {ApiClient, ApiError} from './api';
import {Button} from './Button';
import {enquiryPage} from './enquiries';
import {orders} from './orders';
import {useResource} from './useResource';

const activeOrderStates = new Set(['PENDING', 'CONFIRMED', 'PROCESSING', 'READY']);

export function DealerActivity({api, token, revision, onExpired, onOpenOrders}: {
  api: ApiClient; token: string; revision: number; onExpired: () => void; onOpenOrders: () => void;
}) {
  const activity = useResource(useCallback(async signal => {
    try {
      const [recentOrders, recentEnquiries] = await Promise.all([
        orders(api, token, true, 1, signal), enquiryPage(api, token, true, 1, signal),
      ]);
      return {
        enquiries: recentEnquiries.results.filter(item => item.state === 'SUBMITTED' || item.state === 'QUOTED').length,
        active: recentOrders.results.filter(item => activeOrderStates.has(item.state)).length,
        ready: recentOrders.results.filter(item => item.state === 'READY').length,
        invoices: recentOrders.results.filter(item => item.invoice !== null).length,
        moreOrders: Boolean(recentOrders.next),
      };
    } catch (error) {
      if (!signal.aborted && error instanceof ApiError && error.status === 401) onExpired();
      throw error;
    }
  }, [api, token, revision, onExpired]));

  return <View style={styles.banner}>
    <Text accessibilityRole="header" style={styles.heading}>Recent activity</Text>
    {activity.state.status === 'loading' && <ActivityIndicator accessibilityLabel="Loading recent activity" />}
    {activity.state.status === 'error' && <>
      <Text accessibilityRole="alert" style={styles.copy}>We couldn’t load recent activity.</Text>
      <Button variant="tertiary" title="Retry recent activity" onPress={activity.retry} />
    </>}
    {activity.state.status === 'ready' && (() => {
      const {active, ready, enquiries, invoices, moreOrders} = activity.state.data;
      return <>
        <Text style={styles.copy}>{active > 0 ? `${active} active ${active === 1 ? 'order' : 'orders'} in recent activity`
          : moreOrders ? 'No active orders in recent activity' : 'All orders up to date'}</Text>
        <View style={styles.chips}>
          <Text style={styles.chip}>{`${enquiries} active ${enquiries === 1 ? 'enquiry' : 'enquiries'}`}</Text>
          <Text style={styles.chip}>{`${ready} ${ready === 1 ? 'order' : 'orders'} ready`}</Text>
          <Text style={styles.chip}>{`${invoices} ${invoices === 1 ? 'invoice' : 'invoices'} ready`}</Text>
        </View>
        <Text style={styles.copy}>Counts are based on the latest page of orders and enquiries.</Text>
      </>;
    })()}
    <Button variant="secondary" icon="next" title="View orders and invoices" onPress={onOpenOrders} />
  </View>;
}

const styles = StyleSheet.create({
  banner: {backgroundColor: '#14553e', borderRadius: 16, padding: 16, gap: 10},
  heading: {color: '#fff', fontSize: 20, fontWeight: '800'},
  copy: {color: '#e0f3e7', lineHeight: 20},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 7},
  chip: {color: '#17392d', fontWeight: '700', backgroundColor: '#e6f4eb', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5},
});
