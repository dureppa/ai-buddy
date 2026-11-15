import type { Props } from '../../shared/frontend/work-tool-data';
import { Tabs, Status, Grid, Chart } from '../../shared/frontend/view-ui';

export function Dashboard({ record }: Props) {
  const rows = Object.entries(record.fields).filter(([, value]) => /^\d+(?:[.,]\d+)?%?$/.test(value));
  return (
    <>
      <Status>{record.status}</Status>
      <p>{record.description}</p>
      <Tabs views={{ График: <Chart rows={rows} />, Таблица: <Grid rows={rows} /> }} />
    </>
  );
}
