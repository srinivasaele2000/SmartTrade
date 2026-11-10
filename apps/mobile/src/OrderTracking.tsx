import {StyleSheet, Text, View} from 'react-native';
import {istDateTime} from './india';
import type {Order} from './orders';

const states: Record<string, {label: string; step: number}> = {
  PENDING: {label: 'Order placed', step: 0}, CONFIRMED: {label: 'Confirmed', step: 1},
  PROCESSING: {label: 'Preparing order', step: 1}, READY: {label: 'Ready for dispatch', step: 2},
  COMPLETED: {label: 'Completed', step: 3},
};

export function orderStatusLabel(state: string) {
  return states[state]?.label ?? (state === 'CANCELLED' ? 'Cancelled' : state === 'REJECTED' ? 'Rejected' : 'Status unavailable');
}

export function OrderTracking({order}: {order: Order}) {
  const stopped = order.state === 'CANCELLED' || order.state === 'REJECTED';
  const current = stopped ? (order.confirmed_at ? 1 : 0) : (states[order.state]?.step ?? 0);
  const steps = [
    {title: 'Order Placed', at: order.created_at}, {title: 'Confirmed', at: order.confirmed_at},
    {title: 'Ready for Dispatch'}, {title: 'Completed'},
  ];
  return <View style={styles.section}>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.heading}>Order tracking</Text>
      <Text style={[styles.pill, stopped && styles.stopped]}>{orderStatusLabel(order.state)}</Text>
    </View>
    {steps.map(({title, at}, index) => {
      const reached = index <= current;
      const status = !stopped && index === current ? 'Current step' : reached ? 'Reached' : stopped ? 'Not reached' : 'Pending';
      const timestamp = reached && at ? istDateTime(at) : null;
      return <View key={title} style={styles.step} accessible accessibilityLabel={`${title}, ${status}${timestamp ? `, ${timestamp}` : ''}`}>
        <View style={styles.rail}>
          <View style={[styles.dot, reached && styles.reached]} />
          {index < steps.length - 1 && <View style={[styles.line, index < current && styles.reached]} />}
        </View>
        <View style={styles.detail}>
          <Text style={[styles.stepTitle, !reached && styles.pending]}>{title}</Text>
          {timestamp && <Text style={styles.pending}>{timestamp}</Text>}
        </View>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  section: {padding: 14, borderRadius: 12, backgroundColor: '#f3f7f4'},
  header: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14},
  heading: {fontSize: 17, fontWeight: '800', color: '#17392d'},
  pill: {color: '#14553e', backgroundColor: '#dcefe3', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, fontWeight: '700'},
  stopped: {color: '#8a241b', backgroundColor: '#fce7e4'},
  step: {flexDirection: 'row', gap: 10, minHeight: 44}, rail: {alignItems: 'center', width: 16},
  dot: {width: 12, height: 12, marginTop: 3, borderRadius: 6, backgroundColor: '#c9d7ce'},
  line: {width: 2, flex: 1, backgroundColor: '#c9d7ce'}, reached: {backgroundColor: '#24734f'},
  detail: {flex: 1, paddingBottom: 9}, stepTitle: {fontWeight: '700', color: '#17392d'}, pending: {color: '#52675c'},
});
