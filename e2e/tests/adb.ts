import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * The phone's Chrome media session as Android reports it — what the lock
 * screen, the notification and the car show. null when Chrome has none.
 */
export function mediaSession(): { state: string; title: string } | null {
  const out = adb('shell', 'dumpsys', 'media_session');
  const at = out.indexOf('package=com.android.chrome');
  if (at < 0) return null;
  const block = out.slice(at, at + 3000);
  const state = /state=PlaybackState \{state=([A-Z_]+)\(\d+\)/.exec(block)?.[1] ?? '';
  const title = /metadata: size=\d+, description=([^,\n]*)/.exec(block)?.[1]?.trim() ?? '';
  return { state: state.toLowerCase(), title };
}
