import { products, profiles, type ProfileId } from '../../../web/frontend/src/demo-accounts';
import { profileRoles } from '../../../web/frontend/src/resource-kits';
import type { LiveTemplate } from './api';
import type { RequestInput } from './model';

export function prefilledRequest(profile: ProfileId, template: LiveTemplate, version: number): RequestInput {
  const person = profiles[profile];
  const product = products[person.productId];
  if (template.roles.length && !template.roles.includes(profileRoles[profile]))
    throw new Error('Шаблон недоступен для этой специальности.');
  const resource = template.resources.length === 1 ? template.resources[0] : undefined;
  if (!template.resources.length) throw new Error('Для этого шаблона нет доступных ресурсов.');
  const fields = Object.fromEntries(template.fields.map((field) => [field.key, resource?.fields[field.key] ?? '']));
  return {
    template_id: template.id,
    catalog_version: version,
    system: template.system,
    resource_key: resource?.resource_key ?? '',
    justification: 'Учебный доступ для стажировки: ' + product.firstStep,
    permission: template.levels[0],
    duration_days: 30,
    fields,
  };
}
