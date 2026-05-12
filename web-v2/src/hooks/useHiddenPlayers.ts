import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'owr-v2:hidden-players';

function loadInitial(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export interface UseHiddenPlayers {
  hidden: Set<string>;
  isHidden: (slug: string) => boolean;
  toggle: (slug: string) => void;
  restoreAll: () => void;
}

export function useHiddenPlayers(): UseHiddenPlayers {
  const [hidden, setHidden] = useState<Set<string>>(loadInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...hidden]));
    } catch {
      // ignore quota errors
    }
  }, [hidden]);

  // Cross-tab sync: other tabs editing the same list should reflect here.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setHidden(loadInitial());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback((slug: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const restoreAll = useCallback(() => {
    setHidden(new Set());
  }, []);

  const isHidden = useCallback((slug: string) => hidden.has(slug), [hidden]);

  return { hidden, isHidden, toggle, restoreAll };
}
