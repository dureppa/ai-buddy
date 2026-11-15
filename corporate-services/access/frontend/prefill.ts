import { products, profiles, type ProfileId } from '../../../web/frontend/src/demo-accounts';
import { profileRoles } from '../../../web/frontend/src/resource-kits';
import type { LiveTemplate } from './api';
import { parseInput } from './model';

export function prefilledRequest(profile: ProfileId, template: LiveTemplate) {
  const person = profiles[profile];
  const product = products[person.productId];
  if (template.roles.length && !template.roles.includes(profileRoles[profile]))
    throw new Error('Шаблон недоступен для этой специальности.');
  const resource = template.resources[0];
  if (!resource) throw new Error('Для этого шаблона нет доступных ресурсов.');
  const defaults: Record<string, string> = {
    workspace: product.team,
    test_plan: product.firstStep,
    study: product.teamDescription,
    device: 'demo-' + profile + '-laptop',
  };
  const fields = Object.fromEntries(
    template.fields.map((field) => [
      field.key,
      resource.fields[field.key] || field.options?.[0] || defaults[field.key] || '',
    ]),
  );
  return parseInput({
    template_id: template.id,
    catalog_version: 1,
    system: template.system,
    resource_key: resource.resource_key,
    justification: 'Учебный доступ для стажировки: ' + product.firstStep,
    permission: template.levels[0],
    duration_days: 30,
    fields,
  });
}
