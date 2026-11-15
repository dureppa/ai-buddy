import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { askSelectionBackend, backendEnabled } from './backend';
import { AgentAnswer } from './AgentAnswer';
import { Buddy, Icon } from './ui';
import { captureSelection, type ExplanationContext, type SelectionTarget } from './selection-context';
import type { ProfileId } from './demo-accounts';
import './selection-assistant.css';

type Props = { profileId: ProfileId; apiPrefix?: string; enabled?: boolean };
type Answer = Awaited<ReturnType<typeof askSelectionBackend>>;
type Entry = { question?: string; answer?: Answer };
type Panel = {
  context: ExplanationContext;
  portal: HTMLElement;
  entries: Entry[];
  conversation?: string;
  waiting: boolean;
  error?: string;
  lastQuestion: string;
};
const initialQuestion =
  'Объясни выделенный фрагмент: что это означает, зачем нужно и как связано с текущей задачей или материалом. Ответь коротко по пунктам.';

export function SelectionAssistant(props: Props) {
  return <SelectionAssistantSession key={props.profileId} {...props} />;
}
function SelectionAssistantSession({ profileId, apiPrefix = '/api', enabled = backendEnabled }: Props) {
  const [target, setTarget] = useState<SelectionTarget | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [question, setQuestion] = useState('');
  const request = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const latestPanel = useRef(panel);
  latestPanel.current = panel;

  function close() {
    revision.current++;
    request.current?.abort();
    setPanel(null);
    setTarget(null);
    setQuestion('');
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
  }
  useEffect(() => {
    let timer = 0;
    let selectedAt = 0;
    function update() {
      const next = captureSelection();
      const same =
        next?.context &&
        latestPanel.current &&
        JSON.stringify(next.context) === JSON.stringify(latestPanel.current.context);
      setTarget(same ? null : next);
      if (next) selectedAt = Date.now();
    }
    function delayed() {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 120);
    }
    function click(event: MouseEvent) {
      if (
        event.detail &&
        Date.now() - selectedAt < 300 &&
        window.getSelection()?.toString().trim() &&
        event.target instanceof Element &&
        !event.target.closest('[data-selection-assistant]')
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    function dismiss(event: KeyboardEvent) {
      if (event.key === 'Escape' && (latestPanel.current || window.getSelection()?.toString())) {
        event.preventDefault();
        event.stopPropagation();
        close();
        window.getSelection()?.removeAllRanges();
      }
    }
    function moved() {
      setTarget(null);
    }
    function dialogClosed(event: Event) {
      if (event.target === latestPanel.current?.portal) close();
    }
    document.addEventListener('mouseup', update);
    document.addEventListener('keyup', delayed);
    document.addEventListener('selectionchange', delayed);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('close', dialogClosed, true);
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', moved);
    return () => {
      revision.current++;
      request.current?.abort();
      window.clearTimeout(timer);
      document.removeEventListener('mouseup', update);
      document.removeEventListener('keyup', delayed);
      document.removeEventListener('selectionchange', delayed);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', dismiss, true);
      document.removeEventListener('close', dialogClosed, true);
      window.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', moved);
    };
  }, []);
  useEffect(() => {
    triggerRef.current?.showPopover?.();
  }, [target]);
  useEffect(() => {
    panelRef.current?.showPopover?.();
    panelRef.current?.querySelector<HTMLButtonElement>('[aria-label="Закрыть пояснение"]')?.focus();
  }, [panel?.context]);

  useEffect(() => {
    if (!panel || panel.portal === document.body) return;
    const source = panel.portal;
    const observer = new MutationObserver(() => {
      if (!source.isConnected || (source instanceof HTMLDialogElement && !source.open)) close();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, [panel?.portal]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [panel?.entries, panel?.waiting]);

  async function send(text: string, current: Panel, retry = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const id = ++revision.current;
    const entries = retry || text === initialQuestion ? current.entries : [...current.entries, { question: text }];
    setPanel({ ...current, entries, waiting: true, error: undefined, lastQuestion: text });
    try {
      if (!enabled) throw new Error('Пояснения доступны в серверном режиме AI Buddy.');
      const answer = await askSelectionBackend(
        profileId,
        text,
        current.context,
        current.conversation,
        controller.signal,
        apiPrefix,
      );
      if (revision.current === id)
        setPanel({
          ...current,
          entries: [...entries, { answer }],
          waiting: false,
          error: undefined,
          conversation: answer.conversation_id,
          lastQuestion: text,
        });
    } catch (error) {
      if (revision.current === id && !controller.signal.aborted)
        setPanel({
          ...current,
          entries,
          waiting: false,
          lastQuestion: text,
          error: error instanceof Error ? error.message : 'Не удалось получить пояснение. Попробуй ещё раз.',
        });
    }
  }
  function open() {
    if (!target?.context) return;
    if (document.activeElement instanceof HTMLElement && !document.activeElement.closest('[data-selection-assistant]'))
      returnFocus.current = document.activeElement;
    const current: Panel = {
      context: target.context,
      portal: target.portal,
      entries: [],
      waiting: false,
      lastQuestion: initialQuestion,
    };
    setTarget(null);
    setQuestion('');
    void send(initialQuestion, current);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!panel || panel.waiting || !question.trim()) return;
    void send(question.trim(), panel);
    setQuestion('');
  }
  return (
    <>
      {target &&
        createPortal(
          <div
            data-selection-assistant
            popover="manual"
            ref={triggerRef}
            className="selection-assistant selection-assistant--trigger"
            style={{ left: target.left, top: target.top }}
          >
            {target.error ? (
              <span role="status" className="selection-assistant__notice">
                {target.error}
              </span>
            ) : (
              <button
                type="button"
                className="selection-assistant__trigger"
                onMouseDown={(event) => event.preventDefault()}
                onClick={open}
              >
                <Icon name="sparkles" size={16} />
                Уточнить у агента
              </button>
            )}
          </div>,
          target.portal,
        )}
      {panel &&
        createPortal(
          <aside
            data-selection-assistant
            popover="manual"
            className="selection-assistant selection-assistant--panel"
            aria-label="Пояснение выделенного текста"
            ref={panelRef}
          >
            <header className="selection-assistant__header">
              <Buddy compact />
              <div>
                <h2>Уточнить у агента</h2>
                <p>Помогу разобраться в контексте</p>
              </div>
              <button
                type="button"
                className="selection-assistant__close"
                aria-label="Закрыть пояснение"
                onClick={close}
              >
                <Icon name="close" size={19} />
              </button>
            </header>
            <div className="selection-assistant__body" ref={bodyRef}>
              <div className="selection-assistant__context">
                <small>
                  {panel.context.selection.resource?.label || panel.context.selection.title || 'Выделенный фрагмент'}
                </small>
                <blockquote>{panel.context.selection.text}</blockquote>
              </div>
              <div role="log" aria-label="Пояснения агента" aria-live="polite">
                {panel.entries.map((entry, index) => (
                  <div
                    key={index}
                    className={entry.question ? 'selection-assistant__question' : 'selection-assistant__answer'}
                  >
                    {entry.question ||
                      (entry.answer && <AgentAnswer text={entry.answer.text} references={entry.answer.references} />)}
                  </div>
                ))}
                {panel.waiting && (
                  <p role="status" className="selection-assistant__pending">
                    Читаю контекст и материалы…
                  </p>
                )}
                {panel.error && (
                  <div role="alert" className="selection-assistant__error">
                    <p>{panel.error}</p>
                    <button type="button" onClick={() => void send(panel.lastQuestion, panel, true)}>
                      Повторить
                    </button>
                  </div>
                )}
              </div>
            </div>
            <form className="selection-assistant__form" onSubmit={submit}>
              <label htmlFor="selection-question">Уточни, что осталось непонятно</label>
              <div>
                <input
                  id="selection-question"
                  placeholder="Например, как это связано с моей задачей?"
                  maxLength={700}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  disabled={panel.waiting}
                />
                <button type="submit" aria-label="Отправить уточнение" disabled={!question.trim() || panel.waiting}>
                  <Icon name="send" size={18} />
                </button>
              </div>
            </form>
          </aside>,
          panel.portal,
        )}
    </>
  );
}
