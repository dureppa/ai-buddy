import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { profiles } from '../../../web/frontend/src/demo-accounts';
import { boardSchema, filterIssues, jiraClient, priorities, statuses, type Issue, type IssueInput } from './api';
import type { z } from 'zod';
import './style.css';

function setLocation(space?: string, board?: string, issue?: string) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries({ space, board, issue })) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.replaceState(null, '', url);
}
export function JiraPage({ profile }: { profile: keyof typeof profiles }) {
  const api = useMemo(() => jiraClient(profile), [profile]);
  const initial = new URLSearchParams(window.location.search);
  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>([]);
  const [boards, setBoards] = useState<{ id: string; name: string; key: string }[]>([]);
  const [spaceId, setSpace] = useState(initial.get('space') || '');
  const [boardId, setBoardId] = useState(initial.get('board') || '');
  const [board, setBoard] = useState<z.infer<typeof boardSchema>>();
  const [selected, setSelected] = useState<Issue | 'new'>();
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setPending(true);
    setError('');
    setBoard(undefined);
    setBoards([]);
    setSelected(undefined);
    (async () => {
      const allSpaces = await api.spaces();
      if (!active) return;
      setSpaces(allSpaces);
      const space = spaceId || allSpaces[0]?.id;
      if (!space) return;
      const allBoards = await api.boards(space);
      if (!active) return;
      setBoards(allBoards);
      setSpace(space);
      const id = boardId || allBoards[0]?.id;
      if (!id) {
        setLocation(space);
        return;
      }
      const result = await api.board(id);
      if (result.space_id !== space) throw new Error('Доска не относится к выбранному пространству.');
      if (!active) return;
      setBoard(result);
      setBoardId(id);
      setLocation(space, id, initial.get('issue') || undefined);
      const issueId = initial.get('issue');
      if (issueId) {
        const found = result.issues.find((i) => i.id === issueId);
        if (!found) throw new Error('Задача не найдена на доске.');
        setSelected(found);
      }
    })()
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Не удалось загрузить Jira.');
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [api, spaceId, boardId, revision]);
  const issues = filterIssues(board?.issues || [], query, mine, profile);
  function chooseSpace(id: string) {
    setLocation(id);
    setSpace(id);
    setBoardId('');
  }
  function chooseBoard(id: string) {
    setLocation(spaceId, id);
    setBoardId(id);
  }
  function open(issue: Issue | 'new') {
    setSelected(issue);
    setLocation(spaceId, boardId, issue === 'new' ? undefined : issue.id);
  }
  function close() {
    setSelected(undefined);
    setLocation(spaceId, boardId);
  }
  return (
    <div className="jira-app">
      <header className="jira-header">
        <a href={'/?profile=' + profile} className="jira-logo">
          <span>◆</span> Jira <small>Team workspace</small>
        </a>
        <span>{profiles[profile].fullName}</span>
      </header>
      <div className="jira-layout">
        <aside className="jira-sidebar">
          <p className="jira-eyebrow">Рабочее пространство</p>
          <label className="jira-space-label">
            Пространство
            <select value={spaceId} onChange={(e) => chooseSpace(e.target.value)} disabled={pending}>
              {spaces.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <h2>Доски</h2>
          <nav aria-label="Доски Jira">
            {boards.map((b) => (
              <button
                key={b.id}
                className={boardId === b.id ? 'active' : ''}
                onClick={() => chooseBoard(b.id)}
                disabled={pending}
              >
                <span>▦</span>
                {b.name}
                <small>{b.key}</small>
              </button>
            ))}
          </nav>
          <p className="jira-sidebar-note">Здесь отображаются доски, в которые вас добавила команда.</p>
        </aside>
        <main className="jira-main">
          <p className="jira-eyebrow">{spaces.find((s) => s.id === spaceId)?.name || 'Jira'} / Доски</p>
          <div className="jira-heading">
            <div>
              <h1>{board?.name || 'Ваши доски'}</h1>
              <p>Планируйте работу и двигайте задачи к результату.</p>
            </div>
            <button className="jira-primary" disabled={!board || pending} onClick={() => open('new')}>
              + Создать задачу
            </button>
          </div>
          {pending && <p role="status">Загружаем рабочее пространство…</p>}
          {error && (
            <div className="jira-error" role="alert">
              {error} <button onClick={() => setRevision((v) => v + 1)}>Повторить</button>
            </div>
          )}
          {!pending && !error && !board && (
            <p>Пока нет доступных досок. Попросите наставника добавить вас в команду.</p>
          )}
          {board && (
            <>
              <div className="jira-toolbar">
                <label>
                  Поиск задач
                  <input
                    type="search"
                    placeholder="Ключ или название задачи"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <label className="jira-mine">
                  <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
                  Только мои
                </label>
                <span>
                  {board.members.length} участника · {issues.length} задач
                </span>
              </div>
              <div className="jira-kanban">
                {Object.entries(statuses).map(([status, label]) => (
                  <section className="jira-column" key={status} aria-label={label}>
                    <h2>
                      {label}
                      <span>{issues.filter((i) => i.status === status).length}</span>
                    </h2>
                    {issues
                      .filter((i) => i.status === status)
                      .map((issue) => (
                        <button className="jira-card" key={issue.id} onClick={() => open(issue)}>
                          <span className={'jira-priority jira-priority--' + issue.priority}>
                            {priorities[issue.priority]}
                          </span>
                          <strong>{issue.title}</strong>
                          <span className="jira-card-description">{issue.description}</span>
                          <span className="jira-card-footer">
                            <small>{issue.key}</small>
                            <span>
                              {board.members.find((m) => m.id === issue.assignee_id)?.name || 'Без исполнителя'}
                            </span>
                          </span>
                          {issue.due_date && <small>Срок: {issue.due_date}</small>}
                        </button>
                      ))}
                    {!issues.some((i) => i.status === status) && <p className="jira-empty">Нет задач</p>}
                  </section>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
      {selected && board && (
        <IssueEditor
          key={selected === 'new' ? 'new' : selected.id}
          issue={selected}
          members={board.members}
          onClose={close}
          onSave={async (input) => {
            await api.save(board.id, input, selected === 'new' ? undefined : selected.id);
            close();
            setRevision((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
export function IssueEditor({
  issue,
  members,
  onClose,
  onSave,
}: {
  issue: Issue | 'new';
  members: { id: string; name: string }[];
  onClose: () => void;
  onSave: (input: IssueInput) => Promise<void>;
}) {
  const [input, setInput] = useState<IssueInput>(
    issue === 'new'
      ? {
          title: '',
          description: '',
          status: 'todo',
          priority: 'medium',
          assignee_id: null,
          due_date: null,
          version: 1,
        }
      : {
          title: issue.title,
          description: issue.description,
          status: issue.status,
          priority: issue.priority,
          assignee_id: issue.assignee_id,
          due_date: issue.due_date,
          version: issue.version,
        },
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError('');
    try {
      await onSave(input);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить задачу.');
    } finally {
      setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="jira-editor"
      aria-labelledby="jira-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
    >
      <div className="jira-heading">
        <h2 id="jira-editor-title">{issue === 'new' ? 'Новая задача' : issue.key}</h2>
        <button type="button" onClick={onClose} disabled={pending} aria-label="Закрыть задачу">
          ✕
        </button>
      </div>
      {issue !== 'new' && (
        <section className="jira-issue-context">
          <h3>{issue.title}</h3>
          <p>{issue.description}</p>
        </section>
      )}
      <form onSubmit={(e) => void submit(e)}>
        <fieldset disabled={pending}>
          <label>
            Название
            <input
              required
              autoFocus
              maxLength={200}
              value={input.title}
              onChange={(e) => setInput({ ...input, title: e.target.value })}
            />
          </label>
          <label>
            Описание
            <textarea
              rows={5}
              maxLength={10000}
              value={input.description}
              onChange={(e) => setInput({ ...input, description: e.target.value })}
            />
          </label>
          <div className="jira-form-grid">
            <label>
              Статус
              <select
                value={input.status}
                onChange={(e) => setInput({ ...input, status: e.target.value as Issue['status'] })}
              >
                {Object.entries(statuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Приоритет
              <select
                value={input.priority}
                onChange={(e) => setInput({ ...input, priority: e.target.value as Issue['priority'] })}
              >
                {Object.entries(priorities).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Исполнитель
            <select
              value={input.assignee_id || ''}
              onChange={(e) => setInput({ ...input, assignee_id: e.target.value || null })}
            >
              <option value="">Без исполнителя</option>
              {members.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Срок
            <input
              type="date"
              value={input.due_date || ''}
              onChange={(e) => setInput({ ...input, due_date: e.target.value || null })}
            />
          </label>
        </fieldset>
        {issue !== 'new' && (
          <p className="jira-meta">
            Автор: {members.find((m) => m.id === issue.reporter_id)?.name || issue.reporter_id} · Версия {issue.version}
          </p>
        )}
        {error && (
          <p role="alert" className="jira-error">
            {error}
          </p>
        )}
        <div className="jira-editor-actions">
          <button type="button" onClick={onClose} disabled={pending}>
            Отмена
          </button>
          <button className="jira-primary" disabled={pending}>
            {pending ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
