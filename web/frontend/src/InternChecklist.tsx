import { useId, useState, type FormEvent } from 'react';
import { stages } from './checklist';
import type { ChecklistEntry, ChecklistItemInput, ShownMaterial } from './staff-data';
import { Icon, Modal } from './ui';
import { TaskMaterialPicker } from './TaskMaterialPicker';

export function InternChecklist({
  name,
  stageLabel,
  items,
  materials,
  canEdit,
  onBack,
  onAdd,
  onChangeMaterial,
  onRemove,
}: {
  name: string;
  stageLabel: string;
  items: ChecklistEntry[];
  materials: ShownMaterial[];
  canEdit: boolean;
  onBack: () => void;
  onAdd: (input: ChecklistItemInput) => Promise<void>;
  onChangeMaterial: (taskId: string, materialId: string, attach: boolean) => void;
  onRemove: (taskId: string) => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const task = items.find((item) => item.id === openId);

  return (
    <section className="staff-checklist" aria-label={'Чек-лист · ' + name}>
      <button type="button" className="text-link staff-back" onClick={task ? () => setOpenId(undefined) : onBack}>
        <span className="staff-back__icon">
          <Icon name="chevron" size={16} />
        </span>
        {task ? 'Весь чек-лист' : 'Мои стажёры'}
      </button>
      {task ? (
        <TaskMaterials
          task={task}
          materials={materials}
          canEdit={canEdit}
          error={error}
          onChange={(materialId, attach) => {
            onChangeMaterial(task.id, materialId, attach);
            setError('');
          }}
          onRemove={async () => {
            if (saving) return;
            setSaving(true);
            try {
              await onRemove(task.id);
              setOpenId(undefined);
              setError('');
            } catch (problem) {
              setError(problem instanceof Error ? problem.message : 'Не удалось удалить пункт.');
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : (
        <>
          <div className="section-title">
            <div>
              <h2>{name}</h2>
              <p className="staff-muted">{stageLabel}</p>
            </div>
            {canEdit && (
              <button type="button" className="button button--dark" onClick={() => setAdding(true)}>
                Добавить пункт
              </button>
            )}
          </div>
          <ol className="stage-list">
            {stages.map((stage) => {
              const stageItems = items.filter((item) => item.stage === stage.id);
              if (!stageItems.length) return null;
              const done = stageItems.filter((item) => item.done).length;
              return (
                <li key={stage.id} className="panel stage">
                  <div className={'stage__header tone-' + stage.tone}>
                    <span className="icon-tile">
                      <Icon name="flag" size={18} />
                    </span>
                    <div>
                      <h2>{stage.name}</h2>
                      <small>{stage.dates}</small>
                    </div>
                    <span className="pill">
                      {done} / {stageItems.length}
                    </span>
                  </div>
                  <ul className="task-list">
                    {stageItems.map((item) => (
                      <li key={item.id} className={'task-row' + (item.done ? ' task-row--done' : '')}>
                        <span className="task-check" aria-checked={item.done} aria-hidden="true">
                          <Icon name="check" size={15} />
                        </span>
                        <button
                          type="button"
                          className="task-link"
                          onClick={() => {
                            setError('');
                            setOpenId(item.id);
                          }}
                        >
                          <span className={'icon-tile tone-' + item.tone}>
                            <Icon name={item.icon} size={19} />
                          </span>
                          <span className="task-text">
                            <strong>{item.title}</strong>
                            <small>
                              {item.summary}
                              {item.materialIds.length > 0 ? ' · Материалы: ' + item.materialIds.length : ''}
                            </small>
                          </span>
                          <span className={'task-time' + (item.done ? ' is-done' : '')}>
                            {item.done ? 'Выполнено' : item.due}
                          </span>
                          <Icon name="chevron" size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {adding && (
        <Modal title="Новый пункт" onClose={() => setAdding(false)}>
          <ItemForm
            error={error}
            saving={saving}
            onSubmit={async (input) => {
              if (saving) return;
              setSaving(true);
              try {
                await onAdd(input);
                setAdding(false);
                setError('');
              } catch (problem) {
                setError(problem instanceof Error ? problem.message : 'Не удалось добавить пункт.');
              } finally {
                setSaving(false);
              }
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function ItemForm({
  error,
  saving,
  onSubmit,
}: {
  error: string;
  saving: boolean;
  onSubmit: (input: ChecklistItemInput) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const stage = stages.find((item) => item.id === String(data.get('stage')))?.id ?? 'week-1';
    onSubmit({
      title: String(data.get('title')),
      summary: String(data.get('summary')),
      stage,
    });
  }

  return (
    <form className="staff-form" onSubmit={submit}>
      <label>
        Название
        <input name="title" required minLength={2} maxLength={120} />
      </label>
      <label>
        Пояснение
        <textarea name="summary" rows={3} required minLength={2} maxLength={240} />
      </label>
      <label>
        Период
        <select name="stage" defaultValue="week-1">
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="staff-error" role="alert">
          {error}
        </p>
      )}
      <button className="button button--dark" type="submit" disabled={saving}>
        Добавить в чек-лист
      </button>
    </form>
  );
}

function TaskMaterials({
  task,
  materials,
  canEdit,
  error,
  onChange,
  onRemove,
}: {
  task: ChecklistEntry;
  materials: ShownMaterial[];
  canEdit: boolean;
  error: string;
  onChange: (materialId: string, attach: boolean) => void;
  onRemove: () => void;
}) {
  const catalogId = useId();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [detachError, setDetachError] = useState('');
  const availableById = new Map(materials.map((material) => [material.id, material]));
  const attached = task.materialIds.flatMap((id) => {
    const material = availableById.get(id);
    return material ? [material] : [];
  });

  function detach(materialId: string) {
    try {
      onChange(materialId, false);
      setDetachError('');
    } catch (problem) {
      setDetachError(problem instanceof Error ? problem.message : 'Не удалось открепить материал.');
    }
  }

  return (
    <div className="staff-checklist__task">
      <div className="section-title">
        <h2>{task.title}</h2>
      </div>
      <p className="staff-muted">{task.summary}</p>
      {error && (
        <p className="staff-error" role="alert">
          {error}
        </p>
      )}
      <section className="panel checklist-materials-section" aria-label="Материалы пункта">
        <header className="checklist-materials-heading">
          <h3>Материалы пункта</h3>
          {canEdit && materials.length > 0 && (
            <button
              className={'button ' + (catalogOpen ? 'button--white' : 'button--dark')}
              type="button"
              aria-controls={catalogId}
              aria-expanded={catalogOpen}
              onClick={() => setCatalogOpen(!catalogOpen)}
            >
              <Icon name={catalogOpen ? 'close' : 'plus'} size={17} />
              {catalogOpen ? 'Свернуть каталог' : 'Прикрепить материал'}
            </button>
          )}
        </header>
        {canEdit && catalogOpen && (
          <TaskMaterialPicker
            id={catalogId}
            materials={materials}
            attachedIds={new Set(task.materialIds)}
            onAttach={(materialId) => onChange(materialId, true)}
          />
        )}
        {detachError && (
          <p className="staff-error" role="alert">
            {detachError}
          </p>
        )}
        {attached.length ? (
          <ul className="checklist-materials checklist-materials--attached" aria-label="Прикреплённые материалы">
            {attached.map((material) => (
              <li key={material.id} className="checklist-material">
                <span className="checklist-material__label">
                  <strong>{material.title}</strong>
                  <small>
                    {material.group} · {material.author}
                  </small>
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    className="button button--white"
                    aria-label={'Открепить ' + material.title}
                    onClick={() => detach(material.id)}
                  >
                    Открепить
                  </button>
                ) : (
                  <a className="text-link" href={material.source.href} target="_blank" rel="noreferrer">
                    {material.source.kind === 'file' ? material.source.name : material.source.href}
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="staff-muted">
            {canEdit && !materials.length
              ? 'Сначала опубликуй материалы для стажёра.'
              : 'К этому пункту пока не прикреплены материалы.'}
          </p>
        )}
      </section>
      {canEdit && task.custom && (
        <button className="button button--white" type="button" onClick={onRemove}>
          Удалить пункт
        </button>
      )}
    </div>
  );
}
