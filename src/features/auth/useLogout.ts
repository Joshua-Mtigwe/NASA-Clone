import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { authApi } from '@/api/auth';
import { useUi } from '@/features/shell/uiStore';
import { useSession } from './sessionStore';

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The local session ends regardless; the server token expires on its own.
    }
    useSession.getState().clear();
    useUi.getState().selectAstronaut(null);
    queryClient.clear();
    void navigate('/login', { replace: true });
  }, [navigate, queryClient]);
}
