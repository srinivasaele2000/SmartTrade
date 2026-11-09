import {Text,View,StyleSheet} from 'react-native';
import {Button} from './Button';
import type {HistorySnapshot} from './history-page';

export function HistoryPager<T>({page,state,next,previous,disabled=false}:HistorySnapshot<T>&{next:()=>unknown;previous:()=>unknown;disabled?:boolean}) {
  const ready=state.status==='ready';
  return <View style={s.row}>
    <Button variant="tertiary" icon="back" title="Previous history page" disabled={disabled||!ready||!state.data.previous} onPress={previous}/>
    <Text accessibilityLiveRegion="polite">Page {page}{ready?` · ${state.data.count} records`:''}</Text>
    <Button variant="tertiary" icon="next" title="Next history page" disabled={disabled||!ready||!state.data.next} onPress={next}/>
  </View>;
}
const s=StyleSheet.create({row:{flexDirection:'row',flexWrap:'wrap',gap:8,alignItems:'center',justifyContent:'space-between'}});
