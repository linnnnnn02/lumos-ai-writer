import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/lib/auth-provider'
import { TooltipProvider } from '@/components/ui/tooltip'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </AuthProvider>
  </StrictMode>,
)
