import type { DataStatus } from '@/components/shared';

/** Map a TanStack Query result onto the DataState statuses. */
export function statusOf(
  query: { isPending: boolean; isError: boolean },
  isEmpty: boolean,
  emptyStatus: 'empty' | 'no-data' = 'empty',
): DataStatus {
  if (query.isPending) return 'loading';
  if (query.isError) return 'error';
  return isEmpty ? emptyStatus : 'ready';
}
