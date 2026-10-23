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

        // Soft chime synthesized via the Web Audio API — no asset to 404 on
        // (/notification.mp3 never existed), and it needs no network request.
        try {
          const AudioCtx =
            window.AudioContext || (window as any).webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.setValueAtTime(1175, ctx.currentTime + 0.12);
            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.42);
          }
        } catch {
          // Autoplay policy / unsupported — a chime is optional, ignore.
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
