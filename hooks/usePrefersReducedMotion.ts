// hooks/usePrefersReducedMotion.ts
//
// True while the device asks for reduced motion (Android "Remove animations",
// Windows "Animation effects" off, iOS/macOS "Reduce motion"). Follows a change
// live, without a reload. False wherever matchMedia is missing or throws (SSR,
// old WebViews), so callers never have to guard it.
import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function mediaQuery(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(QUERY)
      : null;
  } catch {
    return null;
  }
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => mediaQuery()?.matches === true);

  useEffect(() => {
    const mql = mediaQuery();
    if (!mql) return;
    const onChange = () => setReduced(mql.matches);
    onChange(); // it may have changed between the first render and this effect
    try {
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
      }
      // Safari < 14 only has the deprecated listener API.
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    } catch {
      return undefined;
    }
  }, []);

  return reduced;
}
