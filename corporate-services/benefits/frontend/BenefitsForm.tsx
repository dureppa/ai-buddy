import { Icon } from '../../../web/frontend/src/ui';
import { rubles, type FormProps } from '../../../ops/service-sites/frontend/src/form-shared';
import { benefitOptions } from './meta';

export function BenefitsForm({ view, submit }: FormProps) {
  return (
    <div className="hr-options">
      {benefitOptions.map((item) => {
        const requested = view.benefits.some((record) => record.benefit === item.id);
        const unavailable = !view.settings.benefits.includes(item.id);
        return (
          <div className="hr-option" key={item.id}>
            <span className="icon-tile tone-mint">
              <Icon name={item.icon} />
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>
                {item.description} · {rubles.format(item.amount)}
              </small>
            </span>
            <button
              type="button"
              className="button button--white"
              disabled={requested || unavailable || item.amount > view.benefitLeft}
              aria-label={item.title + ' — запросить компенсацию'}
              onClick={() => submit({ service: 'benefits', benefit: item.id }, 'Заявка на компенсацию сохранена.')}
            >
              {requested
                ? 'Заявка подана'
                : unavailable
                  ? 'Недоступно'
                  : item.amount > view.benefitLeft
                    ? 'Сверх бюджета'
                    : 'Запросить'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
