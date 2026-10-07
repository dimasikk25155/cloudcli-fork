import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { IS_PLATFORM } from '../../../constants/config';
import { api } from '../../../utils/api';
import { AUTH_ERROR_MESSAGES, AUTH_TOKEN_STORAGE_KEY } from '../constants';
import type {
  AuthActionResult,
  AuthContextValue,
  AuthProviderProps,
  AuthSessionPayload,
  AuthStatusPayload,
  AuthUser,
  AuthUserPayload,
  OnboardingStatusPayload,
} from '../types';
import { safeLocalStorage } from '../../chat/utils/chatStorage';
import { parseJsonSafely, resolveApiErrorMessage } from '../utils';

const AuthContext = createContext<AuthContextValue | null>(null);

const readStoredToken = (): string | null => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

// A full localStorage (drafts, queued messages with images) makes setItem throw.
// The old expired token then stays behind, every request after login gets 403
// and the user is bounced back to the login form. Drop the stale token first,
// free disposable chat data on quota errors, and confirm the write.
const persistToken = (token: string): boolean => {
  try {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // ignore: the write below reports the real outcome
  }
  safeLocalStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  return safeLocalStorage.getItem(AUTH_TOKEN_STORAGE_KEY) === token;
};

const clearStoredToken = () => {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [terminalDisabled, setTerminalDisabled] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSession = useCallback((nextUser: AuthUser, nextToken: string): boolean => {
    if (!persistToken(nextToken)) {
      return false;
    }
    setUser(nextUser);
    setToken(nextToken);
    return true;
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    clearStoredToken();
  }, []);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonSafely<OnboardingStatusPayload>(response);
      setHasCompletedOnboarding(Boolean(payload?.hasCompletedOnboarding));
    } catch (caughtError) {
      console.error('Error checking onboarding status:', caughtError);
      // Fail open to avoid blocking access on transient onboarding status errors.
      setHasCompletedOnboarding(true);
    }
  }, []);

  const refreshOnboardingStatus = useCallback(async () => {
    await checkOnboardingStatus();
  }, [checkOnboardingStatus]);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const statusResponse = await api.auth.status();
      const statusPayload = await parseJsonSafely<AuthStatusPayload>(statusResponse);

      setTerminalDisabled(Boolean(statusPayload?.terminalDisabled));

      if (statusPayload?.needsSetup) {
        setNeedsSetup(true);
        return;
      }

      setNeedsSetup(false);

      if (!token) {
        return;
      }

      const sentToken = readStoredToken();
      const userResponse = await api.auth.user();
      if (userResponse.status === 401 || userResponse.status === 403) {
        // A login that finished while this check was in flight has already
        // stored a new token; the rejection is about the old one.
        const storedToken = readStoredToken();
        if (storedToken && storedToken !== sentToken) {
          setToken(storedToken);
          return;
        }
        clearSession();
        return;
      }
      if (!userResponse.ok) {
        // Proxy hiccups (502/504) must not throw a valid session away.
        setError(AUTH_ERROR_MESSAGES.authStatusCheckFailed);
        return;
      }

      const userPayload = await parseJsonSafely<AuthUserPayload>(userResponse);
      if (!userPayload?.user) {
        clearSession();
        return;
      }

      setUser(userPayload.user);
      await checkOnboardingStatus();
    } catch (caughtError) {
      console.error('[Auth] Auth status check failed:', caughtError);
      setError(AUTH_ERROR_MESSAGES.authStatusCheckFailed);
    } finally {
      setIsLoading(false);
    }
  }, [checkOnboardingStatus, clearSession, token]);

  useEffect(() => {
    if (IS_PLATFORM) {
      setUser({ username: 'platform-user' });
      setNeedsSetup(false);
      void checkOnboardingStatus().finally(() => {
        setIsLoading(false);
      });
      return;
    }

    void checkAuthStatus();
  }, [checkAuthStatus, checkOnboardingStatus]);

  const login = useCallback<AuthContextValue['login']>(
    async (username, password) => {
      try {
        setError(null);
        const response = await api.auth.login(username, password);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        if (!response.ok || !payload?.token || !payload.user) {
          const message = resolveApiErrorMessage(payload, AUTH_ERROR_MESSAGES.loginFailed);
          setError(message);
          return { success: false, error: message };
        }

        if (!setSession(payload.user, payload.token)) {
          setError(AUTH_ERROR_MESSAGES.storageFull);
          return { success: false, error: AUTH_ERROR_MESSAGES.storageFull };
        }
        setNeedsSetup(false);
        await checkOnboardingStatus();
        return { success: true };
      } catch (caughtError) {
        console.error('Login error:', caughtError);
        setError(AUTH_ERROR_MESSAGES.networkError);
        return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
      }
    },
    [checkOnboardingStatus, setSession],
  );

  const register = useCallback<AuthContextValue['register']>(
    async (username, password) => {
      try {
        setError(null);
        const response = await api.auth.register(username, password);
        const payload = await parseJsonSafely<AuthSessionPayload>(response);

        if (!response.ok || !payload?.token || !payload.user) {
          const message = resolveApiErrorMessage(payload, AUTH_ERROR_MESSAGES.registrationFailed);
          setError(message);
          return { success: false, error: message };
        }

        if (!setSession(payload.user, payload.token)) {
          setError(AUTH_ERROR_MESSAGES.storageFull);
          return { success: false, error: AUTH_ERROR_MESSAGES.storageFull };
        }
        setNeedsSetup(false);
        await checkOnboardingStatus();
        return { success: true };
      } catch (caughtError) {
        console.error('Registration error:', caughtError);
        setError(AUTH_ERROR_MESSAGES.networkError);
        return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
      }
    },
    [checkOnboardingStatus, setSession],
  );

  const restartOnboarding = useCallback(async (): Promise<AuthActionResult> => {
    try {
      const response = await api.user.resetOnboarding();
      if (!response.ok) {
        return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
      }
      setHasCompletedOnboarding(false);
      return { success: true };
    } catch (caughtError) {
      console.error('Error resetting onboarding:', caughtError);
      return { success: false, error: AUTH_ERROR_MESSAGES.networkError };
    }
  }, []);

  const logout = useCallback(() => {
    const tokenToInvalidate = token;
    clearSession();

    if (tokenToInvalidate) {
      void api.auth.logout().catch((caughtError: unknown) => {
        console.error('Logout endpoint error:', caughtError);
      });
    }
  }, [clearSession, token]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      needsSetup,
      terminalDisabled,
      hasCompletedOnboarding,
      error,
      login,
      register,
      logout,
      refreshOnboardingStatus,
      restartOnboarding,
    }),
    [
      error,
      hasCompletedOnboarding,
      isLoading,
      login,
      logout,
      needsSetup,
      terminalDisabled,
      refreshOnboardingStatus,
      restartOnboarding,
      register,
      token,
      user,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
