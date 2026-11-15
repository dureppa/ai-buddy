import { useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

import { getPageHelp } from './context';

const webUrl = import.meta.env.VITE_WEB_URL || 'http://localhost:5173/';
const buddy = './buddy.webp';

function Popup() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);

  async function ask(text: string) {
    if (!text.trim() || pending) return;
    setPending(true);
    setAnswer('');
    try {
      const api = typeof chrome !== 'undefined' ? chrome.tabs : undefined;
      const [tab] = api ? await api.query({ active: true, currentWindow: true }) : [];
      setAnswer(getPageHelp(tab?.url, webUrl, text));
    } catch {
      setAnswer('Не получилось прочитать адрес вкладки. Открой инструменты в AI-buddy и попробуй ещё раз.');
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  function openWeb() {
    const target = new URL('/tools', webUrl).href;
    if (typeof chrome !== 'undefined' && chrome.tabs) void chrome.tabs.create({ url: target });
    else window.open(target, '_blank', 'noopener,noreferrer');
  }

  return (
    <main>
      <header>
        <span>AI-buddy</span>
        <img src={buddy} alt="" />
      </header>
      <h1>Помочь с этой страницей?</h1>
      <p>Могу подсказать, где посмотреть инструменты и как запросить доступ.</p>
      <form onSubmit={submit}>
        <label htmlFor="question">Вопрос о странице</label>
        <input
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Где здесь запросить доступ?"
          maxLength={300}
        />
        <button type="submit" disabled={!question.trim() || pending}>
          {pending ? 'Смотрю…' : 'Спросить'}
        </button>
      </form>
      <button
        type="button"
        className="suggestion"
        disabled={pending}
        onClick={() => void ask('Где здесь запросить доступ?')}
      >
        Где здесь запросить доступ?
      </button>
      <div aria-live="polite">{answer && <p className="answer">{answer}</p>}</div>
      <button type="button" className="open-web" onClick={openWeb}>
        Открыть AI-buddy <span aria-hidden="true">↗</span>
      </button>
    </main>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<Popup />);
