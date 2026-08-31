import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

/**
 * Fetch-on-focus with key-aware loading state.
 *
 * `key` identifies the query (filter, date, range). The loading flag is raised
 * only when the key differs from the data currently held — so switching filters
 * shows a skeleton, while merely re-focusing the tab refreshes silently instead
 * of flashing one. On failure, stale data is dropped if it belonged to a
 * different key, so a screen never shows results labelled with the wrong query.
 */
export function useFetch<T>(key: string, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedKey = useRef<string | null>(null);

  // Held in a ref so an inline arrow fetcher doesn't retrigger the effect.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(
    async (opts?: { refresh?: boolean }) => {
      const isNewQuery = loadedKey.current !== key;
      if (!opts?.refresh && isNewQuery) setLoading(true);
      try {
        const result = await fetcherRef.current();
        setData(result);
        setError(null);
        loadedKey.current = key;
      } catch (e: any) {
        setError(e?.message || "Failed to load");
        if (isNewQuery) setData(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [key]
  );

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const refresh = useCallback(() => {
    setRefreshing(true);
    load({ refresh: true });
  }, [load]);

  // setData is exposed for optimistic updates (e.g. flipping an order's status
  // in place) so a screen doesn't have to refetch the whole list to reflect one edit.
  return { data, setData, loading, refreshing, error, refresh, reload: load };
}
