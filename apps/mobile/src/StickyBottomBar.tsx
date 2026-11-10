import type {ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

export function StickyBottomBar({children}: {children: ReactNode}) {
  const {bottom} = useSafeAreaInsets();
  return <View style={[styles.bar, {paddingBottom: bottom > 0 ? bottom + 8 : 16}]}>{children}</View>;
}

const styles = StyleSheet.create({
  bar: {backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#dce7e0', paddingHorizontal: 18, paddingTop: 10},
});
