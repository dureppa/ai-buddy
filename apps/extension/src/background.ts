import { answerFromPage, type PageContext } from './assistant';

type Message =
  | { type: 'get-widget-state' }
  | { type: 'set-widget-state'; state: { minimized: boolean } }
  | { type: 'ask-buddy'; question: string; page: PageContext };

const defaultState = { minimized: false };

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'get-widget-state') {
    chrome.storage.local.get('ai-buddy.widget-state').then((stored) => {
      sendResponse(stored['ai-buddy.widget-state'] ?? defaultState);
    });
    return true;
  }

  if (message.type === 'set-widget-state') {
    void chrome.storage.local.set({ 'ai-buddy.widget-state': message.state });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'ask-buddy') {
    sendResponse(answerFromPage(message.question, message.page));
    return false;
  }

  return false;
});
