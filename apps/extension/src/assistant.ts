export type PageContext = {
  url?: string;
  title?: string;
  selectedText?: string;
};

export type BuddyAnswer = {
  text: string;
  source?: string;
};

export function answerFromPage(question: string, page: PageContext): BuddyAnswer {
  const normalized = question.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
  const selected = page.selectedText?.trim();

  if (/доступ|инструмент|grafana|jira|figma|confluence/.test(normalized)) {
    if (page.url?.includes('/tools')) {
      return {
        text: 'На этой странице выбери карточку нужного сервиса. В подробностях можно посмотреть инструкцию или подготовить заявку на доступ.',
        source: 'Инструменты и доступы',
      };
    }
    return {
      text: 'Я могу помочь с доступами. Открой раздел «Инструменты и доступы» в AI-buddy, выбери нужный сервис и подтверди заявку в чате.',
      source: 'AI-buddy',
    };
  }

  if (selected) {
    return {
      text: `Вижу выделенный фрагмент «${selected.slice(0, 140)}${selected.length > 140 ? '…' : ''}». Могу помочь разобрать его или подсказать следующий шаг.`,
      source: page.title || 'Текущая страница',
    };
  }

  if (/куда|найти|нажать|страниц|раздел/.test(normalized)) {
    return {
      text: `Сейчас открыта страница «${page.title || 'без названия'}». Я могу подсказать навигацию, если ты уточнишь, какой результат хочешь получить.`,
      source: page.title || 'Текущая страница',
    };
  }

  return {
    text: 'Я вижу текущую страницу. Уточни, что нужно найти или сделать, и я подскажу следующий шаг.',
    source: page.title || 'Текущая страница',
  };
}
