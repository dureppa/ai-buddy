import type { Props } from '../../shared/frontend/work-tool-data';
import { Tabs, Status } from '../../shared/frontend/view-ui';

export function Bitbucket({ record }: Props) {
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
