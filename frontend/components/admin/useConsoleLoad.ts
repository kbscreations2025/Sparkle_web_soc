"use client";

import { useEffect, useEffectEvent, useState } from "react";

/**
 * A console page's first fetch: `loading` until it settles, and the page's
 * `error` line, which later actions on the page set too.
 *
 * `apply` folds the response into the page's state and returns the message to
 * show when the response reports a failure; a request that throws reads as
 * "Could not reach the server". Whatever lands after the page unmounts, or
 * after `request` changes and fetches again, is dropped. `request` must be
 * stable — module-level or memoized — since a new one is a new fetch.
 */
export function useConsoleLoad<T>(request: () => Promise<T>, apply: (result: T) => string | void) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const onLoaded = useEffectEvent(apply);

  useEffect(() => {
    let cancelled = false;
    request()
      .then((result) => {
        if (cancelled) return;
        const message = onLoaded(result);
        if (message) setError(message);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not reach the server");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  return { loading, error, setError };
}
