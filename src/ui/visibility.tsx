/**
 * Whether a transcript row has been on screen.
 *
 * The transcript's list mounts several screens either side of the viewport,
 * so "mounted" is not "seen". Media that costs a request — an artifact card
 * asking what it is, a thumbnail decoding — waits for its row to be viewable
 * for a moment, which is what keeps a fast scroll through a long run from
 * firing a request per card it passes.
 *
 * Once seen, a row stays seen: scrolling away must not tear down an image the
 * reader is about to scroll back to, and the list unmounts far-off rows anyway.
 *
 * Outside a provider (a sub-session card, a test, another screen) everything
 * counts as seen.
 */
import React, { createContext, useContext, useMemo, useSyncExternalStore } from 'react';

export interface RowVisibility {
  /** Record rows that are viewable now. */
  show(keys: readonly string[]): void;
  seen(key: string): boolean;
  subscribe(listener: () => void): () => void;
}

export function createRowVisibility(): RowVisibility {
  const seen = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    show(keys) {
      let changed = false;
      for (const key of keys) {
        if (!seen.has(key)) {
          seen.add(key);
          changed = true;
        }
      }
      if (changed) listeners.forEach(listener => listener());
    },
    seen: key => seen.has(key),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const Context = createContext<{ store: RowVisibility; rowKey: string } | null>(null);

export function RowVisibilityScope({
  store,
  rowKey,
  children,
}: {
  store: RowVisibility;
  rowKey: string;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ store, rowKey }), [store, rowKey]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

const always = () => () => {};

/** True once the enclosing row has been on screen; always true outside a scope. */
export function useRowSeen(): boolean {
  const scope = useContext(Context);
  return useSyncExternalStore(
    scope ? scope.store.subscribe : always,
    () => (scope ? scope.store.seen(scope.rowKey) : true),
  );
}
