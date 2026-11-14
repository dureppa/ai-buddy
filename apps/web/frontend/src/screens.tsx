import { HrDayEvents } from './HrDayEvents';
import type { HrToday } from './hr-schedule';
import { eventDay, eventMonth, eventTime, upcomingEvents, type ScheduleEvent } from './schedule';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { services, stages, type Person, type ProfileId, type Service, type Task, profiles } from './data';
import { homeTasks, tasksFor } from './checklist';
import { products, teamColleagues, teamContacts } from './demo-accounts';
import { buddyGrowthStage, progressFor, serviceStatus, type BuddyGrowthStage, type Workspace } from './demo';
import { Avatar, Buddy, EmptyState, Icon, PageIntro } from './ui';
import { jiraService, jiraProfileUrl } from './tool-links';
import { InternMaterials } from './StaffWorkspace';

export type Detail =
  | { kind: 'task'; item: Task }
  | { kind: 'person'; item: Person }
  | { kind: 'service'; item: Service }
  | { kind: 'event'; item: Pick<ScheduleEvent, 'title' | 'description'> & { detail: string } }
  | { kind: 'settings' }
  | { kind: 'survey' };
export type OpenDetail = (detail: Detail) => void;

const accessLabels = {
  available: 'Доступ предоставлен',
  requestable: 'Требуется запрос',
  submitted: 'Ожидает подтверждения',
  setup: 'Не настроено',
} as const;

type ChecklistProps = {
  profileId: ProfileId;
  workspace: Workspace;
  onOpen: OpenDetail;
  onToggle: (id: string) => void;
  savingTask?: string;
};

function TaskRow({
  task,
  checked,
  saving,
  next,
  onOpen,
  onToggle,
}: {
  task: Task;
  checked: boolean;
  saving: boolean;
  next?: boolean;
  onOpen: OpenDetail;
  onToggle: (id: string) => void;
}) {
  return (
    <li className={'task-row' + (checked ? ' task-row--done' : '')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={task.title}
        className="task-check"
        disabled={saving}
        onClick={() => onToggle(task.id)}
      >
        <Icon name="check" size={15} />
      </button>
      <button type="button" className="task-link" onClick={() => onOpen({ kind: 'task', item: task })}>
        <span className={'icon-tile tone-' + task.tone}>
          <Icon name={task.icon} size={19} />
        </span>
        <span className="task-text">
          <strong>{task.title}</strong>
          <small>{task.summary}</small>
        </span>
        <span className={'task-time' + (checked ? ' is-done' : '')}>
          {checked ? 'Выполнено' : next ? 'В процессе' : task.due}
        </span>
        <Icon name="chevron" size={16} />
      </button>
    </li>
  );
}

function Progress({ workspace }: { workspace: Workspace }) {
  const progress = progressFor(workspace);
  return (
    <section className="progress-card" aria-label="Прогресс адаптации">
      <header>
        <span className="icon-tile">
          <Icon name="flag" size={20} />
        </span>
        <h2>Твой прогресс</h2>
      </header>
      <div className="progress-number">
        <strong>
          {progress.percent}
          <span>%</span>
        </strong>
        <span className="progress-mark" aria-hidden="true">
          ↗
        </span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Прогресс адаптации"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: progress.percent + '%' }} />
      </div>
      <div className="progress-caption">
        <span>
          <strong>{progress.completed}</strong> выполнено
        </span>
        <span>
          <strong>{progress.remaining}</strong> осталось
        </span>
      </div>
    </section>
  );
}

function SectionTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

const quickActions = [
  { title: 'Спросить Buddy', detail: 'Подскажу, с чего начать', icon: 'message', to: '/chat', tone: 'lilac' },
  { title: 'Мой план адаптации', detail: 'Этапы, задачи и прогресс', icon: 'map', to: '/onboarding', tone: 'mint' },
  { title: 'Познакомиться с командой', detail: 'Твои коллеги и наставник', icon: 'users', to: '/team', tone: 'blue' },
  { title: 'Рабочие инструменты', detail: 'Сервисы и заявки', icon: 'key', to: '/tools', tone: 'pink' },
] as const;

export function Dashboard({
  profileId,
  workspace,
  onOpen,
  onToggle,
  savingTask,
  events,
  hrEvents,
  hrError,
  scheduleNow,
  grownStage,
  onGrowthEnd,
}: ChecklistProps & {
  events: ScheduleEvent[];
  scheduleNow: number;
  hrEvents: HrToday['events'];
  hrError: boolean;
  grownStage: BuddyGrowthStage | null;
  onGrowthEnd: () => void;
}) {
  const profile = profiles[profileId];
  const product = products[profile.productId];
  const nextEvents = upcomingEvents(events, scheduleNow).slice(0, 3);
  const dashboardTasks = homeTasks(profileId);
  const allDone = progressFor(workspace).remaining === 0;
  const growthStage = buddyGrowthStage(profileId, workspace);
  return (
    <>
      <div className="page-title">
        <h1>Главная</h1>
        <span className="date-label">
          <Icon name="calendar" size={17} /> {profile.stage}
        </span>
      </div>
      <div className="dashboard-grid">
        <section className="hero">
          <div className="hero__copy">
            <span className="hero__badge">
              <span /> День {profile.day} · {product.name} · {product.team}
            </span>
            <h2>Привет, {profile.name}!</h2>
            <p>Стажёр · {profile.position}</p>
            <p>{allDone ? 'Все шаги адаптации пройдены. Поздравляю!' : profile.stageDescription + '.'}</p>
            <div className="hero__actions">
              <Link className="button button--dark hero__button" to="/onboarding">
                Мой план адаптации <Icon name="diagonal" size={18} />
              </Link>
              <Link className="button button--white hero__button" to="/product-guide">
                Путеводитель по продукту <Icon name="arrow" size={16} />
              </Link>
            </div>
          </div>
          <div className="hero__art">
            <span className="hero__orbit hero__orbit--one" />
            <span className="hero__orbit hero__orbit--two" />
            <span className="hero__spark hero__spark--one">✦</span>
            <span className="hero__spark hero__spark--two">✧</span>
            <span className="hero__speech">{allDone ? 'Отличная работа!' : 'Я рядом!'}</span>
            <Buddy
              mood={allDone ? 'celebrating' : 'happy'}
              growthStage={growthStage}
              onGrowthEnd={grownStage === growthStage ? onGrowthEnd : undefined}
            />
          </div>
        </section>
        <Progress workspace={workspace} />
        <section className="panel tasks-panel">
          <SectionTitle title={profile.stageId === 'first' ? 'Задачи на сегодня' : 'Итоги адаптации'}>
            <Link className="text-link" to="/onboarding">
              Весь план <Icon name="arrow" size={17} />
            </Link>
          </SectionTitle>
          <ul className="task-list">
            {dashboardTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                checked={workspace.completed.includes(task.id)}
                saving={savingTask === task.id}
                onOpen={onOpen}
                onToggle={onToggle}
              />
            ))}
          </ul>
        </section>
        <section className="panel events-panel">
          <SectionTitle title="Ближайшие события">
            <Link className="text-link" to="/events" aria-label="Открыть расписание">
              <Icon name="calendar" size={19} />
            </Link>
          </SectionTitle>
          <HrDayEvents events={hrEvents} error={hrError} />
          {!nextEvents.length && !hrEvents.length && !hrError && <p>Ближайших событий нет.</p>}
          <ul className="event-list">
            {nextEvents.map((event) => {
              const date = new Date(event.startsAt);
              const detail = eventDay.format(date) + ' · ' + eventTime.format(date);
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    className="event-row"
                    onClick={() => onOpen({ kind: 'event', item: { ...event, detail } })}
                  >
                    <span className={'event-date tone-' + event.tone}>
                      <strong>{date.getDate()}</strong>
                      <small>{eventMonth.format(date).replace('.', '')}</small>
                    </span>
                    <span>
                      <strong>{event.title}</strong>
                      <small>{detail}</small>
                    </span>
                    <Icon name="chevron" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <section className="quick-section">
        <SectionTitle title="Быстрые действия" />
        <div className="quick-grid">
          {quickActions.map((action) => (
            <Link key={action.to} to={action.to} className={'quick-card tone-' + action.tone}>
              <span className="quick-card__icons">
                <Icon name={action.icon} size={23} />
                <Icon name="diagonal" size={17} />
              </span>
              <strong>{action.title}</strong>
              <span>{action.detail}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

export function Adaptation({ profileId, workspace, onOpen, onToggle, savingTask }: ChecklistProps) {
  const tasks = tasksFor(profileId);
  const [tab, setTab] = useState<'tasks' | 'materials'>('tasks');
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');
  const next = tasks.find((task) => !workspace.completed.includes(task.id))?.id;
  const visible = tasks.filter(
    (task) => filter === 'all' || workspace.completed.includes(task.id) === (filter === 'done'),
  );
  return (
    <>
      <PageIntro
        title="Моя адаптация"
        text="Чек-лист стажировки: от первой недели до выпуска."
        tone="mint"
        icon="map"
      />
      <div className="filter-row adaptation-tabs" role="tablist" aria-label="Разделы адаптации">
        <button
          type="button"
          className="filter"
          role="tab"
          aria-selected={tab === 'tasks'}
          onClick={() => setTab('tasks')}
        >
          Задачи
        </button>
        <button
          type="button"
          className="filter"
          role="tab"
          aria-selected={tab === 'materials'}
          onClick={() => setTab('materials')}
        >
          Материалы
        </button>
      </div>
      {tab === 'materials' ? (
        <InternMaterials />
      ) : (
        <div className="adaptation-layout">
          <section>
            <div className="filter-row" aria-label="Фильтр задач">
              <button type="button" className="filter" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                Все задачи
              </button>
              <button
                type="button"
                className="filter"
                aria-pressed={filter === 'pending'}
                onClick={() => setFilter('pending')}
              >
                Осталось
              </button>
              <button
                type="button"
                className="filter"
                aria-pressed={filter === 'done'}
                onClick={() => setFilter('done')}
              >
                Выполнено
              </button>
            </div>
            {visible.length === 0 && (
              <EmptyState title="В этом списке пока пусто" text="Выбери другой фильтр, чтобы увидеть задачи." />
            )}
            <ol className="stage-list">
              {stages.map((stage) => {
                const stageTasks = visible.filter((task) => task.stage === stage.id);
                if (!stageTasks.length) return null;
                const total = tasks.filter((task) => task.stage === stage.id);
                const done = total.filter((task) => workspace.completed.includes(task.id)).length;
                return (
                  <li key={stage.id} className="panel stage">
                    <div className={'stage__header tone-' + stage.tone}>
                      <span className="icon-tile">
                        <Icon name="flag" size={18} />
                      </span>
                      <div>
                        <h2>{stage.name}</h2>
                        <small>{stage.dates}</small>
                      </div>
                      <span className="pill">
                        {done} / {total.length}
                      </span>
                    </div>
                    <ul className="task-list">
                      {stageTasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          checked={workspace.completed.includes(task.id)}
                          next={next === task.id}
                          saving={savingTask === task.id}
                          onOpen={onOpen}
                          onToggle={onToggle}
                        />
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </section>
          <aside>
            <Progress workspace={workspace} />
            <div className="aside-note">
              <Buddy mood={next ? 'supportive' : 'celebrating'} compact />
              <p>
                {next ? 'Если шаг непонятен, я помогу разобраться.' : 'Все задачи выполнены. Ты отлично справился!'}
              </p>
              <Link to="/chat" className="text-link">
                Открыть чат <Icon name="arrow" size={17} />
              </Link>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function PersonCard({ person, onOpen }: { person: Person; onOpen: OpenDetail }) {
  return (
    <article className={'person-card tone-' + person.tone}>
      <Avatar initials={person.initials} tone={person.tone === 'paper' ? 'lilac' : 'paper'} avatar={person.avatar} />
      <div>
        {person.role !== 'Коллега' && <span className="person-label">{person.role}</span>}
        <h3>{person.name}</h3>
        <p>{person.position}</p>
      </div>
      <p className="person-bio">{person.bio}</p>
      <button type="button" className="button button--white" onClick={() => onOpen({ kind: 'person', item: person })}>
        Открыть профиль <Icon name="diagonal" size={16} />
      </button>
    </article>
  );
}

export function Team({ profileId, onOpen }: { profileId: ProfileId; onOpen: OpenDetail }) {
  const product = products[profiles[profileId].productId];
  return (
    <>
      <PageIntro
        title="Моя команда"
        text={product.name + ' · «' + product.team + '». ' + product.teamDescription}
        tone="lilac"
        icon="users"
      />
      <SectionTitle title="Твои первые контакты" />
      <div className="people-grid people-grid--featured">
        {teamContacts(profileId).map((person) => (
          <PersonCard key={person.id} person={person} onOpen={onOpen} />
        ))}
      </div>
      <div className="people-grid people-grid--colleagues">
        {teamColleagues(profileId).map((person) => (
          <PersonCard key={person.id} person={person} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}

export function AccessBadge({ status }: { status: keyof typeof accessLabels }) {
  return (
    <span className={'status status--' + status}>
      <span />
      {accessLabels[status]}
    </span>
  );
}

export function JiraToolCard({ profileId }: { profileId: ProfileId }) {
  return (
    <a
      className="panel service-card"
      href={jiraProfileUrl(jiraService.url, profileId)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="tile-top">
        <span className="service-symbol tone-blue">J</span>
        <Icon name="diagonal" size={19} />
      </span>
      <span className="tile-category">Задачи</span>
      <strong>Jira</strong>
      <span className="tile-description">{jiraService.description}</span>
      <span>Открыть доски</span>
    </a>
  );
}

export function Tools({
  profileId,
  workspace,
  onOpen,
}: {
  profileId: ProfileId;
  workspace: Workspace;
  onOpen: OpenDetail;
}) {
  const [filter, setFilter] = useState<'all' | keyof typeof accessLabels>('all');
  const visible = services.filter((service) =>
    service.id === 'jira' ? filter === 'all' : filter === 'all' || serviceStatus(workspace, service) === filter,
  );
  return (
    <>
      <PageIntro
        title="Инструменты и доступы"
        text="Рабочие сервисы, инструкции и статусы твоих заявок."
        tone="blue"
        icon="key"
      />
      <div className="filter-row" aria-label="Фильтр доступов">
        <button type="button" className="filter" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          Все сервисы
        </button>
        <button
          type="button"
          className="filter"
          aria-pressed={filter === 'available'}
          onClick={() => setFilter('available')}
        >
          Есть доступ
        </button>
        <button
          type="button"
          className="filter"
          aria-pressed={filter === 'requestable'}
          onClick={() => setFilter('requestable')}
        >
          Нужен запрос
        </button>
        <button
          type="button"
          className="filter"
          aria-pressed={filter === 'submitted'}
          onClick={() => setFilter('submitted')}
        >
          Ожидают подтверждения
        </button>
      </div>
      <div className="tile-grid">
        {visible.map((service) =>
          service.id === 'jira' ? (
            <JiraToolCard key={service.id} profileId={profileId} />
          ) : (
            <button
              type="button"
              className="panel service-card"
              key={service.id}
              onClick={() => onOpen({ kind: 'service', item: service })}
            >
              <span className="tile-top">
                <span className={'service-symbol tone-' + service.tone}>{service.symbol}</span>
                <Icon name="diagonal" size={19} />
              </span>
              <span className="tile-category">{service.category}</span>
              <strong>{service.title}</strong>
              <span className="tile-description">{service.description}</span>
              <AccessBadge status={serviceStatus(workspace, service)} />
            </button>
          ),
        )}
      </div>
      {!visible.length && (
        <EmptyState title="В этом списке пока пусто" text="Заявка появится здесь после подтверждения в чате Buddy." />
      )}
      {workspace.requests.length > 0 && (
        <section className="panel requests-panel">
          <SectionTitle title="Мои заявки" />
          {workspace.requests.map((request) => (
            <div className="request-row" key={request.id}>
              <span>{services.find((service) => service.id === request.serviceId)?.title || request.serviceId}</span>
              <strong>{request.number}</strong>
              <AccessBadge status={request.status} />
            </div>
          ))}
        </section>
      )}
    </>
  );
}

export function Resources({ directory }: { directory: ReactNode }) {
  return (
    <>
      <PageIntro title="Корпоративные сервисы" text="Открывай сервисы и инструкции." tone="pink" icon="layers" />
      {directory}
    </>
  );
}
