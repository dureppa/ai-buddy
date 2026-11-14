import { corporateLinks } from './corporate-links';
import { Icon } from './ui';

export function CorporateDirectory() {
  return (
    <section className="corporate-directory" aria-labelledby="corporate-directory-title">
      <div className="section-title">
        <h2 id="corporate-directory-title">HR-сервисы</h2>
      </div>
      <div className="tile-grid">
        {corporateLinks.map((service) => (
          <a className={'resource-card tone-' + service.tone} key={service.id} href={service.url}>
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
