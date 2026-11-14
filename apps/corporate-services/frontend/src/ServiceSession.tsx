import { useSyncExternalStore, type ReactNode } from 'react';
import type { ProfileId } from '../../../web/frontend/src/data';
import { readServiceProfile } from '../../../web/frontend/src/service-session';

function subscribe(onChange: () => void) {
  window.addEventListener('focus', onChange);
  const timer = window.setInterval(onChange, 1000);
  return () => {
    window.removeEventListener('focus', onChange);
    window.clearInterval(timer);
  };
}

export function ServiceSession({ children }: { children: (profile: ProfileId) => ReactNode }) {
  const profile = useSyncExternalStore(
    subscribe,
    () => readServiceProfile(document.cookie),
    () => null,
  );
  if (!profile)
    return (
      <main className="hr-page">
        <section className="panel hr-panel">
          <h1>Войди в AI Buddy</h1>
          <p>Открой сервис из своего рабочего пространства после входа в AI Buddy.</p>
        </section>
      </main>
    );
  return <div key={profile}>{children(profile)}</div>;
}
