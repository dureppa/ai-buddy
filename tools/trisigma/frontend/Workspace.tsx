import type { Props } from '../../shared/frontend/work-tool-data';
import { Tabs, Status, Grid } from '../../shared/frontend/view-ui';

export function Experiment({ record }: Props) {
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
