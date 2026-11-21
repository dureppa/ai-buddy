import { stages, type Task } from './checklist';
import { currentChecklistTask } from './current-task';

type SuggestedQuestion = { text: string; task?: Task };

const mentor = { text: 'Кто мой наставник?' };
const tools = { text: 'Какие инструменты нужны моей команде?' };
const documents = { text: 'Где найти документы?' };
const generalQuestions = [mentor, tools, documents];

export function chatSuggestions(
  catalog: readonly Task[],
  completed: readonly string[] | undefined,
  selectedTaskId: string | undefined,
  hasReadableMaterials: (task: Task) => boolean,
): SuggestedQuestion[] {
  if (!completed || !catalog.length) return generalQuestions;

  const current = currentChecklistTask(catalog, completed);
  if (!current) return [tools, documents, mentor];

  const selected = catalog.find((task) => task.id === selectedTaskId && !completed.includes(task.id));
  const task = selected ?? current;
  const stage = stages.findIndex(({ id }) => id === task.stage);
  const stageStarted = catalog.some((item) => item.stage === task.stage && completed.includes(item.id));
  const title = Array.from(task.title);
  const shortTitle = title.length > 54 ? title.slice(0, 53).join('') + '…' : task.title;
  const firstQuestion = selected
    ? { text: 'С чего начать этот пункт?', task }
    : stage === 0
      ? { text: 'С чего начать сегодня?' }
      : !stageStarted
        ? { text: 'Что дальше по плану?' }
        : { text: 'Как выполнить «' + shortTitle + '»?', task };

  const questions: SuggestedQuestion[] = [firstQuestion];
  if (hasReadableMaterials(task)) questions.push({ text: 'Какие материалы нужны?', task });
  if (selected) questions.push({ text: 'Где могут быть сложности?', task });
  else if (stageStarted || stage > 0)
    questions.push({ text: 'Что может помешать выполнить «' + shortTitle + '»?', task });
  questions.push(...generalQuestions);
  return questions.slice(0, 5);
}
