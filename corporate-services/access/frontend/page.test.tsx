// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccessPortal } from './page';
import { accessClient, type LiveTemplate } from './api';
import { templates } from './catalog';
import type { AccessRequest } from './model';

vi.mock('./api', () => ({ accessClient: vi.fn() }));
const template: LiveTemplate = {
  ...templates.find((value) => value.id === 'dwh')!,
  resources: [{ resource_key: 'delivery.orders_mart', fields: { usage: 'Исследование' } }],
};
const record: AccessRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  number: 'ДОС-000001',
  profile_id: 'olga',
  product_id: 'delivery',
  input: {
    template_id: 'dwh',
    catalog_version: 1,
    system: 'DWH',
    resource_key: 'delivery.orders_mart',
    justification: 'Проверить воронку оформления',
    permission: 'read',
    duration_days: 30,
    fields: { usage: 'Исследование' },
  },
  status: 'submitted',
  created_at: '2026-11-15T10:00:00Z',
  decision_by: null,
  decision_note: '',
  decided_at: null,
};
const api = { catalog: vi.fn(), list: vi.fn(), submit: vi.fn(), cancel: vi.fn() };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const crypto = globalThis.crypto;
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
  document.cookie = 'ai_buddy_account=olga; Path=/';
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  api.catalog.mockReset().mockResolvedValue({
    version: 1,
    templates: [template],
    context: { profile_id: 'olga', product_id: 'delivery', job_role: 'analyst', name: 'Ольга' },
  });
  api.list.mockReset().mockResolvedValue([]);
  api.submit.mockReset();
  api.cancel.mockReset();
  vi.mocked(accessClient).mockReturnValue(api);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.cookie = 'ai_buddy_account=; Max-Age=0; Path=/';
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(<AccessPortal />));
}
async function button(text: string) {
  return vi.waitFor(async () => {
    await act(async () => {});
    const value = [...container.querySelectorAll('button')].find((element) => element.textContent?.includes(text));
    if (!value) throw new Error('Missing ' + text);
    return value;
  });
}
async function click(text: string) {
  const value = await button(text);
  await act(async () => value.click());
}
async function fillForm() {
  const select = container.querySelector<HTMLSelectElement>('.access-fields select')!;
  await act(async () => {
    select.value = 'delivery.orders_mart';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const textarea = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      record.input.justification,
    );
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submitForm() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
async function hasText(text: string) {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain(text);
  });
}
it('loads the catalog and opens a review on an HTTP-like origin without randomUUID', async () => {
  await mount();
  await click(template.title);
  await fillForm();
  await submitForm();
  await hasText('Проверьте заявку');
  expect(container.textContent).toContain('delivery.orders_mart');
  expect(api.submit).not.toHaveBeenCalled();
});
it('keeps the operation key on retry and rotates it for a new form after success', async () => {
  api.submit.mockRejectedValueOnce(new Error('Соединение прервано')).mockResolvedValue(record);
  await mount();
  await click(template.title);
  await fillForm();
  await submitForm();
  await submitForm();
  await hasText('Соединение прервано');
  const first = api.submit.mock.calls[0][1];
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await submitForm();
  await hasText('Заявка сохранена.');
  expect(api.submit.mock.calls[1][1]).toBe(first);
  await click('Каталог доступов');
  await click(template.title);
  await fillForm();
  await submitForm();
  await submitForm();
  await hasText('Заявка сохранена.');
  expect(api.submit.mock.calls[2][1]).not.toBe(first);
});

it('opens a prefilled review from a template link without submitting until clicked', async () => {
  window.history.replaceState(null, '', '/?template=dwh&profile=olga');
  await mount();
  await hasText('Проверьте заявку');
  expect(container.textContent).toContain('delivery.orders_mart');
  expect(api.submit).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(api.submit).not.toHaveBeenCalled();
  api.submit.mockResolvedValue(record);
  await submitForm();
  expect(api.submit).toHaveBeenCalledWith(
    expect.objectContaining({ resource_key: 'delivery.orders_mart', permission: 'read', duration_days: 30 }),
    expect.any(String),
  );
  window.history.replaceState(null, '', '/');
});
it('rejects unknown preset links without creating a request', async () => {
  window.history.replaceState(null, '', '/?template=foreign-resource');
  await mount();
  await hasText('Этот раздел доступов недоступен');
  expect(api.submit).not.toHaveBeenCalled();
  window.history.replaceState(null, '', '/');
});
