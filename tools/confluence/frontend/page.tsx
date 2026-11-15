import { useEffect, useMemo, useState } from 'react';
import { profiles, products, type ProfileId } from '../../../web/frontend/src/demo-accounts';
import { Icon } from '../../../web/frontend/src/ui';
import { knowledgeClient, kinds, sections, type KnowledgePage } from './api';
import './style.css';

export function KnowledgeArticle({ page }: { page: KnowledgePage }) {
  return (
    <article
      className="knowledge-article"
      data-agent-resource={JSON.stringify({ kind: 'confluence', id: page.id, label: page.title })}
    >
      <p className="knowledge-eyebrow">{kinds[page.kind]} / База знаний команды</p>
      <h1>{page.title}</h1>
      <div className="knowledge-meta">
        <span className="knowledge-author">Д</span>
        <span>
          Демо-команда · Версия {page.version}
          <small>Обновлено {new Date(page.updated_at).toLocaleDateString('ru-RU')}</small>
        </span>
      </div>
      <div className="knowledge-body">
        {sections(page.body).map((section, index) => (
          <section key={index}>
            {section.heading && <h2>{section.heading}</h2>}
            <p>{section.text}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
export function ConfluencePage({ profile }: { profile: ProfileId }) {
  const api = useMemo(() => knowledgeClient(profile), [profile]);
  const product = products[profiles[profile].productId];
  const [pages, setPages] = useState<KnowledgePage[]>([]);
  const [page, setPage] = useState<KnowledgePage>();
  const [pageId, setPageId] = useState(
    () => new URLSearchParams(window.location.search).get('page') || 'product-' + profiles[profile].productId,
  );
  const [query, setQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<KnowledgePage[]>([]);
  const [searchError, setSearchError] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setPending(true);
    setError('');
    setPage(undefined);
    Promise.all([api.list('', controller.signal), api.read(pageId, controller.signal)])
      .then(([all, current]) => {
        if (active) {
          setPages(all);
          setPage(current);
        }
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Не удалось прочитать страницу.');
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, pageId, revision]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setSearchError('');
    setSearchMatches([]);
    if (!query.trim()) return () => controller.abort();
    const timer = window.setTimeout(() => {
      api
        .list(query, controller.signal)
        .then((items) => {
          if (active) setSearchMatches(items);
        })
        .catch((error: unknown) => {
          if (active) setSearchError(error instanceof Error ? error.message : 'Поиск недоступен.');
        });
    }, 200);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [api, query]);
  const matches = query.trim() ? searchMatches : pages;
  function open(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', id);
    window.history.replaceState(null, '', url);
    setPageId(id);
    setQuery('');
  }
  return (
    <div className="knowledge-app">
      <header className="knowledge-header">
        <a href="/" className="knowledge-brand">
          <span>◆</span>Confluence
        </a>
        <span className="knowledge-header-label">Знания команды</span>
        <span className="knowledge-user">{profiles[profile].fullName}</span>
      </header>
      <div className="knowledge-layout">
        <aside className="knowledge-sidebar">
          <p className="knowledge-label">ПРОСТРАНСТВО</p>
          <div className="knowledge-space">
            <span>{product.name.charAt(0)}</span>
            <div>
              <strong>{product.name}</strong>
              <small>{product.team}</small>
            </div>
          </div>
          <label className="knowledge-search">
            <Icon name="search" size={17} />
            <input
              aria-label="Поиск страницы"
              type="search"
              placeholder="Найти страницу…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <nav aria-label="Страницы Confluence">
            {searchError && (
              <p role="alert" className="knowledge-error">
                {searchError}
              </p>
            )}
            {Object.entries(kinds).map(([kind, label]) => (
              <section key={kind}>
                <h2>{label}</h2>
                {matches
                  .filter((item) => item.kind === kind)
                  .map((item) => (
                    <button key={item.id} className={pageId === item.id ? 'active' : ''} onClick={() => open(item.id)}>
                      <Icon name={kind === 'product' ? 'layers' : kind === 'team' ? 'users' : 'file'} size={15} />
                      <span>{item.title}</span>
                    </button>
                  ))}
              </section>
            ))}
            {!matches.length && !pending && <p className="knowledge-muted">Страницы не найдены.</p>}
          </nav>
        </aside>
        <main className="knowledge-main">
          <div className="knowledge-notice">
            <Icon name="info" size={17} />
            Учебная база знаний AI Buddy. Материалы не являются внутренними инструкциями Авито.
          </div>
          {pending && (
            <p role="status" className="knowledge-muted">
              Загружаем материалы…
            </p>
          )}
          {error && (
            <div role="alert" className="knowledge-error">
              {error}
              <button
                onClick={() => {
                  setPageId('product-' + profiles[profile].productId);
                  setRevision((v) => v + 1);
                }}
              >
                Открыть пространство
              </button>
            </div>
          )}
          {page && <KnowledgeArticle page={page} />}
        </main>
      </div>
    </div>
  );
}
