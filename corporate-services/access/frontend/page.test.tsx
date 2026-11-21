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
  window.history.replaceState({}, '', '/');
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
  window.history.replaceState({}, '', '/');
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
  expect(accessClient).toHaveBeenCalledWith('olga');
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

it('opens the requests tab from a chat link without a Buddy cookie or business write', async () => {
  document.cookie = 'ai_buddy_account=; Max-Age=0; Path=/';
  window.history.replaceState({}, '', '/?profile=olga&tab=requests');
  api.list.mockResolvedValue([record]);
  await mount();
  await hasText(record.number);
  expect(accessClient).toHaveBeenCalledWith('olga');
  expect(api.submit).not.toHaveBeenCalled();
  expect(api.cancel).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-selected="true"]')?.textContent ?? container.textContent).toContain(
    'Мои заявки',
  );
});

it.each([true, false])('opens a prefilled review with Buddy cookie=%s, submitting only on click', async (cookie) => {
  if (!cookie) document.cookie = 'ai_buddy_account=; Max-Age=0; Path=/';
  window.history.replaceState(null, '', '/?template=dwh&profile=olga');
  await mount();
  await hasText('Проверьте заявку');
  expect(accessClient).toHaveBeenCalledWith('olga');
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

const bi: LiveTemplate = {
  ...templates.find((value) => value.id === 'bi')!,
  resources: [
    { resource_key: 'bi-id-1', fields: { workspace: 'Пространство доставки' } },
    { resource_key: 'bi-id-2', fields: {} },
  ],
};
function field(name: string) {
  return [...container.querySelectorAll('label')].find((label) => label.textContent?.startsWith(name))!;
}
async function chooseResource(id: string) {
  const select = field('Ключ ресурса').querySelector('select')!;
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
it('switches dependent BI fields and submits the catalog identifiers after review', async () => {
  const catalog = await api.catalog();
  api.catalog.mockResolvedValue({ ...catalog, version: 2, templates: [bi, template] });
  api.submit.mockResolvedValue(record);
  await mount();
  await click(template.title);
  await chooseResource('delivery.orders_mart');
  await click('Отмена');
  await click(bi.title);
  expect(field('Система или проект').querySelector('input')?.value).toBe('BI');
  expect(field('Ключ ресурса').querySelector('select')?.value).toBe('');
  expect(field('Рабочее пространство').querySelector('input')?.disabled).toBe(true);
  expect(field('Ключ ресурса').textContent).toContain('Пространство доставки');
  const search = field('Поиск ресурса').querySelector('input')!;
  async function searchFor(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value);
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await searchFor('нет такого');
  await hasText('По этому запросу ничего не найдено.');
  await searchFor('доставки');
  expect([...field('Ключ ресурса').querySelectorAll('option')].map((option) => option.value)).toEqual(['', 'bi-id-1']);
  await searchFor('');
  await chooseResource('bi-id-1');
  expect(field('Рабочее пространство').querySelector('input')?.value).toBe('Пространство доставки');
  expect(field('Рабочее пространство').querySelector('input')?.readOnly).toBe(true);
  await chooseResource('bi-id-2');
  expect(field('Рабочее пространство').querySelector('input')?.value).toBe('');
  expect(field('Рабочее пространство').querySelector('input')?.readOnly).toBe(false);
  await chooseResource('bi-id-1');
  const textarea = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      record.input.justification,
    );
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await submitForm();
  await hasText('Проверьте заявку');
  expect(api.submit).not.toHaveBeenCalled();
  await submitForm();
  expect(api.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      template_id: 'bi',
      system: 'BI',
      resource_key: 'bi-id-1',
      catalog_version: 2,
      fields: { workspace: 'Пространство доставки' },
    }),
    expect.any(String),
  );
});

it('shows a scoped empty catalog without allowing an unknown resource to be submitted', async () => {
  const catalog = await api.catalog();
  api.catalog.mockResolvedValue({ ...catalog, templates: [{ ...bi, resources: [] }] });
  await mount();
  await click(bi.title);
  await hasText('у вашего профиля нет доступных ресурсов');
  expect(field('Ключ ресурса').querySelector('select')?.disabled).toBe(true);
  expect((await button('Продолжить')).disabled).toBe(true);
  await submitForm();
  expect(api.submit).not.toHaveBeenCalled();
});

it('opens an editable preset when the catalog does not specify the workspace', async () => {
  window.history.replaceState(null, '', '/?template=bi&profile=olga');
  const catalog = await api.catalog();
  api.catalog.mockResolvedValue({ ...catalog, templates: [{ ...bi, resources: [bi.resources[1]] }] });
  await mount();
  await button('Продолжить');
  expect(field('Ключ ресурса').querySelector('select')?.value).toBe('bi-id-2');
  expect(field('Рабочее пространство').querySelector('input')?.value).toBe('');
  expect(api.submit).not.toHaveBeenCalled();
});

it('shows a catalog error without displaying an empty result or guessing resources', async () => {
  api.catalog.mockRejectedValueOnce(new Error('Сервис временно недоступен.'));
  await mount();
  await hasText('Сервис временно недоступен.');
  expect(container.textContent).not.toContain('Ресурсы не найдены.');
  expect(container.querySelector('.access-card')).toBeNull();
  await click('Повторить');
  await button(template.title);
});
