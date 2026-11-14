/**
 * Mock realtime channel (WS /api/v1/ws). Sends the mission state on connect, a
 * simulation_tick every 2 s while a run is running, and broadcasts changes made
 * through the REST mock (run control, triggered events, new alerts).
 */
import { ws } from 'msw';
import type { RealtimeMessage } from '@/api/types';
import { currentMissionState } from './compute/mission';

export const missionChannel = ws.link('*/api/v1/ws');
const TICK_MS = 2000;

export function broadcast(message: RealtimeMessage): void {
  try {
    missionChannel.broadcast(JSON.stringify(message));
  } catch {
    // No connected clients.
  }
}

export const realtimeHandlers = [
  missionChannel.addEventListener('connection', ({ client }) => {
    const send = async (type: 'mission_state' | 'simulation_tick') => {
      client.send(
        JSON.stringify({ type, payload: await currentMissionState() } satisfies RealtimeMessage),
      );
    };
    void send('mission_state');
    const timer = setInterval(() => {
      void currentMissionState().then((state) => {
        if (state.simulation_run?.status === 'running') {
          client.send(
            JSON.stringify({ type: 'simulation_tick', payload: state } satisfies RealtimeMessage),
          );
        }
      });
    }, TICK_MS);
    client.addEventListener('close', () => clearInterval(timer));
  }),
];
