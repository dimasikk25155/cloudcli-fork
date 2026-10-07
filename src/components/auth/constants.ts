export const AUTH_TOKEN_STORAGE_KEY = 'auth-token';

export const AUTH_ERROR_MESSAGES = {
  authStatusCheckFailed: 'Failed to check authentication status',
  loginFailed: 'Login failed',
  registrationFailed: 'Registration failed',
  networkError: 'Network error. Please try again.',
  storageFull: 'Browser storage is full, the session could not be saved. Clear this site\'s data and sign in again.',
} as const;
