import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch, backendEnabled } from './backend';
import type { ProfileId } from './demo-accounts';

const teamGuideSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['missing', 'pending', 'failed']) }),
  z.object({
    status: z.literal('ready'),
    cards: z.array(z.object({ title: z.string().trim().min(1), text: z.string().trim().min(1) })).length(3),
  }),
]);
type TeamGuide = z.infer<typeof teamGuideSchema>;
const path = '/api/v1/product-guide/team';

async function requestGuide(profileId: ProfileId, options: RequestInit): Promise<TeamGuide> {
  const response = await apiFetch(profileId, path, options);
  return teamGuideSchema.parse(await response.json());
}

export function useTeamGuide(profileId: ProfileId) {
  const client = useQueryClient();
  const queryKey = ['team-guide', profileId] as const;
  const query = useQuery({
    queryKey,
    enabled: backendEnabled,
    queryFn: ({ signal }) =>
      requestGuide(profileId, {
        method: client.getQueryData<TeamGuide>(queryKey)?.status === 'pending' ? 'GET' : 'POST',
        signal,
      }),
    refetchInterval: (current) =>
      current.state.status === 'success' && current.state.data?.status === 'pending' ? 1500 : false,
  });
  const retry = useMutation({
    mutationFn: () => requestGuide(profileId, { method: 'POST', body: JSON.stringify({ retry: true }) }),
    onMutate: () => client.cancelQueries({ queryKey }),
    onSuccess: (guide) => client.setQueryData(queryKey, guide),
  });

  return {
    guide: query.data,
    loading:
      retry.isPending || (!retry.isError && !query.isError && (query.isPending || query.data?.status === 'pending')),
    error: retry.isError || query.isError || query.data?.status === 'failed' || query.data?.status === 'missing',
    retry: retry.mutate,
  };
}
