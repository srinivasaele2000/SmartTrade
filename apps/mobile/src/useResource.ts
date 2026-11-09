import { useEffect, useReducer, useState } from 'react';
import { resourceReducer, type Resource } from './resource';

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, { retainData = false } = {}) {
  const [attempt, retry] = useState(0);
  const [state, dispatch] = useReducer(resourceReducer<T>, { status: 'loading' } as Resource<T>);
  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: 'loading', retainData });
    load(controller.signal).then(data => {
      if (!controller.signal.aborted) dispatch({ type: 'ready', data });
    }).catch(error => {
      if (!controller.signal.aborted) dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Request failed.', retainData });
    });
    return () => controller.abort();
  }, [load, attempt, retainData]);
  return { state, retry: () => retry(value => value + 1) };
}
