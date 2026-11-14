import { create } from 'zustand';
import type { RealtimeStatus } from '@/features/realtime/client';

/** UI-only state. Server data lives in TanStack Query. */
interface UiState {
  /** Astronaut chosen in the header by roles that view crew data. */
  selectedAstronautId: string | null;
  mobileNavOpen: boolean;
  realtimeStatus: RealtimeStatus | null;
  setRealtimeStatus: (s: RealtimeStatus) => void;
  selectAstronaut: (id: string | null) => void;
  setMobileNavOpen: (open: boolean) => void;
}

export const useUi = create<UiState>()((set) => ({
  selectedAstronautId: null,
  mobileNavOpen: false,
  realtimeStatus: null,
  setRealtimeStatus: (s) => set({ realtimeStatus: s }),
  selectAstronaut: (id) => set({ selectedAstronautId: id }),
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
}));
