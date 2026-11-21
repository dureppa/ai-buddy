import { stages, type Task } from './checklist';
import { currentChecklistTask } from './current-task';

type SuggestedQuestion = { text: string; task?: Task };

const mentor = { text: 'Кто мой наставник?' };
const tools = { text: 'Какие инструменты нужны моей команде?' };
const documents = { text: 'Где найти документы?' };
const generalQuestions = [mentor, tools, documents];

const followUps = {
  jira: ['Как создать задачу в Jira?', 'Какие задачи Jira назначены мне?'],
  calendar: ['Какие события у меня завтра?', 'Что в моём календаре на этой неделе?', 'Какие встречи у меня сегодня?'],
  access: ['Как проверить статус моих заявок на доступ?', 'Какие ресурсы есть в каталоге доступов?'],
  mentor: ['Как связаться с моим наставником?', 'Кто входит в мою команду?'],
  tools: [tools.text, 'Какие инструменты доступны для моей роли?'],
  documents: [documents.text, 'Где найти путеводитель по продукту?'],
};

export function chatTopic(text: string) {
  if (/jira|джир/i.test(text)) return 'jira';
  if (
    /^(?:(?:как выполнить|что может помешать выполнить|что стоит проверить перед|на что обратить внимание в|как понять, что|какие доступы понадобятся для) «|отметить выполненной:)|пункт|чек.лист|по плану|материалы нужны|с чего начать/i.test(
      text,
    )
  )
    return 'task';
  if (/календар|расписан|событи|встреч|созвон/i.test(text)) return 'calendar';
  if (/доступ|мо[ихя]+ заявк/i.test(text)) return 'access';
  if (/инструмент/i.test(text)) return 'tools';
  if (/наставник|коллег|команд/i.test(text)) return 'mentor';
  if (/документ|инструкци|путеводител/i.test(text)) return 'documents';
  if (/задач|задани|помешат|препятств|сложност/i.test(text)) return 'task';
}

function taskFollowUp(task: Task, title: string, last: string) {
  if (/помешат|препятств|сложност/i.test(last)) return 'Как понять, что «' + title + '» выполнено?';
  if (/как выполнить|с чего начать|что дальше|какая задача/i.test(last))
    return 'Что стоит проверить перед «' + title + '»?';
  switch (task.icon) {
    case 'key':
      return 'Какие доступы понадобятся для «' + title + '»?';
    case 'book':
    case 'file':
      return 'На что обратить внимание в «' + title + '»?';
    case 'users':
      return 'Что обсудить с командой по пункту «' + title + '»?';
    default:
      return 'Как проверить результат пункта «' + title + '»?';
  }
}

export function chatSuggestions(
  catalog: readonly Task[],
  completed: readonly string[] | undefined,
  selectedTaskId: string | undefined,
  hasReadableMaterials: (task: Task) => boolean,
  recentQuestions: readonly string[] = [],
): SuggestedQuestion[] {
  const last = recentQuestions.at(-1) ?? '';
  const topic = chatTopic(last);
  const recent = new Set(
    recentQuestions.map((text) =>
      text
        .trim()
        .toLowerCase()
        .replace(/[?!.]+$/, ''),
    ),
  );
  function rank(questions: SuggestedQuestion[]) {
    return questions.filter(({ text }) => !recent.has(text.toLowerCase().replace(/[?!.]+$/, ''))).slice(0, 5);
  }
  if (topic && topic !== 'task') {
    const related = followUps[topic].map((text) => ({ text }));
    return rank([...related, ...generalQuestions.filter(({ text }) => !followUps[topic].includes(text))]);
  }
  if (!completed || !catalog.length) return rank(generalQuestions);

  const current = currentChecklistTask(catalog, completed);
  if (!current) return rank([tools, documents, mentor]);

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

  const followUp = { text: taskFollowUp(task, shortTitle, topic === 'task' ? last : ''), task };
  const questions: SuggestedQuestion[] = topic === 'task' ? [followUp, firstQuestion] : [firstQuestion];
  if (hasReadableMaterials(task)) questions.push({ text: 'Какие материалы нужны?', task });
  if (topic !== 'task' && (selected || stageStarted || stage > 0)) questions.push(followUp);
  questions.push(...generalQuestions);
  return rank(questions);
}

// A task selection changes the server's permissions. Keep it for follow-ups that refer to the task.
export function isTaskFollowUp(text: string, title?: string): boolean {
  const value = text.trim().toLowerCase();
  if (/эт(?:от|ого|ому|им|ом) (?:пункт|задан)|эт(?:у|ой|ая) задач/i.test(value)) return true;
  if (title && value.includes(title.toLowerCase())) return true;
  const topic = chatTopic(value);
  if (topic && topic !== 'task') return false;
  return (
    /эт(?:о|ого|ой|ом)(?=\s|[?!.]|$)/i.test(value) ||
    /^(?:а )?(?:какие материалы (?:мне )?(?:нужны|к нему)|какой (?:мой )?первый шаг|что может помешать(?: выполнить задачу)?|какие (?:есть )?препятствия|где могут быть сложности|объясни простыми словами|(?:а )?почему|зачем|(?:а )?дальше|как это проверить)[?!.]*$/i.test(
      value,
    )
  );
}
