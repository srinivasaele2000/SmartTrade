import {useEffect,useRef,useState} from 'react';
import {HistoryPage,type HistoryLoader} from './history-page';

export function useHistoryPage<T>(load:HistoryLoader<T>) {
  const controller=useRef<HistoryPage<T>|null>(null);
  if(!controller.current)controller.current=new HistoryPage(load);
  const history=controller.current;
  const [snapshot,setSnapshot]=useState(history.snapshot);
  useEffect(()=>{
    history.subscribe(setSnapshot);void history.start(load);
    return()=>history.dispose();
  },[history,load]);
  return {...snapshot,next:history.next,previous:history.previous,retry:history.retry,refresh:history.refresh,reload:history.reload};
}
