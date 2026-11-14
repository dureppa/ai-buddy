import { useEffect, useState, type FormEvent } from 'react';
import { isProfileId, products, profiles, staffAccounts, type ProfileId, type StaffId } from './demo-accounts';
import { readDemoSession } from './demo-session';
import {
  internOverview,
  materialsFor,
  materialsKey,
  maxMaterialBytes,
  readMaterials,
  readStaffId,
  removeMaterial,
  saveMaterial,
  type MaterialInput,
  type StaffMaterial,
} from './staff-data';
import { backendEnabled } from './backend';
import { StaffReviews } from './ReviewPanel';
import { Avatar, Icon, Modal } from './ui';
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

function MaterialForm({ staff, edit, onSaved }: { staff: StaffId; edit?: StaffMaterial; onSaved: () => void }) {
  const internId = products[staffAccounts[staff].productId].intern;
  const [kind, setKind] = useState<'link' | 'file'>(edit?.source.kind ?? 'link');
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
        audience: data.getAll('audience') as ProfileId[],
        source,
      };
      if (readStaffId(localStorage) !== staff) throw new Error('Сессия завершилась. Войди снова.');
      saveMaterial(localStorage, staff, input, edit?.id);
      onSaved();
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

function MaterialLink({ material }: { material: StaffMaterial }) {
  const source = material.source;
  return source.kind === 'file' ? (
    <a className="text-link" href={source.href} download={source.name}>
      Скачать файл <Icon name="file" size={15} />
    </a>
  ) : (
    <a className="text-link" href={source.href} target="_blank" rel="noreferrer">
      Открыть ссылку <Icon name="diagonal" size={15} />
    </a>
  );
}

export function InternMaterials() {
  const profile = readDemoSession(localStorage);
  if (!profile || !isProfileId(profile)) return null;
  return <ProfileMaterials key={profile} profileId={profile} />;
}

function ProfileMaterials({ profileId }: { profileId: ProfileId }) {
  const [items, setItems] = useState(() => materialsFor(localStorage, profileId));
  useEffect(() => {
    function refresh(event: StorageEvent) {
      if (event.key === materialsKey || event.key === null) setItems(materialsFor(localStorage, profileId));
    }
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [profileId]);
  if (!items.length) return null;
  return (
    <section className="intern-materials" aria-labelledby="intern-materials-title">
      <div className="section-title">
        <h2 id="intern-materials-title">Материалы от команды</h2>
      </div>
      <div className="tile-grid">
        {items.map((material) => (
          <article className="panel staff-material" key={material.id}>
            <span className="icon-tile tone-lilac">
              <Icon name={material.source.kind === 'file' ? 'file' : 'book'} />
            </span>
            <h3>{material.title}</h3>
            <p>{material.description}</p>
            <MaterialLink material={material} />
          </article>
        ))}
      </div>
    </section>
  );
}

export function StaffWorkspace({ id, onExit }: { id: StaffId; onExit: () => void }) {
  const account = staffAccounts[id];
  const product = products[account.productId];
  const isMentor = account.role === 'Наставник';
  const [section, setSection] = useState<'interns' | 'materials'>('interns');
  const [interns, setInterns] = useState(() => internOverview(localStorage, id));
  const [selected, setSelected] = useState<ProfileId>();
  const [materials, setMaterials] = useState(() => readMaterials(localStorage));
  const [editor, setEditor] = useState<'new' | StaffMaterial>();
  const [pendingRemoval, setPendingRemoval] = useState<StaffMaterial>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    function refresh(event: StorageEvent) {
      if (event.key === null || event.key.startsWith('ai-buddy.workspace.'))
        setInterns(internOverview(localStorage, id));
      if (event.key === null || event.key === materialsKey) setMaterials(readMaterials(localStorage));
    }
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [id]);

  const current = interns.find((intern) => intern.id === selected);
  const visibleMaterials = materials.filter((material) => material.author === id);

  function deleteMaterial() {
    if (!pendingRemoval) return;
    try {
      removeMaterial(localStorage, id, pendingRemoval.id);
      setMaterials(readMaterials(localStorage));
      setPendingRemoval(undefined);
      setMessage('Материал удалён.');
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
        {backendEnabled && (id === 'mentor' || id === 'manager') && <StaffReviews staff={id} />}
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
            onClick={() => setSection('interns')}
          >
            Мои стажёры
          </button>
          <button
            className="filter"
            type="button"
            aria-pressed={section === 'materials'}
            onClick={() => setSection('materials')}
          >
            Материалы для стажёров
          </button>
        </nav>
        {section === 'interns' ? (
          <div className="staff-grid">
            {interns.map(({ id: internId, profile, progress, next, requests }) => (
              <button key={internId} type="button" className="panel staff-intern" onClick={() => setSelected(internId)}>
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
                {requests.length > 0 && <span className="status">На согласовании · {requests.length}</span>}
              </button>
            ))}
          </div>
        ) : (
          <section className="staff-publications" aria-label="Материалы для стажёров">
            <div className="section-title">
              <h2>Опубликованные материалы</h2>
              <button type="button" className="button button--dark" onClick={() => setEditor('new')}>
                Добавить материал
              </button>
            </div>
            {message && (
              <p className="staff-message" role="status">
                {message}
              </p>
            )}
            {visibleMaterials.length ? (
              <div className="staff-grid">
                {visibleMaterials.map((material) => (
                  <article className="panel staff-material" key={material.id}>
                    <h3>{material.title}</h3>
                    <p>{material.description}</p>
                    <p className="staff-muted">
                      {material.audience.map((profile) => profiles[profile].fullName).join(', ')}
                    </p>
                    <MaterialLink material={material} />
                    <div className="staff-actions">
                      <button type="button" className="button button--white" onClick={() => setEditor(material)}>
                        Редактировать
                      </button>
                      <button
                        type="button"
                        className="button button--white"
                        onClick={() => {
                          setPendingRemoval(material);
                          setError('');
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="panel staff-empty">Здесь появятся материалы, которые ты опубликуешь для стажёров.</p>
            )}
          </section>
        )}
      </main>
      {current && (
        <Modal title={current.profile.fullName} onClose={() => setSelected(undefined)}>
          <div className="staff-detail">
            <p>
              {current.profile.stage} · {current.progress.percent}% выполнено
            </p>
            <h3>Чек-лист адаптации</h3>
            <ul>
              {current.checklist.map((item) => (
                <li key={item.id}>
                  <Icon name={item.done ? 'check' : 'clock'} size={17} />
                  {item.title}
                  <small>{item.done ? 'Выполнено' : 'Осталось'}</small>
                </li>
              ))}
            </ul>
            <h3>Заявки на согласовании</h3>
            {current.requests.length ? (
              current.requests.map((request) => (
                <details key={request.id}>
                  <summary>
                    {request.title} · {request.number}
                  </summary>
                  <p>На согласовании · владелец сервиса {request.owner}</p>
                </details>
              ))
            ) : (
              <p>Активных заявок нет.</p>
            )}
          </div>
        </Modal>
      )}
      {editor && (
        <Modal
          title={editor === 'new' ? 'Новый материал' : 'Редактирование материала'}
          onClose={() => setEditor(undefined)}
        >
          <MaterialForm
            staff={id}
            edit={editor === 'new' ? undefined : editor}
            onSaved={() => {
              setMaterials(readMaterials(localStorage));
              setEditor(undefined);
              setMessage(editor === 'new' ? 'Материал опубликован.' : 'Изменения сохранены.');
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
    </div>
  );
}
