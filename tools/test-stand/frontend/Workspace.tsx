import { useState } from 'react';
import { ApiResponse } from '../../shared/frontend/view-ui';
import type { Props } from '../../shared/frontend/work-tool-data';

export function Stand({ record }: Props) {
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
