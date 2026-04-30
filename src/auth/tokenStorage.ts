import { Store } from '@tauri-apps/plugin-store';

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

const STORE_FILE = 'lowspot_tokens.json';
const STORE_KEY = 'spotify_tokens';

const memoryFallback = {
  read: (): TokenSet | null => {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  },
  write: (tokens: TokenSet) => {
    localStorage.setItem(STORE_KEY, JSON.stringify(tokens));
  },
  clear: () => localStorage.removeItem(STORE_KEY),
};

const getStore = async (): Promise<Store | null> => {
  try {
    return await Store.load(STORE_FILE);
  } catch {
    return null;
  }
};

export const loadTokens = async (): Promise<TokenSet | null> => {
  const store = await getStore();

  if (!store) {
    return memoryFallback.read();
  }

  const tokenSet = await store.get<TokenSet>(STORE_KEY);
  return tokenSet ?? null;
};

export const saveTokens = async (tokens: TokenSet): Promise<void> => {
  const store = await getStore();

  if (!store) {
    memoryFallback.write(tokens);
    return;
  }

  await store.set(STORE_KEY, tokens);
  await store.save();
};

export const clearTokens = async (): Promise<void> => {
  const store = await getStore();

  if (!store) {
    memoryFallback.clear();
    return;
  }

  await store.delete(STORE_KEY);
  await store.save();
};
