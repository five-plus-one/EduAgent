import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 加载当前 mode（development / production）对应的 .env 文件
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  const backendOrigin = env.VITE_BACKEND_ORIGIN || 'http://localhost:8000'

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return

            if (id.includes('react') || id.includes('scheduler')) {
              return 'react-vendor'
            }

            if (id.includes('react-router')) {
              return 'router-vendor'
            }

            if (
              id.includes('katex')
            ) {
              return 'katex-vendor'
            }

            if (
              id.includes('react-markdown') ||
              id.includes('remark-gfm') ||
              id.includes('remark-math') ||
              id.includes('rehype-katex') ||
              id.includes('rehype-raw')
            ) {
              return 'markdown-vendor'
            }

            if (id.includes('@radix-ui')) {
              return 'radix-vendor'
            }

            if (id.includes('lucide-react')) {
              return 'icons-vendor'
            }

            return 'vendor'
          },
        },
      },
    },
    server: {
      host: true, // 监听 0.0.0.0，对局域网开放
      proxy: {
        '/api': {
          target: backendOrigin,
          changeOrigin: true,
          // Uncomment if backend doesn't use /api prefix:
          // rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
