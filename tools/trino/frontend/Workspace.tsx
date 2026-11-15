import { useState } from 'react';
import type { Props } from '../../shared/frontend/work-tool-data';
import { Status, Grid } from '../../shared/frontend/view-ui';

export function Trino({ record }: Props) {
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
