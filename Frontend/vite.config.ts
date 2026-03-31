import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const mockSsePlugin = () => ({
  name: 'mock-sse',
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      // 0. Global CORS & OPTIONS Handling for Mocked Routes
      const isMockRoute = req.url && (
        req.url.includes('/generate/stream') || 
        req.url.includes('/auth/login') || 
        req.url.includes('/auth/me') || 
        req.url.includes('/sessions') || 
        req.url.includes('/courseware/preview')
      );

      if (isMockRoute) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
        
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
      }

      // 1. Mock SSE Stream
      if (req.url && req.url.includes('/generate/stream') && req.method === 'POST') {
        console.log('[ViteMock] Intercepting SSE Stream...');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const send = (data: any) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        send({ event: "generate_start", data: { total_hint: 3, theme: { bg_color: "#ffffff", primary: "#1a73e8", text_color: "#121212" } } });
        
        setTimeout(() => {
          send({ event: "page_chunk", data: { page_index: 0, layout_type: "cover", title: "Vite Mocked Cover", elements: [{"type": "text_block", "content": ["AI Streaming Protocol Test"], "position": "center"}] } });
        }, 1500);
        
        setTimeout(() => {
          send({ event: "page_chunk", data: { page_index: 1, layout_type: "content", title: "Incremental Rendering Architecture", elements: [{"type": "text_block", "content": ["- Zero Blocking UI", "- Native EventSource", "- Glassmorphism Skeletons"], "position": "left"}] } });
        }, 3500);
        
        setTimeout(() => {
          send({ event: "generate_done", data: { total_pages: 2 } });
          res.end();
          console.log('[ViteMock] Stream finished.');
        }, 5000);
        return;
      }
      
      // 2. Mock Login
      if (req.url && req.url.includes('/auth/login') && req.method === 'POST') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          data: { access_token: 'mock_token_12345' } 
        }));
        return;
      }

      // 3. Mock Profile
      if (req.url && req.url.includes('/auth/me') && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          data: { user_id: 'test_u', username: '12345678', name: '测试老师' } 
        }));
        return;
      }

      // 4. Mock Sessions List
      if (req.url && req.url.includes('/sessions') && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          data: [
            { session_id: 'sess_streaming', course_name: 'Live Stream Test', updated_at: new Date().toISOString() }
          ]
        }));
        return;
      }

      // 5. Mock Session Detail
      if (req.url && req.url.match(/\/sessions\/[^\/]+$/) && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          data: { session_id: 'sess_streaming', course_name: 'Live Stream Test' }
        }));
        return;
      }

      // 6. Mock regular preview endpoint
      if (req.url && req.url.includes('/courseware/preview') && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          data: {
            pages: [
              { page_index: 0, layout_type: "cover", title: "Vite Mocked Cover (Final)", elements: [] },
              { page_index: 1, layout_type: "content", title: "Incremental Rendering Architecture (Final)", elements: [] }
            ],
            word_markdown: "# Final Mocked Word Document\nReady for review."
          }
        }));
        return;
      }
      next();
    });
  }
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mockSsePlugin()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://192.168.31.157:8000',
        changeOrigin: true,
      }
    }
  }
})
