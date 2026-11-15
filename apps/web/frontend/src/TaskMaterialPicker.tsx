import { useEffect, useRef, useState } from 'react';
import { groupByName, type ShownMaterial } from './staff-data';
import { Icon, Modal } from './ui';

export function TaskMaterialPicker({
  materials,
  attached,
  onSave,
  onClose,
}: {
  materials: ShownMaterial[];
  attached: ShownMaterial[];
  onSave: (materialIds: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(() => new Set(attached.map((material) => material.id)));
  const [group, setGroup] = useState<string>();
  const [query, setQuery] = useState('');
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const groupHeading = useRef<HTMLHeadingElement>(null);
  const catalogButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (group !== undefined) groupHeading.current?.focus();
  }, [group]);

  const groups = groupByName(materials);
  const search = query.trim().toLocaleLowerCase('ru');
  const availableIds = new Set(materials.map((material) => material.id));
  const selectedIds = [...selected].filter((id) => availableIds.has(id));
  const changed = selectedIds.length !== attached.length || attached.some((material) => !selected.has(material.id));
  const choosingGroup = !review && !search && group === undefined;
  const visible = review
    ? materials.filter((material) => selected.has(material.id))
    : search
      ? materials.filter((material) => material.title.toLocaleLowerCase('ru').includes(search))
      : (groups.find((entry) => entry.name === group)?.items ?? []);

  function save() {
    try {
      onSave(selectedIds);
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Не удалось сохранить материалы.');
    }
  }

  return (
    <Modal side title="Материалы пункта" onClose={onClose}>
      <div className="material-picker">
        <div className="material-picker__views" role="group" aria-label="Списки материалов">
          <button
            ref={catalogButton}
            type="button"
            className="button button--white"
            aria-pressed={!review}
            onClick={() => setReview(false)}
          >
            Каталог
          </button>
          <button type="button" className="button button--white" aria-pressed={review} onClick={() => setReview(true)}>
            Выбрано ({selectedIds.length})
          </button>
        </div>
        {!review && (
          <label className="search-field">
            <Icon name="search" size={17} />
            <input
              aria-label="Поиск материалов"
              type="search"
              placeholder="Поиск по названию во всех группах"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        )}
        {!review && !search && group !== undefined && (
          <div className="material-picker__group-header">
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setGroup(undefined);
                catalogButton.current?.focus();
              }}
            >
              <span className="staff-back__icon">
                <Icon name="chevron" size={16} />
              </span>
              Все группы
            </button>
            <h3 tabIndex={-1} ref={groupHeading}>
              {group}
            </h3>
          </div>
        )}
        <div className="material-picker__list" key={review ? 'selected' : search ? 'search' : 'group:' + group}>
          {choosingGroup ? (
            <ul className="checklist-materials" aria-label="Группы материалов">
              {groups.map(({ name, items }) => (
                <li key={name}>
                  <button
                    className="material-picker__group"
                    type="button"
                    aria-label={name + ' · ' + items.length}
                    onClick={() => setGroup(name)}
                  >
                    <strong>{name}</strong>
                    <small>{items.length}</small>
                    <Icon name="chevron" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : visible.length ? (
            <ul className="checklist-materials" aria-label={review ? 'Выбранные материалы' : 'Доступные материалы'}>
              {visible.map((material) => {
                const included = selected.has(material.id);
                const action = included ? 'Убрать' : 'Добавить';
                return (
                  <li key={material.id} className="checklist-material">
                    <span className="checklist-material__label">
                      <strong>{material.title}</strong>
                      <small>
                        {material.group} · {material.author}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="button button--white"
                      aria-label={action + ' ' + material.title}
                      onClick={() =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          if (next.has(material.id)) next.delete(material.id);
                          else next.add(material.id);
                          return next;
                        })
                      }
                    >
                      {action}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="staff-muted" role="status">
              {review ? 'Материалы пока не выбраны.' : 'Материалы не найдены.'}
            </p>
          )}
        </div>
        {error && (
          <p className="staff-error" role="alert">
            {error}
          </p>
        )}
        <footer className="material-picker__actions">
          <button className="button button--white" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="button button--dark" type="button" disabled={!changed} onClick={save}>
            Сохранить материалы
          </button>
        </footer>
      </div>
    </Modal>
  );
}
