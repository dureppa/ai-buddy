import { z } from 'zod';

export const statuses = { todo: 'К выполнению', in_progress: 'В работе', review: 'На проверке', done: 'Готово' };
export const priorities = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
export const issueSchema = z.object({
  id: z.string().uuid(),
  board_id: z.string(),
  space_id: z.string(),
  key: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(['todo', 'in_progress', 'review', 'done']),
  priority: z.enum(['low', 'medium', 'high']),
  assignee_id: z.string().nullable(),
  reporter_id: z.string(),
  due_date: z.string().nullable(),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Issue = z.infer<typeof issueSchema>;
export type IssueInput = Pick<
  Issue,
  'title' | 'description' | 'status' | 'priority' | 'assignee_id' | 'due_date' | 'version'
>;
export const spacesSchema = z.array(z.object({ id: z.string(), name: z.string(), description: z.string() }));
export const boardsSchema = z.array(
  z.object({ id: z.string(), name: z.string(), space_id: z.string(), key: z.string() }),
);
export const boardSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  space_id: z.string(),
  members: z.array(z.object({ id: z.string(), name: z.string() })),
  issues: z.array(issueSchema),
});
const sessionSchema = z.object({ access_token: z.string().min(1), profile_id: z.string(), name: z.string() });
export function jiraClient(profile: string) {
  let session: Promise<z.infer<typeof sessionSchema>> | undefined;
  async function login() {
    if (!session)
      session = (async () => {
        const response = await fetch('/jira-api/v1/demo/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile_id: profile }),
        });
        if (!response.ok) throw new Error('Не удалось войти в Jira. Проверьте доступность сервиса и деморежим.');
        const result = sessionSchema.parse(await response.json());
        if (result.profile_id !== profile) throw new Error('Профиль сессии не совпадает.');
        return result;
      })().catch((error: unknown) => {
        session = undefined;
        throw error;
      });
    return session;
  }
  async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}) {
    const token = (await login()).access_token;
    const response = await fetch('/jira-api/v1' + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    });
    if (response.status === 401) session = undefined;
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? 'Задача уже изменена. Обновите доску и повторите правку.'
          : response.status === 404
            ? 'Доска или задача недоступна для вашего профиля.'
            : response.status === 400
              ? 'Проверьте поля задачи и исполнителя.'
              : 'Не удалось выполнить запрос. Попробуйте ещё раз.',
      );
    return schema.parse(await response.json());
  }
  return {
    spaces: () => request('/spaces', spacesSchema),
    boards: (id: string) => request('/spaces/' + encodeURIComponent(id) + '/boards', boardsSchema),
    board: (id: string) => request('/boards/' + encodeURIComponent(id), boardSchema),
    mine: () => request('/me/issues', z.array(issueSchema)),
    save: (board: string, input: IssueInput, id?: string) =>
      request(
        id ? '/issues/' + encodeURIComponent(id) : '/boards/' + encodeURIComponent(board) + '/issues',
        z.object({ id: z.string().uuid() }),
        { method: id ? 'PUT' : 'POST', body: JSON.stringify(input) },
      ),
  };
}
export function filterIssues(issues: Issue[], query: string, mine: boolean, user: string) {
  const search = query.trim().toLocaleLowerCase();
  return issues.filter(
    (issue) =>
      (!mine || issue.assignee_id === user) && (issue.key + ' ' + issue.title).toLocaleLowerCase().includes(search),
  );
}
