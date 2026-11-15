import { Link } from 'react-router-dom';
import type { Props } from '../../shared/frontend/work-tool-data';
import { Tabs, Status, Preview } from '../../shared/frontend/view-ui';

export function Figma({ record }: Props) {
  return (
    <div className="tool-design-editor">
      <section className="tool-design-editor__workspace" aria-label="Холст">
        <Preview record={record} frame />
      </section>
      <aside className="tool-design-editor__inspector" aria-label="Панель макета">
        <Status>{record.status}</Status>
        <Tabs
          views={{
            Свойства: (
              <dl>
                {Object.entries(record.fields)
                  .filter(([label]) => label !== 'Открытых комментариев')
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
            ),
            Комментарии: (
              <>
                <p>Открытых комментариев · {record.fields['Открытых комментариев'] ?? '0'}</p>
                <Link to="/work-tools/design-review">Открыть дизайн-ревью →</Link>
              </>
            ),
          }}
        />
      </aside>
    </div>
  );
}
