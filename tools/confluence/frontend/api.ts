import { z } from 'zod';
import type { ProfileId } from '../../../web/frontend/src/demo-accounts';
import { portalFetch } from '../../../corporate-services/access/frontend/api';
export const pageSchema = z.object({
  id: z.string(),
  product_id: z.string().nullable(),
  parent_id: z.string().nullable(),
  kind: z.enum(['product', 'team', 'role', 'guide']),
  title: z.string(),
  body: z.string(),
  version: z.number().int().positive(),
  updated_at: z.string().datetime(),
});
export type KnowledgePage = z.infer<typeof pageSchema>;
export const kinds = { product: 'Продукт', team: 'Команда', role: 'Специальности', guide: 'Гайды и процессы' };
export function knowledgeClient(profile: ProfileId) {
  return {
    list: async (query = '', signal?: AbortSignal) =>
      z
        .array(pageSchema)
        .parse(
          await (
            await portalFetch(profile, '/api/v1/confluence/pages?query=' + encodeURIComponent(query), { signal })
          ).json(),
        ),
    read: async (id: string, signal?: AbortSignal) =>
      pageSchema.parse(
        await (await portalFetch(profile, '/api/v1/confluence/pages/' + encodeURIComponent(id), { signal })).json(),
      ),
  };
}
export function sections(body: string) {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((text) => {
      const lines = text.split('\n');
      return text.startsWith('## ')
        ? { heading: lines[0].slice(3), text: lines.slice(1).join('\n') }
        : { heading: '', text };
    });
}
