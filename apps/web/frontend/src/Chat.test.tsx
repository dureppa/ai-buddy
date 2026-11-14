import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatPage } from './Chat';

it('opens the chat without an unrelated consent learning form', () => {
  const html = renderToStaticMarkup(
    <ChatPage
      name="Мария"
      profileId="maria"
      entries={[]}
      waiting={false}
      confirming={false}
      drafts={{}}
      onSend={() => undefined}
      onConfirm={() => undefined}
      onDismiss={() => undefined}
      onSurvey={() => undefined}
      surveyDone={false}
    />,
  );
  expect(html).toContain('chat-panel');
  expect(html).toContain('Твой AI-buddy');
  expect(html).not.toContain('Учебное задание');
  expect(html).not.toContain('Проверить знания');
});
