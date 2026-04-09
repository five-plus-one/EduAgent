# EduAgent 默认图库导入教程（开发者版）

本教程面向参赛团队的开发者，说明如何在演示前将教学图片批量导入"默认图片库"，
使 AI 生成 PPT 时能自动配图，无需用户手动上传任何图片。

---

## 第一步：配置 Admin 密钥

打开后端目录下的 `.env` 文件（`d:\MyProject\Repos\EduAgent\Backend\.env`），
追加以下配置项：

```
ADMIN_SECRET_KEY=EduAgent2026Demo
VISION_MODEL=doubao-vision-pro-32k
```

> [!NOTE]
> ADMIN_SECRET_KEY 是访问图库管理接口的唯一凭证，只有开发者知道。
> 前端完全没有调用这些接口的入口，普通用户察觉不到图库的存在。

如果你使用的 Vision 模型不是 doubao，可按实际情况修改 VISION_MODEL。
支持任何 OpenAI-compatible 的 Vision 接口（消息体含 image_url 字段的模型）。

---

## 第二步：准备图片文件

建议按学科分文件夹组织：

```
d:\MyProject\Repos\EduAgent\Backend\uploads\image_library\
├── physics\          ← 物理学科图片
│   ├── newton_apple.jpg
│   ├── pendulum.png
│   └── circuit.jpg
├── math\             ← 数学学科图片
│   ├── parabola.png
│   └── integral_curve.jpg
├── chemistry\        ← 化学学科图片
│   └── periodic_table.jpg
└── general\          ← 通用教学图片（默认分类）
    ├── classroom.jpg
    └── timeline.png
```

图片要求：
- 格式：JPG、PNG、WebP（推荐 JPG，文件小，兼容性最好）
- 分辨率：建议 800×600 以上，PPT 中清晰显示
- 内容：教学示意图、实验图、知识结构图效果最佳；避免纯文字截图

---

## 第三步：启动后端服务

```bash
cd d:\MyProject\Repos\EduAgent\Backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

等待看到以下输出后，服务就绪：
```
INFO:     Application startup complete.
```

> [!IMPORTANT]
> 第一次启动时，SQLAlchemy 会自动创建 `session_image` 和 `image_library` 两张新表。
> 无需手动执行任何建表 SQL。

---

## 第四步（方式A）：批量导入 — 推荐用于演示前准备

把所有图片放好后，用 Postman 或 curl 调用批量扫描接口，一次导入整个目录：

### 使用 Postman

1. Method: **POST**
2. URL: `http://localhost:8000/api/v1/admin/image-library/batch`
3. Headers:
   ```
   X-Admin-Key: EduAgent2026Demo
   Content-Type: application/json
   ```
4. Body (raw JSON):
   ```json
   {
     "scan_dir": "uploads/image_library/physics",
     "category": "physics",
     "import_note": "物理教学图集 v1"
   }
   ```
5. Send → 响应示例：
   ```json
   {
     "queued": 8,
     "skipped": 0,
     "task_id": "batch_a3f9b21c"
   }
   ```

对每个学科目录重复操作（改 scan_dir 和 category）。

### 使用 curl（Windows PowerShell）

```powershell
# 导入物理学科图片
Invoke-RestMethod -Method POST `
  -Uri "http://localhost:8000/api/v1/admin/image-library/batch" `
  -Headers @{ "X-Admin-Key" = "EduAgent2026Demo"; "Content-Type" = "application/json" } `
  -Body '{"scan_dir":"uploads/image_library/physics","category":"physics","import_note":"物理教学图集"}' | ConvertTo-Json

# 导入数学学科图片
Invoke-RestMethod -Method POST `
  -Uri "http://localhost:8000/api/v1/admin/image-library/batch" `
  -Headers @{ "X-Admin-Key" = "EduAgent2026Demo"; "Content-Type" = "application/json" } `
  -Body '{"scan_dir":"uploads/image_library/math","category":"math","import_note":"数学图集"}' | ConvertTo-Json

# 导入通用图片
Invoke-RestMethod -Method POST `
  -Uri "http://localhost:8000/api/v1/admin/image-library/batch" `
  -Headers @{ "X-Admin-Key" = "EduAgent2026Demo"; "Content-Type" = "application/json" } `
  -Body '{"scan_dir":"uploads/image_library/general","category":"general","import_note":"通用图集"}' | ConvertTo-Json
```

---

## 第四步（方式B）：单张导入 — 用于精细控制

逐张上传，适合只有几张关键图时：

### Postman

1. Method: **POST**
2. URL: `http://localhost:8000/api/v1/admin/image-library`
3. Headers: `X-Admin-Key: EduAgent2026Demo`
4. Body: **form-data**
   | Key | Value |
   |---|---|
   | `file` | （选择本地图片文件）|
   | `category` | `physics` |
   | `import_note` | 牛顿苹果树插图 |

5. 响应示例：
   ```json
   {
     "lib_id": "lib_3f8a1b2c",
     "filename": "newton_apple.jpg",
     "category": "physics",
     "annotate_status": "pending"
   }
   ```

### curl（PowerShell）

```powershell
$form = @{
    file       = Get-Item "d:\MyImages\newton_apple.jpg"
    category   = "physics"
    import_note = "牛顿苹果树引力插图"
}
Invoke-RestMethod -Method POST `
  -Uri "http://localhost:8000/api/v1/admin/image-library" `
  -Headers @{ "X-Admin-Key" = "EduAgent2026Demo" } `
  -Form $form | ConvertTo-Json
```

---

## 第五步：等待 Vision LLM 自动标注

图片导入后，后台会自动调用 Vision LLM 为每张图生成：
- **描述**（30字内，如"牛顿站在苹果树下、苹果落下的黑白手绘教学插图"）
- **标签**（5-8个，如 ["牛顿", "苹果", "引力", "经典物理", "手绘"]）

标注完成后，描述+标签被向量化存入 ChromaDB，之后的图片检索基于向量相似度，
**不需要遍历图库**。

### 查看标注进度

```powershell
Invoke-RestMethod -Method GET `
  -Uri "http://localhost:8000/api/v1/admin/image-library?page=1&size=50" `
  -Headers @{ "X-Admin-Key" = "EduAgent2026Demo" } | ConvertTo-Json -Depth 5
```

响应中每条记录的 `annotate_status` 字段：

| 状态 | 含义 |
|---|---|
| `pending` | 等待标注 |
| `processing` | 正在调用 Vision LLM |
| `done` | 标注完成，已入向量库，可被检索 |
| `failed` | 标注失败（网络/模型问题）|

> [!IMPORTANT]
> **只有 `done` 状态的图片才能被 AI 检索到。**
> 请在演示前确认所有关键图片都是 done 状态。

### 筛选只看已完成的

```powershell
Invoke-RestMethod -Method GET `
  -Uri "http://localhost:8000/api/v1/admin/image-library?annotate_status=done&size=100" `
  -Headers @{ "X-Admin-Key" = "EduAgent2026Demo" } | ConvertTo-Json -Depth 5
```

---

## 第六步：验证图片预览（可选）

在浏览器直接访问（需先设置请求头，可用 ModHeader 插件或 Postman）：

```
GET http://localhost:8000/api/v1/admin/image-library/{lib_id}/preview
Header: X-Admin-Key: EduAgent2026Demo
```

或用 PowerShell 下载检查：

```powershell
Invoke-WebRequest `
  -Uri "http://localhost:8000/api/v1/admin/image-library/lib_3f8a1b2c/preview" `
  -Headers @{ "X-Admin-Key" = "EduAgent2026Demo" } `
  -OutFile "check_img.jpg"
Start-Process "check_img.jpg"   # 打开查看
```

---

## 第七步：生成 PPT 验证效果

1. 用前端界面正常走一次生成流程（无需上传图片）
2. 在 two_column 布局的幻灯片中，如果 AI 认为需要图片，会自动触发检索
3. 观察 PPT 预览卡片：
   - 命中图库 → 显示真实图片 + 来源徽章"系统图库"
   - 无匹配 → 显示灰色占位框（查询词文字）

---

## 常见问题

### Q: 标注失败怎么办？
调用重试接口（以单张 lib 图片无此接口为例，也可删除后重新上传）：
```powershell
# 先删除标注失败的图
Invoke-RestMethod -Method DELETE `
  -Uri "http://localhost:8000/api/v1/admin/image-library/lib_xxxxxxxx" `
  -Headers @{ "X-Admin-Key" = "EduAgent2026Demo" }

# 然后重新单张导入
```

### Q: 批量导入显示 skipped 不为 0？
`skipped` 表示该文件名已存在于数据库中，跳过了重复导入。这是正常的幂等行为，
无需担心。

### Q: 图片多大会导致 Vision 请求出错？
Vision 模型通常限制输入图片不超过 20MB（base64 约 27MB）。建议单张图不超过 5MB。
超大图片会导致标注 `failed`，请压缩后重试。

### Q: 能否手动指定图片的描述和标签，不用 AI 自动生成？
当前版本不支持手动覆盖。可在标注完成后，直接修改 SQLite 数据库的
`image_library.description` 和 `image_library.tags` 字段，然后：
1. 使用 DB Browser for SQLite 打开 `edu_agent.db`
2. 修改 `description` 和 `tags`（tags 为 JSON 数组格式 `["tag1","tag2"]`）
3. 重新触发向量化（目前需要删除后重新导入，或直接操作 ChromaDB 更新向量）

---

## 演示前检查清单

- [ ] `.env` 中 `ADMIN_SECRET_KEY` 已设置为非默认值
- [ ] `.env` 中 `VISION_MODEL` 已确认为可用的 Vision 模型
- [ ] 所有图片放入 `uploads/image_library/` 对应子目录
- [ ] 后端启动成功，新表已创建
- [ ] 批量导入请求返回 `queued > 0`
- [ ] 查询列表确认所有关键图片 `annotate_status = done`
- [ ] 手动生成一页 PPT，验证图片正常出现

---

*文档版本: v1.0 | 日期: 2026-04-07 | 适用环境: EduAgent 后端 v1.1+*
