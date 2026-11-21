import { expectTypeOf, it } from 'vitest';
import { apiFetch } from '../../../../web/frontend/src/backend';
import type { AccountId, ProfileId } from '../../../../web/frontend/src/demo-accounts';
import { standaloneWorkToolFetch, useWorkToolTransport } from '../../../../tools/shared/frontend/work-tool-transport';

it('keeps work tool transport scoped to interns while the shared API also accepts staff', () => {
  expectTypeOf<Parameters<ReturnType<typeof useWorkToolTransport>>[0]>().toEqualTypeOf<ProfileId>();
  expectTypeOf<Parameters<typeof standaloneWorkToolFetch>[0]>().toEqualTypeOf<ProfileId>();
  expectTypeOf<Parameters<typeof apiFetch>[0]>().toEqualTypeOf<AccountId>();
});
