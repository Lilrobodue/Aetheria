import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// The tests' own port and origin, kept apart from the dev server you run by
// hand (port 3100): on a phone the tests share Chrome's one profile with you,
// and they wipe their origin's storage before every test.
export const TEST_PORT = 3199;
export const TEST_ORIGIN = `http://localhost:${TEST_PORT}`;

// The Android device the suite drives when E2E_DEVICE is set:
//   E2E_DEVICE=1 (or usb)   the one USB-connected phone (adb -d)
//   E2E_DEVICE=emulator     the one running emulator (adb -e)
//   E2E_DEVICE=<serial>     that device (adb -s <serial>)
export const DEVICE = process.env.E2E_DEVICE || '';

function adbPath(): string {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
    (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '');
  const exe = sdk ? join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : '';
  return exe && existsSync(exe) ? exe : 'adb';
}

function target(): string[] {
  if (!DEVICE || DEVICE === '1' || DEVICE === 'usb') return ['-d'];
  if (DEVICE === 'emulator') return ['-e'];
  return ['-s', DEVICE];
}

/** Run an adb command against the test device and return its output. */
export function adb(...args: string[]): string {
  return execFileSync(adbPath(), [...target(), ...args], { encoding: 'utf8' }).replace(/\r/g, '');
}

/** Fail fast on a locked phone: taps and playback need it unlocked, and only
 *  its owner can unlock a secure lock. */
export function assertUnlocked(): void {
  if (/isKeyguardShowing=true/.test(adb('shell', 'dumpsys', 'window'))) {
    throw new Error('The phone is locked. Unlock it (and keep it unlocked) to run the device tests.');
  }
}

/**
 * Every media session Chrome holds, as Android reports them (highest priority
 * first) — what the lock screen, the notification and the car show.
 */
export function chromeSessions(): { state: string; title: string }[] {
  const out = adb('shell', 'dumpsys', 'media_session');
  const marker = 'package=com.android.chrome';
  const sessions: { state: string; title: string }[] = [];
  for (let at = out.indexOf(marker); at >= 0; at = out.indexOf(marker, at + marker.length)) {
    const next = out.indexOf('package=', at + marker.length);
    const block = out.slice(at, next < 0 ? at + 3000 : Math.min(next, at + 3000));
    const state = /state=PlaybackState \{state=([A-Z_]+)\(\d+\)/.exec(block)?.[1] ?? '';
    // "description=<title>, <artist>, <album>": the app's artist is fixed, so a
    // song title holding commas is still read whole.
    const description = /metadata: size=\d+, description=([^\n]*)/.exec(block)?.[1] ?? '';
    const title = (/^(.*?), Aetheria Harmonic Player/.exec(description)?.[1] ?? description.split(',')[0]).trim();
    sessions.push({ state: state.toLowerCase(), title });
  }
  return sessions;
}

/** Chrome's top media session (the card the phone shows); null when it has none. */
export function mediaSession(): { state: string; title: string } | null {
  return chromeSessions()[0] ?? null;
}
