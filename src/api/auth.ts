import { callEndpoint } from './client';
import type {
  DemoAccount,
  DemoSessionRequest,
  LoginRequest,
  LoginResponse,
  SessionUser,
} from './types';

export const authApi = {
  /** Credential sign-in. Not used by the demonstration UI; kept for real authentication. */
  login: (body: LoginRequest) => callEndpoint<LoginResponse>('auth.login', {}, { body }),
  logout: () => callEndpoint<void>('auth.logout'),
  me: () => callEndpoint<SessionUser>('auth.me'),
  /** Demonstration mode: the seeded demo accounts behind the role selector. */
  demoAccounts: () => callEndpoint<DemoAccount[]>('auth.demoAccounts'),
  /** Demonstration mode: open a session for a demo account, without a password. */
  demoSession: (body: DemoSessionRequest) =>
    callEndpoint<LoginResponse>('auth.demoSession', {}, { body }),
};
