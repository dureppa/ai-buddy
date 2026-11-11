import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { events, people, resources, services, stages, tasks, type Event, type Person, type ProfileId, type Resource, type Service, type Task, profiles } from './data';
import { progressFor, serviceStatus, type Workspace } from './demo';
import { Avatar, Buddy, EmptyState, Icon, type IconName } from './ui';

export type Detail =
  | { kind: 'task'; item: Task }
  | { kind: 'person'; item: Person }
  | { kind: 'service'; item: Service }
  | { kind: 'resource'; item: Resource }
  | { kind: 'event'; item: Event }
  | { kind: 'settings' }
  | { kind: 'survey' };
export type OpenDetail = (detail: Detail) => void;
export type Profile = typeof profiles[ProfileId];

const accessLabels = {
  available: 'Доступ предоставлен',
  requestable: 'Требуется запрос',
  submitted: 'Ожидает подтверждения',
  setup: 'Не настроено',
} as const;

type ChecklistProps = {
  workspace: Workspace;
  onOpen: OpenDetail;
  onToggle: (id: string) => void;
  savingTask?: string;
};

function TaskRow({ task, checked, saving, next, onOpen, onToggle }: {
  task: Task;
  checked: boolean;
  saving: boolean;
  next?: boolean;
  onOpen: OpenDetail;
  onToggle: (id: string) => void;
}) {
  return (
    <li className={'task-row' + (checked ? ' task-row--done' : '')}>
      <button type="button" role="checkbox" aria-checked={checked} aria-label={task.title} className="task-check" disabled={saving} onClick={() => onToggle(task.id)}>
        <Icon name="check" size={15} />
      </button>
      <button type="button" className="task-link" onClick={() => onOpen({ kind: 'task', item: task })}>
        <span className={'icon-tile tone-' + task.tone}><Icon name={task.icon} size={19} /></span>
        <span className="task-text"><strong>{task.title}</strong><small>{task.summary}</small></span>
        <span className={'task-time' + (checked ? ' is-done' : '')}>{checked ? 'Выполнено' : next ? 'В процессе' : task.due}</span>
        <Icon name="chevron" size={16} />
      </button>
    </li>
  );
}

function Progress({ workspace }: { workspace: Workspace }) {
  const progress = progressFor(workspace);
  return (
    <section className="progress-card" aria-label="Прогресс адаптации">
      <header><span className="icon-tile"><Icon name="flag" size={20} /></span><h2>Твой прогресс</h2></header>
      <div className="progress-number"><strong>{progress.percent}<span>%</span></strong><span className="progress-mark" aria-hidden="true">↗</span></div>
      <div className="progress-track" role="progressbar" aria-label="Прогресс адаптации" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: progress.percent + '%' }} /></div>
      <div className="progress-caption"><span><strong>{progress.completed}</strong> выполнено</span><span><strong>{progress.remaining}</strong> осталось</span></div>
    </section>
  );
}

function SectionTitle({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="section-title"><h2>{title}</h2>{children}</div>;
}

const quickActions = [
  { title: 'Спросить Buddy', detail: 'Подскажу, с чего начать', icon: 'message', to: '/chat', tone: 'lilac' },
  { title: 'Мой план адаптации', detail: 'Этапы, задачи и прогресс', icon: 'map', to: '/onboarding', tone: 'mint' },
  { title: 'Познакомиться с командой', detail: 'Твои коллеги и наставник', icon: 'users', to: '/team', tone: 'blue' },
  { title: 'Рабочие инструменты', detail: 'Сервисы и заявки', icon: 'key', to: '/tools', tone: 'pink' },
] as const;

export function Dashboard({ profile, workspace, onOpen, onToggle, savingTask }: ChecklistProps & { profile: Profile }) {
  const todaysTasks = tasks.filter((task) => task.today);
  const allDone = progressFor(workspace).remaining === 0;
  return (
    <>
      <div className="page-title">
        <h1>Главная</h1>
        <span className="date-label"><Icon name="calendar" size={17} /> Понедельник, 16 ноября</span>
      </div>
      <div className="dashboard-grid">
        <section className="hero">
          <div className="hero__copy">
            <span className="hero__badge"><span /> День {profile.day} · {profile.team}</span>
            <h2>Привет, {profile.name}!</h2>
            <p>{allDone ? 'Ты прошёл все шаги адаптации. Поздравляю!' : 'Добро пожаловать в команду. Давай разберёмся, с чего начать сегодня.'}</p>
            <Link className="button button--dark hero__button" to="/onboarding">Мой план адаптации <Icon name="diagonal" size={18} /></Link>
          </div>
          <div className="hero__art">
            <span className="hero__orbit hero__orbit--one" />
            <span className="hero__orbit hero__orbit--two" />
            <span className="hero__spark hero__spark--one">✦</span>
            <span className="hero__spark hero__spark--two">✧</span>
            <span className="hero__speech">{allDone ? 'Отличная работа!' : 'Я рядом!'}</span>
            <Buddy mood={allDone ? 'celebrating' : 'happy'} />
          </div>
        </section>
        <Progress workspace={workspace} />
        <section className="panel tasks-panel">
          <SectionTitle title="Задачи на сегодня"><Link className="text-link" to="/onboarding">Весь план <Icon name="arrow" size={17} /></Link></SectionTitle>
          <ul className="task-list">
            {todaysTasks.map((task) => <TaskRow key={task.id} task={task} checked={workspace.completed.includes(task.id)} saving={savingTask === task.id} onOpen={onOpen} onToggle={onToggle} />)}
          </ul>
        </section>
        <section className="panel events-panel">
          <SectionTitle title="Ближайшие события"><Icon name="calendar" size={19} /></SectionTitle>
          <ul className="event-list">
            {events.map((event) => (
              <li key={event.title}>
                <button type="button" className="event-row" onClick={() => onOpen({ kind: 'event', item: event })}>
                  <span className={'event-date tone-' + event.tone}><strong>{event.day}</strong><small>{event.month}</small></span>
                  <span><strong>{event.title}</strong><small>{event.detail}</small></span>
                  <Icon name="chevron" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="quick-section">
        <SectionTitle title="Быстрые действия" />
        <div className="quick-grid">
          {quickActions.map((action) => (
            <Link key={action.to} to={action.to} className={'quick-card tone-' + action.tone}>
              <span className="quick-card__icons"><Icon name={action.icon} size={23} /><Icon name="diagonal" size={17} /></span>
              <strong>{action.title}</strong><span>{action.detail}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

function PageIntro({ title, text, tone, icon }: { title: string; text: string; tone: string; icon: IconName }) {
  return (
    <header className={'page-intro tone-' + tone}>
      <div><h1>{title}</h1><p>{text}</p></div>
      <span className="page-intro__icon"><Icon name={icon} size={44} /></span>
    </header>
  );
}

export function Adaptation({ workspace, onOpen, onToggle, savingTask }: ChecklistProps) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');
  const next = tasks.find((task) => !workspace.completed.includes(task.id))?.id;
  const visible = tasks.filter((task) => filter === 'all' || workspace.completed.includes(task.id) === (filter === 'done'));
  return (
    <>
      <PageIntro title="Моя адаптация" text="План первых недель и ближайшие шаги." tone="mint" icon="map" />
      <div className="adaptation-layout">
        <section>
          <div className="filter-row" aria-label="Фильтр задач">
            <button type="button" className="filter" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Все задачи</button>
            <button type="button" className="filter" aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>Осталось</button>
            <button type="button" className="filter" aria-pressed={filter === 'done'} onClick={() => setFilter('done')}>Выполнено</button>
          </div>
          {visible.length === 0 && <EmptyState title="В этом списке пока пусто" text="Выбери другой фильтр, чтобы увидеть задачи." />}
          <ol className="stage-list">
            {stages.map((stage) => {
              const stageTasks = visible.filter((task) => task.stage === stage.id);
              if (!stageTasks.length) return null;
              const total = tasks.filter((task) => task.stage === stage.id);
              const done = total.filter((task) => workspace.completed.includes(task.id)).length;
              return (
                <li key={stage.id} className="panel stage">
                  <div className={'stage__header tone-' + stage.tone}>
                    <span className="icon-tile"><Icon name="flag" size={18} /></span>
                    <div><h2>{stage.name}</h2><small>{stage.dates}</small></div>
                    <span className="pill">{done} / {total.length}</span>
                  </div>
                  <ul className="task-list">
                    {stageTasks.map((task) => <TaskRow key={task.id} task={task} checked={workspace.completed.includes(task.id)} next={next === task.id} saving={savingTask === task.id} onOpen={onOpen} onToggle={onToggle} />)}
                  </ul>
                </li>
              );
            })}
          </ol>
        </section>
        <aside><Progress workspace={workspace} /><div className="aside-note"><Buddy mood={next ? 'supportive' : 'celebrating'} compact /><p>{next ? 'Если шаг непонятен, я помогу разобраться.' : 'Все задачи выполнены. Ты отлично справился!'}</p><Link to="/chat" className="text-link">Открыть чат <Icon name="arrow" size={17} /></Link></div></aside>
      </div>
    </>
  );
}

export function Team({ onOpen }: { onOpen: OpenDetail }) {
  return (
    <>
      <PageIntro title="Моя команда" text="Познакомься с теми, кто поможет тебе освоиться в дизайне продукта." tone="lilac" icon="users" />
      <SectionTitle title="Твои первые контакты" />
      <div className="people-grid people-grid--featured">
        {people.slice(0, 2).map((person) => (
          <article className={'person-card tone-' + person.tone} key={person.id}>
            <Avatar initials={person.initials} tone="paper" />
            <div><span className="person-label">{person.group}</span><h3>{person.name}</h3><p>{person.role}</p></div>
            <p className="person-bio">{person.bio}</p>
            <button type="button" className="button button--white" onClick={() => onOpen({ kind: 'person', item: person })}>Открыть профиль <Icon name="diagonal" size={16} /></button>
          </article>
        ))}
      </div>
      <SectionTitle title="Коллеги по команде" />
      <div className="people-grid">
        {people.slice(2).map((person) => (
          <article className="panel person-card" key={person.id}>
            <Avatar initials={person.initials} tone={person.tone} />
            <div><h3>{person.name}</h3><p>{person.role}</p></div>
            <p className="person-bio">{person.bio}</p>
            <button type="button" className="text-link" onClick={() => onOpen({ kind: 'person', item: person })}>Профиль <Icon name="arrow" size={16} /></button>
          </article>
        ))}
      </div>
    </>
  );
}

export function AccessBadge({ status }: { status: keyof typeof accessLabels }) {
  return <span className={'status status--' + status}><span />{accessLabels[status]}</span>;
}

export function Tools({ workspace, onOpen }: { workspace: Workspace; onOpen: OpenDetail }) {
  const [filter, setFilter] = useState<'all' | keyof typeof accessLabels>('all');
  const visible = services.filter((service) => filter === 'all' || serviceStatus(workspace, service) === filter);
  return (
    <>
      <PageIntro title="Инструменты и доступы" text="Рабочие сервисы, инструкции и статусы твоих заявок." tone="blue" icon="key" />
      <div className="filter-row" aria-label="Фильтр доступов">
        <button type="button" className="filter" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Все сервисы</button>
        <button type="button" className="filter" aria-pressed={filter === 'available'} onClick={() => setFilter('available')}>Есть доступ</button>
        <button type="button" className="filter" aria-pressed={filter === 'requestable'} onClick={() => setFilter('requestable')}>Нужен запрос</button>
        <button type="button" className="filter" aria-pressed={filter === 'submitted'} onClick={() => setFilter('submitted')}>Ожидают подтверждения</button>
      </div>
      <div className="tile-grid">
        {visible.map((service) => (
          <button type="button" className="panel service-card" key={service.id} onClick={() => onOpen({ kind: 'service', item: service })}>
            <span className="tile-top"><span className={'service-symbol tone-' + service.tone}>{service.symbol}</span><Icon name="diagonal" size={19} /></span>
            <span className="tile-category">{service.category}</span>
            <strong>{service.title}</strong>
            <span className="tile-description">{service.description}</span>
            <AccessBadge status={serviceStatus(workspace, service)} />
          </button>
        ))}
      </div>
      {!visible.length && <EmptyState title="В этом списке пока пусто" text="Заявка появится здесь после подтверждения в чате Buddy." />}
      {workspace.requests.length > 0 && (
        <section className="panel requests-panel">
          <SectionTitle title="Мои заявки" />
          {workspace.requests.map((request) => <div className="request-row" key={request.id}><span>{services.find((service) => service.id === request.serviceId)?.title || request.serviceId}</span><strong>{request.number}</strong><AccessBadge status={request.status} /></div>)}
        </section>
      )}
    </>
  );
}

export function Resources({ onOpen }: { onOpen: OpenDetail }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Все');
  const categories = ['Все', ...new Set(resources.map((resource) => resource.category))];
  const visible = resources.filter((resource) =>
    (category === 'Все' || resource.category === category) &&
    (resource.title + ' ' + resource.summary).toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <PageIntro title="Корпоративные сервисы" text="Памятки, обучение и контакты, которые пригодятся в первые недели." tone="pink" icon="layers" />
      <label className="search-field resource-search"><Icon name="search" size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти документ или инструкцию" /></label>
      <div className="filter-row" aria-label="Категория материалов">
        {categories.map((item) => <button type="button" className="filter" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      <div className="tile-grid">
        {visible.map((resource) => (
          <button type="button" className={'resource-card tone-' + resource.tone} key={resource.id} onClick={() => onOpen({ kind: 'resource', item: resource })}>
            <span className="tile-top"><span className="icon-tile"><Icon name={resource.icon} size={23} /></span><Icon name="diagonal" size={19} /></span>
            <strong>{resource.title}</strong><span className="tile-description">{resource.summary}</span>
          </button>
        ))}
      </div>
      {!visible.length && <EmptyState title="Материалы не найдены" text="Измени поисковый запрос или выбери другую категорию." />}
    </>
  );
}
