import type { Props } from '../../shared/frontend/work-tool-data';
import { Tabs, Status, Grid, Preview } from '../../shared/frontend/view-ui';

export function DesignSystem({ record }: Props) {
  return (
    <>
      <Status>{record.status}</Status>
      <p>{record.description}</p>
      <Tabs views={{ Пример: <Preview record={record} />, Свойства: <Grid rows={Object.entries(record.fields)} /> }} />
    </>
  );
}
