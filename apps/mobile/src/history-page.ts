import type {Page} from './api';
import type {Resource} from './resource';

export type HistorySnapshot<T> = {page:number; state:Resource<Page<T>>};
export type HistoryLoader<T> = (page:number,signal:AbortSignal)=>Promise<Page<T>>;

/** Request generation and immediate loading gate cover rapid taps and late responses. */
export class HistoryPage<T> {
  snapshot:HistorySnapshot<T> = {page:1,state:{status:'loading'}};
  private generation=0;
  private abort:AbortController|null=null;
  private listener:(value:HistorySnapshot<T>)=>void=()=>{};
  private load:HistoryLoader<T>;
  constructor(load:HistoryLoader<T>) {this.load=load;}
  subscribe(listener:(value:HistorySnapshot<T>)=>void) {this.listener=listener;}
  start(load:HistoryLoader<T>) {this.load=load;return this.request(this.snapshot.page);}
  dispose() {this.generation++;this.abort?.abort();this.listener=()=>{};}
  private publish(value:HistorySnapshot<T>) {this.snapshot=value;this.listener(value);}
  private async request(page:number) {
    const generation=++this.generation;
    this.abort?.abort();const abort=new AbortController();this.abort=abort;
    this.publish({page,state:{status:'loading'}});
    try {
      const data=await this.load(page,abort.signal);
      if(generation===this.generation&&!abort.signal.aborted)this.publish({page,state:{status:'ready',data}});
    } catch(error) {
      if(generation===this.generation&&!abort.signal.aborted)this.publish({page,state:{status:'error',message:error instanceof Error?error.message:'History request failed.'}});
    }
  }
  next=()=>{const {page,state}=this.snapshot;if(state.status==='ready'&&state.data.next)return this.request(page+1);};
  previous=()=>{const {page,state}=this.snapshot;if(page>1&&state.status==='ready'&&state.data.previous)return this.request(page-1);};
  retry=()=>{if(this.snapshot.state.status!=='loading')return this.request(this.snapshot.page);};
  refresh=()=>{if(this.snapshot.state.status!=='loading')return this.request(1);};
  reload=()=>this.request(this.snapshot.page);
}
