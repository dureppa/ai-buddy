import { Link } from 'react-router-dom';
import { products, profiles, staffAccounts, type ProfileId } from './demo-accounts';
import { productGuides } from './product-guide-data';
import { Avatar, Icon } from './ui';
import './product-guide.css';

const directions = ['Товары', 'Авто', 'Недвижимость', 'Работа', 'Услуги'];
const facts = [
  { number: '246+ млн', label: 'активных объявлений' },
  { number: '51+ млн', label: 'пользователей в месяц' },
  { number: '11+', label: 'сделок в секунду' },
];

export function ProductGuide({ profileId }: { profileId: ProfileId }) {
  const profile = profiles[profileId];
  const product = products[profile.productId];
  const guide = productGuides[profile.productId];
  const mentor = staffAccounts[product.mentor];

  return (
    <article className={'product-guide tone-' + product.tone}>
      <Link to="/home" className="text-link guide-back">
        <Icon name="arrow" size={17} /> На главную
      </Link>

      <header className="guide-hero">
        <div className="guide-hero-copy">
          <h1>{product.name}</h1>
          <p>{guide.overview}</p>
        </div>
        <div className="guide-art" aria-hidden="true">
          <span className="guide-art-symbol">
            <Icon name={guide.icon} size={64} />
          </span>
          <span className="guide-art-spark">
            <Icon name="sparkles" size={25} />
          </span>
        </div>
        <div className="guide-team-strip">
          <div>
            <span>Твоя демокоманда</span>
            <strong>{product.team}</strong>
          </div>
          <div>
            <span>Твоя роль</span>
            <strong>{profile.position}</strong>
          </div>
          <Link to="/team" className="text-link">
            Моя команда <Icon name="arrow" size={17} />
          </Link>
        </div>
      </header>

      <section className="guide-team" aria-labelledby="guide-team">
        <h2 id="guide-team">Чем занимается команда</h2>
        <div className="guide-work">
          {guide.work.map((item) => (
            <div className="guide-card" key={item.title}>
              <span className="guide-icon">
                <Icon name={item.icon} size={21} />
              </span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
        <div className="guide-practice">
          <section className="guide-card guide-example">
            <h3>Пример задачи в демо</h3>
            <p>{guide.example}</p>
          </section>
          <section className="guide-card">
            <h3>С чего начать</h3>
            <p>{product.firstStep}</p>
            <Link to={'/team?person=' + product.mentor} className="guide-mentor">
              <Avatar initials={mentor.initials} avatar={mentor.avatar} tone={mentor.tone} />
              <span>
                <strong>{mentor.name}</strong>
                <small>Твой наставник</small>
              </span>
              <Icon name="arrow" size={17} />
            </Link>
          </section>
        </div>
      </section>

      <section className="guide-company" aria-labelledby="guide-company">
        <div>
          <h2 id="guide-company">Об Авито</h2>
          <p>Платформа объявлений, которая помогает людям находить нужное и улучшать жизнь вокруг.</p>
          <ul className="guide-directions" aria-label="Направления платформы">
            {directions.map((direction) => (
              <li key={direction}>{direction}</li>
            ))}
          </ul>
        </div>
        <dl className="guide-facts" aria-label="Авито в цифрах">
          {facts.map(({ number, label }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{number}</dd>
            </div>
          ))}
        </dl>
        <div className="guide-career">
          <span className="guide-icon">
            <Icon name="book" size={21} />
          </span>
          <div>
            <h3>Стажировка в Авито</h3>
            <p>Реальные задачи, наставник с первого дня, сообщество стажёров и доступ к библиотекам и базам знаний.</p>
          </div>
        </div>
        <p className="guide-source">
          Кейс Hack&amp;Change «AI-buddy», слайды 16–18. Данные об аудитории за сентябрь 2026 года.
        </p>
      </section>
    </article>
  );
}
