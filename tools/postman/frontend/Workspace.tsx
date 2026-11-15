import { useState } from 'react';
import type { Props } from '../../shared/frontend/work-tool-data';
import type { ToolRecord } from '../../shared/frontend/work-tool-data';
import { pageSchema } from '../../shared/frontend/work-tool-data';
import { useWorkToolTransport } from '../../shared/frontend/work-tool-transport';
import { ApiResponse } from '../../shared/frontend/view-ui';

export function Postman({ record, profileId }: Props) {
  const apiFetch = useWorkToolTransport();
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
