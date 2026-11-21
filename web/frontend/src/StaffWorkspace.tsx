import { useQuery, useQueryClient } from '@tanstack/react-query';
import { backendEnabled } from './backend';
import { changeTeamPlan, readTeamPlans, type ChecklistPlan } from './role-checklist-api';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { isProfileId, products, profiles, staffAccounts, type ProfileId, type StaffId } from './demo-accounts';
import { readDemoSession } from './demo-session';
import {
  addChecklistItem,
  baselineFor,
  checklistEditsKey,
  groupByName,
  internMaterials,
  internOverview,
  materialGroupChoices,
  materialsForTask,
  materialsKey,
  maxMaterialBytes,
  readMaterials,
  publishedForIntern,
  readStaffId,
  removeChecklistItem,
  removeMaterial,
  setTaskMaterials,
  saveMaterial,
  type ChecklistItemInput,
  type MaterialInput,
  type ShownMaterial,
  type StaffMaterial,
} from './staff-data';
import { InternChecklist } from './InternChecklist';
import { Avatar, Icon, Modal, Toast } from './ui';
import './staff.css';

function fileSource(file: File): Promise<StaffMaterial['source']> {
  const types = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !Object.hasOwn(types, extension)) {
    throw new Error('Выбери PDF, DOCX, TXT, PNG или JPEG.');
  }
  if (!file.size || file.size > maxMaterialBytes) throw new Error('Размер файла должен быть от 1 байта до 1 МБ.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const data = String(reader.result).split(',')[1];
      resolve({
        kind: 'file',
        href: 'data:' + types[extension as keyof typeof types] + ';base64,' + data,
        name: file.name,
      });
    });
    reader.addEventListener('error', () => reject(new Error('Не удалось прочитать файл.')));
    reader.readAsDataURL(file);
  });
}

const customGroupValue = 'custom-group';

function MaterialForm({
  staff,
  edit,
  group,
  groups,
  onSaved,
}: {
  staff: StaffId;
  edit?: StaffMaterial;
  group?: string;
  groups: readonly string[];
  onSaved: (group: string) => void;
}) {
  const internId = products[staffAccounts[staff].productId].intern;
  const initialGroup = edit?.group ?? group ?? groups[0] ?? 'Чаты';
  const [kind, setKind] = useState<'link' | 'file'>(edit?.source.kind ?? 'link');
  const [custom, setCustom] = useState(() => !groups.includes(initialGroup));
  const [selected, setSelected] = useState(() =>
    groups.includes(initialGroup) ? initialGroup : (groups[0] ?? 'Чаты'),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      const file = data.get('file');
      let source: StaffMaterial['source'];
      if (kind === 'link') source = { kind: 'link', href: String(data.get('url')).trim() };
      else if (file instanceof File && file.size) source = await fileSource(file);
      else if (edit?.source.kind === 'file') source = edit.source;
      else throw new Error('Выбери файл для публикации.');
      const input: MaterialInput = {
        title: String(data.get('title')),
        description: String(data.get('description')),
        group: String(data.get('group')),
        audience: data.getAll('audience') as ProfileId[],
        source,
      };
      if (readStaffId(localStorage) !== staff) throw new Error('Сессия завершилась. Войди снова.');
      saveMaterial(localStorage, staff, input, edit?.id);
      onSaved(input.group.trim());
    } catch (problem) {
      setError(
        problem instanceof DOMException
          ? 'В браузере не хватило места. Удали старый файл или опубликуй ссылку.'
          : problem instanceof Error
            ? problem.message
            : 'Не удалось сохранить материал.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="staff-form" onSubmit={(event) => void publish(event)}>
      <label>
        Название
        <input name="title" defaultValue={edit?.title} required minLength={2} maxLength={100} />
      </label>
      <label>
        Группа
        <select
          name={custom ? undefined : 'group'}
          value={custom ? customGroupValue : selected}
          onChange={(event) => {
            const value = event.target.value;
            if (value === customGroupValue) setCustom(true);
            else {
              setCustom(false);
              setSelected(value);
            }
          }}
        >
          {groups.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value={customGroupValue}>Своя группа</option>
        </select>
      </label>
      {custom && (
        <label>
          Название группы
          <input
            name="group"
            required
            minLength={2}
            maxLength={40}
            defaultValue={groups.includes(initialGroup) ? '' : initialGroup}
            placeholder="Например, Онбординг"
          />
        </label>
      )}
      <label>
        Пояснение
        <textarea name="description" defaultValue={edit?.description} rows={3} required minLength={2} maxLength={420} />
      </label>
      <label>
        Источник
        <select value={kind} onChange={(event) => setKind(event.target.value === 'file' ? 'file' : 'link')}>
          <option value="link">Ссылка</option>
          <option value="file">Файл</option>
        </select>
      </label>
      {kind === 'link' ? (
        <label>
          Ссылка
          <input
            type="url"
            name="url"
            placeholder="https://…"
            defaultValue={edit?.source.kind === 'link' ? edit.source.href : ''}
            required
          />
        </label>
      ) : (
        <label>
          Файл до 1 МБ
          <input
            type="file"
            name="file"
            accept=".pdf,.docx,.txt,.png,.jpg,.jpeg"
            required={edit?.source.kind !== 'file'}
          />
          {edit?.source.kind === 'file' && <small>Текущий файл · {edit.source.name}</small>}
        </label>
      )}
      <fieldset>
        <legend>Кому показать</legend>
        <label className="staff-check">
          <input type="checkbox" name="audience" value={internId} defaultChecked />
          {profiles[internId].fullName}
        </label>
      </fieldset>
      {error && (
        <p className="staff-error" role="alert">
          {error}
        </p>
      )}
      <button className="button button--dark" type="submit" disabled={saving}>
        {edit ? 'Сохранить изменения' : 'Опубликовать материал'}
      </button>
    </form>
  );
}

function materialCountLabel(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'материал'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'материала'
        : 'материалов';
  return count + ' ' + word;
}

function MaterialCard({ material, actions }: { material: ShownMaterial; actions?: ReactNode }) {
  return (
    <article className="panel staff-material">
      <span className="icon-tile tone-lilac">
        <Icon name={material.source.kind === 'file' ? 'file' : 'book'} />
      </span>
      <h3>{material.title}</h3>
      <p>{material.description}</p>
      <p className="staff-muted">{material.author}</p>
      <MaterialLink material={material} />
      {actions}
    </article>
  );
}

function MaterialGroups({
  items,
  idPrefix,
  actions,
}: {
  items: ShownMaterial[];
  idPrefix: string;
  actions?: (material: ShownMaterial) => ReactNode;
}) {
  return (
    <div className="material-groups">
      {groupByName(items).map((group, index) => (
        <section key={group.name} aria-labelledby={idPrefix + '-' + index}>
          <h2 id={idPrefix + '-' + index}>{group.name}</h2>
          <div className="tile-grid">
            {group.items.map((material) => (
              <MaterialCard key={material.id} material={material} actions={actions?.(material)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MaterialLink({ material }: { material: Pick<StaffMaterial, 'source'> }) {
  const source = material.source;
  return source.kind === 'file' ? (
    <a className="text-link" href={source.href} download={source.name}>
      Скачать файл <Icon name="file" size={15} />
    </a>
  ) : (
    <a className="text-link material-url" href={source.href} target="_blank" rel="noreferrer">
      {source.href}
    </a>
  );
}

function MaterialActions({
  material,
  onEdit,
  onRemove,
}: {
  material: StaffMaterial;
  onEdit: (material: StaffMaterial) => void;
  onRemove: (material: StaffMaterial) => void;
}) {
  return (
    <div className="staff-actions">
      <button type="button" className="button button--white" onClick={() => onEdit(material)}>
        Редактировать
      </button>
      <button type="button" className="button button--white" onClick={() => onRemove(material)}>
        Удалить
      </button>
    </div>
  );
}

function StaffMaterials({
  baseline,
  ownMaterials,
  visibleMaterials,
  openGroup,
  onOpenGroup,
  onCreate,
  onEdit,
  onRemove,
}: {
  baseline: ShownMaterial[];
  ownMaterials: StaffMaterial[];
  visibleMaterials: ShownMaterial[];
  openGroup?: string;
  onOpenGroup: (group?: string) => void;
  onCreate: () => void;
  onEdit: (material: StaffMaterial) => void;
  onRemove: (material: StaffMaterial) => void;
}) {
  const groups = groupByName([...baseline, ...visibleMaterials]);
  const active = groups.find((group) => group.name === openGroup);
  return (
    <section className="staff-publications" aria-label="Материалы для стажёров">
      {active ? (
        <>
          <button type="button" className="text-link staff-back" onClick={() => onOpenGroup(undefined)}>
            <span className="staff-back__icon">
              <Icon name="chevron" size={16} />
            </span>
            Все группы
          </button>
          <div className="section-title">
            <h2>{active.name}</h2>
            <button type="button" className="button button--dark" onClick={onCreate}>
              Добавить материал
            </button>
          </div>
          <div className="tile-grid">
            {active.items.map((material) => {
              const stored = ownMaterials.find((item) => item.id === material.id);
              return (
                <MaterialCard
                  key={material.id}
                  material={material}
                  actions={
                    stored ? <MaterialActions material={stored} onEdit={onEdit} onRemove={onRemove} /> : undefined
                  }
                />
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="section-title">
            <h2>Группы</h2>
            <button type="button" className="button button--dark" onClick={onCreate}>
              Добавить материал
            </button>
          </div>
          <div className="staff-grid">
            {groups.map((group) => (
              <button
                key={group.name}
                type="button"
                className="panel staff-group"
                onClick={() => onOpenGroup(group.name)}
              >
                <span className="icon-tile tone-lilac">
                  <Icon name="layers" />
                </span>
                <span>
                  <strong>{group.name}</strong>
                  <small>{materialCountLabel(group.items.length)}</small>
                </span>
                <Icon name="arrow" />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function InternMaterials() {
  const profile = readDemoSession(localStorage);
  if (!profile || !isProfileId(profile)) return null;
  return <ProfileMaterials key={profile} profileId={profile} />;
}

function ProfileMaterials({ profileId }: { profileId: ProfileId }) {
  const [items, setItems] = useState(() => internMaterials(localStorage, profileId));
  useEffect(() => {
    function refresh(event: StorageEvent) {
      if (event.key === materialsKey || event.key === null) setItems(internMaterials(localStorage, profileId));
    }
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [profileId]);
  return (
    <section className="intern-materials" aria-label="Материалы от команды">
      <MaterialGroups
        items={[...items].sort((a, b) => Number(a.group === 'Чаты') - Number(b.group === 'Чаты'))}
        idPrefix="intern-materials"
      />
    </section>
  );
}

export function StaffWorkspace({ id, onExit }: { id: StaffId; onExit: () => void }) {
  const account = staffAccounts[id];
  const product = products[account.productId];
  const isMentor = account.role === 'Наставник';
  const [section, setSection] = useState<'interns' | 'materials'>('interns');
  const [openGroup, setOpenGroup] = useState<string>();
  const [, setLocalRevision] = useState(0);
  const queryClient = useQueryClient();
  const plansKey = ['role-checklist-team', id] as const;
  const plansQuery = useQuery({ queryKey: plansKey, queryFn: () => readTeamPlans(id), enabled: backendEnabled });
  const plans = backendEnabled ? (plansQuery.data ?? []) : undefined;
  const interns = internOverview(localStorage, id, plans);
  const [selected, setSelected] = useState<ProfileId>();
  const [materials, setMaterials] = useState(() => readMaterials(localStorage));
  const [editor, setEditor] = useState<'new' | StaffMaterial>();
  const [pendingRemoval, setPendingRemoval] = useState<StaffMaterial>();
  const [notice, setNotice] = useState<{ message: string }>();
  const [error, setError] = useState('');

  useEffect(() => {
    function refresh(event: StorageEvent) {
      if (event.key === null || event.key === checklistEditsKey || event.key.startsWith('ai-buddy.workspace.'))
        setLocalRevision((value) => value + 1);
      if (event.key === null || event.key === materialsKey) setMaterials(readMaterials(localStorage));
    }
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [id]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const current = interns.find((intern) => intern.id === selected);
  const currentPlan = plans?.find((plan) => plan.profile_id === selected);
  async function editChecklist(intern: ProfileId, change: ChecklistItemInput | string) {
    if (backendEnabled) {
      const plan = await changeTeamPlan(id, intern, change);
      await queryClient.cancelQueries({ queryKey: plansKey });
      queryClient.setQueryData<ChecklistPlan[]>(plansKey, (previous) =>
        previous?.map((old) => (old.profile_id === intern ? plan : old)),
      );
      void queryClient.invalidateQueries({ queryKey: ['role-checklist', intern] });
    } else {
      if (typeof change === 'string') removeChecklistItem(localStorage, id, change);
      else addChecklistItem(localStorage, id, change);
      setLocalRevision((value) => value + 1);
    }
  }
  const ownMaterials = materials.filter(
    (material) => material.author === id && material.audience.includes(product.intern),
  );
  const visibleMaterials = publishedForIntern(localStorage, product.intern);
  const baseline = baselineFor(product.intern);
  const groupOptions = materialGroupChoices([
    ...baseline.map((item) => item.group),
    ...visibleMaterials.map((item) => item.group),
  ]);

  function deleteMaterial() {
    if (!pendingRemoval) return;
    try {
      removeMaterial(localStorage, id, pendingRemoval.id);
      setMaterials(readMaterials(localStorage));
      setPendingRemoval(undefined);
      setNotice({ message: 'Материал удалён.' });
      setError('');
    } catch {
      setError('Не удалось удалить материал. Обнови страницу и попробуй ещё раз.');
    }
  }

  return (
    <div className="staff-workspace">
      <header className="staff-top">
        <span className="start-brand">
          <span className="brand-mark">
            <i />
            <i />
          </span>
          AI-buddy
        </span>
        <div className="staff-account">
          <Avatar initials={account.initials} tone={account.tone} avatar={account.avatar} />
          <span>
            <strong>{account.name}</strong>
            <small>
              {account.role} · {account.position}
            </small>
          </span>
          <button type="button" className="button button--white" onClick={onExit}>
            Выйти из аккаунта
          </button>
        </div>
      </header>
      <main className="staff-main">
        <header className={'page-intro tone-' + (isMentor ? 'lilac' : 'blue')}>
          <div>
            <h1>{isMentor ? 'Кабинет наставника' : 'Кабинет руководителя'}</h1>
            <p>
              {product.name} · Команда «{product.team}»
            </p>
          </div>
          <span className="page-intro__icon">
            <Icon name="users" size={44} />
          </span>
        </header>
        <nav className="filter-row staff-tabs" aria-label="Разделы кабинета">
          <button
            className="filter"
            type="button"
            aria-pressed={section === 'interns'}
            onClick={() => {
              setSection('interns');
              setSelected(undefined);
            }}
          >
            Мои стажёры
          </button>
          <button
            className="filter"
            type="button"
            aria-pressed={section === 'materials'}
            onClick={() => {
              setSection('materials');
              setOpenGroup(undefined);
            }}
          >
            Материалы для стажёров
          </button>
        </nav>
        {section === 'interns' ? (
          backendEnabled && plansQuery.isError ? (
            <button className="button button--white" onClick={() => void plansQuery.refetch()}>
              Повторить загрузку прогресса
            </button>
          ) : backendEnabled && plansQuery.isPending ? (
            <p role="status">Загружаем прогресс стажёров…</p>
          ) : current ? (
            <InternChecklist
              key={current.id}
              name={current.profile.fullName}
              stageLabel={current.profile.stage + ' · ' + current.progress.percent + '% выполнено'}
              items={current.checklist}
              materials={internMaterials(localStorage, current.id)}
              canEdit
              onBack={() => setSelected(undefined)}
              onAdd={async (input) => {
                await editChecklist(current.id, input);
                setNotice({ message: 'Пункт добавлен в чек-лист.' });
              }}
              onChangeMaterial={(taskId, materialId, attach) => {
                const savedIds = materialsForTask(localStorage, current.id, taskId, currentPlan).map(
                  (material) => material.id,
                );
                const materialIds = attach ? [...savedIds, materialId] : savedIds.filter((id) => id !== materialId);
                setTaskMaterials(localStorage, id, taskId, materialIds, currentPlan);
                setLocalRevision((value) => value + 1);
                setNotice({ message: attach ? 'Материал прикреплён.' : 'Материал откреплён.' });
              }}
              onRemove={async (taskId) => {
                await editChecklist(current.id, taskId);
                setNotice({ message: 'Пункт удалён.' });
              }}
            />
          ) : (
            <div className="staff-grid">
              {interns.map(({ id: internId, profile, progress, next }) => (
                <button
                  key={internId}
                  type="button"
                  className="panel staff-intern"
                  onClick={() => setSelected(internId)}
                >
                  <span className="staff-person">
                    <Avatar initials={profile.initials} avatar={profile.avatar} />
                    <span>
                      <strong>{profile.fullName}</strong>
                      <small>
                        {profile.position} · {profile.stage}
                      </small>
                    </span>
                    <Icon name="arrow" />
                  </span>
                  <span className="staff-progress">
                    <strong>{progress.percent}%</strong>
                    <small>
                      {progress.completed} из {progress.completed + progress.remaining} задач
                    </small>
                  </span>
                  <progress value={progress.percent} max="100" aria-label={'Прогресс · ' + profile.fullName} />
                  <span className="staff-intern__next">{next ? 'Дальше · ' + next.title : 'Чек-лист выполнен'}</span>
                </button>
              ))}
            </div>
          )
        ) : (
          <StaffMaterials
            baseline={baseline}
            ownMaterials={ownMaterials}
            visibleMaterials={visibleMaterials}
            openGroup={openGroup}
            onOpenGroup={setOpenGroup}
            onCreate={() => setEditor('new')}
            onEdit={setEditor}
            onRemove={(material) => {
              setPendingRemoval(material);
              setError('');
            }}
          />
        )}
      </main>
      {editor && (
        <Modal
          title={editor === 'new' ? 'Новый материал' : 'Редактирование материала'}
          onClose={() => setEditor(undefined)}
        >
          <MaterialForm
            staff={id}
            edit={editor === 'new' ? undefined : editor}
            group={editor === 'new' ? openGroup : undefined}
            groups={groupOptions}
            onSaved={(group) => {
              setMaterials(readMaterials(localStorage));
              setEditor(undefined);
              setOpenGroup(group);
              setSection('materials');
              setNotice({ message: editor === 'new' ? 'Материал опубликован.' : 'Изменения сохранены.' });
            }}
          />
        </Modal>
      )}
      {pendingRemoval && (
        <Modal title="Удалить материал?" onClose={() => setPendingRemoval(undefined)}>
          <div className="staff-detail">
            <p>{pendingRemoval.title}</p>
            {error && (
              <p className="staff-error" role="alert">
                {error}
              </p>
            )}
            <div className="staff-actions">
              <button type="button" className="button button--white" onClick={() => setPendingRemoval(undefined)}>
                Отмена
              </button>
              <button type="button" className="button button--dark" onClick={deleteMaterial}>
                Удалить публикацию
              </button>
            </div>
          </div>
        </Modal>
      )}
      {notice && <Toast message={notice.message} placement="top-right" />}
    </div>
  );
}
