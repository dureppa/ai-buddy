import { chatSuggestions } from './chat-suggestions';
import { taskSelectionResource } from './task-selection';
import { chatPageContext, isChecklistQuestion, isTaskCompletionMessage } from './current-task';
import { checklistQuestion } from './checklist-question';
import type { ChatPageContext, ExplanationContext } from './selection-context';
import { BuddyPanel } from './BuddyPanel';
import { ServiceActionPage } from './ServiceActionPage';
import { OnboardingTaskPage } from './OnboardingTaskPage';
import { accountCookieValue } from './service-session';
import { readHrToday } from './hr-schedule';
import { Schedule } from './EventsPage';
import { readSchedule, scheduleKey, type ScheduleEvent } from './schedule';
import { readCalendar, changeCalendar } from './schedule-api';
import { askBackend, backendEnabled, readBackendConversation } from './backend';
import { InternshipSurvey } from './InternshipSurvey';
import {
  completedSurveys,
  markNotificationsRead,
  notificationSurvey,
  readNotifications,
  submitSurvey,
  surveys,
  surveyForTask,
  surveyStage,
  surveyTaskId,
  type SurveyStage,
} from './surveys';
import { StartScreen } from './StartScreen';
import { StaffWorkspace } from './StaffWorkspace';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ChatPage, type ChatEntry, type DraftState } from './Chat';
import { tasksFor, type Task } from './checklist';
import { navigation } from './data';
import { isStaffId, products, profiles, teamColleagues, teamContacts, type ProfileId } from './demo-accounts';
import {
  answerBuddy,
  absenceServiceLink,
  buddyGrowthStage,
  confirmAccess,
  completeTask,
  progressFor,
  readWorkspace,
  toggleTask,
  type AccessDraft,
  type BuddyGrowthStage,
  type Workspace,
} from './demo';
import { demoSessionKey, endDemoSession, readDemoSession, startDemoSession } from './demo-session';
import { saveServiceQuestion } from './service-questions';
import { checklistFor, materialsForTask } from './staff-data';
import { Adaptation, Dashboard, Resources, Team, Tools, type Detail } from './screens';
import { Avatar, Buddy, EmptyState, Icon, Modal, Toast, type Mood } from './ui';

import { corporateLinks } from './corporate-links';
import { toolProfileUrl, workToolsOrigin, toolsFor } from './tool-links';
import { CorporateDirectory, accessPortalUrl } from './CorporateDirectory';
import { WorkToolPage } from '../../../tools/shared/frontend/WorkToolPage';
import { ProductGuide } from './ProductGuide';

const searchItems = [
  { label: 'Путеводитель по продукту', detail: 'Раздел', to: '/product-guide' },
  ...navigation.map((item) => ({ label: item.label, detail: 'Раздел', to: item.path })),
  ...corporateLinks.map((service) => ({ label: service.title, detail: 'Внешний сервис', to: service.url })),
];

type ToastState = { message: string; tone: 'success' | 'error'; placement?: 'top-right' };
const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function TaskMaterialList({
  profileId,
  taskId,
  compact = false,
}: {
  profileId: ProfileId;
  taskId: string;
  compact?: boolean;
}) {
  const materials = materialsForTask(localStorage, profileId, taskId);
  if (!materials.length) return null;
  if (compact)
    return (
      <nav className="buddy-materials" aria-label="Материалы пункта">
        {materials.map((material) => (
          <a
            key={material.id}
            href={material.source.href}
            target={material.source.kind === 'link' ? '_blank' : undefined}
            rel="noopener noreferrer"
            download={material.source.kind === 'file' ? material.source.name : undefined}
          >
            <Icon name="file" size={15} />
            <span>{material.title}</span>
            <Icon name="diagonal" size={14} />
          </a>
        ))}
      </nav>
    );

  return (
    <section className="task-materials" aria-label="Материалы к заданию">
      <h3>Материалы к заданию</h3>
      <ul>
        {materials.map((material) => (
          <li key={material.id} className="panel task-material">
            <strong>{material.title}</strong>
            <p>{material.description}</p>
            <small>
              {material.group} · {material.author}
            </small>
            {material.source.kind === 'file' ? (
              <a
                className="text-link task-material__link"
                href={material.source.href}
                download={material.source.name}
                aria-label={'Скачать файл ' + material.source.name}
              >
                Скачать файл <Icon name="file" size={15} />
              </a>
            ) : (
              <a
                className="text-link task-material__link"
                href={material.source.href}
                target="_blank"
                rel="noreferrer"
                aria-label={'Открыть ссылку ' + material.title}
              >
                Открыть ссылку <Icon name="diagonal" size={15} />
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SearchDialog({ profileId, onClose }: { profileId: ProfileId; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const results = [
    ...searchItems.map((item) =>
      item.to === corporateLinks.find((service) => service.id === 'access')?.url
        ? { ...item, to: accessPortalUrl(item.to, profileId) }
        : item,
    ),
    ...toolsFor(profileId).map((tool) => ({
      label: tool.title,
      detail: tool.category,
      to: 'url' in tool ? toolProfileUrl(tool.url, profileId) : '/tools?service=' + tool.id,
    })),
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
            target={!item.to.startsWith('/') ? '_blank' : undefined}
            rel={!item.to.startsWith('/') ? 'noopener noreferrer' : undefined}
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

function ServiceQuestionForm({ profileId, onSaved }: { profileId: ProfileId; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const trimmed = text.trim();

  return (
    <form
      className="detail-form question-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError('');
        try {
          saveServiceQuestion(localStorage, profileId, text);
          setText('');
          onSaved();
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'Не удалось сохранить вопрос.');
        }
      }}
    >
      <p>Опиши, что непонятно в работе сервиса.</p>
      <label>
        Вопрос
        <textarea
          name="question"
          rows={4}
          required
          minLength={2}
          maxLength={1000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Например, где посмотреть статус заявки на доступ"
        />
      </label>
      {error && (
        <p className="question-error" role="alert">
          {error}
        </p>
      )}
      <button className="button button--dark" type="submit" disabled={trimmed.length < 2}>
        Отправить вопрос
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
  const [localEvents, setEvents] = useState(() => readSchedule(localStorage, profileId));
  const calendar = useQuery({
    queryKey: ['calendar', profileId],
    queryFn: ({ signal }) => readCalendar(profileId, signal),
    enabled: backendEnabled,
    refetchOnWindowFocus: 'always',
    refetchInterval: 30_000,
  });
  const events = backendEnabled ? (calendar.data?.events ?? []) : localEvents;
  const [scheduleNow, setScheduleNow] = useState(Date.now);
  useEffect(() => {
    if (backendEnabled) return;
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

  async function changeSchedule(next: ScheduleEvent[]) {
    try {
      if (backendEnabled) {
        const result = await changeCalendar(profileId, events, next);
        queryClient.setQueryData(
          ['calendar', profileId],
          (old: Awaited<ReturnType<typeof readCalendar>> | undefined) => {
            const current = old?.events ?? [];
            const saved = result.saved;
            return {
              has_more: old?.has_more ?? false,
              events: saved
                ? [...current.filter((event) => event.id !== saved.id), saved]
                : current.filter((event) => event.id !== result.removed),
            };
          },
        );
        void queryClient.invalidateQueries({ queryKey: ['calendar', profileId] });
        return true;
      }
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
  const [navOpen, setNavOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
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
  const surveysKey = ['internship-surveys', profileId] as const;
  const surveysQuery = useQuery({ queryKey: surveysKey, queryFn: () => completedSurveys(profileId) });
  const completedStages = surveysQuery.data;
  const notificationsKey = ['notifications', profileId] as const;
  const notificationsQuery = useQuery({
    queryKey: notificationsKey,
    queryFn: () => readNotifications(profileId, profile.stageId),
    refetchInterval: backendEnabled ? 60_000 : false,
  });
  const notifications = notificationsQuery.data?.filter((notification) => {
    const stage = notificationSurvey(notification.action_url);
    return !stage || !completedStages?.includes(stage);
  });
  const unreadIds =
    notifications
      ?.filter((notification) => !notification.read)
      .map(({ id }) => id)
      .join(',') ?? '';
  const unreadCount = unreadIds ? unreadIds.split(',').length : 0;
  const { mutate: markRead, isError: readFailed } = useMutation({
    mutationFn: (ids: string[]) => markNotificationsRead(profileId, ids),
    onSuccess: async (_, ids) => {
      await queryClient.cancelQueries({ queryKey: notificationsKey });
      queryClient.setQueryData<Awaited<ReturnType<typeof readNotifications>>>(notificationsKey, (previous) =>
        previous?.map((notification) =>
          ids.includes(notification.id) ? { ...notification, read: true } : notification,
        ),
      );
    },
  });
  useEffect(() => {
    if (alertsOpen && unreadIds) markRead(unreadIds.split(','));
  }, [alertsOpen, markRead, unreadIds]);

  const workspace = workspaceQuery.data && {
    ...workspaceQuery.data,
    completed: [
      ...workspaceQuery.data.completed.filter((id) => !surveyForTask(id)),
      ...(completedStages ?? []).map(surveyTaskId),
    ],
  };

  const [completionTargetId, setCompletionTargetId] = useState<string | null>();
  const completionSending = useRef(false);
  const [completionVisible, setCompletionVisible] = useState(false);
  const [serviceShortcut, setServiceShortcut] = useState<{ label: string; to: string }>();
  const catalog = checklistFor(localStorage, profileId);
  const completionTarget = workspace && catalog.find((item) => item.id === completionTargetId);
  const completionDone = Boolean(workspace && completionTarget && workspace.completed.includes(completionTarget.id));
  useEffect(() => {
    if (!completionVisible || !completionDone) return;
    const timer = window.setTimeout(() => setCompletionVisible(false), 2000);
    return () => window.clearTimeout(timer);
  }, [completionVisible, completionDone, completionTargetId]);
  const taskMutation = useMutation({
    mutationFn: async ({ id, completion }: { id: string; completion?: boolean; title?: string }) => {
      if (completion && (!checklistFor(localStorage, profileId).some((item) => item.id === id) || surveyForTask(id)))
        throw new Error('Пункт нельзя подтвердить таким способом.');
      return completion ? completeTask(localStorage, profileId, id) : toggleTask(localStorage, profileId, id);
    },
    onSettled: () => {
      completionSending.current = false;
    },
    onSuccess: (updated, { id, completion, title }) => {
      const previous = queryClient.getQueryData<Workspace>(workspaceKey);
      const done = updated.completed.includes(id);
      const nextStage = buddyGrowthStage(profileId, updated);
      if (previous && nextStage !== buddyGrowthStage(profileId, previous)) {
        setGrownStage(done ? nextStage : null);
      }
      queryClient.setQueryData(workspaceKey, updated);
      if (done) setMood('celebrating');
      if (completion) setActiveTask(undefined);
      if (completion)
        setEntries((items) => [
          ...items,
          {
            id: nextEntry.current++,
            from: 'buddy',
            reply: {
              kind: 'answer',
              text: 'Пункт «' + title + '» отмечен выполненным в твоём чек-листе. Можешь перейти к следующему пункту.',
            },
          },
        ]);
      setToast({
        tone: 'success',
        message: done
          ? progressFor(updated).remaining === 0
            ? 'Все шаги выполнены. Buddy поздравляет тебя!'
            : 'Задача отмечена выполненной.'
          : 'Задача возвращена в план.',
      });
    },
    onError: (_, { completion }) => {
      setMood('supportive');
      if (completion)
        setEntries((items) => [
          ...items,
          {
            id: nextEntry.current++,
            from: 'buddy',
            reply: {
              kind: 'answer',
              text: 'Не удалось сохранить отметку. Задача не завершена — попробуй ещё раз.',
            },
          },
        ]);
      setToast({ tone: 'error', message: 'Не удалось сохранить отметку. Попробуй ещё раз.' });
    },
  });

  const taskQuestionSending = useRef(false);
  const [activeTask, setActiveTask] = useState<ExplanationContext>();
  const selectedResource = activeTask?.selection.resource;
  const taskContext =
    selectedResource?.kind === 'task' ? { id: selectedResource.id, title: selectedResource.label } : undefined;
  const questions = chatSuggestions(
    catalog,
    surveysQuery.isSuccess ? workspace?.completed : undefined,
    taskContext?.id,
    (item) => Boolean(taskSelectionResource(profileId, item).page_ids?.length),
  );
  const [chatError, setChatError] = useState<string>();
  const lastQuestion = useRef<{ text: string; context?: ChatPageContext } | undefined>(undefined);
  const answerMutation = useMutation({
    onMutate: (question) => {
      lastQuestion.current = question;
      setChatError(undefined);
    },
    onSettled: () => {
      taskQuestionSending.current = false;
    },
    mutationFn: async ({ text, context }: { text: string; context?: ChatPageContext }) => {
      if (backendEnabled) return context ? askBackend(profileId, text, context) : askBackend(profileId, text);
      if (context?.selection?.resource?.kind === 'task')
        return {
          kind: 'answer' as const,
          text: 'Учебное объяснение пункта: ' + context.selection.resource.label,
          lines: [
            context.selection.resource.description || 'Описание пункта пока не добавлено.',
            'Начни с прикреплённых материалов. Этот локальный ответ не проверяет корпоративные инструкции.',
          ],
        };
      await delay(580);
      return answerBuddy(text, readWorkspace(localStorage, profileId), profileId, awaitingService);
    },
    onSuccess: (reply, question) => {
      const context = question.context;
      const serviceQuestion = context?.selection?.resource?.kind !== 'task' && absenceServiceLink(question.text);
      setCompletionTargetId(
        serviceQuestion
          ? null
          : context?.selection?.resource?.kind === 'task'
            ? context.selection.resource.id
            : isChecklistQuestion(question.text) && context?.checklist?.status === 'in_progress'
              ? context.checklist.task.id
              : undefined,
      );
      setCompletionVisible(
        !serviceQuestion &&
          (context?.selection?.resource?.kind === 'task' ||
            (isChecklistQuestion(question.text) && context?.checklist?.status === 'in_progress')),
      );
      const id = nextEntry.current++;
      setEntries((items) => [...items, { id, from: 'buddy', reply }]);
      setAwaitingService(reply.kind === 'clarification' && reply.awaitingService);
      setMood(reply.kind === 'access_denied' ? 'supportive' : 'happy');
    },
    onError: () => {
      setMood('supportive');
      setChatError('Buddy временно недоступен. Попробуй ещё раз.');
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

  function confirmChatTask(text?: string) {
    if (
      !workspace ||
      historyLoading ||
      surveysQuery.isPending ||
      answerMutation.isPending ||
      taskMutation.isPending ||
      taskQuestionSending.current ||
      completionSending.current
    )
      return;
    setChatError(undefined);
    lastQuestion.current = undefined;
    const item =
      completionTarget && checklistFor(localStorage, profileId).find((task) => task.id === completionTarget.id);
    setEntries((items) => [
      ...items,
      { id: nextEntry.current++, from: 'user', text: text ?? 'Отметить выполненной: «' + item?.title + '».' },
    ]);
    if (surveysQuery.isError || !item) {
      setEntries((items) => [
        ...items,
        {
          id: nextEntry.current++,
          from: 'buddy',
          reply: {
            kind: 'answer',
            text: surveysQuery.isError
              ? 'Не удалось обновить план. Попробуй открыть его заново — пока не буду менять отметки.'
              : 'Сейчас нет доступного пункта для отметки. Выбери задачу в плане адаптации.',
          },
        },
      ]);
      return;
    }
    setCompletionTargetId(item.id);
    const survey = surveyForTask(item.id);
    if (survey) {
      openSurvey(survey);
      return;
    }
    completionSending.current = true;
    taskMutation.mutate({ id: item.id, completion: true, title: item.title });
  }

  function send(text: string) {
    if (
      !text.trim() ||
      answerMutation.isPending ||
      historyLoading ||
      !workspace ||
      surveysQuery.isPending ||
      taskQuestionSending.current ||
      taskMutation.isPending ||
      completionSending.current
    )
      return;
    if (isTaskCompletionMessage(text)) {
      confirmChatTask(text.trim());
      return;
    }
    const suggestion = questions.find((question) => question.text === text.trim());
    const shortcut = suggestion?.task ? undefined : absenceServiceLink(text);
    const currentTaskQuestion = !suggestion?.task && isChecklistQuestion(text);
    const selection = suggestion?.task
      ? checklistQuestion(profileId, suggestion.task).context
      : shortcut || currentTaskQuestion || suggestion
        ? undefined
        : activeTask;
    setServiceShortcut(shortcut);
    if (shortcut || currentTaskQuestion || (suggestion && !suggestion.task)) {
      setActiveTask(undefined);
      setCompletionTargetId(null);
      setAwaitingService(false);
    }
    taskQuestionSending.current = true;
    const id = nextEntry.current++;
    setEntries((items) => [...items, { id, from: 'user', text: text.trim() }]);
    answerMutation.mutate({
      text: text.trim(),
      context: chatPageContext(profileId, workspace, selection, !surveysQuery.isError),
    });
  }

  function openBuddy() {
    setCompletionVisible(false);
    setActiveTask(undefined);
    setCompletionTargetId(undefined);
    setDrawerOpen(true);
  }
  function retryQuestion() {
    if (!lastQuestion.current || answerMutation.isPending || taskQuestionSending.current) return;
    taskQuestionSending.current = true;
    const context = lastQuestion.current.context;
    setActiveTask(context?.selection ? { url: context.url, selection: context.selection } : undefined);
    answerMutation.mutate(lastQuestion.current);
  }
  function askTask(item: Task) {
    if (
      answerMutation.isPending ||
      historyLoading ||
      !workspace ||
      surveysQuery.isPending ||
      taskQuestionSending.current
    )
      return;
    taskQuestionSending.current = true;
    setCompletionTargetId(item.id);
    const question = checklistQuestion(profileId, item);
    const id = nextEntry.current++;
    setEntries((items) => [...items, { id, from: 'user', text: question.text }]);
    setActiveTask(question.context);
    closeDetail();
    setDrawerOpen(true);
    answerMutation.mutate({
      ...question,
      context: chatPageContext(profileId, workspace, question.context, !surveysQuery.isError),
    });
  }

  const params = new URLSearchParams(location.search);
  const task =
    location.pathname === '/onboarding' &&
    checklistFor(localStorage, profileId).find((item) => item.id === params.get('task'));
  const person =
    location.pathname === '/team' &&
    [...teamContacts(profileId), ...teamColleagues(profileId)].find((item) => item.id === params.get('person'));
  const service =
    location.pathname === '/tools' && toolsFor(profileId).find((item) => item.id === params.get('service'));
  const linkedSurvey =
    location.pathname === '/onboarding' && (surveyStage(params.get('survey')) || (task && surveyForTask(task.id)));
  const linkedDetail: Detail | null = linkedSurvey
    ? { kind: 'survey', stage: linkedSurvey }
    : task
      ? { kind: 'task', item: task }
      : person
        ? { kind: 'person', item: person }
        : service && 'instruction' in service
          ? { kind: 'service', item: service }
          : null;
  const shownDetail = detail ?? linkedDetail;
  function closeDetail() {
    setDetail(null);
    if (linkedDetail) navigate(location.pathname, { replace: true });
  }
  function openSurvey(stage: SurveyStage = profile.stageId) {
    setAlertsOpen(false);
    setDrawerOpen(false);
    setDetail({ kind: 'survey', stage });
  }
  const chatProps = {
    profileId,
    name: profile.name,
    entries,
    suggestedQuestions: questions.map(({ text }) => text),
    waiting:
      answerMutation.isPending || historyLoading || !workspace || surveysQuery.isPending || taskMutation.isPending,
    confirming: confirmation.isPending,
    drafts,
    onSend: send,
    serviceShortcut,
    completionTask:
      completionVisible && completionTarget && !surveysQuery.isError
        ? {
            id: completionTarget.id,
            title: completionTarget.title,
            completed: workspace?.completed.includes(completionTarget.id) ?? false,
            survey: Boolean(surveyForTask(completionTarget.id)),
          }
        : undefined,
    onCompleteTask: () => confirmChatTask(),
    onConfirm: (draft: AccessDraft) => confirmation.mutate(draft),
    onDismiss: (draft: AccessDraft) => setDrafts((previous) => ({ ...previous, [draft.id]: { type: 'dismissed' } })),
    onSurvey: () => openSurvey(),
    surveyDone: completedStages?.includes(profile.stageId) ?? false,
    taskContext,
    contextMaterials: taskContext ? (
      <TaskMaterialList profileId={profileId} taskId={taskContext.id} compact />
    ) : undefined,
    onClearContext: () => {
      setCompletionVisible(false);
      setActiveTask(undefined);
      setCompletionTargetId(undefined);
    },
    error: chatError,
    onRetry: retryQuestion,
  };

  const checklist = workspace && {
    workspace,
    asking: answerMutation.isPending || historyLoading || surveysQuery.isPending,
    onAsk: askTask,
    onOpenBuddy: openBuddy,
    onOpen: (next: Detail) => {
      setDrawerOpen(false);
      setDetail(next);
    },
    onToggle: (id: string) => taskMutation.mutate({ id }),
    savingTask: taskMutation.isPending ? taskMutation.variables?.id : undefined,
  };

  return (
    <div className={'shell' + (drawerOpen && location.pathname !== '/chat' ? ' shell--buddy-open' : '')}>
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
            className="sidebar-question"
            onClick={() => {
              setNavOpen(false);
              setQuestionOpen(true);
            }}
          >
            <Icon name="message" size={18} />
            <span>Задать вопрос по работе сервиса</span>
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
              onClick={() => setAlertsOpen(true)}
            >
              <Icon name="bell" />
              {unreadCount > 0 && <span aria-label={'Непрочитанных уведомлений: ' + unreadCount}>{unreadCount}</span>}
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
                <Route path="/onboarding/tasks/:taskId" element={<OnboardingTaskPage profileId={profileId} />} />
                <Route path="/onboarding" element={<Adaptation profileId={profileId} {...checklist} />} />
                <Route
                  path="/events"
                  element={
                    <Schedule
                      loading={backendEnabled && calendar.isPending}
                      loadError={backendEnabled && calendar.isError}
                      onRetry={() => void calendar.refetch()}
                      hrEvents={hrEvents}
                      hrError={hrError}
                      events={events}
                      now={scheduleNow}
                      onChange={changeSchedule}
                    />
                  }
                />
                <Route path="/team" element={<Team profileId={profileId} onOpen={setDetail} />} />
                <Route path="/tools" element={<Tools profileId={profileId} onOpen={setDetail} />} />
                <Route
                  path="/resources"
                  element={<Resources directory={<CorporateDirectory profileId={profileId} />} />}
                />
                <Route path="/actions/:actionId" element={<ServiceActionPage profileId={profileId} />} />
                <Route path="/chat" element={<ChatPage {...chatProps} />} />
                <Route path="*" element={<Navigate to="/home" replace />} />
              </Routes>
            </div>
          )}
        </main>
      </div>
      {location.pathname !== '/chat' && !drawerOpen && (
        <button
          type="button"
          className="floating-buddy"
          aria-label="Открыть панель Buddy"
          onClick={() => {
            setMood('surprised');
            openBuddy();
          }}
        >
          <Buddy mood={answerMutation.isPending ? 'thinking' : mood} compact />
        </button>
      )}
      {questionOpen && (
        <Modal title="Вопрос по работе сервиса" onClose={() => setQuestionOpen(false)}>
          <ServiceQuestionForm
            profileId={profileId}
            onSaved={() => {
              setQuestionOpen(false);
              setToast({ tone: 'success', message: 'Вопрос сохранён.' });
            }}
          />
        </Modal>
      )}
      {searchOpen && <SearchDialog profileId={profileId} onClose={() => setSearchOpen(false)} />}
      {alertsOpen && (
        <Modal title="Уведомления" onClose={() => setAlertsOpen(false)}>
          {notificationsQuery.isPending && <p>Загружаем уведомления…</p>}
          {notificationsQuery.isError && (
            <button className="button button--white" onClick={() => void notificationsQuery.refetch()}>
              Повторить загрузку уведомлений
            </button>
          )}
          {readFailed && unreadIds && (
            <button className="button button--white" onClick={() => markRead(unreadIds.split(','))}>
              Повторить отметку о прочтении
            </button>
          )}
          {notifications?.map((notification) => {
            const stage = notificationSurvey(notification.action_url);
            return (
              <div key={notification.id} className="alert-card tone-lilac">
                <Icon name="flag" />
                <div>
                  <h3>{notification.title}</h3>
                  <p>{notification.text}</p>
                  {stage ? (
                    <button type="button" className="button button--white" onClick={() => openSurvey(stage)}>
                      {notification.action_title}
                    </button>
                  ) : (
                    notification.action_url && (
                      <Link to={notification.action_url} className="text-link" onClick={() => setAlertsOpen(false)}>
                        {notification.action_title}
                      </Link>
                    )
                  )}
                </div>
              </div>
            );
          })}
          {notifications?.length === 0 && (
            <EmptyState title="Новых уведомлений нет" text="Важные напоминания появятся здесь." />
          )}
        </Modal>
      )}
      {drawerOpen && location.pathname !== '/chat' && (
        <BuddyPanel {...chatProps} onClose={() => setDrawerOpen(false)} />
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
                : surveys[shownDetail.stage].title
          }
          onClose={closeDetail}
        >
          {shownDetail.kind === 'task' && (
            <div className="detail-content">
              <TaskMaterialList profileId={profileId} taskId={shownDetail.item.id} />
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
                  className="button button--white"
                  disabled={answerMutation.isPending || historyLoading || surveysQuery.isPending}
                  onClick={() => askTask(shownDetail.item)}
                >
                  Разобрать пункт
                </button>
                <button
                  type="button"
                  className="button button--dark"
                  disabled={taskMutation.isPending}
                  onClick={() => taskMutation.mutate({ id: shownDetail.item.id })}
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
              <p>{shownDetail.item.description}</p>
              <p>{shownDetail.item.instruction}</p>
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
            (completedStages?.includes(shownDetail.stage) ? (
              <EmptyState title="Спасибо за ответы!" text="Опрос уже заполнен." />
            ) : completedStages ? (
              <InternshipSurvey
                key={shownDetail.stage}
                stage={shownDetail.stage}
                onSubmit={async (answers) => {
                  const stage = shownDetail.stage;
                  await submitSurvey(profileId, stage, answers);
                  await queryClient.cancelQueries({ queryKey: surveysKey });
                  queryClient.setQueryData<SurveyStage[]>(surveysKey, (previous) => [
                    ...new Set([...(previous ?? []), stage]),
                  ]);
                  void queryClient.invalidateQueries({ queryKey: notificationsKey });
                  closeDetail();
                  setMood('celebrating');
                  setToast({
                    tone: 'success',
                    message: 'Ответы получены, спасибо за прохождение!',
                    placement: 'top-right',
                  });
                }}
              />
            ) : surveysQuery.isError ? (
              <button className="button button--white" onClick={() => void surveysQuery.refetch()}>
                Повторить загрузку опроса
              </button>
            ) : (
              <p>Загружаем опрос…</p>
            ))}
        </Modal>
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} placement={toast.placement} />}
    </div>
  );
}

function ExternalWorkTool() {
  const { pathname, search, hash } = useLocation();
  useEffect(() => {
    window.location.replace(workToolsOrigin + pathname + search + hash);
  }, [pathname, search, hash]);
  return <p role="status">Открываем рабочий инструмент…</p>;
}

export default function App() {
  const [account, setAccount] = useState(() => readDemoSession(localStorage));
  const { pathname } = useLocation();

  useEffect(() => {
    document.cookie = accountCookieValue(account);
  }, [account]);

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

  if (pathname.startsWith('/work-tools/')) {
    if (workToolsOrigin) return <ExternalWorkTool />;
    return (
      <main className="work-tool-page">
        <Routes>
          <Route path="/work-tools/:service" element={<WorkToolPage profileId={account} />} />
          <Route path="*" element={<Navigate to="/tools" replace />} />
        </Routes>
      </main>
    );
  }
  return <WorkspaceShell key={account} profileId={account} onExit={exit} />;
}
