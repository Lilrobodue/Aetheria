import { adb, assertUnlocked, DEVICE, TEST_PORT } from './tests/adb';

// Global setup for runs on the Android device (E2E_DEVICE set; see
// tests/adb.ts): wake it, make sure Chrome runs, reverse the test server's
// port, forward Chrome's DevTools socket, and turn the media volume down while
// the tests play their tones. The returned function puts it all back. It never
// closes the user's tabs or touches any origin but the tests' own.
export default async function deviceSetup() {
  if (!DEVICE) return;
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  assertUnlocked();
  adb('shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main');
  for (let i = 0; i < 20 && !adb('shell', 'cat', '/proc/net/unix').includes('@chrome_devtools_remote'); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  adb('reverse', `tcp:${TEST_PORT}`, `tcp:${TEST_PORT}`);
  adb('forward', 'tcp:9222', 'localabstract:chrome_devtools_remote');

  const volume = /volume is (\d+)/.exec(adb('shell', 'cmd', 'media_session', 'volume', '--stream', '3', '--get'))?.[1];
  adb('shell', 'cmd', 'media_session', 'volume', '--stream', '3', '--set', '2');
  // Keep the screen on while plugged in, so a screen timeout can't lock the
  // phone in the middle of the run.
  const stayOn = adb('shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in').trim();
  adb('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', '3');

  return async () => {
    if (volume) adb('shell', 'cmd', 'media_session', 'volume', '--stream', '3', '--set', volume);
    adb('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', stayOn);
    adb('reverse', '--remove', `tcp:${TEST_PORT}`);
    adb('forward', '--remove', 'tcp:9222');
  };
}
