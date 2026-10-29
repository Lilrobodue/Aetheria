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
//
// v16.1: Clear keeps the saved playlists. With any (playlistCount > 0), a tickbox under the button, "Also delete my 5
// playlists", unticked by default and again after each Clear, and the armed words say which (mockups
// clear-classic-*). With none, exactly v16.0's markup and words.

import React, { useState, useRef, useEffect } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { alsoDeleteLabel, classicArmedName, classicArmedText } from './shell/playlists/playlistsViewModel';

interface Props {
  /** v16.1: whether the saved playlists go too (the tickbox; false with none). */
  onClear: (alsoPlaylists: boolean) => void;
  /** Tracks in the whole library (unique ids), not the list on screen. */
  libraryCount: number;
  /** v16.1: the saved playlists (0: no tickbox, v16.0's markup). */
  playlistCount?: number;
}

const ClearPlaylistButton: React.FC<Props> = ({ onClear, libraryCount, playlistCount = 0 }) => {
  const [armed, setArmed] = useState(false);
  const [ticked, setTicked] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the disarm timer if the component unmounts mid-arm.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const withPlaylists = playlistCount > 0;
  const alsoPlaylists = withPlaylists && ticked;

  const handleClick = () => {
    if (!armed) {
      // First tap — arm, then auto-disarm after 3s.
      setArmed(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      // v16.1 review: an abandoned Clear unticks the box too, so a later two-tap Clear keeps the playlists unless the
      // box is ticked again.
      timerRef.current = setTimeout(() => {
        setArmed(false);
        setTicked(false);
      }, 3000);
    } else {
      // Second tap — confirm and clear.
      if (timerRef.current) clearTimeout(timerRef.current);
      setArmed(false);
      setTicked(false); // v16.1: unticked again after each Clear
      onClear(alsoPlaylists);
    }
  };

  const button = (
    <button
      onClick={handleClick}
      aria-label={armed ? classicArmedName(libraryCount, playlistCount, alsoPlaylists) : 'Clear library and cache'}
      className={`w-full text-[11px] py-2.5 rounded-lg border transition-all duration-300 flex items-center justify-center gap-2 ${
        armed
          ? 'bg-red-900/30 border-red-500/50 text-red-300 hover:bg-red-900/50'
          : 'bg-slate-900/50 border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-700'
      }`}
    >
      <Trash2 size={12} />
      {armed
        ? classicArmedText(libraryCount, playlistCount, alsoPlaylists)
        : 'Clear Library & Cache'}
    </button>
  );
  if (!withPlaylists) return button;

  return (
    <>
      {button}
      <label data-testid="clear-also-playlists" className="mt-2 min-h-[44px] px-1 flex items-center gap-3 text-[11px] text-slate-500 cursor-pointer">
        <input
          type="checkbox"
          checked={ticked}
          onChange={(e: { target: HTMLInputElement }) => setTicked(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-gold-400 ${
            ticked ? 'bg-red-900/40 border-red-500/60 text-red-300' : 'border-slate-700'
          }`}
        >
          {ticked ? <Check size={14} /> : null}
        </span>
        {alsoDeleteLabel(playlistCount)}
      </label>
    </>
  );
};

export default ClearPlaylistButton;
