import {useEffect, useState} from 'react';

export function useDebouncedSearch() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const normalized = text.trim().replace(/\s+/g, ' ');
  const pending = normalized !== query;

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setQuery(normalized), 275);
    return () => clearTimeout(timer);
  }, [normalized, pending]);

  function change(value: string) {
    setText(value);
    if (!value.trim()) setQuery('');
  }

  return {text, query, pending, change, submit: () => setQuery(normalized)};
}
