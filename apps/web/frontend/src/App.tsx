import { readHrToday } from './hr-schedule';
import { Schedule } from './EventsPage';
import { readSchedule, scheduleKey, type ScheduleEvent } from './schedule';
import { askBackend, backendEnabled, readBackendConversation } from './backend';
import { StartScreen } from './StartScreen';
import { StaffWorkspace } from './StaffWorkspace';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ChatPage, ChatWindow, type ChatEntry, type DraftState } from './Chat';
import { tasksFor } from './checklist';
import { navigation, services } from './data';
import { isStaffId, products, profiles, teamColleagues, teamContacts, type ProfileId } from './demo-accounts';
import {
  answerBuddy,
  buddyGrowthStage,
  confirmAccess,
  progressFor,
  readWorkspace,
  serviceStatus,
  toggleTask,
  type AccessDraft,
  type BuddyGrowthStage,
  type Workspace,
} from './demo';
import { demoSessionKey, endDemoSession, readDemoSession, startDemoSession } from './demo-session';
import { AccessBadge, Adaptation, Dashboard, Resources, Team, Tools, type Detail } from './screens';
import { Avatar, Buddy, EmptyState, Icon, Modal, type Mood } from './ui';

import { corporateLinks } from './corporate-links';
import { CorporateDirectory } from './CorporateDirectory';
import { ProductGuide } from './ProductGuide';

const searchItems = [
  { label: 'Путеводитель по продукту', detail: 'Раздел', to: '/product-guide' },
  ...navigation.map((item) => ({ label: item.label, detail: 'Раздел', to: item.path })),
  ...services.map((service) => ({
    label: service.title,
    detail: service.category,
    to: '/tools?service=' + service.id,
  })),
  ...corporateLinks.map((service) => ({ label: service.title, detail: 'Внешний сервис', to: service.url })),
];

type Toast = { message: string; tone: 'success' | 'error' };
const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function SearchDialog({ profileId, onClose }: { profileId: ProfileId; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const results = [
    ...searchItems,
    ...tasksFor(profileId).map((task) => ({
      label: task.title,
      detail: 'Задача',
      to: '/onboarding?task=' + task.id,
    })),
    ...[...teamContacts(profileId), ...teamColleagues(profileId)].map((person) => ({
      label: person.name,
      detail: person.role + ' · ' + person.position,
      to: '/team?person=' + person.id,
    })),
  ]
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
          <Link
            key={item.to}
            className="search-result"
            to={item.to}
            reloadDocument={!item.to.startsWith('/')}
            onClick={onClose}
          >
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

function WorkspaceShell({ profileId, onExit }: { profileId: ProfileId; onExit: () => void }) {
  const profile = profiles[profileId];
  const product = products[profile.productId];
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const section = navigation.find((item) => item.path === location.pathname);
  const [detail, setDetail] = useState<Detail | null>(null);
  const hrToday = useQuery({
    queryKey: ['hr-today', profileId, location.pathname],
    queryFn: ({ signal }) => readHrToday(profileId, signal),
    enabled: backendEnabled && ['/home', '/events'].includes(location.pathname),
    refetchOnWindowFocus: 'always',
    refetchInterval: 60_000,
  });
  const hrEvents = hrToday.data?.events ?? [];
  const hrError = hrToday.isError || Boolean(hrToday.data?.unavailable.length);
  const [events, setEvents] = useState(() => readSchedule(localStorage, profileId));
  const [scheduleNow, setScheduleNow] = useState(Date.now);
  useEffect(() => {
    const key = scheduleKey(profileId);
    try {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, JSON.stringify(readSchedule(localStorage, profileId)));
      }
    } catch {
      // The demo schedule remains readable if storage is unavailable.
    }
    function syncSchedule(event: StorageEvent) {
      if (event.key === key || event.key === null) setEvents(readSchedule(localStorage, profileId));
    }
    function updateTime() {
      setScheduleNow(Date.now());
    }
    const timer = window.setInterval(updateTime, 15_000);
    window.addEventListener('storage', syncSchedule);
    window.addEventListener('focus', updateTime);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', syncSchedule);
      window.removeEventListener('focus', updateTime);
    };
  }, [profileId]);

  function changeSchedule(next: ScheduleEvent[]) {
    try {
      localStorage.setItem(scheduleKey(profileId), JSON.stringify(next));
      setEvents(next);
      setScheduleNow(Date.now());
      return true;
    } catch {
      setToast({ message: 'Не удалось сохранить расписание.', tone: 'error' });
      return false;
    }
  }

  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [readAlerts, setReadAlerts] = useState(false);
  const [surveyDone, setSurveyDone] = useState(() => localStorage.getItem('ai-buddy.survey.' + profileId) === 'done');
  const [navOpen, setNavOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [mood, setMood] = useState<Mood>('happy');
  const [grownStage, setGrownStage] = useState<BuddyGrowthStage | null>(null);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [awaitingService, setAwaitingService] = useState(false);
  const nextEntry = useRef(1);
  const [historyLoading, setHistoryLoading] = useState(backendEnabled);
  useEffect(() => {
    if (!backendEnabled) return;
    let active = true;
    readBackendConversation(profileId)
      .then((messages) => {
        if (!active) return;
        setEntries(
          messages.map((message): ChatEntry =>
            message.role === 'user'
              ? { id: nextEntry.current++, from: 'user', text: message.content }
              : {
                  id: nextEntry.current++,
                  from: 'buddy',
                  reply: { kind: 'answer', text: message.content, references: message.references },
                },
          ),
        );
      })
      .catch(() => {
        if (active) setToast({ tone: 'error', message: 'Не удалось загрузить историю диалога.' });
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [profileId]);

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
      const previous = queryClient.getQueryData<Workspace>(workspaceKey);
      const done = updated.completed.includes(id);
      const nextStage = buddyGrowthStage(profileId, updated);
      if (previous && nextStage !== buddyGrowthStage(profileId, previous)) {
        setGrownStage(done ? nextStage : null);
      }
      queryClient.setQueryData(workspaceKey, updated);
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
      if (backendEnabled) return askBackend(profileId, text);
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
  const task =
    location.pathname === '/onboarding' && tasksFor(profileId).find((item) => item.id === params.get('task'));
  const person =
    location.pathname === '/team' &&
    [...teamContacts(profileId), ...teamColleagues(profileId)].find((item) => item.id === params.get('person'));
  const service = location.pathname === '/tools' && services.find((item) => item.id === params.get('service'));
  const linkedDetail: Detail | null = task
    ? { kind: 'task', item: task }
    : person
      ? { kind: 'person', item: person }
      : service
        ? { kind: 'service', item: service }
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
    waiting: answerMutation.isPending || historyLoading,
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
    !readAlerts &&
    (profile.stageId === 'first' || profile.stageId === 'final' || (profile.stageId === 'midpoint' && !surveyDone));

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
            <small>Стажёр · {profile.position}</small>
          </div>
        </div>
        <nav aria-label="Разделы AI-buddy">
          {navigation.map((item) => (
            <NavLink end key={item.path} to={item.path} onClick={() => setNavOpen(false)}>
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
            <strong>
              {section?.label ?? (location.pathname === '/product-guide' ? 'Путеводитель по продукту' : 'AI-buddy')}
            </strong>
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
                <Route
                  path="/home"
                  element={
                    <Dashboard
                      profileId={profileId}
                      {...checklist}
                      hrEvents={hrEvents}
                      hrError={hrError}
                      events={events}
                      scheduleNow={scheduleNow}
                      grownStage={grownStage}
                      onGrowthEnd={() => setGrownStage(null)}
                    />
                  }
                />
                <Route path="/product-guide" element={<ProductGuide profileId={profileId} />} />
                <Route path="/onboarding" element={<Adaptation profileId={profileId} {...checklist} />} />
                <Route
                  path="/events"
                  element={
                    <Schedule
                      hrEvents={hrEvents}
                      hrError={hrError}
                      events={events}
                      now={scheduleNow}
                      onChange={changeSchedule}
                    />
                  }
                />
                <Route path="/team" element={<Team profileId={profileId} onOpen={setDetail} />} />
                <Route path="/tools" element={<Tools workspace={workspace} onOpen={setDetail} />} />
                <Route path="/resources" element={<Resources directory={<CorporateDirectory />} />} />
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
      {searchOpen && <SearchDialog profileId={profileId} onClose={() => setSearchOpen(false)} />}
      {alertsOpen && (
        <Modal title="Уведомления" onClose={() => setAlertsOpen(false)}>
          {profile.stageId === 'midpoint' && !surveyDone ? (
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
          ) : profile.stageId === 'first' ? (
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
          ) : profile.stageId === 'final' ? (
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
              </div>
            </div>
          )}
          {shownDetail.kind === 'person' && (
            <div className="detail-content">
              <div className="detail-person">
                <Avatar
                  initials={shownDetail.item.initials}
                  tone={shownDetail.item.tone}
                  avatar={shownDetail.item.avatar}
                />
                <div>
                  <strong>
                    {shownDetail.item.role} · {shownDetail.item.position}
                  </strong>
                  <p>
                    {product.name} · {product.team}
                  </p>
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
              <h3>{profile.fullName}</h3>
              <p>
                {profile.stage} · {product.team}
              </p>
              <button type="button" className="button button--dark" onClick={onExit}>
                Выйти из аккаунта
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
  const [account, setAccount] = useState(() => readDemoSession(localStorage));
  const { pathname } = useLocation();

  useEffect(() => {
    function syncSession(event: Event) {
      if (event instanceof StorageEvent && event.key !== demoSessionKey && event.key !== null) return;
      setAccount(readDemoSession(localStorage));
    }
    window.addEventListener('storage', syncSession);
    window.addEventListener('pageshow', syncSession);
    return () => {
      window.removeEventListener('storage', syncSession);
      window.removeEventListener('pageshow', syncSession);
    };
  }, []);

  function exit() {
    endDemoSession(localStorage);
    setAccount(null);
  }

  if (!account) {
    if (pathname !== '/') return <Navigate to="/" replace />;
    return <StartScreen onSelect={(id) => setAccount(startDemoSession(localStorage, id))} />;
  }
  if (isStaffId(account)) {
    if (pathname !== '/staff') return <Navigate to="/staff" replace />;
    return <StaffWorkspace key={account} id={account} onExit={exit} />;
  }
  if (pathname === '/' || pathname === '/staff') return <Navigate to="/home" replace />;

  return <WorkspaceShell key={account} profileId={account} onExit={exit} />;
}
