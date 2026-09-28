import { useState, useEffect } from "react";

export function useNow(intervalMs: number = 30000): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    let timerId: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      setNow(new Date());
    };

    const startTimer = () => {
      if (timerId === null) {
        timerId = setInterval(tick, intervalMs);
      }
    };

    const stopTimer = () => {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    const handleVisibilityOrFocus = () => {
      if (typeof document !== "undefined" && document.hidden) {
        stopTimer();
      } else {
        // Tab is visible or window gained focus: set the clock to real time immediately
        tick();
        stopTimer();
        startTimer();
      }
    };

    if (typeof document === "undefined" || !document.hidden) {
      startTimer();
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleVisibilityOrFocus);
    }

    return () => {
      stopTimer();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleVisibilityOrFocus);
      }
    };
  }, [intervalMs]);

  return now;
}
