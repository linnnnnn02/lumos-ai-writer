import { createContext, useContext } from 'react'
import type { PublicConfigResponse } from '@lumos-ai/shared'
import type { Session, SupabaseClient } from '@supabase/supabase-js'

export type AuthSessionStatus =
  | 'initializing'
  | 'guest'
  | 'authenticated'
  | 'recovery-confirmation'
  | 'recovery'
  | 'recovery-success'
  | 'recovery-error'
  | 'error'

export type AuthContextValue = {
  status: AuthSessionStatus
  client: SupabaseClient | null
  config: PublicConfigResponse | null
  session: Session | null
  error: string
  confirmPasswordRecovery: () => Promise<string | null>
  completePasswordRecovery: (password: string) => Promise<string | null>
  finishPasswordRecovery: () => Promise<string | null>
  cancelPasswordRecovery: () => Promise<void>
  signOut: () => Promise<string | null>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}
