import { readServiceProfileQuery } from '../../../web/frontend/src/service-session';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { profiles, products, isProfileId, type AccountId } from '../../../web/frontend/src/demo-accounts';
import { Icon } from '../../../web/frontend/src/ui';
import { catalogVersion, permissions, templates, type AccessTemplate } from './catalog';
import {
  accountContext,
  readAccessAccount,
  parseInput,
  statusLabels,
  type AccessRequest,
  type RequestInput,
} from './model';
import { accessClient, type LiveTemplate } from './api';
import { newOperationKey } from './operation-key';
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
  template: AccessTemplate & { resources?: LiveTemplate['resources'] };
  onSubmit: (input: RequestInput) => void | Promise<void>;
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
  const [pending, setPending] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setPending(true);
    try {
      const parsed = parseInput(input);
      if (!review) {
        setInput(parsed);
        setReview(true);
      } else await onSubmit(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить заявку.');
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog title={review ? 'Проверьте заявку' : template.title} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
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
              {template.resources ? (
                <select
                  required
                  value={input.resource_key}
                  onChange={(e) => {
                    const resource = template.resources?.find((item) => item.resource_key === e.target.value);
                    setInput({ ...input, resource_key: e.target.value, fields: { ...resource?.fields } });
                  }}
                >
                  <option value="">Выберите ресурс вашей команды</option>
                  {template.resources.map((item) => (
                    <option key={item.resource_key}>{item.resource_key}</option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  maxLength={160}
                  placeholder={template.keyHint}
                  value={input.resource_key}
                  onChange={(e) => setInput({ ...input, resource_key: e.target.value })}
                />
              )}
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
          <button className="access-primary" type="submit" disabled={pending}>
            {pending ? 'Отправляем…' : review ? 'Отправить заявку' : 'Продолжить'}
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
  onCancel,
  onClose,
}: {
  request: AccessRequest;
  account: AccountId;
  onCancel: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function cancel() {
    setPending(true);
    try {
      await onCancel(request.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отменить заявку.');
    } finally {
      setPending(false);
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
      {request.status === 'submitted' && request.profile_id === account && (
        <div className="access-actions">
          <button disabled={pending} onClick={() => void cancel()}>
            Отменить заявку
          </button>
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
  const [selectedProfile, setSelectedProfile] = useState<AccountId>();
  const buddyAccount = useSyncExternalStore(
    subscribeSession,
    () => readAccessAccount(document.cookie),
    () => null,
  );
  const linkedProfile = typeof window === 'undefined' ? null : readServiceProfileQuery(window.location.search);
  const account = buddyAccount ?? linkedProfile ?? selectedProfile;
  if (!account)
    return (
      <main className="access-app access-main">
        <h1>Войти в управление доступами</h1>
        {Object.keys(profiles)
          .filter(isProfileId)
          .map((id) => (
            <button key={id} type="button" onClick={() => setSelectedProfile(id)}>
              {profiles[id].fullName}
            </button>
          ))}
      </main>
    );
  return <Portal key={account} account={account} />;
}
function Portal({ account }: { account: AccountId }) {
  const api = useMemo(() => accessClient(account), [account]);
  const fallback = accountContext(account);
  const [serverContext, setServerContext] = useState<typeof fallback>();
  const context = serverContext || fallback;
  const product = products[context.productId];
  const [tab, setTab] = useState<'catalog' | 'requests'>(() =>
    new URLSearchParams(window.location.search).get('tab') === 'requests' ? 'requests' : 'catalog',
  );
  const [query, setQuery] = useState('');
  const [recommended, setRecommended] = useState(true);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [liveTemplates, setLiveTemplates] = useState<LiveTemplate[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(true);
  const [template, setTemplate] = useState<LiveTemplate>();
  const [selected, setSelected] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get('request') || undefined,
  );
  const [status, setStatus] = useState('all');
  const [operationKey, setOperationKey] = useState(newOperationKey);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setPending(true);
    setError('');
    Promise.all([api.catalog(), api.list()])
      .then(([catalog, records]) => {
        if (!active) return;
        setServerContext({
          name: catalog.context.name,
          productId: catalog.context.product_id,
          role: catalog.context.job_role === 'staff' ? null : catalog.context.job_role,
        });
        setLiveTemplates(catalog.templates as LiveTemplate[]);
        setRequests(records);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Не удалось прочитать серверные заявки.');
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [api, revision]);
  useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    window.addEventListener('focus', update);
    const timer = window.setInterval(update, 15000);
    return () => {
      window.removeEventListener('focus', update);
      window.clearInterval(timer);
    };
  }, []);
  async function submit(input: RequestInput) {
    await api.submit(input, operationKey);
    setOperationKey(newOperationKey());
    setTemplate(undefined);
    setTab('requests');
    setStatus('all');
    setNotice('Заявка сохранена. Её номер и статус доступны в списке.');
    setRevision((value) => value + 1);
  }
  async function cancel(id: string) {
    await api.cancel(id);
    setNotice('Заявка отменена.');
    setRevision((value) => value + 1);
  }
  const mine = requests;
  const catalog = liveTemplates.filter(
    (item) =>
      (!recommended || !context.role || item.roles.length === 0 || item.roles.includes(context.role)) &&
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
            <small>{isProfileId(account) ? profiles[account].position : 'Сотрудник'}</small>
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
            Мои заявки
            <span>{mine.length}</span>
          </button>
        </div>
        <div className="access-demo-note">
          <Icon name="info" size={17} />
          <span>Учебный сервис. Отправленные заявки хранятся в списке «Мои заявки».</span>
        </div>
        {pending && (
          <p role="status" className="access-muted">
            Обновляем данные сервера…
          </p>
        )}
        {error && (
          <div role="alert" className="access-error">
            {error} <button onClick={() => setRevision((value) => value + 1)}>Повторить</button>
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
                  disabled={!isProfileId(account) || pending}
                  onClick={() => {
                    setOperationKey(newOperationKey());
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
          </>
        ) : (
          <>
            <div className="access-request-toolbar">
              <h2>Ваши заявки</h2>
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
                {isProfileId(account) && <p>Выберите ресурс в каталоге, чтобы запросить доступ.</p>}
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
          onCancel={cancel}
          onClose={() => setSelected(undefined)}
        />
      )}
    </div>
  );
}
