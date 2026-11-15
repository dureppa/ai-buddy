import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Props } from '../../shared/frontend/work-tool-data';
import { Status } from '../../shared/frontend/view-ui';

export function TestRun({ record }: Props) {
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
