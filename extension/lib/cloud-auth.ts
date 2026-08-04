import { createClient, type Session } from '@supabase/supabase-js'
import type { CurrentUser } from '@lumos-ai/shared'
import {
  CLOUD_SESSION_STORAGE_KEY,
  CLOUD_USER_STORAGE_KEY,
  getCloudPublicConfig,
  getCloudStorageValue,
  setCloudStorageValue,
} from './cloud-session'
export { getValidCloudAccessToken } from './cloud-session'

export type CloudAuthState =
  | {
      status: 'authenticated'
      user: CurrentUser
    }
  | {
      status: 'unauthenticated'
      user: null
    }

function getDisplayNameFromSession(session: Session) {
  const metadata = session.user.user_metadata ?? {}
  if (typeof metadata.name === 'string') return metadata.name
  if (typeof metadata.full_name === 'string') return metadata.full_name
  return null
}

function getAvatarUrlFromSession(session: Session) {
  const avatarUrl = session.user.user_metadata?.avatar_url
  return typeof avatarUrl === 'string' ? avatarUrl : null
}

function toCurrentUser(session: Session): CurrentUser {
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    displayName: getDisplayNameFromSession(session),
    avatarUrl: getAvatarUrlFromSession(session),
  }
}

async function createSupabaseAuthClient() {
  const config = await getCloudPublicConfig()
  if (!config.authConfigured || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('云端登录还没有配置好')
  }

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

export async function getCloudAuthState(): Promise<CloudAuthState> {
  const user = await getCloudStorageValue<CurrentUser>(CLOUD_USER_STORAGE_KEY)
  const session = await getCloudStorageValue<Session>(CLOUD_SESSION_STORAGE_KEY)

  if (!user || !session?.access_token) {
    return { status: 'unauthenticated', user: null }
  }

  return { status: 'authenticated', user }
}

async function saveCloudSession(session: Session) {
  await Promise.all([
    setCloudStorageValue(CLOUD_SESSION_STORAGE_KEY, session),
    setCloudStorageValue(CLOUD_USER_STORAGE_KEY, toCurrentUser(session)),
  ])
}

function launchGoogleAuthFlow(url: string) {
  return new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new Error(runtimeError.message || 'Google 登录窗口未能打开'))
        return
      }
      if (!redirectUrl) {
        reject(new Error('Google 登录没有返回有效结果'))
        return
      }
      resolve(redirectUrl)
    })
  })
}

export async function signInToCloudWithGoogle(): Promise<CloudAuthState> {
  const supabase = await createSupabaseAuthClient()
  const redirectTo = chrome.identity.getRedirectURL('supabase-auth')
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      scopes: 'openid email profile',
      queryParams: { prompt: 'select_account' },
    },
  })

  if (error) throw new Error(error.message)
  if (!data.url) throw new Error('Google 登录没有返回有效地址')

  const redirectUrl = await launchGoogleAuthFlow(data.url)
  const parsedRedirect = new URL(redirectUrl)
  const hashParams = new URLSearchParams(parsedRedirect.hash.replace(/^#/, ''))
  const oauthError = hashParams.get('error_description') || hashParams.get('error')
  if (oauthError) throw new Error(oauthError)

  const accessToken = hashParams.get('access_token')
  const refreshToken = hashParams.get('refresh_token')
  if (!accessToken || !refreshToken) {
    throw new Error('Google 登录没有返回有效 session')
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (sessionError) throw new Error(sessionError.message)
  if (!sessionData.session) throw new Error('Google 登录没有返回有效 session')

  await saveCloudSession(sessionData.session)
  return {
    status: 'authenticated',
    user: toCurrentUser(sessionData.session),
  }
}

export async function signOutFromCloud() {
  await Promise.all([
    setCloudStorageValue(CLOUD_SESSION_STORAGE_KEY, null),
    setCloudStorageValue(CLOUD_USER_STORAGE_KEY, null),
  ])
}
