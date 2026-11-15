import { useState } from 'react';
import { groupByName, type ShownMaterial } from './staff-data';
import { Icon } from './ui';

export function TaskMaterialPicker({
  id,
  materials,
  attachedIds,
  onAttach,
}: {
  id: string;
  materials: ShownMaterial[];
  attachedIds: ReadonlySet<string>;
  onAttach: (materialId: string) => void;
}) {
  const [group, setGroup] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const groups = groupByName(materials);
  const search = query.trim().toLocaleLowerCase('ru');
  const visible = search
    ? materials.filter((material) => material.title.toLocaleLowerCase('ru').includes(search))
    : (groups.find((entry) => entry.name === group)?.items ?? []);

  function attach(materialId: string) {
    try {
      onAttach(materialId);
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Не удалось прикрепить материал.');
    }
  }

  return (
    <div className="material-picker" id={id}>
      <div className="material-picker__fields">
        <label className="material-picker__field">
          Группа
          <select
            value={group}
            onChange={(event) => {
              setGroup(event.target.value);
              setQuery('');
              setError('');
            }}
          >
            <option value="">Выбрать группу</option>
            {groups.map(({ name }) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="material-picker__field">
          Поиск по всем группам
          <span className="search-field">
            <Icon name="search" size={17} />
            <input
              type="search"
              placeholder="Название материала"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setError('');
              }}
            />
          </span>
        </label>
      </div>
      {error && (
        <p className="staff-error" role="alert">
          {error}
        </p>
      )}
      {visible.length ? (
        <ul className="material-picker__results checklist-materials" aria-label="Доступные материалы">
          {visible.map((material) => (
            <li key={material.id} className="checklist-material">
              <span className="checklist-material__label">
                <strong>{material.title}</strong>
                <small>
                  {material.group} · {material.author}
                </small>
              </span>
              {attachedIds.has(material.id) ? (
                <span className="material-picker__attached">
                  <Icon name="check" size={15} /> Прикреплён
                </span>
              ) : (
                <button
                  type="button"
                  className="button button--white"
                  aria-label={'Прикрепить ' + material.title}
                  onClick={() => attach(material.id)}
                >
                  <Icon name="plus" size={15} />
                  Прикрепить
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="staff-muted" role="status">
          {group || search ? 'Материалы не найдены.' : 'Выбери группу или найди материал по названию.'}
        </p>
      )}
    </div>
  );
}
