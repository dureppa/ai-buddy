// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SelectionAssistant } from './SelectionAssistant';
import { captureSelection } from './selection-context';
import { corporateLinks } from './corporate-links';

const mocks = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock('./backend', () => ({ backendEnabled: true, askSelectionBackend: mocks.ask }));
const answer = {
  conversation_id: '22222222-2222-4222-8222-222222222222',
  kind: 'answer' as const,
  text: 'Метрика показывает результат.',
  references: [{ title: 'Материал', url: 'https://docs.example/' }],
};
let root: Root;
let container: HTMLElement;
let content: HTMLElement;
let resource: HTMLElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.ask.mockReset().mockResolvedValue(answer);
  window.getSelection()?.removeAllRanges();
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: vi.fn(() => ({ left: 40, top: 60, bottom: 80 })),
  });
  document.title = 'Рабочая страница';
  resource = document.createElement('article');
  resource.dataset.agentResource = JSON.stringify({
    kind: 'confluence',
    id: 'guide-access',
    label: 'Гайд по доступам',
  });
  content = document.createElement('p');
  content.textContent = 'Метрика конверсии';
  resource.append(content);
  document.body.append(resource);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<SelectionAssistant profileId="olga" />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.getSelection()?.removeAllRanges();
  resource.remove();
  container.remove();
  document.querySelectorAll('dialog').forEach((node) => node.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function select(element = content) {
  const range = document.createRange();
  range.selectNodeContents(element);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}
async function selected(element = content) {
  select(element);
  await act(async () => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
}
function button(name = 'Уточнить у агента') {
  const item = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === name || item.getAttribute('aria-label') === name,
  );
  expect(item).toBeTruthy();
  return item!;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
async function open() {
  await selected();
  await click('Уточнить у агента');
}

it('sends nothing on selection, keeps the quote on click and reads context in a side panel', async () => {
  await selected();
  expect(mocks.ask).not.toHaveBeenCalled();
  const trigger = button();
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  trigger.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await click('Уточнить у агента');
  expect(mocks.ask).toHaveBeenCalledTimes(1);
  const [profile, , context, conversation, signal, prefix] = mocks.ask.mock.calls[0];
  expect(profile).toBe('olga');
  expect(prefix).toBe('/api');
  expect(conversation).toBeUndefined();
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(context.selection).toEqual({
    text: 'Метрика конверсии',
    title: 'Рабочая страница',
    resource: { kind: 'confluence', id: 'guide-access', label: 'Гайд по доступам' },
  });
  expect(document.querySelector('aside[aria-label="Пояснение выделенного текста"]')?.textContent).toContain(
    'Метрика показывает результат.',
  );
  expect(document.querySelector('blockquote')?.textContent).toBe('Метрика конверсии');
  expect(document.querySelector('a[href="https://docs.example/"]')).toBeTruthy();
});
it('sends follow-up in the same conversation with the original fragment', async () => {
  await open();
  const input = document.querySelector<HTMLInputElement>('#selection-question')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Зачем это мне?');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.ask.mock.calls[1][1]).toBe('Зачем это мне?');
  expect(mocks.ask.mock.calls[1][3]).toBe(answer.conversation_id);
  expect(mocks.ask.mock.calls[1][2]).toEqual(mocks.ask.mock.calls[0][2]);
});
it('shows progress, blocks duplicate sends, and ignores a response after closing', async () => {
  let resolve!: (value: typeof answer) => void;
  mocks.ask.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await open();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Читаю контекст');
  expect(document.querySelector<HTMLInputElement>('#selection-question')?.disabled).toBe(true);
  const signal = mocks.ask.mock.calls[0][4] as AbortSignal;
  await click('Закрыть пояснение');
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(answer));
  expect(document.querySelector('aside')).toBeNull();
});
it('retries a failed request without adding a fake answer', async () => {
  mocks.ask.mockRejectedValueOnce(new Error('Сервис недоступен'));
  await open();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Сервис недоступен');
  await click('Повторить');
  expect(mocks.ask).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
it('creates a separate conversation for a new fragment and aborts the previous request', async () => {
  let resolve!: (value: typeof answer) => void;
  mocks.ask.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await open();
  const signal = mocks.ask.mock.calls[0][4] as AbortSignal;
  content.textContent = 'Новая метрика';
  await open();
  expect(signal.aborted).toBe(true);
  expect(mocks.ask.mock.calls[1][3]).toBeUndefined();
  await act(async () => resolve({ ...answer, text: 'Старый ответ' }));
  expect(document.querySelector('aside')?.textContent).not.toContain('Старый ответ');
  expect(document.querySelector('blockquote')?.textContent).toBe('Новая метрика');
});
it('clears old profile context and prevents late responses crossing profiles', async () => {
  let resolve!: (value: typeof answer) => void;
  mocks.ask.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await open();
  await act(async () => root.render(<SelectionAssistant profileId="maria" apiPrefix="/buddy-api" />));
  await act(async () => resolve(answer));
  expect(document.querySelector('aside')).toBeNull();
  await open();
  expect(mocks.ask.mock.calls[1][0]).toBe('maria');
  expect(mocks.ask.mock.calls[1][5]).toBe('/buddy-api');
});
it('supports native dialogs and Escape closes only the explanation', async () => {
  const dialog = document.createElement('dialog');
  dialog.open = true;
  dialog.append(resource);
  document.body.append(dialog);
  await open();
  expect(dialog.querySelector('aside')).toBeTruthy();
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await act(async () => document.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(dialog.open).toBe(true);
  expect(dialog.querySelector('aside')).toBeNull();
});
it('closes the panel when its source dialog closes', async () => {
  const dialog = document.createElement('dialog');
  dialog.open = true;
  dialog.append(resource);
  document.body.append(dialog);
  await open();
  await act(async () => dialog.dispatchEvent(new Event('close')));
  expect(document.querySelector('aside')).toBeNull();
});
it('does not imitate a response without an enabled backend', async () => {
  await act(async () => root.render(<SelectionAssistant profileId="olga" enabled={false} />));
  await open();
  expect(mocks.ask).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('серверном режиме');
});
it('handles keyboard selection and hides the trigger on scroll', async () => {
  vi.useFakeTimers();
  select();
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    vi.advanceTimersByTime(130);
  });
  expect(button()).toBeTruthy();
  await act(async () => window.dispatchEvent(new Event('scroll')));
  expect(document.querySelector('.selection-assistant--trigger')).toBeNull();
});
it('prevents a drag-selection click from opening the underlying task button', async () => {
  await selected();
  const parent = document.createElement('button');
  resource.replaceChildren(parent);
  parent.append(content);
  const clicked = vi.fn();
  parent.addEventListener('click', clicked);
  await selected();
  await act(async () => parent.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
  expect(clicked).not.toHaveBeenCalled();
});
it('does not silently truncate a long selection', async () => {
  content.textContent = 'я'.repeat(1201);
  await selected();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('1200');
  expect(document.querySelector('button')).toBeNull();
  expect(mocks.ask).not.toHaveBeenCalled();
});
it.each(['input', 'textarea', 'select', 'div'])('does not capture editable controls: %s', (tag) => {
  const control = document.createElement(tag);
  if (tag === 'div') control.setAttribute('contenteditable', 'true');
  control.textContent = 'private';
  resource.append(control);
  select(control);
  expect(captureSelection()).toBeNull();
});
it('ignores panel text and malformed resource metadata', async () => {
  resource.dataset.agentResource = '{bad';
  select();
  expect(captureSelection()?.context?.selection.resource).toBeUndefined();
  resource.dataset.agentResource = JSON.stringify({ kind: 'task', id: 'x', label: 'x', profile_id: 'other' });
  expect(captureSelection()?.context?.selection.resource).toBeUndefined();
  resource.setAttribute('data-selection-assistant', '');
  expect(captureSelection()).toBeNull();
});
it('does not attach the first resource when a selection spans two tasks', () => {
  const other = document.createElement('p');
  other.dataset.agentResource = JSON.stringify({ kind: 'task', id: 'other', label: 'Other' });
  other.textContent = 'Other';
  resource.append(other);
  const range = document.createRange();
  range.setStart(content.firstChild!, 0);
  range.setEnd(other.firstChild!, 5);
  window.getSelection()?.addRange(range);
  expect(captureSelection()?.context?.selection.resource).toBeUndefined();
});
it('clamps the trigger to the viewport and removes query parameters', () => {
  vi.mocked(Range.prototype.getBoundingClientRect).mockReturnValue({ left: 9999, top: 9999, bottom: 10010 } as DOMRect);
  window.history.replaceState(null, '', '/?token=secret#private');
  select();
  const target = captureSelection()!;
  expect(target.left).toBeLessThan(window.innerWidth);
  expect(target.top).toBeLessThan(window.innerHeight);
  expect(target.context?.url).not.toContain('secret');
  expect(target.context?.url).not.toContain('#');
  window.history.replaceState(null, '', '/');
});

it('promotes floating UI above a native dialog with the Popover API', async () => {
  const show = vi.fn();
  HTMLElement.prototype.showPopover = show;
  await open();
  expect(show).toHaveBeenCalledTimes(2);
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
});

it('aborts a pending explanation when the source dialog is removed', async () => {
  mocks.ask.mockImplementation(() => new Promise(() => {}));
  const dialog = document.createElement('dialog');
  dialog.open = true;
  dialog.append(resource);
  document.body.append(dialog);
  await open();
  const signal = mocks.ask.mock.calls[0][4] as AbortSignal;
  await act(async () => dialog.remove());
  expect(signal.aborted).toBe(true);
  expect(document.querySelector('aside')).toBeNull();
});

it('does not offer the same fragment again while its panel is open', async () => {
  await open();
  await selected();
  expect(document.querySelector('.selection-assistant--trigger')).toBeNull();
  expect(mocks.ask).toHaveBeenCalledTimes(1);
});

it('scrolls to a new clarification response', async () => {
  await open();
  const body = document.querySelector<HTMLElement>('.selection-assistant__body')!;
  Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 1000 });
  const input = document.querySelector<HTMLInputElement>('#selection-question')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Почему?');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(body.scrollTop).toBe(1000);
});

it('keeps the current profile on a corporate source opened from the explanation panel', async () => {
  const service = corporateLinks.find((entry) => entry.id === 'documents')!;
  const source = new URL(service.url);
  source.searchParams.set('page', 'sign');
  source.hash = 'steps';
  mocks.ask.mockResolvedValue({ ...answer, references: [{ title: 'Документы', url: source.toString() }] });
  await open();
  const expected = new URL(source);
  expected.searchParams.set('profile', 'olga');
  expect([...document.querySelectorAll('aside a')].map((link) => link.getAttribute('href'))).toContain(
    expected.toString(),
  );
  expect(mocks.ask).toHaveBeenCalledTimes(1);
});
