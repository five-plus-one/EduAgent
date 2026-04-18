# 互动游戏公开分享 & 短链接 API 需求文档

> **版本**: v1.0 | **日期**: 2026-04-14  
> **模块**: 互动游戏 · 公开分享系统  
> **前端对应**: `GamePanel`、路由 `/s/:code`、路由 `/play/:code`

---

## 一、需求背景与目标

### 1.1 使用场景

| 场景 | 描述 |
|------|------|
| **PPT 嵌入超链接** | 教师在 PPT 幻灯片中插入一个短链接，学生扫码/点击后用浏览器打开互动游戏，无需安装任何软件，无需登录 |
| **课堂分享** | 教师复制短链接发到群聊/投屏，学生扫码直接进入游戏 |
| **直接预览** | 在游戏预览界面一键复制分享链接，方便直接分享给他人 |

### 1.2 核心约束

- **无需登录**：分享链接必须完全公开，任何人可访问
- **短链接**：格式为 `/s/{6位code}`，便于 PPT 中插入，方便口述和扫码
- **内容简洁**：落地页只展示游戏标题 + 互动游戏内容，无多余导航
- **安全**：短链接不暴露 JWT Token，游戏内容通过 code 换取，后端控制访问权限

---

## 二、系统架构

### 2.1 完整访问链路

```
[PPT 超链接 / 用户分享]
        │
        ▼
GET /s/{code}                           ← 短链接入口（无需登录）
        │  302 重定向
        ▼
/play/{code}                            ← 前端落地页路由（React SPA）
        │  前端请求游戏内容
        ▼
GET /api/v1/public/games/share/{code}   ← 公开 API（无需登录）
        │  返回游戏标题 + HTML
        ▼
前端用 srcdoc 注入 iframe 渲染游戏
```

### 2.2 短链接生命周期

```
教师点击「生成分享链接」
        │
        ▼
POST /api/v1/games/{game_id}/share      ← 鉴权接口，创建短码
        │  返回 { code, short_url }
        ▼
短码存入数据库
game_share 表: code ↔ game_id + 过期时间 + 访问统计
        │
        ▼
GET /s/{code}  →  302 到 /play/{code}  ← 任何人可访问
```

---

## 三、数据库设计（供参考）

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | `VARCHAR(8)` PK | 随机短码，URL-safe，默认 6 位 |
| `game_id` | `VARCHAR` FK | 关联 `games.game_id` |
| `created_by` | `VARCHAR` | 创建者 user_id |
| `created_at` | `DATETIME` | 创建时间 |
| `expires_at` | `DATETIME` | 过期时间（NULL 表示永不过期） |
| `view_count` | `INT` | 访问计数 |
| `is_active` | `BOOL` | 是否有效（可手动停用） |

---

## 四、API 接口定义

### 4.1 创建分享短链接

**需要登录**

```
POST /api/v1/games/{game_id}/share
Authorization: Bearer <token>
Content-Type: application/json
```

#### 请求体（可选）

```json
{
  "expires_in_days": 30
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `expires_in_days` | `int` | ❌ | 链接有效天数；不传表示永不过期 |

#### 响应 `200`

```json
{
  "code": "a3f8kz",
  "short_url": "/s/a3f8kz",
  "full_short_url": "http://your-domain.com/s/a3f8kz",
  "game_id": "game_89721e6d",
  "game_title": "简谐振动选择题",
  "created_at": "2026-04-14T12:00:00Z",
  "expires_at": "2026-05-14T12:00:00Z"
}
```

#### 错误响应

| HTTP | code | 说明 |
|------|------|------|
| `403` | `4031` | 非游戏创建者，无权生成分享链接 |
| `404` | `4041` | game_id 不存在 |

---

### 4.2 短链接重定向

**无需登录**

```
GET /s/{code}
```

- 返回 `302 Found`，`Location: /play/{code}`
- 同时对 `view_count + 1`

#### 特殊情况

| 情况 | HTTP | 行为 |
|------|------|------|
| code 不存在 | `404` | 返回"链接不存在或已失效"页面 |
| 已过期 | `410 Gone` | 返回"链接已过期"页面 |
| is_active=false | `410 Gone` | 返回"链接已停用"页面 |

> **实现建议**：404/410 时可直接返回一个简洁 HTML 错误页，不跳转前端 SPA，减少依赖

---

### 4.3 获取分享游戏内容（公开接口，核心）

**无需登录**

```
GET /api/v1/public/games/share/{code}
```

> 这是前端落地页 `/play/{code}` 加载内容时调用的接口，**无需 Authorization**。

#### 响应 `200`

```json
{
  "code": "a3f8kz",
  "game_id": "game_89721e6d",
  "title": "简谐振动选择题",
  "game_type": "quiz",
  "html_content": "<!DOCTYPE html>...完整游戏 HTML...",
  "created_at": "2026-04-14T12:00:00Z"
}
```

| 字段 | 说明 |
|------|------|
| `html_content` | 完整的游戏 HTML 字符串，前端用 `srcdoc` 注入 `iframe` |
| `title` | 展示在落地页顶部的游戏标题 |

#### 错误响应

| HTTP | 说明 |
|------|------|
| `404` | code 不存在，前端跳到 `/s/404` 错误页 |
| `410` | 已过期或停用，前端展示对应提示 |

---

### 4.4 获取我的分享链接列表

**需要登录**

```
GET /api/v1/games/{game_id}/shares
Authorization: Bearer <token>
```

> 用于 GamePanel 中显示该游戏已生成的所有分享链接，支持管理（停用/删除）

#### 响应 `200`

```json
{
  "shares": [
    {
      "code": "a3f8kz",
      "short_url": "/s/a3f8kz",
      "created_at": "2026-04-14T12:00:00Z",
      "expires_at": "2026-05-14T12:00:00Z",
      "view_count": 42,
      "is_active": true
    }
  ]
}
```

---

### 4.5 停用分享链接

**需要登录**

```
DELETE /api/v1/games/shares/{code}
Authorization: Bearer <token>
```

响应 `200 { "ok": true }`

---

## 五、前端改动需求

### 5.1 新增路由

| 路由 | 组件 | 描述 |
|------|------|------|
| `/play/:code` | `GamePublicPage` | 公开落地页，无需登录，显示标题 + iframe游戏 |

> `/s/:code` 由后端直接 302 重定向，前端无需配置该路由

### 5.2 `GamePublicPage` 落地页设计

```
┌─────────────────────────────────────────┐
│  EduAgent  ·  互动教学                  │  ← 品牌 header（极简）
├─────────────────────────────────────────┤
│                                         │
│  📚  简谐振动选择题                      │  ← 游戏标题
│                                         │
│  ┌─────────────────────────────────────┐│
│  │                                     ││
│  │        iframe (srcdoc)              ││  ← 互动游戏内容（撑满高度）
│  │        allow-scripts 沙箱           ││
│  │                                     ││
│  └─────────────────────────────────────┘│
│                                         │
│  由 EduAgent 生成 · 互动教学平台         │  ← 品牌 footer（极简）
└─────────────────────────────────────────┘
```

**技术要求**：
- 路由加载时调用 `GET /api/v1/public/games/share/{code}`（无 auth）
- HTML 内容用 `srcdoc` 注入 `<iframe>`，sandbox=`allow-scripts allow-same-origin`
- 页面 title 设为游戏标题
- 纯静态感：无登录按钮、无导航菜单、无侧边栏

### 5.3 GamePanel 新增功能

#### A. 「复制分享链接」按钮

在游戏预览界面的操作栏中新增：

```
[👁 预览] [</> 源码]           [📋 复制链接] [↗ 新标签] [🗑 删除]
```

点击「复制链接」时：
1. 调用 `POST /api/v1/games/{game_id}/share`（若已有则复用已有的 code）
2. 复制 `full_short_url` 到剪贴板
3. 按钮显示「✓ 已复制」1.5s 后恢复

#### B. PPT 嵌入工具

在 `PPTPageWorkbench` 的工具栏新增「插入游戏链接」选项：
1. 弹出当前 session 的游戏列表（从 `listSessionGames` 获取）
2. 用户选择游戏后，自动为该游戏生成分享链接（未生成则创建）
3. 在当前 PPT 页插入超链接文本框（内容可自定义，如「点击开始互动练习 →」）

> **PPT 文本框超链接接口**：需后端提供 `POST /slideEdit/{slide_index}/insert-link`（见下方 §六）

---

## 六、附属接口（可选，PPT 嵌入功能用）

### 6.1 在 PPT 幻灯片中插入带链接的文本框

```
POST /api/v1/sessions/{session_id}/courseware/slides/{slide_index}/insert-text-link
Authorization: Bearer <token>
Content-Type: application/json
```

#### 请求体

```json
{
  "text":    "点击开始互动练习 →",
  "url":     "http://your-domain.com/s/a3f8kz",
  "x_pct":  10,
  "y_pct":  85,
  "w_pct":  35,
  "h_pct":  8,
  "font_color":  "#FFFFFF",
  "bg_color":    "#3B82F6",
  "font_size":   18,
  "bold":        true
}
```

| 字段 | 说明 |
|------|------|
| `x_pct` / `y_pct` | 文本框位置（相对幻灯片宽高的百分比） |
| `w_pct` / `h_pct` | 文本框大小（百分比） |
| `url` | 超链接目标 URL |

#### 响应 `200`

```json
{
  "slide_index": 3,
  "element_id": "link_elem_xyz",
  "preview_url": "/api/v1/sessions/{id}/courseware/preview"
}
```

---

## 七、安全设计

### 7.1 访问控制

- `/api/v1/public/games/share/{code}` **无需鉴权**，任何人可访问
- 但该接口**只返回 HTML 内容**，不返回 session_id、user_id 等敏感信息
- 短码使用 **URL-safe Base62**（`[0-9A-Za-z]`），6 位 = 56 亿种组合，枚举困难

### 7.2 防滥用

- 速率限制：`GET /api/v1/public/games/share/{code}` 限制每 IP 每分钟 60 次
- 生成短码限制：每个 game_id 最多 10 个有效分享链接
- iframe sandbox：`allow-scripts`，禁止 `allow-top-navigation` 防止落地页跳转劫持

### 7.3 短码生成算法

```python
import secrets, string
ALPHABET = string.ascii_letters + string.digits  # Base62
def generate_code(length=6) -> str:
    return ''.join(secrets.choice(ALPHABET) for _ in range(length))
```

碰撞时自动重试（数据库唯一索引约束）。

---

## 八、实现优先级

| 优先级 | 接口 / 功能 | 工作量估算 |
|--------|------------|-----------|
| **P0** | `POST /games/{id}/share` 创建短码 | 后端 1h |
| **P0** | `GET /s/{code}` 短链接重定向 | 后端 0.5h |
| **P0** | `GET /public/games/share/{code}` 公开内容接口 | 后端 1h |
| **P0** | 前端 `/play/:code` 落地页 | 前端 2h |
| **P1** | GamePanel 「复制分享链接」按钮 | 前端 1h |
| **P2** | `GET /games/{id}/shares` 链接列表 & 管理 | 后端 + 前端 2h |
| **P3** | PPT 插入超链接文本框接口 | 后端 2h + 前端 1h |

---

## 九、接口总览

| # | 方法 | 路径 | 鉴权 | 说明 |
|---|------|------|------|------|
| 1 | `POST` | `/api/v1/games/{game_id}/share` | ✅ Bearer | 创建分享短码 |
| 2 | `GET`  | `/s/{code}` | ❌ 公开 | 短链接 → 302 重定向 |
| 3 | `GET`  | `/api/v1/public/games/share/{code}` | ❌ 公开 | 获取游戏标题 + HTML |
| 4 | `GET`  | `/api/v1/games/{game_id}/shares` | ✅ Bearer | 查看分享链接列表 |
| 5 | `DELETE` | `/api/v1/games/shares/{code}` | ✅ Bearer | 停用分享链接 |
| 6 | `POST` | `/api/v1/sessions/{id}/courseware/slides/{idx}/insert-text-link` | ✅ Bearer | PPT 插入超链接文本框 |

---

## 十、前端路由变更

```
src/
├── pages/
│   ├── GamePublicPage.tsx     [新增] 公开落地页 /play/:code
│   └── Workspace.tsx          [修改] GamePanel 新增分享按钮
├── components/
│   └── GamePanel.tsx          [修改] 复制链接 + PPT嵌入入口
└── utils/
    └── gamesApi.ts            [修改] 新增 createShareLink() 等
```

### App.tsx 路由配置

```tsx
// 新增公开路由（不经过 AuthGuard）
<Route path="/play/:code" element={<GamePublicPage />} />
```

---

*文档由 Antigravity 生成，供后端同学对接实现参考。如有接口细节需调整，请在此文档中批注。*
