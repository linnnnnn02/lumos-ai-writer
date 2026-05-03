import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SidepanelApp } from './SidepanelApp'
import './sidepanel.css'
import '../../components/ui/shadcn.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidepanelApp />
  </StrictMode>,
)
