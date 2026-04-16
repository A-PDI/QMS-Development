import { PublicClientApplication, LogLevel } from '@azure/msal-browser'

const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID

// True only when both credentials are present and look like GUIDs (not placeholders)
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isEntraConfigured =
  !!tenantId && !!clientId && GUID_RE.test(tenantId) && GUID_RE.test(clientId)

export const loginRequest = {
  scopes: ['openid', 'profile', 'User.Read'],
}

// msalInstance is null when Entra credentials are not configured.
// Components must check isEntraConfigured before using MSAL hooks.
export let msalInstance = null

if (isEntraConfigured) {
  const msalConfig = {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: {
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false,
    },
    system: {
      loggerOptions: {
        loggerCallback: (level, message, containsPii) => {
          if (containsPii) return
          if (import.meta.env.DEV && level === LogLevel.Error) {
            console.error('[MSAL]', message)
          }
        },
      },
    },
  }

  try {
    msalInstance = new PublicClientApplication(msalConfig)
  } catch (err) {
    console.error('[MSAL] Failed to initialise — falling back to local auth:', err.message)
  }
} else {
  if (import.meta.env.DEV) {
    console.info(
      '[Auth] Running in local mode (no VITE_ENTRA_TENANT_ID / VITE_ENTRA_CLIENT_ID). ' +
      'Sign in with email + password.'
    )
  }
}
