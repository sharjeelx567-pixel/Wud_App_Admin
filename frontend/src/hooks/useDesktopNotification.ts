import { useEffect, useRef } from 'react';

export function useDesktopNotification(count: number, title: string = 'New Notification', message: string = 'You have a new update.') {
  const prevCountRef = useRef(count);

  useEffect(() => {
    // SSR guard + feature detection. NOTE: on some mobile browsers (e.g.
    // Android Chrome) `Notification` EXISTS in window, so this check passes,
    // but `new Notification()` still THROWS "Illegal constructor" because the
    // platform requires ServiceWorkerRegistration.showNotification() instead.
    // Desktop notifications are a nice-to-have, so the whole block is wrapped
    // in try/catch — previously an unhandled throw here crashed the entire
    // admin app with a client-side exception, but only on mobile.
    if (typeof window === 'undefined' || !('Notification' in window)) {
      prevCountRef.current = count;
      return;
    }

    try {
      if (Notification.permission === 'default') {
        const req = Notification.requestPermission();
        // Modern browsers return a Promise; older ones use a callback and
        // return undefined — guard before calling .catch.
        if (req && typeof (req as Promise<unknown>).catch === 'function') {
          (req as Promise<unknown>).catch(() => {});
        }
      }

      if (count > prevCountRef.current && Notification.permission === 'granted') {
        const notification = new Notification(title, {
          body: message,
          icon: '/favicon.ico',
        });

        try {
          const audio = new Audio('/notification.mp3');
          audio.play().catch(() => {});
        } catch {
          // Ignore audio errors
        }

        setTimeout(() => notification.close(), 5000);
      }
    } catch {
      // Mobile browsers reject `new Notification()` / requestPermission — never
      // let that crash the app.
    }

    prevCountRef.current = count;
  }, [count, title, message]);
}
