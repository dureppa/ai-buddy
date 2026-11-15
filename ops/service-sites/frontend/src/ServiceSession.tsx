import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { isProfileId, profiles, type ProfileId } from '../../../../web/frontend/src/demo-accounts';
import { readServiceProfile, readServiceProfileQuery } from '../../../../web/frontend/src/service-session';

function subscribe(onChange: () => void) {
  window.addEventListener('focus', onChange);
  const timer = window.setInterval(onChange, 1000);
  return () => {
    window.removeEventListener('focus', onChange);
    window.clearInterval(timer);
  };
}

export function ServiceSession({
  children,
  standaloneTitle,
}: {
  children: (profile: ProfileId) => ReactNode;
  standaloneTitle?: string;
}) {
  const [selected, setSelected] = useState<ProfileId>();
  const buddyProfile = useSyncExternalStore(
    subscribe,
    () => readServiceProfile(document.cookie),
    () => null,
  );
  const linkedProfile = typeof window === 'undefined' ? null : readServiceProfileQuery(window.location.search);
  const profile = buddyProfile ?? linkedProfile ?? selected;
  if (!profile && standaloneTitle) {
    return (
      <main className="hr-page">
        <section className="panel hr-panel">
          <h1>{standaloneTitle}</h1>
          {Object.keys(profiles)
            .filter(isProfileId)
            .map((id) => (
              <button key={id} type="button" onClick={() => setSelected(id)}>
                {profiles[id].fullName}
              </button>
            ))}
        </section>
      </main>
    );
  }
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
