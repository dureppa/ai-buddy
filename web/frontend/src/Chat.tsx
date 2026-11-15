import { AgentAnswer } from './AgentAnswer';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { chatDestination } from './chat-links';
import { services, suggestions, type ProfileId } from './data';
import type { AccessDraft, BuddyReply } from './demo';
import { Buddy, Icon } from './ui';

export type ChatEntry = { id: number; from: 'user'; text: string } | { id: number; from: 'buddy'; reply: BuddyReply };
export type DraftState = { type: 'dismissed' } | { type: 'confirmed'; number: string };

type ChatProps = {
  name: string;
  profileId: ProfileId;
  entries: ChatEntry[];
  waiting: boolean;
  confirming: boolean;
  drafts: Record<string, DraftState>;
  onSend: (text: string) => void;
  onConfirm: (draft: AccessDraft) => void;
  onDismiss: (draft: AccessDraft) => void;
  onSurvey: () => void;
  surveyDone: boolean;
  onNavigate?: () => void;
};

function DraftCard({
  draft,
  state,
  confirming,
  onConfirm,
  onDismiss,
}: {
  draft: AccessDraft;
  state?: DraftState;
  confirming: boolean;
  onConfirm: (draft: AccessDraft) => void;
  onDismiss: (draft: AccessDraft) => void;
}) {
  const service = services.find((item) => item.id === draft.serviceId);
  return (
    <div className="draft-card">
      <div className="draft-card__title">
        <span className="icon-tile tone-mint">
          <Icon name="key" size={18} />
        </span>
        <div>
          <strong>{service?.title}</strong>
          <small>Заявка на доступ</small>
        </div>
      </div>
      {state?.type === 'confirmed' ? (
        <p className="draft-result">
          <Icon name="check" size={17} /> Заявка {state.number} отправлена
        </p>
      ) : state?.type === 'dismissed' ? (
        <p className="draft-result">Черновик отменён</p>
      ) : (
        <div className="button-row">
          <button type="button" className="button button--dark" disabled={confirming} onClick={() => onConfirm(draft)}>
            {confirming ? 'Отправляем…' : 'Подтвердить'}
          </button>
          <button type="button" className="button button--white" disabled={confirming} onClick={() => onDismiss(draft)}>
            Отменить
          </button>
        </div>
      )}
    </div>
  );
}

export function ChatWindow({
  name,
  profileId,
  entries,
  waiting,
  confirming,
  drafts,
  onSend,
  onConfirm,
  onDismiss,
  onSurvey,
  surveyDone,
  onNavigate,
}: ChatProps) {
  const [input, setInput] = useState('');
  const messageArea = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = messageArea.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [entries, waiting]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || waiting) return;
    onSend(text);
    setInput('');
  }

  return (
    <div className="chat-window">
      <div className="messages" ref={messageArea} role="log" aria-label="Переписка с Buddy" aria-live="polite">
        <article className="chat-entry">
          <Buddy compact />
          <div>
            <span className="sender">AI-buddy</span>
            <div className="bubble">
              Привет, {name}! Я помогу разобраться с задачами, познакомиться с командой или запросить рабочий доступ. С
              чего начнём?
            </div>
          </div>
        </article>
        {profileId === 'sasha' && !surveyDone && (
          <div className="chat-notice tone-lilac">
            <Icon name="flag" size={22} />
            <div>
              <strong>Экватор стажировки</strong>
              <p>Поделись впечатлениями о первых месяцах.</p>
            </div>
            <button type="button" className="button button--white" onClick={onSurvey}>
              Пройти опрос
            </button>
          </div>
        )}
        {entries.map((entry) =>
          entry.from === 'user' ? (
            <article className="chat-entry chat-entry--user" key={entry.id}>
              <div>
                <span className="sender">Ты</span>
                <div className="bubble">{entry.text}</div>
              </div>
            </article>
          ) : (
            <article className="chat-entry" key={entry.id}>
              <Buddy
                compact
                mood={
                  entry.reply.kind === 'access_denied'
                    ? 'supportive'
                    : entry.reply.kind === 'access_confirmation_required'
                      ? 'surprised'
                      : 'happy'
                }
              />
              <div>
                <span className="sender">AI-buddy</span>
                <div className="bubble">
                  <AgentAnswer text={entry.reply.text} references={entry.reply.references} profileId={profileId} />
                  {entry.reply.lines?.length ? (
                    <ul>
                      {entry.reply.lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                  {entry.reply.link && chatDestination(entry.reply.link.to, profileId) && (
                    <Link
                      className="text-link bubble-link"
                      to={chatDestination(entry.reply.link.to, profileId)!}
                      onClick={onNavigate}
                    >
                      {entry.reply.link.label} <Icon name="diagonal" size={16} />
                    </Link>
                  )}
                  {entry.reply.kind === 'access_confirmation_required' && (
                    <DraftCard
                      draft={entry.reply.draft}
                      state={drafts[entry.reply.draft.id]}
                      confirming={confirming}
                      onConfirm={onConfirm}
                      onDismiss={onDismiss}
                    />
                  )}
                </div>
              </div>
            </article>
          ),
        )}
        {waiting && (
          <div className="chat-entry typing" role="status" aria-label="Buddy думает">
            <Buddy compact />
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>
      <div className="chat-controls">
        <div className="suggestions" aria-label="Предложенные вопросы">
          {suggestions.slice(0, entries.length ? 2 : 4).map((question) => (
            <button type="button" className="filter" key={question} disabled={waiting} onClick={() => onSend(question)}>
              {question}
            </button>
          ))}
        </div>
        <form className="chat-form" onSubmit={submit}>
          <input
            aria-label="Сообщение для Buddy"
            placeholder="Спроси меня о чём угодно…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={700}
          />
          <button
            className="send-button"
            type="submit"
            aria-label="Отправить сообщение"
            disabled={!input.trim() || waiting}
          >
            <Icon name="send" size={19} />
          </button>
        </form>
      </div>
    </div>
  );
}

export function ChatPage(props: ChatProps) {
  return (
    <>
      <header className="chat-hero tone-lilac">
        <div>
          <div className="chat-mode">
            <span /> Демо-режим
          </div>
          <h1>Твой AI-buddy</h1>
          <p>Рядом, пока ты осваиваешься в команде.</p>
        </div>
        <Buddy mood={props.waiting ? 'thinking' : 'happy'} />
      </header>
      <div className="chat-layout">
        <section className="panel chat-panel">
          <ChatWindow {...props} />
        </section>
        <aside className="panel chat-aside">
          <span className="icon-tile tone-mint">
            <Icon name="sparkles" size={22} />
          </span>
          <h2>С чего начать</h2>
          <p>Выбери вопрос или напиши свой.</p>
          {suggestions.map((question) => (
            <button
              type="button"
              className="chat-topic"
              key={question}
              disabled={props.waiting}
              onClick={() => props.onSend(question)}
            >
              {question}
              <Icon name="arrow" size={17} />
            </button>
          ))}
        </aside>
      </div>
    </>
  );
}
