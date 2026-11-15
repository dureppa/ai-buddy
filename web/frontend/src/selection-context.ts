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
export type SelectionTarget = {
  context?: ExplanationContext;
  error?: string;
  left: number;
  top: number;
  portal: HTMLElement;
};

export function captureSelection(): SelectionTarget | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const element = (node: Node) => (node instanceof Element ? node : node.parentElement);
  const start = element(range.startContainer);
  const end = element(range.endContainer);
  const ignored =
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-selection-assistant], [data-assistant-ignore]';
  if (!start || !end || start.closest(ignored) || end.closest(ignored) || range.cloneContents().querySelector(ignored))
    return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const rect = range.getBoundingClientRect();
  const portal = start.closest<HTMLDialogElement>('dialog[open]') ?? document.body;
  const position = {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 225)),
    top:
      rect.bottom + 50 < window.innerHeight
        ? rect.bottom + 8
        : Math.max(8, Math.min(window.innerHeight - 48, rect.top - 44)),
    portal,
  };
  if ([...text].length > 1200) return { ...position, error: 'Выдели фрагмент до 1200 символов.' };
  const resourceNode = start.closest<HTMLElement>('[data-agent-resource]');
  let resource: SelectionResource | undefined;
  if (resourceNode && resourceNode === end.closest('[data-agent-resource]')) {
    try {
      const parsed = selectionResourceSchema.safeParse(JSON.parse(resourceNode.dataset.agentResource ?? ''));
      if (parsed.success) resource = parsed.data;
    } catch {
      /* Unrecognised page metadata does not become trusted context. */
    }
  }
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return {
    ...position,
    context: {
      url: url.toString(),
      selection: { text, title: [...document.title].slice(0, 200).join(''), ...(resource ? { resource } : {}) },
    },
  };
}
