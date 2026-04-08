import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 加载当前 mode（development / production）对应的 .env 文件
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  const backendOrigin = env.VITE_BACKEND_ORIGIN || 'http://localhost:8000'

  return {
    plugins: [react()],
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
