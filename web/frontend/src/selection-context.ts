import { z } from 'zod';

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);
export const workServices = [
  'mattermost',
  'redash',
  'trino',
  'trisigma',
  'bitbucket',
  'paas',
  'grafana',
  'tms',
  'postman',
  'test-stand',
  'figma',
  'design-system',
  'design-review',
] as const;
const label = z.string().max(200).optional();
export const selectionResourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('task'),
      id,
      label: z.string().trim().min(1).max(200),
      description: z.string().max(800).optional(),
      page_ids: z.array(id).max(3).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('confluence'), id, label }).strict(),
  z.object({ kind: z.literal('work_tool'), id, service: z.enum(workServices), label }).strict(),
  z.object({ kind: z.literal('jira'), id: z.uuid(), label }).strict(),
  z
    .object({
      kind: z.literal('service'),
      service: z.enum([
        'absences',
        'trips',
        'hiring',
        'offboarding',
        'consents',
        'benefits',
        'documents',
        'events',
        'access',
      ]),
      label,
    })
    .strict(),
]);
export type SelectionResource = z.infer<typeof selectionResourceSchema>;
export type ExplanationContext = {
  url: string;
  selection: { text: string; title: string; resource?: SelectionResource };
};
