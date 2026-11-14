import Dexie, { type Table } from 'dexie';
import type {
  CompleteSessionRequest,
  ContextInput,
  ScheduleOverrideRequest,
  SessionCompletion,
  SubmitTrialsRequest,
} from '@/api/types';

interface OutboxBase {
  seq?: number;
  /** Group the item belongs to: a session id, or a schedule version for overrides. */
  sessionId: string;
  createdAt: string;
  attempts: number;
  status: 'pending' | 'failed';
  lastError: string | null;
}

/** Queued writes: assessment trials and completions, check-ins and schedule overrides. */
export type OutboxItem =
  | (OutboxBase & { kind: 'context'; payload: ContextInput })
  | (OutboxBase & { kind: 'override'; payload: ScheduleOverrideRequest })
  | {
      seq?: number;
      kind: 'trials';
      sessionId: string;
      payload: SubmitTrialsRequest;
      createdAt: string;
      attempts: number;
      status: 'pending' | 'failed';
      lastError: string | null;
    }
  | {
      seq?: number;
      kind: 'complete';
      sessionId: string;
      payload: CompleteSessionRequest;
      createdAt: string;
      attempts: number;
      status: 'pending' | 'failed';
      lastError: string | null;
    };

export interface CompletionRecord {
  sessionId: string;
  completion: SessionCompletion;
  receivedAt: string;
}

/** Local store: trials and completions are written here before any network call. */
class AegisLocalDb extends Dexie {
  outbox!: Table<OutboxItem, number>;
  completions!: Table<CompletionRecord, string>;

  constructor() {
    super('aegis-local');
    this.version(1).stores({
      outbox: '++seq, sessionId, status',
      completions: 'sessionId',
    });
  }
}

export const localDb = new AegisLocalDb();
