import { useEffect } from 'react';
import { useVisibility } from './useVisibility';

type WakeLockParams = {
  enable: boolean;
};

/**
 * Hook to acquire a screen wake lock.
 *
 * @param enable - Whether to enable (or release) the wake lock.
 */
export const useWakeLock = ({ enable }: WakeLockParams) => {
  const isVisible = useVisibility();
  const _enable = enable && isVisible;

  useEffect(() => {
    // navigator.wakeLock is undefined in insecure contexts (e.g. the dev server
    // over a LAN IP) and in older browsers; calling it would crash the app.
    if (!_enable || !('wakeLock' in navigator)) return;

    const promise = navigator.wakeLock.request('screen').then((sentinel) => {
      console.debug('Screen wake lock acquired');
      return sentinel;
    });
    promise.catch((e) => console.warn(`Failed to acquire wake lock: ${e}`));

    return () => {
      // Only release the lock that was acquired above, not any others that were
      // acquired in the meantime.
      promise
        .then((sentinel) => sentinel.release())
        .then(() => console.debug('Screen wake lock released'))
        .catch((e) => console.warn(`Failed to release wake lock: ${e}`));
    };
  }, [_enable]);
};
