import { corporateLinks } from './corporate-links';
import type { ProfileId } from './data';
import { Icon } from './ui';

export function CorporateDirectory({ profileId }: { profileId?: ProfileId }) {
  return (
    <section className="corporate-directory" aria-label="Сервисы">
      <div className="tile-grid">
        {corporateLinks.map((service) => (
          <a
            className={'resource-card tone-' + service.tone}
            key={service.id}
            href={service.id === 'jira' && profileId ? jiraProfileUrl(service.url, profileId) : service.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="tile-top">
              <span className="icon-tile">
                <Icon name={service.icon} size={23} />
              </span>
              <Icon name="diagonal" size={19} />
            </span>
            <strong>{service.title}</strong>
            <span className="tile-description">{service.description}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

export function jiraProfileUrl(base: string, profile: ProfileId) {
  const url = new URL(base);
  url.searchParams.set('profile', profile);
  return url.toString();
}
