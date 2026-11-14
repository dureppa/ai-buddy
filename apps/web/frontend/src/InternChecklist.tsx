import { useState, type FormEvent } from 'react';
import { stages } from './checklist';
import type { ChecklistEntry, ChecklistItemInput, ShownMaterial } from './staff-data';
import { Icon, Modal } from './ui';

type ChecklistRequest = { id: string; title: string; number: string; owner: string };

export function InternChecklist({
  name,
  stageLabel,
  items,
  requests,
  materials,
  canEdit,
  onBack,
  onAdd,
  onSaveMaterials,
  onRemove,
}: {
  name: string;
  stageLabel: string;
  items: ChecklistEntry[];
  requests: ChecklistRequest[];
  materials: ShownMaterial[];
  canEdit: boolean;
  onBack: () => void;
  onAdd: (input: ChecklistItemInput) => void;
  onSaveMaterials: (taskId: string, materialIds: string[]) => void;
  onRemove: (taskId: string) => void;
}) {
  const [openId, setOpenId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
          notice={notice}
          onSave={(materialIds) => {
            try {
              onSaveMaterials(task.id, materialIds);
              setError('');
              setNotice('Материалы пункта сохранены.');
            } catch (problem) {
              setNotice('');
              setError(problem instanceof Error ? problem.message : 'Не удалось сохранить материалы.');
            }
          }}
          onRemove={() => {
            try {
              onRemove(task.id);
              setOpenId(undefined);
              setError('');
              setNotice('Пункт удалён.');
            } catch (problem) {
              setNotice('');
              setError(problem instanceof Error ? problem.message : 'Не удалось удалить пункт.');
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
          {notice && (
            <p className="staff-message" role="status">
              {notice}
            </p>
          )}
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
                        <button type="button" className="task-link" onClick={() => setOpenId(item.id)}>
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
          <section className="panel stage">
            <div className="stage__header tone-blue">
              <span className="icon-tile">
                <Icon name="file" size={18} />
              </span>
              <div>
                <h2>Заявки на согласовании</h2>
                <small>{requests.length ? requests.length + ' активных' : 'Активных заявок нет'}</small>
              </div>
            </div>
            {requests.length > 0 && (
              <ul className="task-list">
                {requests.map((request) => (
                  <li key={request.id} className="task-row">
                    <span className="task-text checklist-request">
                      <strong>
                        {request.title} · {request.number}
                      </strong>
                      <small>На согласовании · владелец сервиса {request.owner}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {adding && (
        <Modal title="Новый пункт" onClose={() => setAdding(false)}>
          <ItemForm
            error={error}
            onSubmit={(input) => {
              try {
                onAdd(input);
                setAdding(false);
                setError('');
                setNotice('Пункт добавлен в чек-лист.');
              } catch (problem) {
                setError(problem instanceof Error ? problem.message : 'Не удалось добавить пункт.');
              }
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function ItemForm({ error, onSubmit }: { error: string; onSubmit: (input: ChecklistItemInput) => void }) {
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
      <button className="button button--dark" type="submit">
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
  notice,
  onSave,
  onRemove,
}: {
  task: ChecklistEntry;
  materials: ShownMaterial[];
  canEdit: boolean;
  error: string;
  notice: string;
  onSave: (materialIds: string[]) => void;
  onRemove: () => void;
}) {
  const [selected, setSelected] = useState(() => new Set(task.materialIds));
  const attached = materials.filter((material) => task.materialIds.includes(material.id));

  return (
    <div className="staff-checklist__task">
      <div className="section-title">
        <h2>{task.title}</h2>
      </div>
      <p className="staff-muted">{task.summary}</p>
      {notice && (
        <p className="staff-message" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="staff-error" role="alert">
          {error}
        </p>
      )}
      <h3>Материалы пункта</h3>
      {canEdit ? (
        <form
          className="checklist-materials"
          onSubmit={(event) => {
            event.preventDefault();
            onSave([...selected]);
          }}
        >
          {materials.length ? (
            materials.map((material) => (
              <label key={material.id} className="panel checklist-material">
                <input
                  type="checkbox"
                  checked={selected.has(material.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(material.id)) next.delete(material.id);
                    else next.add(material.id);
                    setSelected(next);
                  }}
                />
                <span>
                  <strong>{material.title}</strong>
                  <small>
                    {material.group} · {material.author}
                  </small>
                </span>
              </label>
            ))
          ) : (
            <p className="panel staff-empty">Сначала опубликуй материалы для стажёра.</p>
          )}
          <div className="staff-actions">
            <button className="button button--dark" type="submit" disabled={!materials.length}>
              Сохранить материалы
            </button>
            {task.custom && (
              <button className="button button--white" type="button" onClick={onRemove}>
                Удалить пункт
              </button>
            )}
          </div>
        </form>
      ) : attached.length ? (
        <ul className="checklist-materials">
          {attached.map((material) => (
            <li key={material.id} className="panel checklist-material">
              <span>
                <strong>{material.title}</strong>
                <small>{material.group}</small>
              </span>
              <a className="text-link" href={material.source.href} target="_blank" rel="noreferrer">
                {material.source.kind === 'file' ? material.source.name : material.source.href}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel staff-empty">К этому пункту пока не прикреплены материалы.</p>
      )}
    </div>
  );
}
