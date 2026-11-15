import { type FormProps } from '../../../ops/service-sites/frontend/src/form-shared';
import { consentOptions } from './meta';

export function ConsentForm({ view, submit }: FormProps) {
  return (
    <div className="hr-options">
      <div className="hr-option">
        <span>
          <strong>Рабочие данные</strong>
          <small>Учётная запись и кадровые документы.</small>
        </span>
        <span className="status">Обязательное</span>
      </div>
      {consentOptions.map((item) => {
        const granted = view.grants.has(item.id);
        return (
          <div className="hr-option" key={item.id}>
            <span>
              <strong>{item.title}</strong>
              <small>
                {item.description} {granted ? 'Согласие дано.' : 'Согласие не дано.'}
              </small>
            </span>
            <button
              className="button button--white"
              type="button"
              aria-label={(granted ? 'Отозвать: ' : 'Разрешить: ') + item.title}
              onClick={() =>
                submit(
                  { service: 'consents', consent: item.id, granted: !granted },
                  granted ? 'Согласие отозвано.' : 'Согласие сохранено.',
                )
              }
            >
              {granted ? 'Отозвать' : 'Разрешить'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
