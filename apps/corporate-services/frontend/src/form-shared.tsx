import type { ReactNode } from 'react';
import { Icon } from '../../../web/frontend/src/ui';
import type { HrDemo, HrView } from './hr-demo';

export const dateFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', timeZone: 'UTC' });
export const monthFormat = new Intl.DateTimeFormat('ru', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const rubles = new Intl.NumberFormat('ru', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
export const dateLabel = (date: string) => dateFormat.format(new Date(date));

export function Submit({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button type="submit" className="button button--dark" disabled={disabled}>
      {children}
      <Icon name="arrow" size={17} />
    </button>
  );
}

export type SubmitAction = (action: Parameters<HrDemo['submit']>[0], message: string) => boolean;
export type FormProps = { view: HrView; submit: SubmitAction };
