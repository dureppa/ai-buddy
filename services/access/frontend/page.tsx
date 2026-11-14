import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { profiles, products, isProfileId, type AccountId } from '../../../apps/web/frontend/src/demo-accounts';
import { Icon } from '../../../apps/web/frontend/src/ui';
import { catalogVersion, permissions, recommendedTemplates, templates, type AccessTemplate } from './catalog';
import {
  accountContext,
  changeRequest,
  createRequest,
  readAccessAccount,
  parseInput,
  readRequests,
  saveRequests,
  statusLabels,
  visibleRequests,
  type AccessRequest,
  type RequestInput,
} from './model';
import './style.css';

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="access-dialog"
      ref={dialog}
      aria-labelledby="access-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="access-dialog-heading">
        <h2 id="access-dialog-title">{title}</h2>
        <button type="button" className="access-icon-button" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function AccessForm({
  template,
  onSubmit,
  onClose,
}: {
  template: AccessTemplate;
  onSubmit: (input: RequestInput) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState<RequestInput>({
    template_id: template.id,
    catalog_version: catalogVersion,
    system: template.system,
    resource_key: '',
    justification: '',
    permission: template.levels[0],
    duration_days: 30,
    fields: {},
  });
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const parsed = parseInput(input);
      if (!review) {
        setInput(parsed);
        setReview(true);
      } else onSubmit(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить заявку.');
    }
  }
  return (
    <Dialog title={review ? 'Проверьте заявку' : template.title} onClose={onClose}>
      <p className="access-muted">Согласование: {template.owner} и руководитель команды.</p>
      <form onSubmit={submit}>
        {review ? (
          <RequestSummary input={input} />
        ) : (
          <fieldset className="access-fields">
            <label>
              Система или проект
              <input
                required
                maxLength={120}
                value={input.system}
                onChange={(e) => setInput({ ...input, system: e.target.value })}
              />
            </label>
            <label>
              Ключ ресурса
              <input
                required
                maxLength={160}
                placeholder={template.keyHint}
                value={input.resource_key}
                onChange={(e) => setInput({ ...input, resource_key: e.target.value })}
              />
              <small>Точное имя проекта, доски, схемы или набора данных.</small>
            </label>
            <div className="access-field-row">
              <label>
                Уровень прав
                <select
                  value={input.permission}
                  onChange={(e) => setInput({ ...input, permission: e.target.value as RequestInput['permission'] })}
                >
                  {template.levels.map((level) => (
                    <option key={level} value={level}>
                      {permissions[level]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Срок доступа, дней
                <input
                  type="number"
                  required
                  min={1}
                  max={90}
                  value={input.duration_days}
                  onChange={(e) => setInput({ ...input, duration_days: Number(e.target.value) })}
                />
              </label>
            </div>
            {template.fields.map((field) => (
              <label key={field.key}>
                {field.label}
                {field.options ? (
                  <select
                    required
                    value={input.fields[field.key] || ''}
                    onChange={(e) => setInput({ ...input, fields: { ...input.fields, [field.key]: e.target.value } })}
                  >
                    <option value="">Выберите значение</option>
                    {field.options.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    type={field.key.endsWith('_url') ? 'url' : 'text'}
                    maxLength={500}
                    placeholder={field.placeholder}
                    value={input.fields[field.key] || ''}
                    onChange={(e) => setInput({ ...input, fields: { ...input.fields, [field.key]: e.target.value } })}
                  />
                )}
              </label>
            ))}
            <label>
              Обоснование доступа
              <textarea
                required
                minLength={10}
                maxLength={2000}
                rows={4}
                placeholder="Опишите рабочую задачу и зачем нужен этот ресурс"
                value={input.justification}
                onChange={(e) => setInput({ ...input, justification: e.target.value })}
              />
            </label>
          </fieldset>
        )}
        {input.permission === 'admin' && (
          <p className="access-notice">Администрирование требует отдельного согласования владельцем системы.</p>
        )}
        {error && (
          <p className="access-error" role="alert">
            {error}
          </p>
        )}
        <div className="access-actions">
          <button type="button" onClick={() => (review ? setReview(false) : onClose())}>
            {review ? 'Изменить поля' : 'Отмена'}
          </button>
          <button className="access-primary" type="submit">
            {review ? 'Отправить на согласование' : 'Продолжить'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function RequestSummary({ input }: { input: RequestInput }) {
  const template = templates.find((item) => item.id === input.template_id);
  return (
    <dl className="access-summary">
      <dt>Система</dt>
      <dd>{input.system}</dd>
      <dt>Ключ ресурса</dt>
      <dd>{input.resource_key}</dd>
      <dt>Уровень прав</dt>
      <dd>{permissions[input.permission]}</dd>
      <dt>Срок</dt>
      <dd>{input.duration_days} дней</dd>
      {Object.entries(input.fields).map(([key, value]) => (
        <div className="access-summary-extra" key={key}>
          <dt>{template?.fields.find((field) => field.key === key)?.label || key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      <dt>Обоснование</dt>
      <dd>{input.justification}</dd>
    </dl>
  );
}
function RequestDetails({
  request,
  account,
  onAction,
  onClose,
}: {
  request: AccessRequest;
  account: AccountId;
  onAction: (id: string, action: 'approved' | 'rejected' | 'cancelled', note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const context = accountContext(account);
  function act(action: 'approved' | 'rejected' | 'cancelled') {
    try {
      onAction(request.id, action, note);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить решение.');
    }
  }
  return (
    <Dialog title={'Заявка ' + request.number} onClose={onClose}>
      <p>
        <span className={'access-badge access-badge--' + request.status}>{statusLabels[request.status]}</span>
      </p>
      <p className="access-muted">
        {profiles[request.profile_id].fullName} · {products[request.product_id].name}
      </p>
      <RequestSummary input={request.input} />
      {request.decision_note && <p className="access-notice">Комментарий: {request.decision_note}</p>}
      {request.status === 'approved' && (
        <p className="access-notice">Заявка согласована в деморежиме. Реальные права не выдавались.</p>
      )}
      {request.status === 'submitted' && context.canReview && (
        <>
          <label className="access-comment">
            Комментарий к решению
            <textarea
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="При отказе укажите причину"
            />
          </label>
          <div className="access-actions">
            <button onClick={() => act('rejected')}>Отклонить</button>
            <button className="access-primary" onClick={() => act('approved')}>
              Согласовать
            </button>
          </div>
        </>
      )}
      {request.status === 'submitted' && request.profile_id === account && (
        <div className="access-actions">
          <button onClick={() => act('cancelled')}>Отменить заявку</button>
        </div>
      )}
      {error && (
        <p role="alert" className="access-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
function subscribeSession(onChange: () => void) {
  window.addEventListener('focus', onChange);
  const timer = window.setInterval(onChange, 1000);
  return () => {
    window.removeEventListener('focus', onChange);
    window.clearInterval(timer);
  };
}
export function AccessPortal() {
  const account = useSyncExternalStore(
    subscribeSession,
    () => readAccessAccount(document.cookie),
    () => null,
  );
  if (!account)
    return (
      <main className="access-app access-main">
        <h1>Войди в AI Buddy</h1>
        <p>Открой сервис из своего рабочего пространства после входа в AI Buddy.</p>
      </main>
    );
  return <Portal key={account} account={account} />;
}
function Portal({ account }: { account: AccountId }) {
  const context = accountContext(account);
  const product = products[context.productId];
  const [tab, setTab] = useState<'catalog' | 'requests'>(context.canReview ? 'requests' : 'catalog');
  const [query, setQuery] = useState('');
  const [recommended, setRecommended] = useState(true);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [template, setTemplate] = useState<AccessTemplate>();
  const [selected, setSelected] = useState<string>();
  const [status, setStatus] = useState('all');
  function load() {
    try {
      setRequests(readRequests(localStorage));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Хранилище недоступно.');
    }
  }
  useEffect(() => {
    load();
    const sync = () => load();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  function commit(next: AccessRequest[]) {
    saveRequests(localStorage, next);
    setRequests(next);
    setError('');
  }
  function submit(input: RequestInput) {
    if (!isProfileId(account)) throw new Error('Выберите демопрофиль стажёра.');
    commit(createRequest(readRequests(localStorage), input, account, crypto.randomUUID(), new Date().toISOString()));
    setTemplate(undefined);
    setTab('requests');
    setStatus('all');
    setNotice('Заявка отправлена на согласование.');
  }
  function action(id: string, action: 'approved' | 'rejected' | 'cancelled', note: string) {
    commit(changeRequest(readRequests(localStorage), id, account, action, note, new Date().toISOString()));
    setNotice('Изменения сохранены.');
  }
  const mine = visibleRequests(requests, account);
  const catalog = (recommended && context.role ? recommendedTemplates(context.role) : templates).filter((item) =>
    (item.title + ' ' + item.description + ' ' + item.system).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selectedRequest = requests.find((item) => item.id === selected);
  return (
    <div className="access-app">
      <header className="access-header">
        <a href={'/?profile=' + account} className="access-brand">
          <span>
            <Icon name="key" size={22} />
          </span>
          Доступы
        </a>
        <div className="access-header-right">
          <span className="access-demo">Демосреда</span>
          <div className="access-current-account">
            <span>{context.name}</span>
            <small>
              {context.canReview
                ? 'Руководитель команды'
                : isProfileId(account)
                  ? profiles[account].position
                  : 'Сотрудник'}
            </small>
          </div>
        </div>
      </header>
      <main className="access-main">
        <div className="access-intro">
          <p className="access-eyebrow">
            {product.name} / {product.team}
          </p>
          <h1>Управление доступами</h1>
          <p>Всё необходимое для работы — в одном месте. Выберите ресурс и отправьте заявку.</p>
        </div>
        <div className="access-tabs" role="group" aria-label="Разделы сервиса">
          <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>
            Каталог доступов
          </button>
          <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>
            {context.canReview ? 'Заявки команды' : 'Мои заявки'}
            <span>{mine.length}</span>
          </button>
        </div>
        <div className="access-demo-note">
          <Icon name="info" size={17} />
          <span>
            Демонстрационный сервис: заявки сохраняются в этом браузере. Согласование не выдаёт реальные права.
          </span>
        </div>
        {error && (
          <div role="alert" className="access-error">
            {error} <button onClick={load}>Повторить</button>
          </div>
        )}
        {notice && (
          <p role="status" className="access-success">
            {notice}
          </p>
        )}
        {tab === 'catalog' ? (
          <>
            <div className="access-toolbar">
              <label className="access-search">
                <Icon name="search" size={19} />
                <input
                  type="search"
                  aria-label="Поиск ресурса"
                  placeholder="Найти систему или тип доступа"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {context.role && (
                <div className="access-filters">
                  <button className={recommended ? 'active' : ''} onClick={() => setRecommended(true)}>
                    Для моей роли
                  </button>
                  <button className={!recommended ? 'active' : ''} onClick={() => setRecommended(false)}>
                    Все ресурсы
                  </button>
                </div>
              )}
            </div>
            <div className="access-section-title">
              <h2>{recommended && context.role ? 'Рекомендуем для вашей роли' : 'Каталог ресурсов'}</h2>
              <span>{catalog.length} ресурсов</span>
            </div>
            <div className="access-grid">
              {catalog.map((item) => (
                <button
                  className="access-card"
                  key={item.id}
                  disabled={!isProfileId(account)}
                  onClick={() => {
                    setTemplate(item);
                    setNotice('');
                  }}
                >
                  <span className={'access-tile access-tile--' + item.color}>
                    <Icon name={item.icon} size={27} />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </span>
                  <Icon name="diagonal" size={17} />
                </button>
              ))}
            </div>
            {catalog.length === 0 && (
              <div className="access-empty">Ресурсы не найдены. Попробуйте другое название.</div>
            )}
            {context.canReview && (
              <p className="access-muted">
                Заявки создаются из рабочего пространства стажёра в AI Buddy. Рассмотрение доступно в разделе «Заявки
                команды».
              </p>
            )}
          </>
        ) : (
          <>
            <div className="access-request-toolbar">
              <h2>{context.canReview ? 'Заявки вашей команды' : 'Ваши заявки'}</h2>
              <label>
                Статус
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="all">Все статусы</option>
                  {Object.entries(statusLabels).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="access-request-list">
              {mine
                .filter((item) => status === 'all' || item.status === status)
                .map((item) => (
                  <button key={item.id} className="access-request" onClick={() => setSelected(item.id)}>
                    <span className="access-request-number">{item.number}</span>
                    <span>
                      <strong>
                        {item.input.system} · {item.input.resource_key}
                      </strong>
                      <small>
                        {permissions[item.input.permission]} · {item.input.duration_days} дней ·{' '}
                        {profiles[item.profile_id].fullName}
                      </small>
                    </span>
                    <span className={'access-badge access-badge--' + item.status}>{statusLabels[item.status]}</span>
                    <Icon name="arrow" size={18} />
                  </button>
                ))}
            </div>
            {!mine.some((item) => status === 'all' || item.status === status) && (
              <div className="access-empty">
                <Icon name="file" size={30} />
                <h3>Здесь пока нет заявок</h3>
                <p>
                  {context.canReview
                    ? 'Заявки стажёров вашей команды появятся в этом списке.'
                    : 'Выберите ресурс в каталоге, чтобы запросить доступ.'}
                </p>
                <button onClick={() => setTab('catalog')}>Открыть каталог</button>
              </div>
            )}
          </>
        )}
      </main>
      {template && <AccessForm template={template} onSubmit={submit} onClose={() => setTemplate(undefined)} />}
      {selectedRequest && (
        <RequestDetails
          request={selectedRequest}
          account={account}
          onAction={action}
          onClose={() => setSelected(undefined)}
        />
      )}
    </div>
  );
}
