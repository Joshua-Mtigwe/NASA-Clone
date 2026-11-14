/**
 * Who is calling. Mind Companion conversations belong to one astronaut, so every
 * request must resolve to an astronaut identity.
 *
 * Demonstration mode resolves the demo tokens issued by the role selector
 * (`mock-token.<user_id>`) against users.csv, roles.csv and astronauts.csv. That is
 * NOT secure authentication: anyone can pick a role. A production deployment must
 * replace `Authenticator` with verification of the backend's real access tokens.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from '../../scripts/csv-core';

export interface Caller {
  userId: string;
  role: string;
  astronautId: string | null;
  astronautCode: string | null;
}

export type Authenticator = (authorization: string | undefined) => Promise<Caller | null>;

const DEMO_PREFIX = 'mock-token.';

async function readTable(dir: string, name: string): Promise<Array<Record<string, string>>> {
  const { header, records } = parseCsv(await readFile(path.join(dir, `${name}.csv`), 'utf8'));
  return records.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export async function createDemoAuthenticator(csvDir: string): Promise<Authenticator> {
  const [users, roles, astronauts] = await Promise.all([
    readTable(csvDir, 'users'),
    readTable(csvDir, 'roles'),
    readTable(csvDir, 'astronauts'),
  ]);
  return async (authorization) => {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!token.startsWith(DEMO_PREFIX)) return null;
    const user = users.find(
      (u) => u.user_id === token.slice(DEMO_PREFIX.length) && u.account_status === 'active',
    );
    if (!user) return null;
    const role = roles.find((r) => r.role_id === user.role_id)?.role_name ?? '';
    const astronaut = astronauts.find((a) => a.user_id === user.user_id);
    return {
      userId: user.user_id!,
      role,
      astronautId: role === 'astronaut' ? (astronaut?.astronaut_id ?? null) : null,
      astronautCode: role === 'astronaut' ? (astronaut?.astronaut_code ?? null) : null,
    };
  };
}
