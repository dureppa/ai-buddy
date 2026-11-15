import { useState, type ReactNode } from 'react';
import { profiles, type ProfileId } from '../../../../web/frontend/src/data';
import { VacationForm } from '../../../../corporate-services/absences/frontend/VacationForm';
import { BenefitsForm } from '../../../../corporate-services/benefits/frontend/BenefitsForm';
import { ConsentForm } from '../../../../corporate-services/consents/frontend/ConsentForm';
import { HiringForm } from '../../../../corporate-services/hiring/frontend/HiringForm';
import { ExitForm } from '../../../../corporate-services/offboarding/frontend/ExitForm';
import { TripForm } from '../../../../corporate-services/trips/frontend/TripForm';
import { Avatar, Icon, PageIntro } from '../../../../web/frontend/src/ui';
import { dateLabel, rubles, type SubmitAction } from './form-shared';
import { benefitOptions, consentOptions, destinations, exitSteps, vacancies, type HrService } from './hr-catalog';
import { makeHrDemo, serviceHistory, travelNoticeDays, type HrDemo, type HrView } from './hr-demo';
import './hr.css';

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel hr-panel">
      <div className="section-title">
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

type CatalogItem = { id: string; title: string; description: string };
type Catalogs = { jobs?: CatalogItem[]; steps?: CatalogItem[]; programs?: (CatalogItem & { amount: number })[] };

function historyRow(
  item: HrView['history'][number],
  jobs: CatalogItem[] | undefined,
  programs: Catalogs['programs'],
): [string, string] {
  switch (item.service) {
    case 'absences':
      return [dateLabel(item.start) + ' — ' + dateLabel(item.end), item.days + ' дн. · На согласовании'];
    case 'trips':
      return [
        destinations.find((city) => city.id === item.destination)?.title ?? item.destination,
        dateLabel(item.date) + ' · ' + rubles.format(item.budget) + ' · На согласовании',
      ];
    case 'hiring':
      return [
        item.name,
        ((jobs ?? vacancies).find((vacancy) => vacancy.id === item.vacancy)?.title ?? item.vacancy) +
          ' · Передано в подбор',
      ];
    case 'offboarding':
      return ['Черновик завершения работы', 'Последний день · ' + dateLabel(item.date)];
    case 'consents':
      return [
        consentOptions.find((option) => option.id === item.consent)?.title ?? item.consent,
        item.granted ? 'Предоставлено' : 'Отозвано',
      ];
    case 'benefits':
      return [
        (programs ?? benefitOptions).find((option) => option.id === item.benefit)?.title ?? item.benefit,
        rubles.format(item.amount) + ' · На согласовании',
      ];
  }
}

export function HrPage({ service, profileId }: { service: HrService; profileId: ProfileId }) {
  const [demo] = useState(() => makeHrDemo(localStorage, profileId));
  const [view, setView] = useState(() => demo.read());
  const [feedback, setFeedback] = useState<{ message: string; ok: boolean }>();

  function submit(action: Parameters<HrDemo['submit']>[0], message: string) {
    const result = demo.submit(action);
    setFeedback({ ok: result.ok, message: result.ok ? message : result.message });
    if (result.ok) setView(demo.read());
    return result.ok;
  }

  function onToggle(id: string) {
    demo.toggleExitStep(id);
    setView(demo.read());
    setFeedback(undefined);
  }

  return <HrPageContent {...{ service, profileId, view, submit, onToggle, feedback }} />;
}

type HrPageProps = Catalogs & {
  service: HrService;
  profileId: ProfileId;
  view: HrView;
  submit: SubmitAction;
  onToggle: (id: string) => void;
  feedback?: { message: string; ok: boolean };
  pending?: boolean;
};

export function HrPageContent({
  service,
  profileId,
  view,
  submit,
  onToggle,
  feedback,
  pending,
  jobs,
  steps,
  programs,
}: HrPageProps) {
  const profile = profiles[profileId];
  const [title, metric, note] = {
    absences: [
      'Запланировать отпуск',
      view.vacationLeft + ' дн.',
      'Доступно с ' + dateLabel(view.earliestVacation) + ' · подача за ' + view.settings.vacationNoticeDays + ' дн.',
    ],
    trips: [
      'Новая поездка',
      rubles.format(view.settings.travelBudget),
      'Лимит сметы · подача за ' + travelNoticeDays + ' дн.',
    ],
    hiring: [
      'Рекомендация кандидата',
      view.referralLeft + ' из ' + view.settings.referralSlots,
      'Рекомендаций осталось',
    ],
    offboarding: [
      'Подготовка к завершению',
      view.exitChecklist.length + ' из ' + (steps ?? exitSteps).length,
      'Шагов выполнено · уведомление за ' + view.settings.exitNoticeDays + ' дн.',
    ],
    consents: ['Доступные согласия', view.grants.size + ' из ' + consentOptions.length, 'Дополнительных согласий дано'],
    benefits: ['Программы компенсаций', rubles.format(view.benefitLeft), 'Остаток бюджета'],
  }[service.id];
  const props = { view, submit };
  const history = serviceHistory(view.history, service.id);
  const form = {
    absences: <VacationForm {...props} />,
    trips: <TripForm {...props} />,
    hiring: <HiringForm {...props} options={jobs} />,
    offboarding: <ExitForm {...props} steps={steps} onToggle={onToggle} />,
    consents: <ConsentForm {...props} />,
    benefits: <BenefitsForm {...props} options={programs} />,
  }[service.id];

  return (
    <main className="hr-page">
      <PageIntro title={service.title} text={service.description} tone={service.tone} icon={service.icon} />
      <div className="hr-layout">
        <Panel title={title}>
          <fieldset disabled={pending} className="hr-live-fields">
            {form}
          </fieldset>
          {feedback && (
            <p
              className={'hr-feedback' + (feedback.ok ? '' : ' hr-feedback--error')}
              role={feedback.ok ? 'status' : 'alert'}
            >
              <Icon name={feedback.ok ? 'check' : 'info'} size={18} />
              {feedback.message}
            </p>
          )}
        </Panel>
        <aside className="hr-aside" aria-label="Личные данные и история">
          <section className={'hr-metric tone-' + service.tone}>
            <div className="hr-metric__account">
              <Avatar initials={profile.initials} avatar={profile.avatar} />
              <span>
                <strong>{profile.fullName}</strong>
                <small>Твой аккаунт</small>
              </span>
            </div>
            <span className="hr-metric__value">{metric}</span>
            <p>{note}</p>
          </section>
          <Panel title="История">
            {history.length ? (
              <ul className="hr-history">
                {history.map((item, index) => {
                  const [heading, detail] = historyRow(item, jobs, programs);
                  return (
                    <li key={index}>
                      <Icon name="check" size={16} />
                      <span>
                        <strong>{heading}</strong>
                        <small>{detail}</small>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="hr-note">Здесь появятся твои действия в этом сервисе.</p>
            )}
          </Panel>
        </aside>
      </div>
    </main>
  );
}
