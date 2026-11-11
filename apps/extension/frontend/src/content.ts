import { answerFromPage, type BuddyAnswer, type PageContext } from './assistant';

type WidgetState = { minimized: boolean };

const hostId = 'ai-buddy-floating-widget';
const defaultState: WidgetState = { minimized: false };

if (!document.getElementById(hostId)) {
  const host = document.createElement('div');
  host.id = hostId;
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; right: 24px; bottom: 24px; width: 72px; height: 72px;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .root { color: #171717; font-family: Inter, ui-sans-serif, system-ui, sans-serif; position: relative; width: 72px; height: 72px; }
      .pet-button { position: absolute; inset: 0; display: grid; place-items: center; padding: 0; border: 0; background: transparent; cursor: pointer; transition: transform 180ms ease; }
      .pet-button:hover { transform: translateY(-3px) rotate(3deg); }
      .pet-button:active { transform: scale(.94); }
      .pet-button img { display: block; width: 72px; height: 72px; object-fit: contain; filter: drop-shadow(0 8px 8px rgba(49, 86, 43, .26)); animation: float 4.8s ease-in-out infinite; }
      .action { position: absolute; right: 64px; bottom: 7px; display: flex; align-items: center; gap: 4px; padding: 6px; border-radius: 16px; background: #fff; box-shadow: 0 8px 24px rgba(26, 43, 31, .22); opacity: 0; transform: translateX(6px) scale(.96); pointer-events: none; transition: opacity 180ms ease, transform 180ms ease; white-space: nowrap; }
      .root:hover .action, .root:focus-within .action { opacity: 1; transform: none; pointer-events: auto; }
      .action button { display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 11px; background: #e4f7df; color: #244c2d; cursor: pointer; }
      .action button:hover { background: #c9ffbf; }
      .action span { padding: 0 5px; color: #314535; font-size: 11px; font-weight: 700; }
      .panel { position: absolute; right: 0; bottom: 79px; display: flex; flex-direction: column; width: min(355px, calc(100vw - 32px)); max-height: min(520px, calc(100vh - 118px)); overflow: hidden; border: 1px solid #e6e8e5; border-radius: 20px; background: #fff; box-shadow: 0 18px 50px rgba(26, 43, 31, .22); animation: panel-in 220ms ease both; }
      .panel__head { display: flex; align-items: center; justify-content: space-between; gap: 9px; padding: 13px 14px; background: #dfcdf3; color: #46315e; }
      .panel__identity { display: flex; align-items: center; gap: 8px; }
      .panel__identity img { width: 35px; height: 35px; object-fit: contain; }
      .panel__identity strong, .panel__identity small { display: block; }
      .panel__identity strong { font-size: 13px; }
      .panel__identity small { margin-top: 2px; font-size: 10px; color: #674a7d; }
      .icon-button { display: grid; place-items: center; width: 29px; height: 29px; padding: 0; border: 0; border-radius: 8px; background: #fff8; color: #46315e; cursor: pointer; }
      .messages { min-height: 100px; max-height: 310px; overflow: auto; padding: 13px; }
      .message { margin: 0 0 9px; padding: 9px 11px; border-radius: 4px 13px 13px 13px; background: #edf4eb; color: #26322b; font-size: 12px; line-height: 1.46; }
      .message--user { margin-left: 25px; border-radius: 13px 4px 13px 13px; background: #eee5f8; }
      .message small { display: block; margin-top: 5px; color: #6e7871; font-size: 10px; }
      .question-form { display: flex; gap: 6px; padding: 9px; border-top: 1px solid #edf0ed; }
      .question-form input { min-width: 0; flex: 1; padding: 9px 10px; border: 1px solid #dfe5df; border-radius: 10px; outline: none; color: #171717; font: inherit; font-size: 12px; }
      .question-form input:focus { border-color: #7daf83; box-shadow: 0 0 0 2px rgba(132, 202, 138, .24); }
      .question-form button { display: grid; place-items: center; width: 35px; height: 35px; padding: 0; border: 0; border-radius: 9px; background: #263d2b; color: #fff; cursor: pointer; }
      .question-form button:disabled { opacity: .45; cursor: default; }
      .empty { padding: 14px; color: #5b6660; font-size: 12px; line-height: 1.45; }
      .thinking { display: flex; gap: 4px; align-items: center; min-height: 36px; }
      .thinking i { width: 5px; height: 5px; border-radius: 50%; background: #5e8d65; animation: bounce 1s infinite; }
      .thinking i:nth-child(2) { animation-delay: .14s; }
      .thinking i:nth-child(3) { animation-delay: .28s; }
      @keyframes float { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-6px) rotate(2deg); } }
      @keyframes panel-in { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: none; } }
      @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .55; } 30% { transform: translateY(-3px); opacity: 1; } }
      @media (max-width: 560px) { .root { width: 60px; height: 60px; } .pet-button img { width: 60px; height: 60px; } .action { right: 53px; } .panel { right: -8px; bottom: 67px; } }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
    </style>
    <div class="root">
      <div class="action"><span>Задать вопрос</span><button type="button" aria-label="Задать вопрос">✎</button></div>
      <button type="button" class="pet-button" aria-label="Открыть AI-buddy"><img alt="" /></button>
    </div>
  `;

  const root = shadow.querySelector<HTMLElement>('.root');
  const petButton = shadow.querySelector<HTMLButtonElement>('.pet-button');
  const actionButton = shadow.querySelector<HTMLButtonElement>('.action button');
  const petImage = shadow.querySelector<HTMLImageElement>('.pet-button img');
  if (!root || !petButton || !actionButton || !petImage) throw new Error('AI-buddy widget failed to mount.');
  const widgetRoot = root;
  petImage.src = chrome.runtime.getURL('buddy.webp');

  let state = defaultState;
  let panel: HTMLElement | null = null;
  let answerArea: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  let submit: HTMLButtonElement | null = null;
  let history: Array<{ from: 'user' | 'buddy'; text: string; source?: string }> = [];

  function renderMessages() {
    if (!answerArea) return;
    answerArea.innerHTML = history.length === 0 ? '<div class="empty">Спроси меня о текущей странице. Я подскажу, где найти нужный раздел или что делать дальше.</div>' : '';
    for (const message of history) {
      const element = document.createElement('div');
      element.className = 'message' + (message.from === 'user' ? ' message--user' : '');
      element.textContent = message.text;
      if (message.source) {
        const source = document.createElement('small');
        source.textContent = message.source;
        element.appendChild(source);
      }
      answerArea.appendChild(element);
    }
    answerArea.scrollTop = answerArea.scrollHeight;
  }

  function closePanel() {
    panel?.remove();
    panel = null;
    answerArea = null;
    input = null;
    submit = null;
  }

  function openPanel() {
    if (panel) {
      input?.focus();
      return;
    }
    panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('aria-label', 'Чат с AI-buddy');
    panel.innerHTML = `
      <header class="panel__head">
        <div class="panel__identity"><img alt="" /><div><strong>AI-buddy</strong><small>Помогу разобраться</small></div></div>
        <button type="button" class="icon-button" aria-label="Закрыть">×</button>
      </header>
      <div class="messages" aria-live="polite"></div>
      <form class="question-form"><input aria-label="Вопрос для AI-buddy" placeholder="Спроси о странице…" maxlength="400" /><button type="submit" aria-label="Отправить">↗</button></form>
    `;
    widgetRoot.appendChild(panel);
    const panelImage = panel.querySelector<HTMLImageElement>('.panel__identity img');
    answerArea = panel.querySelector<HTMLElement>('.messages');
    input = panel.querySelector<HTMLInputElement>('input');
    submit = panel.querySelector<HTMLButtonElement>('form button');
    panelImage!.src = chrome.runtime.getURL('buddy.webp');
    panel.querySelector<HTMLButtonElement>('.icon-button')?.addEventListener('click', closePanel);
    panel.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const question = input?.value.trim();
      if (question) void ask(question);
    });
    renderMessages();
    input?.focus();
  }

  async function ask(question: string) {
    if (!input || !submit) return;
    history.push({ from: 'user', text: question });
    input.value = '';
    input.disabled = true;
    submit.disabled = true;
    renderMessages();
    const thinking = document.createElement('div');
    thinking.className = 'message thinking';
    thinking.innerHTML = '<i></i><i></i><i></i>';
    answerArea?.appendChild(thinking);
    try {
      const page: PageContext = { url: location.href, title: document.title, selectedText: window.getSelection()?.toString() };
      const response = await chrome.runtime.sendMessage({ type: 'ask-buddy', question, page }) as BuddyAnswer;
      thinking.remove();
      history.push({ from: 'buddy', text: response.text, source: response.source });
      renderMessages();
    } catch {
      thinking.remove();
      const fallback = answerFromPage(question, { url: location.href, title: document.title, selectedText: window.getSelection()?.toString() });
      history.push({ from: 'buddy', text: fallback.text, source: fallback.source });
      renderMessages();
    } finally {
      input.disabled = false;
      submit.disabled = false;
      input.focus();
    }
  }

  actionButton.addEventListener('click', openPanel);
  petButton.addEventListener('click', openPanel);
  void chrome.runtime.sendMessage({ type: 'get-widget-state' }).then((saved: WidgetState | undefined) => {
    if (saved) state = saved;
    if (state.minimized) host.style.display = 'none';
  });
}
