import type { Task } from './checklist';
import type { ProfileId } from './demo-accounts';
import { taskSelectionResource } from './task-selection';
import type { ExplanationContext } from './selection-context';

export function checklistQuestion(profile: ProfileId, task: Task) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  const text = `Объясни пункт моего чек-листа «${task.title}»: что он означает и зачем нужен, с чего начать и какие материалы или страницы сервисов помогут выполнить его. Ответственный в чек-листе: ${task.owner}.`;
  const context: ExplanationContext = {
    url: url.toString(),
    selection: {
      text: task.title.slice(0, 200),
      title: 'Пункт чек-листа стажёра',
      resource: taskSelectionResource(profile, task),
    },
  };
  return { text, context };
}
