export function getPageHelp(tabUrl: string | undefined, webUrl: string, question: string): string {
  if (!tabUrl) return 'Открой страницу «Инструменты и доступы» в AI-buddy, чтобы я могла подсказать по ней.';
  try {
    const page = new URL(tabUrl);
    const web = new URL(webUrl);
    const knownHosts = new Set(['localhost', '127.0.0.1']);
    const sameSite = page.origin === web.origin ||
      (knownHosts.has(page.hostname) && knownHosts.has(web.hostname) && page.port === web.port && page.protocol === web.protocol);
    if (sameSite && page.pathname.replace(/\/$/, '') === '/tools') {
      if (/инструкц|описан|как работать/i.test(question)) {
        return 'Нажми на карточку нужного сервиса. В подробностях есть инструкция и контакт ответственного.';
      }
      return 'Выбери карточку нужного сервиса, например Grafana. В подробностях нажми «Подготовить заявку», а затем подтверди её в чате.';
    }
  } catch {
    // Browser-internal or malformed addresses have no page guidance.
  }
  return 'Эта страница пока незнакома. Могу подсказать, как запросить доступ, в разделе «Инструменты и доступы».';
}
