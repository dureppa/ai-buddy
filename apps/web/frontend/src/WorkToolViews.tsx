import { useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from './backend';
import type { ProfileId } from './demo-accounts';
import { pageSchema } from './work-tool-data';
import type { ToolRecord } from './work-tool-data';

type Props = { record: ToolRecord; profileId: ProfileId };

function Tabs({ views }: { views: Record<string, ReactNode> }) {
  const [active, setActive] = useState(Object.keys(views)[0]);
  return (
    <>
      <div className="tool-tabs" aria-label="Разделы">
        {Object.keys(views).map((label) => (
          <button key={label} aria-pressed={label === active} onClick={() => setActive(label)}>
            {label}
          </button>
        ))}
      </div>
      {views[active]}
    </>
  );
}

function Status({ children }: { children: ReactNode }) {
  return <span className="tool-status">{children}</span>;
}

function Grid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <table className="tool-table">
      <thead>
        <tr>
          <th scope="col">Показатель</th>
          <th scope="col">Значение</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Chart({ rows }: { rows: Array<[string, string]> }) {
  const [selected, setSelected] = useState('');
  const [firstLabel, firstValue] = rows[0] ?? ['', '0'];
  const total = Math.max(...rows.map(([, value]) => Number.parseFloat(value)), 1);
  return (
    <div className="tool-chart">
      {rows.map(([label, value]) => (
        <button key={label} aria-pressed={(selected || firstLabel) === label} onClick={() => setSelected(label)}>
          <span>{label}</span>
          <span className="tool-chart__track">
            <span style={{ width: Math.max(0, (Number.parseFloat(value) / total) * 100) + '%' }} />
          </span>
          <strong>{value}</strong>
        </button>
      ))}
      <output>
        {selected || firstLabel} · {rows.find(([label]) => label === selected)?.[1] ?? firstValue}
      </output>
    </div>
  );
}

function Dashboard({ record }: Props) {
  const rows = Object.entries(record.fields).filter(([, value]) => /^\d+(?:[.,]\d+)?%?$/.test(value));
  return (
    <>
      <Status>{record.status}</Status>
      <p>{record.description}</p>
      <Tabs views={{ График: <Chart rows={rows} />, Таблица: <Grid rows={rows} /> }} />
    </>
  );
}

function Grafana({ record }: Props) {
  const [period, setPeriod] = useState('all');
  const periods = ['До релиза', 'После релиза'];
  const rows = Object.entries(record.fields).filter(([label]) => periods.includes(label));
  const visible = period === 'all' ? rows : rows.filter(([label]) => label === period);
  return (
    <>
      <div className="tool-toolbar">
        <Status>{record.status}</Status>
        <select aria-label="Период мониторинга" value={period} onChange={(event) => setPeriod(event.target.value)}>
          <option value="all">Вокруг релиза</option>
          {periods.map((label) => (
            <option key={label}>{label}</option>
          ))}
        </select>
      </div>
      <p>{record.description}</p>
      <div className="tool-monitor">
        {visible.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <Tabs views={{ График: <Chart rows={visible} />, Таблица: <Grid rows={visible} /> }} />
    </>
  );
}

function Experiment({ record }: Props) {
  const variants = ['Контроль', 'Вариант B'];
  const rates = variants.map((variant) => Number.parseFloat(record.fields[variant]));
  const uplift = rates[1] - rates[0];
  return (
    <>
      <Status>{record.status}</Status>
      <p>{record.description}</p>
      <div className="tool-monitor">
        {variants.map((label) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{record.fields[label]}</strong>
          </div>
        ))}
        {Number.isFinite(uplift) && (
          <div>
            <span>Разница конверсии</span>
            <strong>
              {new Intl.NumberFormat('ru', { signDisplay: 'exceptZero', maximumFractionDigits: 2 }).format(uplift)} п.
              п.
            </strong>
          </div>
        )}
      </div>
      <Tabs
        views={{
          Результаты: <Grid rows={Object.entries(record.fields).filter(([label]) => label !== 'Задача')} />,
          Гипотеза: <p>{record.description}</p>,
        }}
      />
    </>
  );
}

function Trino({ record }: Props) {
  const [ran, setRan] = useState(false);
  return (
    <div className="tool-console">
      <div className="tool-toolbar">
        <Status>{record.status}</Status>
        <button className="tool-primary" onClick={() => setRan(true)}>
          ▶ Выполнить выборку
        </button>
      </div>
      <pre>{'SELECT step, count(DISTINCT session_id) AS sessions\nFROM ' + record.title + '\nGROUP BY step;'}</pre>
      <p>{record.description}</p>
      {ran && (
        <div role="status">
          <h3>Результат выборки</h3>
          <Grid rows={Object.entries(record.fields).filter(([key]) => key !== 'Задача')} />
        </div>
      )}
    </div>
  );
}

function Bitbucket({ record }: Props) {
  return (
    <>
      <div className="tool-toolbar">
        <Status>{record.status}</Status>
        <code>{record.fields.Ветка} → main</code>
      </div>
      <Tabs
        views={{
          Обзор: <p>{record.description}</p>,
          'Комментарии ревью': (
            <div className="tool-thread">
              <strong>Замечание к PR</strong>
              <p>{record.fields.Замечание}</p>
            </div>
          ),
          Ветка: <pre>{record.fields.Ветка}</pre>,
        }}
      />
    </>
  );
}

function Deployments({ record }: Props) {
  const [version, setVersion] = useState('current');
  return (
    <>
      <div className="tool-toolbar">
        <Status>{record.status}</Status>
        <select aria-label="Версия релиза" value={version} onChange={(event) => setVersion(event.target.value)}>
          <option value="current">{record.fields.Версия} · текущая</option>
          <option value="previous">{record.fields.Предыдущая} · предыдущая</option>
        </select>
      </div>
      <div className="tool-thread">
        <h3>{version === 'current' ? record.fields.Версия : record.fields.Предыдущая}</h3>
        <p>{version === 'current' ? record.description : 'Предыдущий релиз окружения'}</p>
      </div>
      <Link to="/work-tools/grafana">Открыть мониторинг →</Link>
    </>
  );
}

function TestRun({ record }: Props) {
  const [outcome, setOutcome] = useState('');
  return (
    <>
      <Status>{outcome || record.status}</Status>
      <ol className="tool-steps">
        <li>Открыть стенд Автотеки.</li>
        <li>
          Ввести <code>{record.fields['Учебный VIN']}</code> и запустить поиск.
        </li>
        <li>Сравнить ответ с ожидаемым результатом.</li>
      </ol>
      <p>{record.description}</p>
      <div className="tool-toolbar">
        <button onClick={() => setOutcome('Пройден')}>Пройден</button>
        <button onClick={() => setOutcome('Не пройден')}>Не пройден</button>
        <Link to="/work-tools/test-stand">Открыть стенд →</Link>
      </div>
      {outcome && <p role="status">Результат учебного прогона · {outcome}</p>}
    </>
  );
}

function ApiResponse({ record }: { record: ToolRecord }) {
  return (
    <section className="tool-response" aria-label="Ответ">
      <h3>Ответ</h3>
      <Status>HTTP {record.status}</Status>
      <pre>{JSON.stringify({ vin: record.title, code: record.fields.Ответ }, null, 2)}</pre>
    </section>
  );
}

function Postman({ record, profileId }: Props) {
  const [vin, setVin] = useState(record.fields.Сценарий ?? '');
  const [response, setResponse] = useState<ToolRecord>();
  const [state, setState] = useState<'idle' | 'pending' | 'missing' | 'error'>('idle');
  const send = async () => {
    setState('pending');
    setResponse(undefined);
    try {
      const result = await apiFetch(profileId, '/api/v1/work-tools/test-stand');
      const fixtures = pageSchema.parse(await result.json()).records;
      const match = fixtures.find(({ title }) => title.toUpperCase() === vin.trim().toUpperCase());
      setResponse(match);
      setState(match ? 'idle' : 'missing');
    } catch {
      setState('error');
    }
  };
  return (
    <>
      <form
        className="tool-toolbar tool-request"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <code>{record.fields.Метод} /reports/</code>
        <input aria-label="Учебный VIN" value={vin} onChange={(event) => setVin(event.target.value)} />
        <button className="tool-primary" disabled={!vin.trim() || state === 'pending'}>
          Отправить
        </button>
      </form>
      <p>{record.description}</p>
      {state === 'pending' && <p role="status">Отправляем запрос…</p>}
      {state === 'missing' && <p role="status">Для этого VIN нет учебной фикстуры.</p>}
      {state === 'error' && <p role="alert">Стенд недоступен. Отправьте запрос ещё раз.</p>}
      {response && <ApiResponse record={response} />}
    </>
  );
}

function Stand({ record }: Props) {
  const [show, setShow] = useState(false);
  return (
    <>
      <p>{record.description}</p>
      <button className="tool-primary" aria-expanded={show} onClick={() => setShow(!show)}>
        Показать ответ стенда
      </button>
      {show && <ApiResponse record={record} />}
    </>
  );
}

function Preview({ record, frame = false }: { record: ToolRecord; frame?: boolean }) {
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState('100');
  return (
    <>
      <div className="tool-toolbar">
        <button aria-pressed={!error} onClick={() => setError(false)}>
          Успех
        </button>
        <button aria-pressed={error} onClick={() => setError(true)}>
          Ошибка
        </button>
        {frame && (
          <select aria-label="Масштаб" value={zoom} onChange={(event) => setZoom(event.target.value)}>
            <option value="75">75%</option>
            <option value="100">100%</option>
            <option value="125">125%</option>
          </select>
        )}
      </div>
      <div className={'tool-canvas' + (frame ? ' tool-canvas--frame' : '')}>
        <div className="tool-preview" style={{ width: Number(zoom) * 2.8 }}>
          <small>{record.fields.Фрейм ?? record.fields.Компонент}</small>
          <span className={error ? 'tool-preview__error' : 'tool-preview__success'} aria-hidden="true">
            {error ? '!' : '✓'}
          </span>
          <h3>{error ? 'Не получилось отправить заявку' : 'Заявка отправлена'}</h3>
          <p>{error ? 'Проверьте подключение и повторите попытку.' : 'Организатор получит вашу заявку на участие.'}</p>
        </div>
      </div>
    </>
  );
}

function Figma({ record }: Props) {
  return (
    <>
      <Status>{record.status}</Status>
      <Tabs
        views={{
          Холст: <Preview record={record} frame />,
          Комментарии: (
            <div className="tool-thread">
              <p>Открытых комментариев · {record.fields['Открытых комментариев']}</p>
              <Link to="/work-tools/design-review">Открыть дизайн-ревью →</Link>
            </div>
          ),
          Свойства: <Grid rows={Object.entries(record.fields)} />,
        }}
      />
    </>
  );
}

function DesignSystem({ record }: Props) {
  return (
    <>
      <Status>{record.status}</Status>
      <p>{record.description}</p>
      <Tabs views={{ Пример: <Preview record={record} />, Свойства: <Grid rows={Object.entries(record.fields)} /> }} />
    </>
  );
}

function Review({ record }: Props) {
  const [resolved, setResolved] = useState(false);
  return (
    <>
      <Status>{resolved ? 'Решено' : record.status}</Status>
      <div className="tool-thread">
        <strong>Замечание к макету</strong>
        <p>{record.description}</p>
        <button aria-pressed={resolved} onClick={() => setResolved(!resolved)}>
          {resolved ? 'Открыть замечание снова' : 'Отметить решённым'}
        </button>
      </div>
      <Link to={'/work-tools/figma#' + record.fields.Макет}>Открыть макет →</Link>
    </>
  );
}

function Channel({ record }: Props) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  return (
    <div className="tool-channel">
      <div className="tool-thread">
        <Status>{record.status}</Status>
        <p>{record.description}</p>
      </div>
      <ul aria-label="Учебные сообщения">
        {messages.map((message, index) => (
          <li key={index}>
            <strong>Вы</strong>
            <p>{message}</p>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const message = draft.trim();
          if (message) {
            setMessages([...messages, message]);
            setDraft('');
          }
        }}
      >
        <textarea
          aria-label="Сообщение"
          placeholder="Написать в канал…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="tool-primary" disabled={!draft.trim()}>
          Отправить
        </button>
      </form>
    </div>
  );
}

export const toolViews: Record<string, { section: string; icon: string; component: ComponentType<Props> }> = {
  redash: { section: 'Дашборды', icon: '▥', component: Dashboard },
  trino: { section: 'Сохранённые запросы', icon: '⌘', component: Trino },
  trisigma: { section: 'A/B-эксперименты', icon: 'σ', component: Experiment },
  bitbucket: { section: 'Pull requests', icon: '⑂', component: Bitbucket },
  paas: { section: 'Сервисы и окружения', icon: '◇', component: Deployments },
  grafana: { section: 'Дашборды мониторинга', icon: '◔', component: Grafana },
  tms: { section: 'Тест-планы', icon: '☑', component: TestRun },
  postman: { section: 'Коллекции', icon: '↗', component: Postman },
  'test-stand': { section: 'Фикстуры', icon: '⌕', component: Stand },
  figma: { section: 'Слои', icon: '◈', component: Figma },
  'design-system': { section: 'Компоненты', icon: '❖', component: DesignSystem },
  'design-review': { section: 'На ревью', icon: '◫', component: Review },
  mattermost: { section: 'Каналы', icon: '#', component: Channel },
};
