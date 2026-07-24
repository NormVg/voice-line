import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "voice-line",
  description: "The real-time voice layer for AI agents",
  
  // Clean URLs (no .html extensions)
  cleanUrls: true,

  // Default theme is beautiful, let's configure it
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: '/logo.svg', // We will skip the logo image file for now, or you can add one later
    
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'API Reference', link: '/api/core' }
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is voice-line?', link: '/guide/introduction' },
          { text: 'Getting Started', link: '/guide/getting-started' }
        ]
      },
      {
        text: 'Core Concepts',
        items: [
          { text: 'Transports (WS & Ably)', link: '/guide/transports' },
          { text: 'Providers (STT & TTS)', link: '/guide/providers' },
          { text: 'Brain Adapters', link: '/guide/brain-adapters' },
          { text: 'Frontend Integration', link: '/guide/frontend' }
        ]
      },
      {
        text: 'API Reference',
        items: [
          { text: '@voice-line/core', link: '/api/core' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/NormVg/voice-line' }
    ],

    search: {
      provider: 'local'
    },
    
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present voice-line'
    }
  }
})
