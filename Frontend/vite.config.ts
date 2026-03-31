import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 影子后端 Mock 插件：高性能、全自动、零越权
const mockSsePlugin = () => ({
  name: 'mock-sse',
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      // 捕获所有 Mock 路由
      const isMockRoute = req.url && (
        req.url.includes('/generate/stream') || 
        req.url.includes('/auth/login') || 
        req.url.includes('/auth/me') || 
        req.url.includes('/sessions') || 
        req.url.includes('/courseware/preview')
      );

      if (isMockRoute) {
        // 显式支持所有 Origin
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
        
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
      }

      // 1. Mock SSE Stream (协议级还原)
      if (req.url && req.url.includes('/generate/stream') && req.method === 'POST') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const send = (data: any) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        send({ event: "generate_start", data: { total_hint: 3, theme: { primary: "#1a73e8" } } });
        
        setTimeout(() => {
          send({ event: "page_chunk", data: { page_index: 0, layout_type: "cover", title: "影子验证：封面页" } });
        }, 1500);
        
        setTimeout(() => {
          send({ event: "page_chunk", data: { page_index: 1, layout_type: "content", title: "影子验证：技术路线" } });
        }, 3500);
        
        setTimeout(() => {
          send({ event: "generate_done", data: { total_pages: 2 } });
          res.end();
        }, 5000);
        return;
      }
      
      // 2. Mock Preview (解决路由碰撞，优先匹配长路径)
      if (req.url && req.url.includes('/courseware/preview') && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          data: {
            pages: [
              { page_index: 0, layout_type: "cover", title: "影子验证：封面页 (同步态)", elements: [] },
              { page_index: 1, layout_type: "content", title: "影子验证：技术路线 (同步态)", elements: [] }
            ],
            word_markdown: "# 影子验证文档\n已完成全链路闭环验证。"
          }
        }));
        return;
      }

      // 3. Mock Login
      if (req.url && req.url.includes('/auth/login') && req.method === 'POST') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: { access_token: 'mock_token_12345' } }));
        return;
      }

      // 4. Mock Profile
      if (req.url && req.url.includes('/auth/me') && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: { user_id: 'test_u', username: '12345678', name: '测试老师' } }));
        return;
      }

      // 5. Mock Sessions List/Detail (最后匹配)
      if (req.url && req.url.includes('/sessions') && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          data: req.url.match(/\/sessions\/[^\/]+$/) 
            ? { session_id: 'sess_streaming', course_name: '影子验证会话' }
            : [{ session_id: 'sess_streaming', course_name: '影子验证会话', updated_at: new Date().toISOString() }]
        }));
        return;
      }

      next();
    });
  }
});

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
