import type { SleepRecordsRow } from '@/types/tables';
import { callEndpoint } from './client';
import type { AstronautRangeQuery } from './types';

export const sleepApi = {
  records: (query: AstronautRangeQuery) =>
    callEndpoint<SleepRecordsRow[]>('sleep.records', {}, { query }),
};
