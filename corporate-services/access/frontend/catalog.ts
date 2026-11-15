import catalogData from '../../../web/backend/internal/portal/catalog.json';
import type { IconName } from '../../../web/frontend/src/ui';
export const catalogVersion = 1;
export const permissions = { read: 'Чтение', write: 'Чтение и запись', admin: 'Администрирование' } as const;
export type Permission = keyof typeof permissions;
export type JobRole = 'analyst' | 'backend' | 'tester' | 'designer';
export const roleLabels: Record<JobRole, string> = {
  analyst: 'Аналитика',
  backend: 'Разработка',
  tester: 'Тестирование',
  designer: 'Дизайн',
};
export type ExtraField = { key: string; label: string; placeholder?: string; options?: readonly string[] };
export type AccessTemplate = {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  color: string;
  roles: readonly JobRole[];
  system: string;
  keyHint: string;
  levels: readonly Permission[];
  fields: readonly ExtraField[];
  owner: string;
};
export const accessService = {
  id: 'access',
  title: 'Управление доступами',
  description: 'Каталог ресурсов, заявки и согласование прав.',
  icon: 'key',
  tone: 'blue',
} as const;
export const templates = catalogData.templates as AccessTemplate[];
export function recommendedTemplates(role: JobRole) {
  return templates.filter((item) => item.roles.length === 0 || item.roles.includes(role));
}
