import { expect, it } from 'vitest';
import { prefilledRequest } from './prefill';
import { templates } from './catalog';
import { profiles, type ProfileId } from '../../../web/frontend/src/demo-accounts';
import { profileRoles } from '../../../web/frontend/src/resource-kits';

it('fills every eligible configuration with server-bound resource fields and valid inputs', () => {
  for (const profile of Object.keys(profiles) as ProfileId[]) {
    for (const template of templates.filter((t) => !t.roles.length || t.roles.includes(profileRoles[profile]))) {
      const fields = Object.fromEntries(
        template.fields
          .filter((f) => f.key.endsWith('_url') || ['space', 'namespace'].includes(f.key))
          .map((f) => [f.key, f.key.endsWith('_url') ? 'https://example.com/team' : profiles[profile].productId]),
      );
      const input = prefilledRequest(profile, {
        ...template,
        resources: [{ resource_key: 'server-owned-resource', fields }],
      });
      expect(input.resource_key).toBe('server-owned-resource');
      expect(input.fields).toMatchObject(fields);
      expect(input.duration_days).toBe(30);
      expect(Object.values(input.fields).every(Boolean)).toBe(true);
    }
  }
  expect(() => prefilledRequest('olga', { ...templates[0], resources: [] })).toThrow();
  expect(() =>
    prefilledRequest('maria', { ...templates[0], resources: [{ resource_key: 'wrong', fields: {} }] }),
  ).toThrow();
});
