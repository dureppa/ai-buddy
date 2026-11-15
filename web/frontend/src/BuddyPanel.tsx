import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChatWindow, type ChatProps } from './Chat';
import { Buddy, Icon } from './ui';

export function BuddyPanel({ onClose, ...chat }: ChatProps & { onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        close.current();
      }
    }
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('keydown', escape);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <aside className="buddy-panel" aria-label="Чат с Buddy" ref={panel}>
      <header className="buddy-panel__header">
        <Buddy compact />
        <div>
          <h2>Buddy рядом</h2>
          <p>{chat.taskContext ? 'Разберём пункт адаптации' : 'Помогу с вопросами'}</p>
        </div>
        <button type="button" className="icon-button" aria-label="Закрыть панель Buddy" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <ChatWindow {...chat} onNavigate={onClose} />
      <Link to="/chat" className="text-link buddy-panel__expand" onClick={onClose}>
        Открыть полный чат <Icon name="arrow" size={16} />
      </Link>
    </aside>
  );
}
