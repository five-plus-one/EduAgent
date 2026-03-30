import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,   // 监听 0.0.0.0，对局域网开放
    proxy: {
      '/api': {
        target: 'http://192.168.31.157:8000',
        changeOrigin: true,
        // Uncomment if backend doesn't use /api prefix:
        // rewrite: (path) => path.replace(/^\/api/, ''),
      }
    }
  }
})
