import { useEffect, useRef, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms of
 * quiet. Used to keep slider-driven spread recomputation off the drag path so
 * dragging stays smooth while the map/stats settle a beat later.
 */
export function useDebounce<T>(value: T, delay = 180): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    timer.current = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer.current);
  }, [value, delay]);

  return debounced;
}
