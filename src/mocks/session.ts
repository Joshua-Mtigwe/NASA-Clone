/** Mock authentication: demo accounts come from users.csv, roles.csv and astronauts.csv. */
import type { Role, SessionUser } from '@/api/types';
import { MOCK_DEMO_PASSWORD } from '@/features/auth/demo';
import { mockState, table } from './db';

/** Every seeded demo account uses this password in mock mode. */
export { MOCK_DEMO_PASSWORD };

const TOKEN_PREFIX = 'mock-token.';

export function tokenFor(userId: string): string {
  return `${TOKEN_PREFIX}${userId}`;
}

export async function findUserByUsername(username: string): Promise<SessionUser | null> {
  const users = await table('users');
  const user = users.find((u) => u.username === username && u.account_status === 'active');
  return user ? toSessionUser(user.user_id) : null;
}

export async function toSessionUser(userId: string): Promise<SessionUser | null> {
  const [users, roles, astronauts] = await Promise.all([
    table('users'),
    table('roles'),
    table('astronauts'),
  ]);
  const user = users.find((u) => u.user_id === userId);
  if (!user) return null;
  const role = roles.find((r) => r.role_id === user.role_id);
  if (!role) return null;
  const astronaut = astronauts.find((a) => a.user_id === user.user_id);
  return {
    user_id: user.user_id,
    username: user.username,
    role_id: user.role_id,
    role: role.role_name as Role,
    astronaut_id: role.role_name === 'astronaut' ? (astronaut?.astronaut_id ?? null) : null,
  };
}

export async function resolveUser(request: Request): Promise<SessionUser | null> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token.startsWith(TOKEN_PREFIX) || mockState.revokedTokens.has(token)) return null;
  return toSessionUser(token.slice(TOKEN_PREFIX.length));
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}
