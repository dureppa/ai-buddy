import { useState } from 'react';
import type { Props } from '../../shared/frontend/work-tool-data';
import { Status } from '../../shared/frontend/view-ui';

export function Channel({ record }: Props) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  return (
    <div className="tool-channel">
      <div className="tool-thread">
        <Status>{record.status}</Status>
        <p>{record.description}</p>
      </div>
      <ul aria-label="Учебные сообщения">
        {messages.map((message, index) => (
          <li key={index}>
            <strong>Вы</strong>
            <p>{message}</p>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const message = draft.trim();
          if (message) {
            setMessages([...messages, message]);
            setDraft('');
          }
        }}
      >
        <textarea
          aria-label="Сообщение"
          placeholder="Написать в канал…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="tool-primary" disabled={!draft.trim()}>
          Отправить
        </button>
      </form>
    </div>
  );
}
