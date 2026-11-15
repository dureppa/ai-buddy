import type { ComponentType } from 'react';
import type { Props } from './work-tool-data';
import { Dashboard } from '../../redash/frontend/Workspace';
import { Trino } from '../../trino/frontend/Workspace';
import { Experiment } from '../../trisigma/frontend/Workspace';
import { Bitbucket } from '../../bitbucket/frontend/Workspace';
import { Deployments } from '../../paas/frontend/Workspace';
import { Grafana } from '../../grafana/frontend/Workspace';
import { TestRun } from '../../tms/frontend/Workspace';
import { Postman } from '../../postman/frontend/Workspace';
import { Stand } from '../../test-stand/frontend/Workspace';
import { Figma } from '../../figma/frontend/Workspace';
import { DesignSystem } from '../../design-system/frontend/Workspace';
import { Review } from '../../design-review/frontend/Workspace';
import { Channel } from '../../mattermost/frontend/Workspace';

export const toolViews: Record<string, { section: string; icon: string; component: ComponentType<Props> }> = {
  redash: { section: 'Дашборды', icon: '▥', component: Dashboard },
  trino: { section: 'Сохранённые запросы', icon: '⌘', component: Trino },
  trisigma: { section: 'A/B-эксперименты', icon: 'σ', component: Experiment },
  bitbucket: { section: 'Pull requests', icon: '⑂', component: Bitbucket },
  paas: { section: 'Сервисы и окружения', icon: '◇', component: Deployments },
  grafana: { section: 'Дашборды мониторинга', icon: '◔', component: Grafana },
  tms: { section: 'Тест-планы', icon: '☑', component: TestRun },
  postman: { section: 'Коллекции', icon: '↗', component: Postman },
  'test-stand': { section: 'Фикстуры', icon: '⌕', component: Stand },
  figma: { section: 'Слои', icon: '◈', component: Figma },
  'design-system': { section: 'Компоненты', icon: '❖', component: DesignSystem },
  'design-review': { section: 'На ревью', icon: '◫', component: Review },
  mattermost: { section: 'Каналы', icon: '#', component: Channel },
};
