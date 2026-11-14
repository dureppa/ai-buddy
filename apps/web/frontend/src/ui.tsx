import delivery_alina from './assets/avatars/delivery-alina.webp';
import delivery_denis from './assets/avatars/delivery-denis.webp';
import delivery_vera from './assets/avatars/delivery-vera.webp';
import travel_artem from './assets/avatars/travel-artem.webp';
import travel_polina from './assets/avatars/travel-polina.webp';
import travel_kirill from './assets/avatars/travel-kirill.webp';
import autoteca_oleg from './assets/avatars/autoteca-oleg.webp';
import autoteca_ksenia from './assets/avatars/autoteca-ksenia.webp';
import autoteca_maksim from './assets/avatars/autoteca-maksim.webp';
import help_yulia from './assets/avatars/help-yulia.webp';
import help_nikita from './assets/avatars/help-nikita.webp';
import help_elena from './assets/avatars/help-elena.webp';
import { useEffect, useRef, type ReactNode } from 'react';
import annaAvatar from './assets/avatars/avatar-7.webp';
import alexeyAvatar from './assets/avatars/profile-alexey.webp';
import ilyaAvatar from './assets/avatars/avatar-6.webp';
import ekaterinaAvatar from './assets/avatars/profile-ekaterina.webp';
import ninaAvatar from './assets/avatars/avatar-5.webp';
import romanAvatar from './assets/avatars/avatar-4.webp';
import dariaAvatar from './assets/avatars/avatar-9.webp';
import mikhailAvatar from './assets/avatars/avatar-10.webp';
import timurAvatar from './assets/avatars/avatar-8.webp';
import buddy from './assets/buddy.webp';
import buddyBaby from './assets/buddy-baby.webp';
import buddyAdult from './assets/buddy-adult.webp';
import type { BuddyGrowthStage } from './demo';
import alexanderAvatar from './assets/avatars/profile-alexander.webp';
import mariaAvatar from './assets/avatars/profile-maria.webp';
import olgaAvatar from './assets/avatars/profile-olga.webp';
import type { AvatarVariant, Tone } from './data';

const avatarSources: Record<AvatarVariant, string> = {
  'delivery-alina': delivery_alina,
  'delivery-denis': delivery_denis,
  'delivery-vera': delivery_vera,
  'travel-artem': travel_artem,
  'travel-polina': travel_polina,
  'travel-kirill': travel_kirill,
  'autoteca-oleg': autoteca_oleg,
  'autoteca-ksenia': autoteca_ksenia,
  'autoteca-maksim': autoteca_maksim,
  'help-yulia': help_yulia,
  'help-nikita': help_nikita,
  'help-elena': help_elena,

  olga: olgaAvatar,
  alexander: alexanderAvatar,
  maria: mariaAvatar,
  timur: timurAvatar,
  anna: annaAvatar,
  alexey: alexeyAvatar,
  ilya: ilyaAvatar,
  ekaterina: ekaterinaAvatar,
  nina: ninaAvatar,
  roman: romanAvatar,
  daria: dariaAvatar,
  mikhail: mikhailAvatar,
};

const iconPaths = {
  home: 'm3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z',
  map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zm6-3v15m6-12v15',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm4-4a4 4 0 0 1 0 8',
  grid: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  layers: 'm12 2 10 5-10 5L2 7zm-10 10 10 5 10-5M2 17l10 5 10-5',
  sparkles: 'M12 2l2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7zM5 2v6M2 5h6m12 12v5m-2.5-2.5h5',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8zm8 4-2 1 .1 2.2-2 2.1-2.2-.2L13 19h-2l-.9-1.9-2.2.2-2-2.1L6 13l-2-1 2-1-.1-2.2 2-2.1 2.2.2L11 5h2l.9 1.9 2.2-.2 2 2.1L18 11z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm6-2 4 4',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0',
  chevron: 'm9 18 6-6-6-6',
  down: 'm6 9 6 6 6-6',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  diagonal: 'M6 18 18 6M8 6h10v10',
  check: 'm5 12 4 4L19 6',
  file: 'M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 0v5h5M8 13h8m-8 4h6',
  monitor: 'M3 4h18v13H3zm9 13v4m-5 0h10',
  book: 'M2 3h6a4 4 0 0 1 4 4v14a4 4 0 0 0-4-3H2zm20 0h-6a4 4 0 0 0-4 4v14a4 4 0 0 1 4-3h6z',
  key: 'M15 3a6 6 0 0 0-5.7 8L2 18v4h4v-3h3v-3l2-2a6 6 0 1 0 4-11zm3 5h.01',
  flag: 'M4 22V3m0 1c5-4 9 4 16 0v11c-7 4-11-4-16 0',
  calendar: 'M3 5h18v16H3zm0 5h18M8 2v6m8-6v6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-16v6l4 2',
  close: 'm6 6 12 12M18 6 6 18',
  send: 'm22 2-7 20-4-9-9-4zm0 0L11 13',
  menu: 'M3 6h18M3 12h18M3 18h18',
  message: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.9-3.9a8.5 8.5 0 1 1 15.1-4.6z',
  copy: 'M8 8h12v13H8zM16 8V3H3v13h5',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-11v6m0-10h.01',
  heart:
    'M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6l1.2 1.2L12 21l7.6-7.6 1.2-1.2a5.4 5.4 0 0 0 0-7.6z',
} as const;
export type IconName = keyof typeof iconPaths;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}

export function Avatar({
  initials,
  tone = 'lilac',
  avatar,
}: {
  initials: string;
  tone?: Tone;
  avatar?: AvatarVariant;
}) {
  return (
    <span className={'avatar tone-' + tone + (avatar ? ' avatar--image' : '')} aria-hidden="true">
      {avatar ? <img src={avatarSources[avatar]} alt="" draggable="false" /> : initials}
    </span>
  );
}

export type Mood = 'happy' | 'thinking' | 'surprised' | 'supportive' | 'celebrating';

const buddyImages = { baby: buddyBaby, young: buddy, adult: buddyAdult };

export function Buddy({
  mood = 'happy',
  compact = false,
  growthStage,
  onGrowthEnd,
}: {
  mood?: Mood;
  compact?: boolean;
  growthStage?: BuddyGrowthStage;
  onGrowthEnd?: () => void;
}) {
  const symbols = { happy: '', thinking: '···', surprised: '!', supportive: '♥', celebrating: '✦' };
  return (
    <span className={'buddy buddy--' + mood + (compact ? ' buddy--compact' : '')} aria-hidden="true">
      <img
        key={growthStage}
        src={growthStage ? buddyImages[growthStage] : buddy}
        alt=""
        draggable="false"
        data-growth-stage={growthStage}
        className={onGrowthEnd ? 'buddy__growth' : undefined}
        onAnimationEnd={onGrowthEnd}
      />
      {!growthStage && (
        <>
          <span className="buddy__lid buddy__lid--left" />
          <span className="buddy__lid buddy__lid--right" />
        </>
      )}
      {symbols[mood] && <span className="buddy__emotion">{symbols[mood]}</span>}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  side = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  side?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={side ? 'dialog dialog--side' : 'dialog'}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog__inner">
        <div className="dialog__top">
          <h2>{title}</h2>
          <button className="icon-button" type="button" aria-label="Закрыть" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <Buddy mood="supportive" compact />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export function PageIntro({ title, text, tone, icon }: { title: string; text: string; tone: string; icon: IconName }) {
  return (
    <header className={'page-intro tone-' + tone}>
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      <span className="page-intro__icon">
        <Icon name={icon} size={44} />
      </span>
    </header>
  );
}
