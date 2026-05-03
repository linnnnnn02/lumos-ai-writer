import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'XHS AI Studio',
    description: '采集小红书笔记，并在网页端完成 AI 分析与创作。',
    permissions: ['storage', 'tabs', 'activeTab', 'scripting', 'sidePanel'],
    host_permissions: ['https://www.xiaohongshu.com/*'],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval' http://localhost:3000 http://localhost:3001; object-src 'self';",
      sandbox:
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:3000 http://localhost:3001; sandbox allow-scripts allow-forms allow-popups allow-modals; child-src 'self';",
    },
    action: {
      default_title: 'XHS AI Studio',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
})
