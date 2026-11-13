import { describe, expect, it } from 'vitest';
import { hrPath, hrServices } from './hr-catalog';
import { addDays, calendarMonth, makeHrDemo, serviceHistory } from './hr-demo';

const today = '2026-11-13';

function storage() {
  const records = new Map<string, string>();
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => records.set(key, value),
  };
}

describe('HR demo', () => {
  it('exposes six distinct corporate-service links and a Monday-first calendar', () => {
    expect(new Set(hrServices.map((service) => hrPath(service.id))).size).toBe(6);
    expect(calendarMonth('2026-11').slice(0, 8)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('uses each profile’s balance and enforces vacation dates and overlaps', () => {
    const saved = storage();
    const olga = makeHrDemo(saved, 'olga', today);
    const sasha = makeHrDemo(saved, 'sasha', today);
    const maria = makeHrDemo(saved, 'maria', today);
    const start = olga.read().earliestVacation;
    expect([olga, sasha, maria].map((demo) => demo.read().vacationLeft)).toEqual([7, 16, 24]);
    expect(olga.submit({ service: 'absences', start: today, end: start }).ok).toBe(false);
    expect(olga.submit({ service: 'absences', start, end: addDays(start, 7) }).ok).toBe(false);
    expect(olga.submit({ service: 'absences', start, end: addDays(start, 1) }).ok).toBe(true);
    expect(olga.submit({ service: 'absences', start, end: start }).ok).toBe(false);
    expect(makeHrDemo(saved, 'olga', today).read().vacationLeft).toBe(5);
    expect(sasha.read().absences).toHaveLength(0);
  });

  it('enforces trip permission, estimate, budget, notice and pending application', () => {
    const saved = storage();
    const olga = makeHrDemo(saved, 'olga', today);
    const sasha = makeHrDemo(saved, 'sasha', today);
    const action = { service: 'trips', destination: 'kazan', date: sasha.read().earliestTrip, budget: 18000 } as const;
    expect(olga.submit(action).ok).toBe(false);
    expect(sasha.submit({ ...action, date: today }).ok).toBe(false);
    expect(sasha.submit({ ...action, budget: 17999 }).ok).toBe(false);
    expect(sasha.submit({ ...action, budget: 35001 }).ok).toBe(false);
    expect(sasha.submit(action).ok).toBe(true);
    expect(sasha.submit(action).ok).toBe(false);
  });

  it('normalizes referrals and checks contact details, duplicates and quota', () => {
    const olga = makeHrDemo(storage(), 'olga', today);
    const action = {
      service: 'hiring',
      vacancy: 'design',
      name: '  Мила Иванова  ',
      email: 'MILA@EXAMPLE.COM',
    } as const;
    expect(olga.submit({ ...action, email: 'invalid' }).ok).toBe(false);
    expect(olga.submit(action).ok).toBe(true);
    expect(olga.read().referrals[0]).toMatchObject({ name: 'Мила Иванова', email: 'mila@example.com' });
    expect(olga.submit(action).ok).toBe(false);
    expect(olga.submit({ ...action, email: 'other@example.com' }).ok).toBe(false);
  });

  it('requires the offboarding checklist and notice before saving one draft', () => {
    const maria = makeHrDemo(storage(), 'maria', today);
    const action = { service: 'offboarding', date: maria.read().earliestExit } as const;
    expect(maria.submit(action).ok).toBe(false);
    maria.toggleExitStep('unknown');
    maria.toggleExitStep('feedback');
    expect(maria.submit({ ...action, date: today }).ok).toBe(false);
    expect(maria.submit(action).ok).toBe(true);
    maria.toggleExitStep('feedback');
    expect(maria.read().exitChecklist).toHaveLength(3);
    expect(maria.submit(action).ok).toBe(false);
  });

  it('changes optional consents once and lists latest changes first', () => {
    const sasha = makeHrDemo(storage(), 'sasha', today);
    const action = { service: 'consents', consent: 'news', granted: true } as const;
    expect(sasha.submit({ ...action, consent: 'work' }).ok).toBe(false);
    expect(sasha.submit(action).ok).toBe(true);
    expect(sasha.submit(action).ok).toBe(false);
    expect(sasha.submit({ ...action, granted: false }).ok).toBe(true);
    expect(sasha.read().grants.has('news')).toBe(false);
    expect(
      serviceHistory(sasha.read().history, 'consents').map((event) => 'granted' in event && event.granted),
    ).toEqual([false, true]);
  });

  it('checks benefit eligibility, duplicates and remaining balance', () => {
    const saved = storage();
    const olga = makeHrDemo(saved, 'olga', today);
    const maria = makeHrDemo(saved, 'maria', today);
    expect(olga.submit({ service: 'benefits', benefit: 'sport' }).ok).toBe(false);
    expect(olga.submit({ service: 'benefits', benefit: 'learning' }).ok).toBe(true);
    expect(olga.submit({ service: 'benefits', benefit: 'learning' }).ok).toBe(false);
    saved.setItem(
      'ai-buddy.hr.maria',
      JSON.stringify({
        exitChecklist: [],
        history: [{ service: 'benefits', benefit: 'sport', amount: 20000 }],
      }),
    );
    expect(maria.submit({ service: 'benefits', benefit: 'learning' }).ok).toBe(false);
    expect(olga.read().benefitLeft).toBe(1500);
    expect(maria.read().benefitLeft).toBe(4000);
  });
});
