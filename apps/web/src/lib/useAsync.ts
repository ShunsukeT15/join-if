import { useCallback, useEffect, useState } from 'react';

/** Loads data once per `key` and exposes a setter for mutation results. */
export function useLoad<T>(key: string, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const v = await load();
      setData(v);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    void reload();
  }, [reload]);

  // Refresh when the page is restored from the back/forward cache or the tab becomes visible again,
  // so statuses (answered, closed, result) are never stale.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => e.persisted && void reload();
    const onVisible = () => document.visibilityState === 'visible' && void reload();
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  return { data, setData, error, loading, reload };
}
