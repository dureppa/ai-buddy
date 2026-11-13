import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ChatPage, ChatWindow, type ChatEntry, type DraftState } from './Chat';
import { navigation, people, profiles, resources, services, tasks, type ProfileId } from './data';
import {
  answerBuddy,
  confirmAccess,
  progressFor,
  readWorkspace,
  serviceStatus,
  toggleTask,
  type AccessDraft,
} from './demo';
import { hrPath, hrServices } from './hr-catalog';
import { HrDirectory, HrPage } from './HrPages';
import { AccessBadge, Adaptation, Dashboard, Resources, Team, Tools, type Detail } from './screens';
import { Avatar, Buddy, EmptyState, Icon, Modal, type Mood } from './ui';

const searchItems = [
  ...navigation.map((item) => ({ label: item.label, detail: 'Раздел', to: item.path })),
  ...people.map((person) => ({ label: person.name, detail: person.role, to: '/team?person=' + person.id })),
  ...services.map((service) => ({
    label: service.title,
    detail: service.category,
    to: '/tools?service=' + service.id,
  })),
  ...hrServices.map((service) => ({ label: service.title, detail: 'HR-сервис', to: hrPath(service.id) })),
  ...resources.map((resource) => ({
    label: resource.title,
    detail: resource.category,
    to: '/resources?article=' + resource.id,
  })),
  ...tasks.map((task) => ({ label: task.title, detail: 'Задача', to: '/onboarding?task=' + task.id })),
];

type Toast = { message: string; tone: 'success' | 'error' };
const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function loadProfile(): ProfileId | null {
  const saved = localStorage.getItem('ai-buddy.profile');
  return saved && Object.keys(profiles).includes(saved) ? (saved as ProfileId) : null;
}

function StartScreen({ onSelect }: { onSelect: (id: ProfileId) => void }) {
  return (
    <main className="start-screen">
      <section className="start-card" aria-labelledby="start-title">
        <div className="start-card__intro">
          <div className="start-brand">
            <span className="brand-mark">
              <i />
              <i />
            </span>
            <span>AI-buddy</span>
          </div>
          <span className="start-eyebrow">Hack&amp;Change 2026</span>
          <h1 id="start-title">Решение хакатона от команды «Без негатива»</h1>
          <p className="start-card__lead">
            AI-buddy помогает стажёру освоиться в новой команде, пройти этапы адаптации и найти следующий шаг.
          </p>
          <div className="start-card__buddy">
            <Buddy mood="happy" />
          </div>
        </div>
        <div className="start-card__profiles">
          <div className="start-card__heading">
            <h2>Выберите тестового пользователя</h2>
          </div>
          <div className="start-profiles">
            {Object.values(profiles).map((profile) => (
              <button type="button" className="start-profile" key={profile.id} onClick={() => onSelect(profile.id)}>
                <Avatar initials={profile.initials} tone="lilac" avatar={profile.avatar} />
                <span className="start-profile__copy">
                  <strong>{profile.fullName}</strong>
                  <span>{profile.stage}</span>
                  <small>{profile.stageDescription}</small>
                </span>
                <Icon name="arrow" size={19} />
              </button>
            ))}
          </div>
          <p className="start-card__note">Все данные синтетические и предназначены для демонстрации сценариев.</p>
        </div>
      </section>
    </main>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const results = searchItems
    .filter((item) => (item.label + ' ' + item.detail).toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8);
  return (
    <Modal title="Поиск" onClose={onClose}>
      <label className="search-field">
        <Icon name="search" />
        <input
          autoFocus
          aria-label="Поиск по AI-buddy"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Раздел, человек или сервис"
        />
      </label>
      <div className="search-results">
        {results.map((item) => (
          <Link key={item.to} className="search-result" to={item.to} onClick={onClose}>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
            <Icon name="arrow" size={18} />
          </Link>
        ))}
        {results.length === 0 && <p>Ничего не найдено. Попробуй другой запрос.</p>}
      </div>
    </Modal>
  );
}

function Survey({ onSubmit }: { onSubmit: () => void }) {
  const [answer, setAnswer] = useState('');
  return (
    <form
      className="detail-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (answer) onSubmit();
      }}
    >
      <p>Как проходит твоя адаптация?</p>
      <fieldset>
        {['Всё понятно', 'Есть несколько вопросов', 'Нужна помощь'].map((option) => (
          <label key={option} className="radio-row">
            <input
              type="radio"
              name="survey"
              value={option}
              checked={answer === option}
              onChange={() => setAnswer(option)}
            />
            {option}
          </label>
        ))}
      </fieldset>
      <button className="button button--dark" type="submit" disabled={!answer}>
        Отправить ответ
      </button>
    </form>
  );
}

function WorkspaceShell({
  profileId,
  onProfile,
  onExit,
}: {
  profileId: ProfileId;
  onProfile: (id: ProfileId) => void;
  onExit: () => void;
}) {
  const profile = profiles[profileId];
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const section = navigation.find((item) => item.path === location.pathname);
  const hrService = hrServices.find((service) => hrPath(service.id) === location.pathname);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [readAlerts, setReadAlerts] = useState(false);
  const [surveyDone, setSurveyDone] = useState(() => localStorage.getItem('ai-buddy.survey.' + profileId) === 'done');
  const [navOpen, setNavOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [mood, setMood] = useState<Mood>('happy');
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [awaitingService, setAwaitingService] = useState(false);
  const nextEntry = useRef(1);

  const workspaceKey = ['workspace', profileId] as const;
  const workspaceQuery = useQuery({
    queryKey: workspaceKey,
    queryFn: async () => {
      await delay(140);
      return readWorkspace(localStorage, profileId);
    },
    staleTime: Infinity,
  });
  const workspace = workspaceQuery.data;

  const taskMutation = useMutation({
    mutationFn: async (id: string) => toggleTask(localStorage, profileId, id),
    onSuccess: (updated, id) => {
      queryClient.setQueryData(workspaceKey, updated);
      const done = updated.completed.includes(id);
      if (done) setMood('celebrating');
      setToast({
        tone: 'success',
        message: done
          ? progressFor(updated).remaining === 0
            ? 'Все шаги выполнены. Buddy поздравляет тебя!'
            : 'Задача отмечена выполненной.'
          : 'Задача возвращена в план.',
      });
    },
    onError: () => {
      setMood('supportive');
      setToast({ tone: 'error', message: 'Не удалось сохранить отметку. Попробуй ещё раз.' });
    },
  });

  const answerMutation = useMutation({
    mutationFn: async (text: string) => {
      await delay(580);
      return answerBuddy(text, readWorkspace(localStorage, profileId), profileId, awaitingService);
    },
    onSuccess: (reply) => {
      const id = nextEntry.current++;
      setEntries((items) => [...items, { id, from: 'buddy', reply }]);
      setAwaitingService(reply.kind === 'clarification' && reply.awaitingService);
      setMood(reply.kind === 'access_denied' ? 'supportive' : 'happy');
    },
    onError: () => {
      setMood('supportive');
      setToast({ tone: 'error', message: 'Buddy временно недоступен. Попробуй отправить вопрос ещё раз.' });
    },
  });

  const confirmation = useMutation({
    mutationFn: async (draft: AccessDraft) => {
      await delay(220);
      return confirmAccess(localStorage, profileId, draft);
    },
    onSuccess: ({ workspace: updated, request }, draft) => {
      queryClient.setQueryData(workspaceKey, updated);
      setDrafts((previous) => ({ ...previous, [draft.id]: { type: 'confirmed', number: request.number } }));
      setMood('celebrating');
      setToast({ tone: 'success', message: 'Заявка ' + request.number + ' отправлена.' });
    },
    onError: (error) => {
      setMood('supportive');
      setToast({ tone: 'error', message: error.message });
    },
  });

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(null);
      setMood('happy');
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function send(text: string) {
    if (!text.trim() || answerMutation.isPending) return;
    const id = nextEntry.current++;
    setEntries((items) => [...items, { id, from: 'user', text: text.trim() }]);
    answerMutation.mutate(text);
  }

  const params = new URLSearchParams(location.search);
  const task = location.pathname === '/onboarding' && tasks.find((item) => item.id === params.get('task'));
  const person = location.pathname === '/team' && people.find((item) => item.id === params.get('person'));
  const service = location.pathname === '/tools' && services.find((item) => item.id === params.get('service'));
  const resource = location.pathname === '/resources' && resources.find((item) => item.id === params.get('article'));
  const linkedDetail: Detail | null = task
    ? { kind: 'task', item: task }
    : person
      ? { kind: 'person', item: person }
      : service
        ? { kind: 'service', item: service }
        : resource
          ? { kind: 'resource', item: resource }
          : null;
  const shownDetail = detail ?? linkedDetail;
  function closeDetail() {
    setDetail(null);
    if (linkedDetail) navigate(location.pathname, { replace: true });
  }
  function openSurvey() {
    setAlertsOpen(false);
    setDrawerOpen(false);
    setDetail({ kind: 'survey' });
  }
  const chatProps = {
    profileId,
    name: profile.name,
    entries,
    waiting: answerMutation.isPending,
    confirming: confirmation.isPending,
    drafts,
    onSend: send,
    onConfirm: (draft: AccessDraft) => confirmation.mutate(draft),
    onDismiss: (draft: AccessDraft) => setDrafts((previous) => ({ ...previous, [draft.id]: { type: 'dismissed' } })),
    onSurvey: openSurvey,
    surveyDone,
  };

  const checklist = workspace && {
    workspace,
    onOpen: setDetail,
    onToggle: (id: string) => taskMutation.mutate(id),
    savingTask: taskMutation.isPending ? taskMutation.variables : undefined,
  };

  const hasUnread =
    !readAlerts && (profileId === 'olga' || profileId === 'maria' || (profileId === 'sasha' && !surveyDone));

  return (
    <div className="shell">
      <a href="#main-content" className="skip-link">
        Перейти к содержимому
      </a>
      {navOpen && (
        <button
          type="button"
          aria-label="Закрыть навигацию"
          className="nav-overlay"
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside id="workspace-navigation" className={'sidebar' + (navOpen ? ' sidebar--open' : '')}>
        <Link className="brand" to="/home" onClick={() => setNavOpen(false)}>
          <span className="brand-mark">
            <i />
            <i />
          </span>
          <span>AI-buddy</span>
        </Link>
        <div className="sidebar__profile">
          <Avatar initials={profile.initials} tone="lilac" avatar={profile.avatar} />
          <div>
            <strong>{profile.fullName}</strong>
            <small>{profile.role}</small>
          </div>
        </div>
        <nav aria-label="Разделы AI-buddy">
          {navigation.map((item) => (
            <NavLink end={item.path !== '/resources'} key={item.path} to={item.path} onClick={() => setNavOpen(false)}>
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__bottom">
          <button
            type="button"
            className="settings-link"
            onClick={() => {
              setNavOpen(false);
              setDetail({ kind: 'settings' });
            }}
          >
            <Icon name="settings" size={20} /> Настройки
          </button>
          <button
            type="button"
            className="sidebar-buddy"
            onClick={() => {
              setNavOpen(false);
              setDrawerOpen(true);
            }}
          >
            <Buddy compact />
            <span>
              <strong>Нужна помощь?</strong>
              <small>Спроси Buddy</small>
            </span>
            <Icon name="diagonal" size={16} />
          </button>
        </div>
      </aside>
      <div className="shell__body">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              type="button"
              className="icon-button menu-toggle"
              aria-label="Меню"
              aria-controls="workspace-navigation"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(!navOpen)}
            >
              <Icon name="menu" />
            </button>
            <span className="breadcrumb-root">Рабочее пространство</span>
            <Icon name="chevron" size={15} />
            <strong>{hrService?.title ?? section?.label ?? 'AI-buddy'}</strong>
          </div>
          <div className="topbar__actions">
            <button type="button" className="search-trigger" aria-label="Поиск" onClick={() => setSearchOpen(true)}>
              <Icon name="search" size={18} />
              <span>Поиск</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              type="button"
              className="icon-button alert-button"
              aria-label="Уведомления"
              onClick={() => {
                setAlertsOpen(true);
                setReadAlerts(true);
              }}
            >
              <Icon name="bell" />
              {hasUnread && <span />}
            </button>
            <button
              type="button"
              className="profile-button"
              aria-label="Профиль"
              onClick={() => setDetail({ kind: 'settings' })}
            >
              <Avatar initials={profile.initials} tone="lilac" avatar={profile.avatar} />
              <Icon name="down" size={14} />
            </button>
          </div>
        </header>
        <main className="content" id="main-content">
          {!workspace || !checklist ? (
            <div className="skeleton-layout" role="status" aria-label="Загружаем пространство">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : (
            <div className="page-content" key={location.pathname}>
              <Routes>
                <Route path="/home" element={<Dashboard profile={profile} {...checklist} />} />
                <Route path="/onboarding" element={<Adaptation {...checklist} />} />
                <Route path="/team" element={<Team onOpen={setDetail} />} />
                <Route path="/tools" element={<Tools workspace={workspace} onOpen={setDetail} />} />
                <Route path="/resources" element={<Resources onOpen={setDetail} directory={<HrDirectory />} />} />
                {hrServices.map((service) => (
                  <Route
                    key={service.id}
                    path={hrPath(service.id)}
                    element={<HrPage service={service} profileId={profileId} />}
                  />
                ))}
                <Route path="/chat" element={<ChatPage {...chatProps} />} />
                <Route path="*" element={<Navigate to="/home" replace />} />
              </Routes>
            </div>
          )}
        </main>
      </div>
      {location.pathname !== '/chat' && (
        <button
          type="button"
          className="floating-buddy"
          aria-label="Открыть быстрый чат"
          onClick={() => {
            setMood('surprised');
            setDrawerOpen(true);
          }}
        >
          <Buddy mood={answerMutation.isPending ? 'thinking' : mood} compact />
        </button>
      )}
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
      {alertsOpen && (
        <Modal title="Уведомления" onClose={() => setAlertsOpen(false)}>
          {profileId === 'sasha' && !surveyDone ? (
            <div className="alert-card tone-lilac">
              <Icon name="flag" />
              <div>
                <h3>Экватор стажировки</h3>
                <p>Расскажи, как проходят первые месяцы.</p>
                <button type="button" className="button button--white" onClick={openSurvey}>
                  Пройти опрос
                </button>
              </div>
            </div>
          ) : profileId === 'olga' ? (
            <div className="alert-card tone-mint">
              <Icon name="calendar" />
              <div>
                <h3>Твой первый день</h3>
                <p>Сегодня в 14:00 — знакомство с лидом.</p>
                <Link to="/onboarding" className="text-link" onClick={() => setAlertsOpen(false)}>
                  Посмотреть план <Icon name="arrow" size={16} />
                </Link>
              </div>
            </div>
          ) : profileId === 'maria' ? (
            <div className="alert-card tone-blue">
              <Icon name="flag" />
              <div>
                <h3>Финал стажировки</h3>
                <p>Проверь итоги адаптации и подготовься к переходу в команду.</p>
                <Link to="/onboarding" className="text-link" onClick={() => setAlertsOpen(false)}>
                  Открыть итоги <Icon name="arrow" size={16} />
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState title="Новых уведомлений нет" text="Важные напоминания появятся здесь." />
          )}
        </Modal>
      )}
      {drawerOpen && (
        <Modal title="Быстрый чат" side onClose={() => setDrawerOpen(false)}>
          <ChatWindow {...chatProps} onNavigate={() => setDrawerOpen(false)} />
          <Link to="/chat" className="text-link drawer-link" onClick={() => setDrawerOpen(false)}>
            Открыть полный чат <Icon name="arrow" size={17} />
          </Link>
        </Modal>
      )}
      {shownDetail && workspace && (
        <Modal
          title={
            'item' in shownDetail
              ? 'title' in shownDetail.item
                ? shownDetail.item.title
                : shownDetail.item.name
              : shownDetail.kind === 'settings'
                ? 'Настройки'
                : 'Опрос об адаптации'
          }
          onClose={closeDetail}
        >
          {shownDetail.kind === 'task' && (
            <div className="detail-content">
              <p>{shownDetail.item.details}</p>
              <dl>
                <dt>Срок</dt>
                <dd>{shownDetail.item.due}</dd>
                <dt>Ответственный</dt>
                <dd>{shownDetail.item.owner}</dd>
              </dl>
              <div className="button-row">
                <button
                  type="button"
                  className="button button--dark"
                  disabled={taskMutation.isPending}
                  onClick={() => taskMutation.mutate(shownDetail.item.id)}
                >
                  {workspace.completed.includes(shownDetail.item.id) ? 'Вернуть в план' : 'Отметить выполненной'}
                </button>
                {shownDetail.item.resource && (
                  <Link
                    className="button button--white"
                    to={'/resources?article=' + shownDetail.item.resource}
                    onClick={() => setDetail(null)}
                  >
                    Открыть инструкцию
                  </Link>
                )}
              </div>
            </div>
          )}
          {shownDetail.kind === 'person' && (
            <div className="detail-content">
              <div className="detail-person">
                <Avatar initials={shownDetail.item.initials} tone={shownDetail.item.tone} />
                <div>
                  <strong>{shownDetail.item.role}</strong>
                  <p>{profile.team}</p>
                </div>
              </div>
              <p>{shownDetail.item.bio}</p>
              <div className="button-row">
                <a className="button button--dark" href={'mailto:' + shownDetail.item.contact}>
                  Написать <Icon name="diagonal" size={17} />
                </a>
                <button
                  type="button"
                  className="button button--white"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(shownDetail.item.contact)
                      .then(() => setToast({ tone: 'success', message: 'Адрес скопирован.' }))
                      .catch(() =>
                        setToast({
                          tone: 'error',
                          message: 'Не удалось скопировать. Адрес: ' + shownDetail.item.contact,
                        }),
                      );
                  }}
                >
                  <Icon name="copy" size={17} /> Скопировать адрес
                </button>
              </div>
            </div>
          )}
          {shownDetail.kind === 'service' && (
            <div className="detail-content">
              <AccessBadge status={serviceStatus(workspace, shownDetail.item)} />
              <p>{shownDetail.item.description}</p>
              <p>{shownDetail.item.instruction}</p>
              <dl>
                <dt>Ответственный</dt>
                <dd>{shownDetail.item.owner}</dd>
              </dl>
              {serviceStatus(workspace, shownDetail.item) === 'requestable' && (
                <button
                  type="button"
                  className="button button--dark"
                  onClick={() => {
                    closeDetail();
                    navigate('/chat');
                    send('Запроси доступ к ' + shownDetail.item.title);
                  }}
                >
                  Подготовить заявку <Icon name="arrow" size={17} />
                </button>
              )}
              {workspace.requests
                .filter((request) => request.serviceId === shownDetail.item.id)
                .map((request) => (
                  <p className="detail-request" key={request.id}>
                    Заявка <strong>{request.number}</strong>
                  </p>
                ))}
            </div>
          )}
          {shownDetail.kind === 'resource' && (
            <div className="detail-content">
              <span className={'icon-tile tone-' + shownDetail.item.tone}>
                <Icon name={shownDetail.item.icon} />
              </span>
              <p>{shownDetail.item.body}</p>
            </div>
          )}
          {shownDetail.kind === 'event' && (
            <div className="detail-content">
              <p>{shownDetail.item.description}</p>
              <dl>
                <dt>Когда</dt>
                <dd>{shownDetail.item.detail}</dd>
              </dl>
            </div>
          )}
          {shownDetail.kind === 'settings' && (
            <div className="detail-content">
              <h3>Демонстрационный профиль</h3>
              <p>Переключи профиль, чтобы посмотреть другой этап адаптации и права доступа.</p>
              {Object.values(profiles).map((option) => (
                <button
                  type="button"
                  className="profile-option"
                  key={option.id}
                  onClick={() => {
                    onProfile(option.id);
                    setDetail(null);
                  }}
                  aria-pressed={profileId === option.id}
                >
                  <Avatar initials={option.initials} tone="lilac" avatar={option.avatar} />
                  <span>
                    <strong>{option.fullName}</strong>
                    <small>
                      {option.stage} · {option.team}
                    </small>
                  </span>
                  {profileId === option.id && <Icon name="check" size={20} />}
                </button>
              ))}
              <button type="button" className="text-link start-change-profile" onClick={onExit}>
                Вернуться к выбору профиля <Icon name="arrow" size={16} />
              </button>
            </div>
          )}
          {shownDetail.kind === 'survey' &&
            (surveyDone ? (
              <EmptyState title="Спасибо за ответ!" text="Опрос уже заполнен." />
            ) : (
              <Survey
                onSubmit={() => {
                  localStorage.setItem('ai-buddy.survey.' + profileId, 'done');
                  setSurveyDone(true);
                  closeDetail();
                  setMood('celebrating');
                  setToast({ tone: 'success', message: 'Спасибо! Ответ записан в демо.' });
                }}
              />
            ))}
        </Modal>
      )}
      {toast && (
        <div className={'toast toast--' + toast.tone} role={toast.tone === 'error' ? 'alert' : 'status'}>
          <Icon name={toast.tone === 'success' ? 'check' : 'info'} size={20} />
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [profile, setProfile] = useState(loadProfile);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  function selectProfile(id: ProfileId) {
    localStorage.setItem('ai-buddy.profile', id);
    setProfile(id);
  }

  if (pathname === '/') {
    return (
      <StartScreen
        onSelect={(id) => {
          selectProfile(id);
          navigate('/home');
        }}
      />
    );
  }
  if (!profile) return <Navigate to="/" replace />;

  return <WorkspaceShell key={profile} profileId={profile} onProfile={selectProfile} onExit={() => navigate('/')} />;
}
