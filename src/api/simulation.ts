import type { SimulationEventsRow, SimulationRunsRow } from '@/types/tables';
import { callEndpoint } from './client';
import type { CreateSimulationRunRequest, MissionState, UpdateSimulationRunRequest } from './types';

export const simulationApi = {
  listRuns: () => callEndpoint<SimulationRunsRow[]>('simulation.listRuns'),
  createRun: (body: CreateSimulationRunRequest) =>
    callEndpoint<SimulationRunsRow>('simulation.createRun', {}, { body }),
  updateRun: (runId: string, body: UpdateSimulationRunRequest) =>
    callEndpoint<SimulationRunsRow>('simulation.updateRun', { runId }, { body }),
  startRun: (runId: string) => callEndpoint<SimulationRunsRow>('simulation.startRun', { runId }),
  pauseRun: (runId: string) => callEndpoint<SimulationRunsRow>('simulation.pauseRun', { runId }),
  selectRun: (runId: string) => callEndpoint<MissionState>('simulation.selectRun', { runId }),
  listEvents: (query: { simulation_run_id?: string; mission_day?: number } = {}) =>
    callEndpoint<SimulationEventsRow[]>('simulation.listEvents', {}, { query }),
  triggerEvent: (eventId: string) =>
    callEndpoint<SimulationEventsRow>('simulation.triggerEvent', { eventId }),
  /** Reset to the known presentation state (mission day 25, paused, fresh data). */
  demoStory: () => callEndpoint<MissionState>('simulation.demoStory'),
};
