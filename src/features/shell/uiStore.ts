import { create } from 'zustand';
import type { RealtimeStatus } from '@/features/realtime/client';

/** UI-only state. Server data lives in TanStack Query. */
interface UiState {
  /** Astronaut chosen in the header by roles that view crew data. */
  selectedAstronautId: string | null;
  mobileNavOpen: boolean;
  /** Sidebar groups the user has expanded (ids from NAV). */
  expandedNavGroups: string[];
  setNavGroupExpanded: (id: string, open: boolean) => void;
  realtimeStatus: RealtimeStatus | null;
  setRealtimeStatus: (s: RealtimeStatus) => void;
  selectAstronaut: (id: string | null) => void;
  setMobileNavOpen: (open: boolean) => void;
}

export const useUi = create<UiState>()((set) => ({
  selectedAstronautId: null,
  mobileNavOpen: false,
  expandedNavGroups: [],
  setNavGroupExpanded: (id, open) =>
    set((s) => {
      const has = s.expandedNavGroups.includes(id);
      if (open === has) return s;
      return {
        expandedNavGroups: open
          ? [...s.expandedNavGroups, id]
          : s.expandedNavGroups.filter((g) => g !== id),
      };
    }),
  realtimeStatus: null,
  setRealtimeStatus: (s) => set({ realtimeStatus: s }),
  selectAstronaut: (id) => set({ selectedAstronautId: id }),
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
}));
