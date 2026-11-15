import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Props } from '../../shared/frontend/work-tool-data';
import { Status } from '../../shared/frontend/view-ui';

export function Review({ record }: Props) {
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
