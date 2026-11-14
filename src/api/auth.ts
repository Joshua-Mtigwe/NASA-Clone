import { callEndpoint } from './client';
import type { DemoAccount, LoginRequest, LoginResponse, SessionUser } from './types';

export const authApi = {
  login: (body: LoginRequest) => callEndpoint<LoginResponse>('auth.login', {}, { body }),
  logout: () => callEndpoint<void>('auth.logout'),
  me: () => callEndpoint<SessionUser>('auth.me'),
  /** Mock mode only: the seeded demo accounts for the login quick-select cards. */
  demoAccounts: () => callEndpoint<DemoAccount[]>('auth.demoAccounts'),
};
