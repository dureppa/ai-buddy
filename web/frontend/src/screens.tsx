import { taskSelectionResource } from './task-selection';
import { HrDayEvents } from './HrDayEvents';
import type { HrToday } from './hr-schedule';
import { eventDay, eventMonth, eventTime, upcomingEvents, type ScheduleEvent } from './schedule';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { stages, type Person, type ProfileId, type Task, profiles } from './data';
import { homeSectionTitle, homeTasks } from './checklist';
import { checklistFor } from './staff-data';
import { products, teamColleagues, teamContacts } from './demo-accounts';
import { buddyGrowthStage, progressFor, type BuddyGrowthStage, type Workspace } from './demo';
import { Avatar, Buddy, EmptyState, Icon, PageIntro } from './ui';
import { toolProfileUrl, toolsFor, type ToolGuide } from './tool-links';
import { surveyForTask, type SurveyStage } from './surveys';
import { InternMaterials } from './StaffWorkspace';

export type Detail =
  | { kind: 'task'; item: Task }
  | { kind: 'person'; item: Person }
  | { kind: 'service'; item: ToolGuide }
  | { kind: 'event'; item: Pick<ScheduleEvent, 'title' | 'description'> & { detail: string } }
  | { kind: 'settings' }
  | { kind: 'survey'; stage: SurveyStage };
export type OpenDetail = (detail: Detail) => void;

type ChecklistProps = {
  profileId: ProfileId;
  workspace: Workspace;
  onOpen: OpenDetail;
  onToggle: (id: string) => void;
  savingTask?: string;
};

function TaskRow({
  profileId,
  task,
  checked,
  saving,
  next,
  onOpen,
  onToggle,
}: {
  profileId: ProfileId;
  task: Task;
  checked: boolean;
  saving: boolean;
  next?: boolean;
  onOpen: OpenDetail;
  onToggle: (id: string) => void;
}) {
  const survey = surveyForTask(task.id);
  return (
    <li
      className={'task-row' + (checked ? ' task-row--done' : '') + (survey ? ' task-row--survey' : '')}
      data-agent-resource={JSON.stringify(taskSelectionResource(profileId, task))}
    >
      {survey ? (
        <span className="task-check" aria-hidden="true">
          <Icon name="check" size={15} />
        </span>
      ) : (
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
      )}
      <button
        type="button"
        className="task-link"
        onClick={() => onOpen(survey ? { kind: 'survey', stage: survey } : { kind: 'task', item: task })}
      >
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

function Progress({ workspace, taskIds }: { workspace: Workspace; taskIds?: readonly string[] }) {
  const base = progressFor(workspace);
  const completed = taskIds ? taskIds.filter((id) => workspace.completed.includes(id)).length : base.completed;
  const remaining = taskIds ? taskIds.length - completed : base.remaining;
  const progress = {
    completed,
    remaining,
    percent: taskIds ? (taskIds.length ? Math.round((completed / taskIds.length) * 100) : 0) : base.percent,
  };
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
  { title: 'Рабочие инструменты', detail: 'Сервисы команды', icon: 'key', to: '/tools', tone: 'pink' },
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
          <SectionTitle title={homeSectionTitle(profileId)}>
            <Link className="text-link" to="/onboarding">
              Весь план <Icon name="arrow" size={17} />
            </Link>
          </SectionTitle>
          <ul className="task-list">
            {dashboardTasks.map((task) => (
              <TaskRow
                profileId={profileId}
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

const adaptationTabs = [
  { id: 'tasks', label: 'Задачи', icon: 'check' },
  { id: 'materials', label: 'Материалы', icon: 'book' },
] as const;

export function Adaptation({ profileId, workspace, onOpen, onToggle, savingTask }: ChecklistProps) {
  const tasks = checklistFor(localStorage, profileId).map((task) => ({
    ...task,
    summary: task.materialIds.length ? task.summary + ' · Материалы: ' + task.materialIds.length : task.summary,
  }));
  const tabsId = useId();
  const [tab, setTab] = useState<(typeof adaptationTabs)[number]['id']>('tasks');
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
      <div
        className="adaptation-tabs"
        role="tablist"
        aria-label="Разделы адаптации"
        onKeyDown={(event) => {
          const { key } = event;
          if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
          event.preventDefault();
          const nextTab =
            key === 'Home' ? 'tasks' : key === 'End' ? 'materials' : tab === 'tasks' ? 'materials' : 'tasks';
          setTab(nextTab);
          document.getElementById(tabsId + '-' + nextTab)?.focus();
        }}
      >
        {adaptationTabs.map(({ id, label, icon }) => (
          <button
            key={id}
            id={tabsId + '-' + id}
            type="button"
            className="adaptation-tab"
            role="tab"
            aria-selected={tab === id}
            aria-controls={tabsId + '-' + id + '-panel'}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
          >
            <Icon name={icon} size={19} />
            {label}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id={tabsId + '-materials-panel'}
        aria-labelledby={tabsId + '-materials'}
        hidden={tab !== 'materials'}
        tabIndex={0}
      >
        {tab === 'materials' && <InternMaterials />}
      </section>
      <section
        role="tabpanel"
        id={tabsId + '-tasks-panel'}
        aria-labelledby={tabsId + '-tasks'}
        hidden={tab !== 'tasks'}
      >
        {tab === 'tasks' && (
          <div className="adaptation-layout">
            <section>
              <div className="filter-row" aria-label="Фильтр задач">
                <button
                  type="button"
                  className="filter"
                  aria-pressed={filter === 'all'}
                  onClick={() => setFilter('all')}
                >
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
                            profileId={profileId}
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
              <Progress workspace={workspace} taskIds={tasks.map((task) => task.id)} />
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
      </section>
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

export function Tools({ profileId, onOpen }: { profileId: ProfileId; onOpen: OpenDetail }) {
  return (
    <>
      <PageIntro
        title="Инструменты"
        text="Все рабочие сервисы. Сначала — наиболее полезные для твоей специальности."
        tone="blue"
        icon="grid"
      />
      <div className="tile-grid">
        {toolsFor(profileId).map((tool) => {
          const isLink = 'url' in tool;
          const content = (
            <>
              <span className="tile-top">
                <span className={'service-symbol tone-' + tool.tone}>{tool.symbol}</span>
                <Icon name={isLink ? 'diagonal' : 'arrow'} size={19} />
              </span>
              <span className="tile-category">{tool.category}</span>
              <strong>{tool.title}</strong>
              <span className="tile-description">{tool.description}</span>
              <span>{isLink ? tool.action : 'Открыть инструкцию'}</span>
            </>
          );
          return isLink ? (
            <a
              className="panel service-card"
              key={tool.id}
              href={toolProfileUrl(tool.url, profileId)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {content}
            </a>
          ) : (
            <button
              className="panel service-card"
              key={tool.id}
              type="button"
              onClick={() => onOpen({ kind: 'service', item: tool })}
            >
              {content}
            </button>
          );
        })}
      </div>
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
