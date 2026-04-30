declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => {
        connect: () => Promise<boolean>;
        disconnect: () => void;
        addListener: (event: string, cb: (...args: unknown[]) => void) => void;
      };
    };
  }
}

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

export interface PlaybackSdkStatus {
  ready: boolean;
  deviceId?: string;
  message: string;
}

let sdkPromise: Promise<void> | null = null;

export const loadSpotifySdk = (): Promise<void> => {
  if (window.Spotify) {
    return Promise.resolve();
  }

  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${SDK_URL}"]`);
    if (existingScript) {
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load Spotify Web Playback SDK.'));

    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    document.body.appendChild(script);
  });

  return sdkPromise;
};

export const connectPlaybackSdk = async (
  accessToken: string,
  onStateChange: (status: PlaybackSdkStatus) => void,
): Promise<{ disconnect: () => void } | null> => {
  try {
    await loadSpotifySdk();

    if (!window.Spotify) {
      onStateChange({ ready: false, message: 'Spotify SDK unavailable in this environment.' });
      return null;
    }

    const player = new window.Spotify.Player({
      name: 'lowspot',
      getOAuthToken: (cb) => cb(accessToken),
      volume: 0.7,
    });

    player.addListener('ready', (payload) => {
      const data = payload as { device_id?: string };
      onStateChange({ ready: true, deviceId: data.device_id, message: 'Web Playback SDK ready.' });
    });

    player.addListener('initialization_error', (payload) => {
      const data = payload as { message?: string };
      onStateChange({ ready: false, message: `SDK init error: ${data.message ?? 'unknown error'}` });
    });

    player.addListener('authentication_error', (payload) => {
      const data = payload as { message?: string };
      onStateChange({ ready: false, message: `SDK auth error: ${data.message ?? 'unknown error'}` });
    });

    player.addListener('account_error', (payload) => {
      const data = payload as { message?: string };
      onStateChange({ ready: false, message: `SDK account error: ${data.message ?? 'unknown error'}` });
    });

    const ok = await player.connect();

    if (!ok) {
      onStateChange({ ready: false, message: 'Spotify SDK connection was rejected.' });
      return null;
    }

    return {
      disconnect: () => player.disconnect(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown SDK error.';
    onStateChange({ ready: false, message: `SDK unavailable: ${message}` });
    return null;
  }
};
