import { useEffect, useState } from 'react';
import { meOnce, type Me } from './api.ts';

// The signed-in person and how this install signs people in (asked once per page load).
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { let live = true; meOnce().then((m) => live && setMe(m)); return () => { live = false; }; }, []);
  return me;
}
// AUTH=local: one person, no sign-in; nothing to share with or manage.
export const useLocalMode = () => !!useMe()?.auth.modes.includes('local');
