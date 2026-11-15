import { useState, type ReactNode } from 'react';
import type { ToolRecord } from './work-tool-data';

export function Tabs({ views }: { views: Record<string, ReactNode> }) {
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

export function Status({ children }: { children: ReactNode }) {
  return <span className="tool-status">{children}</span>;
}

export function Grid({ rows }: { rows: Array<[string, string]> }) {
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

export function Chart({ rows }: { rows: Array<[string, string]> }) {
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

export function Preview({ record, frame = false }: { record: ToolRecord; frame?: boolean }) {
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
        <div className="tool-preview" style={{ zoom: Number(zoom) / 100 }}>
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

export function ApiResponse({ record }: { record: ToolRecord }) {
  return (
    <section className="tool-response" aria-label="Ответ">
      <h3>Ответ</h3>
      <Status>HTTP {record.status}</Status>
      <pre>{JSON.stringify({ vin: record.title, code: record.fields.Ответ }, null, 2)}</pre>
    </section>
  );
}
