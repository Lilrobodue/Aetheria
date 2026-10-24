// components/shell/useMediaQuery.ts (v15.5, the new layout beta)
//
// Whether a media query matches, following a change live (a rotation, a resize). The first render already has the
// answer (no flash of the other shell); false wherever matchMedia is missing or throws.

import { useEffect, useState } from 'react';

function list(query: string): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
  } catch {
    return null;
  }
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => list(query)?.matches === true);

  useEffect(() => {
    const mql = list(query);
    if (!mql) return;
    const onChange = () => setMatches(mql.matches);
    onChange(); // it may have changed between the first render and this effect
    try {
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
      }
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    } catch {
      return undefined;
    }
  }, [query]);

  return matches;
}
