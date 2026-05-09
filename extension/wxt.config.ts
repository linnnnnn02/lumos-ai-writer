import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Lumos AI Writer',
    description: '采集小红书笔记，沉淀参考库，并在网页端完成 AI 文案学习、生成与改写。',
    permissions: ['storage', 'tabs', 'activeTab', 'scripting', 'sidePanel'],
    host_permissions: [
      'https://www.xiaohongshu.com/*',
      'http://localhost:8788/*',
      'https://*.supabase.co/*',
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval' http://localhost:3000 http://localhost:3001; connect-src 'self' http://localhost:8788 https://*.supabase.co; object-src 'self';",
      sandbox:
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:3000 http://localhost:3001; sandbox allow-scripts allow-forms allow-popups allow-modals; child-src 'self';",
    },
    action: {
      default_title: 'Lumos AI Writer',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
})
