import { expect, it } from 'vitest';
import { chatSuggestions } from './chat-suggestions';
import { tasksFor, type Task } from './checklist';

const firstWeek = tasksFor('olga').filter((task) => task.stage === 'week-1');
const secondWeek = tasksFor('olga').filter((task) => task.stage === 'week-2');
const catalog = [...firstWeek, ...secondWeek];
const noMaterials = () => false;
const questions = (completed?: string[], selected?: string) =>
  chatSuggestions(catalog, completed, selected, noMaterials);

it('suggests first steps, mentor and role tools when the plan is starting', () => {
  expect(
    questions([])
      .slice(0, 3)
      .map(({ text }) => text),
  ).toEqual(['С чего начать сегодня?', 'Кто мой наставник?', 'Какие инструменты нужны моей команде?']);
});

it('asks about the next stage as soon as the first group is complete', () => {
  const completed = firstWeek.map(({ id }) => id);
  const [first, help] = questions(completed, firstWeek[0].id);
  expect(first.text).toBe('Что дальше по плану?');
  expect(help.task?.id).toBe(secondWeek[0].id);
});

it('targets the unfinished task of a group already in progress', () => {
  const completed = [...firstWeek, secondWeek[0]].map(({ id }) => id);
  const [first, help] = questions(completed);
  expect(first.text).toContain('Как выполнить');
  expect(first.task?.id).toBe(secondWeek[1].id);
  expect(help.task?.id).toBe(secondWeek[1].id);
  expect(new Set(questions(completed).map(({ text }) => text)).size).toBe(questions(completed).length);
});

it('prioritizes a selected unfinished task and offers materials when readable', () => {
  const selected = secondWeek[0];
  const result = chatSuggestions(catalog, [], selected.id, (task: Task) => task.id === selected.id);
  expect(result.slice(0, 2)).toEqual([
    { text: 'С чего начать этот пункт?', task: selected },
    { text: 'Какие материалы нужны?', task: selected },
  ]);
  expect(questions([], selected.id).map(({ text }) => text)).not.toContain('Какие материалы нужны?');
});

it('leads with tools and documents once every real item is finished', () => {
  expect(
    questions(catalog.map(({ id }) => id))
      .slice(0, 2)
      .map(({ text }) => text),
  ).toEqual(['Какие инструменты нужны моей команде?', 'Где найти документы?']);
});

it('uses the same safe questions for an unavailable or missing plan', () => {
  expect(chatSuggestions([], [], undefined, noMaterials)).toEqual(questions(undefined, secondWeek[0].id));
  expect(questions()?.map(({ text }) => text)).toEqual([
    'Кто мой наставник?',
    'Какие инструменты нужны моей команде?',
    'Где найти документы?',
  ]);
});

it('ranks follow-ups for the latest topic even when a task remains selected', () => {
  const recent = ['Какие инструменты доступны для моей роли?', 'Какие события у меня завтра?'];
  const result = chatSuggestions(catalog, [], firstWeek[0].id, noMaterials, recent);
  expect(result[0]).toEqual({ text: 'Что в моём календаре на этой неделе?' });
  expect(result.some(({ task }) => task)).toBe(false);
  expect(result.some(({ text }) => recent.includes(text))).toBe(false);
  expect(chatSuggestions(catalog, [], firstWeek[0].id, noMaterials, [...recent, 'Где найти документы?'])[0].text).toBe(
    'Где найти путеводитель по продукту?',
  );
});

it('continues a blocker question with a way to verify the result', () => {
  const result = chatSuggestions(catalog, [], firstWeek[0].id, noMaterials, ['Что может помешать выполнить задачу?']);
  expect(result[0].text).toContain('Как понять');
  expect(result[0].task?.id).toBe(firstWeek[0].id);
});

it('suggests distinct help for access and reading tasks', () => {
  const access = { ...firstWeek[0], icon: 'key' as const };
  const reading = { ...firstWeek[1], icon: 'book' as const };
  expect(chatSuggestions([access], [], access.id, noMaterials)[1].text).toMatch(/^Какие доступы/);
  expect(chatSuggestions([reading], [], reading.id, noMaterials)[1].text).toMatch(/^На что обратить внимание/);
});
