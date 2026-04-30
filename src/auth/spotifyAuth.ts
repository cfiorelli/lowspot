import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { REQUIRED_SCOPES, SPOTIFY_ACCOUNTS_BASE } from '../utils/constants';
import { createChallenge, generateVerifier } from './pkce';
import type { TokenSet } from './tokenStorage';

const VERIFIER_KEY = 'spotify_pkce_verifier';
const STATE_KEY = 'spotify_pkce_state';
const NATIVE_REDIRECT_URI = 'http://127.0.0.1:7878/callback';

const pkceStorage = {
  read: (key: string) => localStorage.getItem(key),
  write: (key: string, value: string) => {
    localStorage.setItem(key, value);
  },
  clear: () => {
    localStorage.removeItem(VERIFIER_KEY);
    localStorage.removeItem(STATE_KEY);
  },
};

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

const requireEnv = () => {
  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
  const redirectUri = isTauri() ? NATIVE_REDIRECT_URI : import.meta.env.VITE_SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error('Missing VITE_SPOTIFY_CLIENT_ID or VITE_SPOTIFY_REDIRECT_URI');
  }

  return { clientId, redirectUri };
};

const randomState = (): string => crypto.randomUUID().replace(/-/g, '');

export const buildAuthorizeUrl = async (): Promise<string> => {
  const { clientId, redirectUri } = requireEnv();
  const verifier = generateVerifier();
  const challenge = await createChallenge(verifier);
  const state = randomState();

  pkceStorage.write(VERIFIER_KEY, verifier);
  pkceStorage.write(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: REQUIRED_SCOPES.join(' '),
    state,
  });

  return `${SPOTIFY_ACCOUNTS_BASE}/authorize?${params.toString()}`;
};

export const openAuthorizeUrl = async (url: string): Promise<void> => {
  if (isTauri()) {
    await openUrl(url);
    return;
  }

  window.location.assign(url);
};

const exchange = async (body: URLSearchParams): Promise<SpotifyTokenResponse> => {
  const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Token request failed: ${detail}`);
  }

  return (await response.json()) as SpotifyTokenResponse;
};

export const exchangeCodeForTokens = async (code: string, state?: string | null): Promise<TokenSet> => {
  const { clientId, redirectUri } = requireEnv();
  const verifier = pkceStorage.read(VERIFIER_KEY);
  const storedState = pkceStorage.read(STATE_KEY);

  if (!verifier) {
    throw new Error('PKCE verifier not found. Start login again.');
  }

  if (state && storedState && state !== storedState) {
    throw new Error('OAuth state mismatch. Start login again.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });

  const tokenData = await exchange(body);
  pkceStorage.clear();

  if (!tokenData.refresh_token) {
    throw new Error('Spotify did not return refresh token.');
  }

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    scope: tokenData.scope,
  };
};

export const refreshAccessToken = async (refreshToken: string): Promise<Partial<TokenSet>> => {
  const { clientId } = requireEnv();

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const tokenData = await exchange(body);

  return {
    accessToken: tokenData.access_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    scope: tokenData.scope,
    // Spotify rotates the refresh token on some flows — always capture it when present
    ...(tokenData.refresh_token ? { refreshToken: tokenData.refresh_token } : {}),
  };
};

export const parseCallbackUrl = (url: string): { code: string | null; state: string | null } => {
  const parsed = new URL(url);
  return {
    code: parsed.searchParams.get('code'),
    state: parsed.searchParams.get('state'),
  };
};
