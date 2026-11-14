import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** MSW server for Vitest (node). */
export const server = setupServer(...handlers);
