import type {ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

export function StickyBottomBar({children, clearance}: {children: ReactNode; clearance?: number}) {
  const {bottom} = useSafeAreaInsets();
  return <View style={[styles.bar, {paddingBottom: clearance === undefined ? (bottom > 0 ? bottom + 8 : 16) : bottom + clearance}]}>{children}</View>;
}

const styles = StyleSheet.create({
  bar: {backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#dce7e0', paddingHorizontal: 18, paddingTop: 10},
});
