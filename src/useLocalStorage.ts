import { useCallback, useEffect, useRef, useState } from 'react';
import z, { ZodType } from 'zod';
import deepEqual from './deep-equal';

const load = <S extends ZodType>(key: string, schema: S) => {
  const value = localStorage.getItem(key);
  if (value == null) return undefined;

  const parsed = schema.safeParse(JSON.parse(value));
  if (!parsed.success) {
    console.warn(`Failed to load ${key} from storage: Validation failed: ${parsed.error}`);
    return undefined;
  }
  console.debug(`Loaded ${key}`);
  return parsed.data;
};

const save = <S extends ZodType>(key: string, schema: S, value: z.infer<S>) => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    // Keep the last good value in storage rather than wiping it (and the session history with it)
    console.warn(`Failed to save ${key} to storage: Validation failed: ${parsed.error}`);
    return false;
  }

  try {
    localStorage.setItem(key, JSON.stringify(parsed.data));
    console.debug(`Saved ${key}`);
  } catch (e) {
    console.warn(`Failed to save ${key} to storage: ${e}`);
  }
  return true;
};

export const useLocalStorage = <S extends ZodType>(key: string, schema: S, initial: z.infer<S>) => {
  const [state, setState] = useState<Readonly<z.infer<S>>>(() => {
    try {
      return load(key, schema) ?? initial;
    } catch (e) {
      console.warn(`Failed to get state: ${e}`);
      return initial;
    }
  });

  // `initial` is often an inline literal; keep it in a ref so the listener isn't re-bound every render
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      let value: z.infer<S>;
      try {
        value = load(key, schema) ?? initialRef.current;
      } catch (err) {
        console.warn(`Failed to sync ${key} from storage: ${err}`);
        return;
      }
      setState((curr) => (deepEqual(curr, value) ? curr : value));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [key, schema]);

  const saveState = useCallback(
    (value: z.infer<S>) => {
      // Don't adopt values that fail validation (e.g. NaN durations)
      if (save(key, schema, value)) setState(value);
    },
    [key, schema],
  );

  return [state, saveState] as const;
};
