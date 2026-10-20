// components/ClearPlaylistButton.tsx
//
// A deliberate, two-tap "Clear Library & Cache" control. Lives below the
// playlist footer (track count + total time) so it requires a scroll-down and
// can never be tapped by accident. First tap ARMS the button (turns red, shows
// the track count); a second tap within 3 seconds confirms and clears. If the
// confirm tap doesn't come, the button auto-disarms.
//
// It clears the WHOLE LIBRARY — every track's stored audio and analysis — not
// just the list on screen, so the count it shows is the library's (v14.5: it
// used to show the play order's count, e.g. "12 tracks" for a mix while the
// second tap deleted all 500).

import React, { useState, useRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';

interface Props {
  onClear: () => void;
  /** Tracks in the whole library (unique ids), not the list on screen. */
  libraryCount: number;
}

const ClearPlaylistButton: React.FC<Props> = ({ onClear, libraryCount }) => {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the disarm timer if the component unmounts mid-arm.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = () => {
    if (!armed) {
      // First tap — arm, then auto-disarm after 3s.
      setArmed(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setArmed(false), 3000);
    } else {
      // Second tap — confirm and clear.
      if (timerRef.current) clearTimeout(timerRef.current);
      setArmed(false);
      onClear();
    }
  };

  return (
    <button
      onClick={handleClick}
      aria-label={armed ? `Confirm deleting all ${libraryCount} tracks from this device` : 'Clear library and cache'}
      className={`w-full text-[11px] py-2.5 rounded-lg border transition-all duration-300 flex items-center justify-center gap-2 ${
        armed
          ? 'bg-red-900/30 border-red-500/50 text-red-300 hover:bg-red-900/50'
          : 'bg-slate-900/50 border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-700'
      }`}
    >
      <Trash2 size={12} />
      {armed
        ? `Tap again to delete all ${libraryCount} tracks and their analysis`
        : 'Clear Library & Cache'}
    </button>
  );
};

export default ClearPlaylistButton;
