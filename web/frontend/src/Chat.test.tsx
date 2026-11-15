import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { ChatPage } from './Chat';

function renderChat(overrides: Partial<ComponentProps<typeof ChatPage>> = {}) {
  return renderToStaticMarkup(
    <ChatPage
      name="Ольга"
      profileId="olga"
      entries={[]}
      waiting={false}
      confirming={false}
      drafts={{}}
      onSend={() => undefined}
      onConfirm={() => undefined}
      onDismiss={() => undefined}
      onSurvey={() => undefined}
      surveyDone={false}
      {...overrides}
    />,
  );
}

it('shows a pending response and disables sending while Buddy is thinking', () => {
  const html = renderChat({
    waiting: true,
    entries: [{ id: 1, from: 'user', text: 'Как запросить доступ к витрине заказов?' }],
  });

  expect(html).toContain('Как запросить доступ к витрине заказов?');
  expect(html).toContain('role="status" aria-label="Buddy думает"');
  expect(html).toMatch(/<button[^>]*aria-label="Отправить сообщение"[^>]*disabled/);
  expect(html).toMatch(/<button[^>]*class="chat-topic"[^>]*disabled/);
});

it('shows the server request number, status and portal link after the reply', () => {
  const html = renderChat({
    entries: [
      {
        id: 1,
        from: 'buddy',
        reply: {
          kind: 'answer',
          text: 'Заявка ДОС-000001 отправлена. Статус: на согласовании.',
          references: [{ title: 'Мои заявки', url: 'http://localhost:5190/' }],
        },
      },
    ],
  });

  expect(html).toContain('Заявка ДОС-000001 отправлена. Статус: на согласовании.');
  expect(html).toContain('href="http://localhost:5190/"');
  expect(html).toContain('Мои заявки');
  expect(html).not.toContain('Buddy думает');
  expect(html).not.toContain('>Подтвердить</button>');
});

it('shows an access refusal without offering to confirm a request', () => {
  const html = renderChat({
    entries: [
      {
        id: 1,
        from: 'buddy',
        reply: { kind: 'access_denied', text: 'Этот ресурс недоступен твоей команде.' },
      },
    ],
  });

  expect(html).toContain('Этот ресурс недоступен твоей команде.');
  expect(html).not.toContain('>Подтвердить</button>');
  expect(html).not.toContain('Заявка отправлена');
});

it.each([
  { state: { type: 'confirmed', number: 'Д-001' } as const, message: 'Заявка Д-001 отправлена' },
  { state: { type: 'dismissed' } as const, message: 'Черновик отменён' },
])('shows the outcome of a demo draft and removes its actions ($state.type)', ({ state, message }) => {
  const html = renderChat({
    drafts: { demo: state },
    entries: [
      {
        id: 1,
        from: 'buddy',
        reply: {
          kind: 'access_confirmation_required',
          text: 'Проверь заявку на доступ.',
          draft: { id: 'demo', profileId: 'olga', serviceId: 'grafana', expiresAt: 1000 },
        },
      },
    ],
  });

  expect(html).toContain(message);
  expect(html).not.toContain('>Подтвердить</button>');
  expect(html).not.toContain('>Отменить</button>');
});

it('opens the chat without an unrelated consent learning form', () => {
  const html = renderChat({ name: 'Мария', profileId: 'maria' });
  expect(html).toContain('chat-panel');
  expect(html).toContain('Твой AI-buddy');
  expect(html).not.toContain('Учебное задание');
  expect(html).not.toContain('Проверить знания');
});
