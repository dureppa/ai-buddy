import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Props } from '../../shared/frontend/work-tool-data';
import { Status } from '../../shared/frontend/view-ui';

export function Deployments({ record }: Props) {
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
