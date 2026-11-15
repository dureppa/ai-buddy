import { useState } from 'react';
import type { Props } from '../../shared/frontend/work-tool-data';
import { Tabs, Status, Grid, Chart } from '../../shared/frontend/view-ui';

export function Grafana({ record }: Props) {
  const [period, setPeriod] = useState('all');
  const periods = ['До релиза', 'После релиза'];
  const rows = Object.entries(record.fields).filter(([label]) => periods.includes(label));
  const visible = period === 'all' ? rows : rows.filter(([label]) => label === period);
  return (
    <>
      <div className="tool-toolbar">
        <Status>{record.status}</Status>
        <select aria-label="Период мониторинга" value={period} onChange={(event) => setPeriod(event.target.value)}>
          <option value="all">Вокруг релиза</option>
          {periods.map((label) => (
            <option key={label}>{label}</option>
          ))}
        </select>
      </div>
      <p>{record.description}</p>
      <div className="tool-monitor">
        {visible.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <Tabs views={{ График: <Chart rows={visible} />, Таблица: <Grid rows={visible} /> }} />
    </>
  );
}
