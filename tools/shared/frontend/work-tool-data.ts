import type { ProfileId } from '../../../web/frontend/src/demo-accounts';
import { z } from 'zod';

export const pageSchema = z.object({
  name: z.string(),
  area: z.string(),
  records: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      description: z.string(),
      fields: z.record(z.string(), z.string()),
    }),
  ),
});

export type ToolRecord = z.infer<typeof pageSchema>['records'][number];

export type Props = { record: ToolRecord; profileId: ProfileId };
