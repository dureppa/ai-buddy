import { expect, it } from 'vitest';
import { resourceKit, profileRoles } from './resource-kits';
import { profiles, type ProfileId } from './demo-accounts';
import { baselineFor, internMaterials } from './staff-data';

it('provides scoped chats, access links and role/product reading for every intern', () => {
  for (const profile of Object.keys(profiles) as ProfileId[]) {
    const kit = resourceKit(profile);
    expect(kit.filter((x) => x.group === 'Чаты')).toHaveLength(3);
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
});
