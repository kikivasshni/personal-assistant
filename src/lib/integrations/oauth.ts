import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { getJsonSecret, getSecret, SecretKey, setJsonSecret } from '../secrets';

WebBrowser.maybeCompleteAuthSession();

// OAuth 2 with PKCE for Microsoft and Google. No client secret is needed:
// both are registered as public/native clients.

type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number };

export type Provider = {
  name: string;
  clientIdKey: SecretKey;
  tokenKey: SecretKey;
  scopes: string[];
  discovery: AuthSession.DiscoveryDocument;
  redirectUri: (clientId: string) => string;
  extraParams?: Record<string, string>;
};

export const MICROSOFT: Provider = {
  name: 'Microsoft',
  clientIdKey: 'msClientId',
  tokenKey: 'msTokens',
  scopes: ['openid', 'offline_access', 'User.Read', 'Tasks.ReadWrite'],
  discovery: {
    authorizationEndpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  },
  redirectUri: () => AuthSession.makeRedirectUri({ scheme: 'oracle', path: 'auth' }),
};

// Google: use an OAuth client of type "iOS" (works on Android through the
// browser). Its redirect is the reversed client ID, which must also be listed
// under "scheme" in app.json. See README.
export const GOOGLE: Provider = {
  name: 'Google',
  clientIdKey: 'googleClientId',
  tokenKey: 'googleTokens',
  scopes: ['openid', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
  discovery: {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  },
  redirectUri: (clientId) => `${googleScheme(clientId)}:/oauthredirect`,
  extraParams: { access_type: 'offline', prompt: 'consent' },
};

export function googleScheme(clientId: string) {
  return `com.googleusercontent.apps.${clientId.replace('.apps.googleusercontent.com', '')}`;
}

export async function connect(p: Provider): Promise<void> {
  const clientId = await getSecret(p.clientIdKey);
  if (!clientId) throw new Error(`Add your ${p.name} client ID first.`);
  const redirectUri = p.redirectUri(clientId);
  const request = new AuthSession.AuthRequest({
    clientId,
    scopes: p.scopes,
    redirectUri,
    usePKCE: true,
    extraParams: p.extraParams,
  });
  const result = await request.promptAsync(p.discovery);
  if (result.type !== 'success') throw new Error(`${p.name} sign-in was ${result.type}.`);
  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      code: result.params.code,
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier ?? '' },
    },
    p.discovery,
  );
  await save(p, token);
}

async function save(p: Provider, t: AuthSession.TokenResponse, previousRefresh?: string) {
  const tokens: Tokens = {
    accessToken: t.accessToken,
    refreshToken: t.refreshToken ?? previousRefresh,
    expiresAt: Date.now() + (t.expiresIn ?? 3600) * 1000 - 60_000,
  };
  await setJsonSecret(p.tokenKey, tokens);
}

export async function isConnected(p: Provider): Promise<boolean> {
  return !!(await getJsonSecret<Tokens>(p.tokenKey));
}

export async function disconnect(p: Provider) {
  await setJsonSecret(p.tokenKey, null);
}

export async function accessToken(p: Provider): Promise<string> {
  const t = await getJsonSecret<Tokens>(p.tokenKey);
  if (!t) throw new Error(`${p.name} isn't connected. Connect it in Settings.`);
  if (Date.now() < t.expiresAt) return t.accessToken;
  if (!t.refreshToken) throw new Error(`${p.name} sign-in expired. Reconnect it in Settings.`);
  const clientId = (await getSecret(p.clientIdKey)) ?? '';
  const fresh = await AuthSession.refreshAsync(
    { clientId, refreshToken: t.refreshToken, scopes: p.scopes },
    p.discovery,
  );
  await save(p, fresh, t.refreshToken);
  return fresh.accessToken;
}

export async function authedFetch(p: Provider, url: string, init: RequestInit = {}) {
  const token = await accessToken(p);
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${p.name} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}
