import { APP_NAME } from '../utils/constants';

interface LoginScreenProps {
  onLogin: () => void;
  errorMessage: string;
}

export function LoginScreen({ onLogin, errorMessage }: LoginScreenProps) {
  return (
    <div className="login-screen">
      <header>
        <h1>{APP_NAME}</h1>
        <p className="subtitle">A compact, text-first Spotify controller for daily listening.</p>
      </header>

      <div className="login-panel">
        <h2>Connect Spotify Premium</h2>
        <p>
          Set your <strong>Client ID</strong> in your environment and allowlist both Spotify callback URIs.
        </p>
        <p className="mono">VITE_SPOTIFY_CLIENT_ID=...</p>
        <p className="mono">VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/callback</p>
        <p className="mono">Spotify native callback: http://127.0.0.1:7878/callback</p>
        {errorMessage ? <p className="error">{errorMessage}</p> : null}
        <button type="button" className="primary" onClick={onLogin}>
          Log in with Spotify
        </button>
      </div>
    </div>
  );
}
