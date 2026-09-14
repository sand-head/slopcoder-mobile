/**
 * The repositories you own, across every connected forge.
 *
 * Fetched on its own rather than with the rest of a screen's data: the server
 * fans this out across every connection, so one slow forge would otherwise hold
 * up the model list and the composer behind it.
 *
 * The listing can half-fail — `{repos, errors}` — and the cockpit says so
 * rather than showing a short list as if it were the whole one. So does this.
 */
import { useEffect, useState } from 'react';
import type { Seam } from '../api/seam';
import { rowToChoice, type RepoChoice } from '../api/repoPicker';

export interface OwnedRepos {
  repos: RepoChoice[];
  /** False until the answer has arrived, which is not the same as having none. */
  loaded: boolean;
  /** What could not be listed, in the words the server used. */
  error: string | null;
}

export function useOwnedRepos(seam: Seam | null): OwnedRepos {
  const [state, setState] = useState<OwnedRepos>({ repos: [], loaded: false, error: null });

  useEffect(() => {
    if (!seam) {
      setState({ repos: [], loaded: false, error: null });
      return;
    }

    let live = true;
    void seam
      .repos()
      .then(listing => {
        if (!live) return;
        setState({
          repos: listing.repos.map(rowToChoice),
          loaded: true,
          error:
            listing.errors.length > 0
              ? `Couldn't list repositories — ${listing.errors.join('; ')}`
              : null,
        });
      })
      .catch(() => {
        // Unreachable is the connection banner's story to tell, not this one's.
        if (live) setState({ repos: [], loaded: true, error: null });
      });

    return () => {
      live = false;
    };
  }, [seam]);

  return state;
}
