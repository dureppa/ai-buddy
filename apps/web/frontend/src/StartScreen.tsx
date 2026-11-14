import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { products, profiles, staffAccounts, type AccountId, type ProductId } from './demo-accounts';
import { LiquidBackdrop } from './LiquidBackdrop';
import { Avatar, Buddy, Icon } from './ui';
import './start.css';

const productIds = Object.keys(products) as ProductId[];
const layoutEasing = 'cubic-bezier(.25,.71,.24,1)';

function moveLight(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType !== 'mouse') return;
  const card = event.currentTarget;
  const bounds = card.getBoundingClientRect();
  card.style.setProperty('--light-x', event.clientX - bounds.left + 'px');
  card.style.setProperty('--light-y', event.clientY - bounds.top + 'px');
}

export function StartScreen({ onSelect }: { onSelect: (id: AccountId) => void | Promise<void> }) {
  const [selected, setSelected] = useState<ProductId | null>(null);
  const [previous, setPrevious] = useState<ProductId>(productIds[0]);
  const [pending, setPending] = useState<AccountId | null>(null);
  const [error, setError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const screen = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const backdropMotion = useRef<(() => void) | null>(null);
  const buddy = useRef<HTMLDivElement>(null);
  const entering = useRef(false);
  const product = products[selected ?? previous];
  const intern = profiles[product.intern];

  useEffect(() => {
    function settle() {
      backdropMotion.current?.();
    }
    window.addEventListener('resize', settle);
    return () => {
      window.removeEventListener('resize', settle);
      settle();
    };
  }, []);

  function lightAt(card: HTMLElement | null, chosen = false) {
    const bounds = card?.getBoundingClientRect();
    screen.current?.dispatchEvent(
      new CustomEvent('product-light', {
        detail: bounds
          ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, selected: chosen }
          : null,
      }),
    );
  }

  function changeProduct(next: ProductId | null) {
    const panel = stage.current;
    if (!panel || entering.current || next === selected) return;
    const id = next ?? selected;
    if (!id) return;
    const card = panel.querySelector<HTMLButtonElement>('#product-' + id);
    const team = panel.querySelector<HTMLElement>('.start-team');
    const source = next ? card : team;
    const destination = next ? team : card;
    const interrupted = panel.querySelector<HTMLElement>('.start-morph');
    const sourceBox = (interrupted ?? source)?.getBoundingClientRect();
    const titleBox = (interrupted ?? source)?.querySelector('strong')?.getBoundingClientRect();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    backdropMotion.current?.();
    if (next) lightAt(card, true);
    else lightAt(null);

    flushSync(() => {
      setError(false);
      setSelected(next);
      if (next) setPrevious(next);
    });

    const focusTarget = next ? heading.current : card;
    focusTarget?.focus({ preventScroll: true });
    focusTarget?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    if (!sourceBox || !titleBox || !destination || reduced) return;

    const targetBox = destination.getBoundingClientRect();
    const targetTitle = destination.querySelector('strong')?.getBoundingClientRect();
    if (!targetTitle) return;
    const parentBox = panel.getBoundingClientRect();
    const fromRadius = getComputedStyle(source ?? destination).borderTopLeftRadius;
    const toRadius = getComputedStyle(destination).borderTopLeftRadius;
    const duration = next ? 510 : 380;
    const settleAt = next ? 0.83 : 1;

    // Only the decorative surface changes size. Its title travels at its natural proportions.
    const surface = document.createElement('div');
    surface.className = 'start-morph tone-' + products[id].tone;
    surface.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong');
    name.textContent = products[id].name;
    surface.append(name);
    panel.append(surface);
    if (source) source.dataset.morphing = 'true';
    destination.dataset.morphing = 'true';
    screen.current?.setAttribute('data-moving', 'true');

    const surfaceFrame = (bounds: DOMRect, borderRadius: string) => ({
      left: bounds.left - parentBox.left + 'px',
      top: bounds.top - parentBox.top + 'px',
      width: bounds.width + 'px',
      height: bounds.height + 'px',
      borderRadius,
    });
    const titleFrame = (title: DOMRect, bounds: DOMRect) => ({
      width: title.width + 'px',
      transform: `translate(${title.left - bounds.left}px, ${title.top - bounds.top}px)`,
    });
    const finalSurface = surfaceFrame(targetBox, toRadius);
    const finalTitle = titleFrame(targetTitle, targetBox);
    const motion = surface.animate(
      [surfaceFrame(sourceBox, fromRadius), { ...finalSurface, offset: settleAt }, finalSurface],
      { duration, easing: layoutEasing, fill: 'both' },
    );
    const destinationTitle = destination.querySelector('strong');
    if (destinationTitle) name.style.fontSize = getComputedStyle(destinationTitle).fontSize;
    const titleMotion = name.animate(
      [titleFrame(titleBox, sourceBox), { ...finalTitle, offset: settleAt }, finalTitle],
      { duration, easing: layoutEasing, fill: 'both' },
    );

    const currentScreen = screen.current;

    function finish() {
      motion.cancel();
      titleMotion.cancel();
      surface.remove();
      source?.removeAttribute('data-morphing');
      destination?.removeAttribute('data-morphing');
      currentScreen?.removeAttribute('data-moving');
      backdropMotion.current = null;
    }
    motion.onfinish = finish;
    backdropMotion.current = finish;

    if (next) {
      buddy.current?.getAnimations().forEach((animation) => animation.cancel());
      buddy.current?.animate(
        [
          { transform: 'none' },
          { transform: 'translateY(-6px) rotate(3deg) scale(1.02)', offset: 0.43 },
          { transform: 'none' },
        ],
        { duration: 390, easing: layoutEasing },
      );
    }
  }

  async function enter(id: AccountId) {
    if (entering.current) return;
    entering.current = true;
    setError(false);
    setPending(id);
    backdropMotion.current?.();
    try {
      await onSelect(id);
    } catch {
      setPending(null);
      setError(true);
      requestAnimationFrame(() => document.getElementById('account-' + id)?.focus());
    } finally {
      entering.current = false;
    }
  }

  return (
    <main className="start-screen" ref={screen} data-step={selected ? 'accounts' : 'products'}>
      <LiquidBackdrop screen={screen} />
      <section className="start-card" aria-labelledby="start-title">
        <div className="start-card__intro">
          <div className="start-brand">
            <span className="brand-mark">
              <i />
              <i />
            </span>
            <span>AI-buddy</span>
          </div>
          <div className="start-welcome">
            <h1 id="start-title">Твой старт в новой команде</h1>
            <p className="start-card__lead">
              Знакомься с командой, проходи адаптацию и находи ответы вместе с AI-buddy.
            </p>
          </div>
          <div className="start-card__buddy" ref={buddy}>
            <Buddy mood="happy" />
          </div>
          <p className="start-credit">HACK&amp;CHANGE 2026 · Команда «Без негатива»</p>
        </div>
        <div className="start-card__profiles">
          <div className="start-stage" ref={stage}>
            <div className="start-step start-step--products" inert={!!selected} aria-hidden={!!selected}>
              <div className="start-card__heading">
                <h2>Выбери продукт</h2>
                <p>Познакомься с командой и начни свой сценарий адаптации.</p>
              </div>
              <div className="start-products">
                {productIds.map((id) => (
                  <button
                    type="button"
                    id={'product-' + id}
                    className={'start-product tone-' + products[id].tone}
                    key={id}
                    onPointerEnter={(event) => {
                      if (event.pointerType === 'mouse') lightAt(event.currentTarget);
                    }}
                    onPointerMove={moveLight}
                    onPointerLeave={() => lightAt(null)}
                    onClick={() => changeProduct(id)}
                  >
                    <strong>{products[id].name}</strong>
                    <span>{products[id].team}</span>
                    <small>{profiles[products[id].intern].position}</small>
                    <span className="start-arrow">
                      <Icon name="arrow" size={19} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="start-step start-step--accounts" inert={!selected} aria-hidden={!selected}>
              <div className={'start-team tone-' + product.tone}>
                <strong>{product.name}</strong>
                <span>{product.team}</span>
              </div>
              <div className="start-card__heading start-account-heading">
                <h2 ref={heading} tabIndex={-1}>
                  Выбери аккаунт
                </h2>
                <p>{product.teamDescription}</p>
              </div>
              <div className="start-profiles" role="group" aria-label="Аккаунты команды" aria-busy={!!pending}>
                {[
                  {
                    id: product.intern,
                    name: intern.fullName,
                    role: 'Стажёр',
                    position: intern.position,
                    initials: intern.initials,
                    avatar: intern.avatar,
                    tone: product.tone,
                    detail: intern.stage + ' · ' + intern.stageDescription,
                  },
                  ...[product.mentor, product.manager].map((id) => ({ ...staffAccounts[id], id, detail: '' })),
                ].map((account) => (
                  <button
                    id={'account-' + account.id}
                    key={account.id}
                    type="button"
                    className="start-profile"
                    disabled={!!pending}
                    data-pending={pending === account.id || undefined}
                    onClick={() => void enter(account.id)}
                  >
                    <Avatar initials={account.initials} tone={account.tone} avatar={account.avatar} />
                    <span className="start-profile__copy">
                      <strong>{account.name}</strong>
                      <span>
                        {account.role} · {account.position}
                      </span>
                      {account.detail && <small>{account.detail}</small>}
                    </span>
                    {pending === account.id ? (
                      <span className="start-loading" role="status">
                        Входим… <span className="start-spinner" />
                      </span>
                    ) : (
                      <Icon name="arrow" size={19} />
                    )}
                  </button>
                ))}
              </div>
              <p className="start-error" role="alert">
                {error && 'Не удалось войти. Выбери аккаунт ещё раз.'}
              </p>
              <button
                type="button"
                className="text-link start-back"
                disabled={!!pending}
                onClick={() => changeProduct(null)}
              >
                <Icon name="arrow" size={17} /> Все продукты
              </button>
            </div>
          </div>
          <p className="start-card__note">Все данные синтетические и предназначены для демонстрации.</p>
        </div>
      </section>
    </main>
  );
}
