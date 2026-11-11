import {useEffect, useState} from 'react';
import {ensureList, requestApi} from './api';

type Page<T> = {count: number; next: string | null; previous: string | null; results: T[]};

export function useAdminPage<T>(baseUrl: string, token: string, path: string, filters = '') {
  const [number, setNumber] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{data?: Page<T>; error?: string}>({});
  useEffect(() => {
    if (!path) return;
    const abort = new AbortController();
    setState({});
    const query = new URLSearchParams(filters);
    query.set('page', String(number));
    void requestApi<Page<T>>(baseUrl, path + '?' + query, token, {signal: abort.signal})
      .then(data => {
        ensureList(data, true);
        if (!abort.signal.aborted) setState({data});
      })
      .catch(error => {
        if (!abort.signal.aborted) setState({error: error.message});
      });
    return () => abort.abort();
  }, [baseUrl, token, path, number, revision, filters]);
  return {...state, number, setNumber, reload: () => setRevision(value => value + 1)};
}
