import { expect, it } from 'vitest';
import { resourceKit, profileRoles } from './resource-kits';
import { profiles, type ProfileId } from './demo-accounts';
import { baselineFor, internMaterials } from './staff-data';

it('provides scoped chats, access links and role/product reading for every intern', () => {
  for (const profile of Object.keys(profiles) as ProfileId[]) {
    const kit = resourceKit(profile);
    expect(kit.filter((x) => x.group === 'Чаты')).toHaveLength(12);
    expect(kit.filter((x) => x.group === 'Доступы').length).toBeGreaterThanOrEqual(10);
    expect(kit.some((x) => x.title.startsWith('Чат с наставником:'))).toBe(true);
    expect(kit.some((x) => x.title.startsWith('Чат с руководителем:'))).toBe(true);
    expect(kit.filter((x) => x.group === 'Документы')).toHaveLength(5);
    expect(new Set(kit.map((x) => x.id)).size).toBe(kit.length);
    for (const item of kit.filter((x) => x.group === 'Доступы')) {
      const url = new URL(item.source.href);
      expect(url.searchParams.get('profile')).toBe(profile);
      expect(url.searchParams.get('template')).toBeTruthy();
    }
    expect(kit.some((x) => x.source.href.includes('role-' + profileRoles[profile]))).toBe(true);
    expect(kit.some((x) => x.source.href.includes('product-' + profiles[profile].productId))).toBe(true);
    expect(baselineFor(profile)).toEqual(internMaterials({ getItem: () => null, setItem: () => {} }, profile));
  }
  expect(
    resourceKit('olga')
      .filter((x) => x.group === 'Доступы')
      .map((x) => x.title),
  ).toContain('Витрины данных DWH');
  expect(
    resourceKit('sasha')
      .filter((x) => x.group === 'Доступы')
      .map((x) => x.title),
  ).not.toContain('Витрины данных DWH');
  expect(titles('olga')).toEqual(expect.arrayContaining(['Отчёты Redash', 'SQL-клиент Trino', 'Дашборды Grafana']));
  expect(titles('sasha')).toEqual(expect.arrayContaining(['Платформа PaaS', 'Корпоративный мессенджер']));
  expect(titles('sasha')).not.toContain('Система тест-кейсов');
  expect(titles('timur')).toEqual(expect.arrayContaining(['Система тест-кейсов', 'Тестовые стенды']));
  expect(titles('maria')).toEqual(expect.arrayContaining(['Дизайн-система', 'Календарь команды']));
  expect(titles('maria')).not.toContain('Репозитории кода');
});

function titles(profile: ProfileId) {
  return resourceKit(profile)
    .filter((x) => x.group === 'Доступы')
    .map((x) => x.title);
}
