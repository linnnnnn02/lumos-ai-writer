# Lumos AI Writer 前后端联调与上线计划

更新时间：2026-05-09  
适用范围：`web`、`extension`、`packages/shared`、`server/functions`

这份文档的目标不是做一个泛泛的技术选型表，而是把 Lumos AI Writer 从“本地前端原型 + 浏览器本地存储插件”推进到：

- 插件和网页端共用同一套账号体系。
- 小红书采集、标注、文案库、项目、对话、草稿都能云端持久化。
- 网页端不再使用 `demo-data`，而是读取真实用户数据。
- AI 分析、生成、改写、读者预演由真实模型完成。
- 开发、测试、预览、发版不依赖每次手动在本机开终端。
- 优先保证中国大陆用户访问速度和可用性，同时保留海外免费/低成本方案用于开发、演示或后续国际化。

> 说明：本文是工程计划，不构成法律意见。涉及备案、个人信息、数据跨境、生成式 AI 服务等事项时，需要以官方规定、平台合同和专业合规意见为准。

---

## 1. 当前项目现状

### 1.1 已经具备的能力

当前仓库是 pnpm monorepo：

- `extension`：WXT + React 浏览器插件。
- `web`：Vite + React 网页工作台。
- `packages/shared`：前后端/插件共享类型。
- `server/functions`：已有后端占位，目前只包含简单 draft outline 逻辑。

插件端已经有比较完整的真实采集链路：

- 小红书内容脚本读取标题、作者、链接、封面、正文。
- 用户在小红书正文选中文字后，可以发送到插件右侧边栏。
- 右侧边栏可以选文件夹、改文件名、打颜色标签、填写标注理由。
- 管理页可以查看文件夹、笔记、标注，支持搜索、排序、标签筛选、回收站。
- 插件数据目前保存在 `chrome.storage.local`。

网页端已经有比较完整的创作流程原型：

- 项目列表。
- 项目内多对话。
- 选择参考文案。
- 学习拆解。
- 篇幅设置。
- 文案创作。
- 编辑细调。
- 读者预演。

### 1.2 最大问题

现在最大的问题是：**产品逻辑连贯，但工程数据没有打通。**

具体表现：

- 插件保存真实素材，但只存在浏览器本地。
- 网页端显示的是 `web/src/lib/demo-data.ts` 里的 demo 数据。
- 网页端的 AI 分析、草稿、改写、读者预演都是本地模拟逻辑。
- 没有真实账号体系。
- 没有云数据库。
- 没有真实 API。
- 没有线上可访问的 staging/prod 环境。
- 没有 CI 自动部署、预览环境、插件构建产物。
- 没有 AI Key 管理、成本控制、用量记录。

---

## 2. 总体架构建议

### 2.1 推荐主线：大陆正式生产环境

优先推荐这一套作为正式产品主线：

```text
用户浏览器
  ├─ Web App: React SPA
  └─ Browser Extension: WXT MV3

中国大陆云资源
  ├─ 静态网页托管: 阿里云 OSS + CDN 或腾讯云 COS + CDN
  ├─ API 服务: 阿里云函数计算 FC / SAE，或腾讯云云函数 SCF / CloudBase 云函数
  ├─ 数据库: PostgreSQL 托管数据库
  ├─ 对象存储: OSS/COS，用于附件、导出文件、图片缓存
  ├─ 日志监控: SLS/CLS + 前端错误上报
  └─ 密钥管理: KMS/Secrets Manager

账号体系
  ├─ Authing / 自建邮箱验证码登录 / 未来接微信登录
  └─ 后端统一签发并校验用户 session

AI 服务
  ├─ 默认: 阿里云百炼 Qwen / DeepSeek 官方 API / 火山方舟
  ├─ 备用: OpenAI API，仅用于海外或用户明确允许的场景
  └─ 后端通过统一 AI Provider Adapter 调用，前端和插件永不接触 API Key
```

### 2.2 为什么不继续只用 Firebase/Supabase

Firebase、Supabase、Vercel、Cloudflare 很适合快速试验和海外免费部署，但如果第一批核心用户在中国大陆，会有三个现实问题：

1. 访问稳定性不可控。  
   大陆用户访问海外服务时，DNS、跨境链路、第三方脚本、验证码、OAuth 回调都有不确定性。

2. 合规链路更复杂。  
   如果用户笔记、标注、草稿等个人内容默认存到海外，后续需要处理数据出境告知、同意、评估或标准合同等问题。

3. AI 请求链路可能变慢。  
   真实 AI 生成如果走海外模型，大陆用户会明显感觉等待时间和失败率。

因此，正式产品建议大陆主线先走国内云和国内可采购模型，海外免费方案只作为开发、演示和备选。

---

## 3. 服务器与云平台选型

### 3.1 选型结论

推荐分三档：

| 档位 | 用途 | 推荐组合 | 适合阶段 |
|---|---|---|---|
| A. 大陆正式主线 | 面向中国大陆用户正式使用 | 阿里云 OSS/CDN + FC/SAE + RDS PostgreSQL + 百炼/DeepSeek + Authing | MVP 正式试用到生产 |
| B. 大陆快速低运维 | 尽快把云端打通 | 腾讯云 CloudBase/SCF + 云数据库 + COS/CDN + Authing | 早期小流量验证 |
| C. 海外免费/低成本 | 开发、演示、海外用户 | Cloudflare Workers/Pages 或 Vercel + Supabase/Firebase + OpenAI/DeepSeek | 原型、PR 预览、海外 demo |

### 3.2 首选：阿里云主线

推荐理由：

- 中国大陆访问稳定。
- 静态托管、CDN、函数计算、RDS、OSS、日志、密钥管理都齐。
- 阿里云百炼模型服务提供中国内地部署范围，适合中文写作产品的默认 AI 通道。
- 域名备案、CDN、HTTPS、监控链路相对完整。

建议资源：

- Web 静态站点：OSS Bucket + CDN。
- API：阿里云函数计算 FC 3.0，或 SAE 部署 Node.js API。
- 数据库：RDS PostgreSQL。
- 对象存储：OSS。
- 日志：SLS。
- 密钥：KMS 或函数计算环境变量 + RAM 最小权限。
- AI：阿里云百炼 Qwen 系列 + DeepSeek 备用。

FC 的好处：

- 无需长期维护服务器。
- 适合 API 请求、AI 调用、轻量后台任务。
- 按量计费，初期成本可控。

SAE 的好处：

- 更像传统 Node 服务，长连接、SSE、较复杂 API 更自然。
- 部署 Docker/Node 应用更直观。
- 对后续队列、后台任务、连接池更友好。

我的建议：

- **MVP 第一阶段用 FC**：更轻、更快、更便宜。
- **如果 AI 流式输出、长任务、队列开始复杂，再迁到 SAE**。
- 代码层用 Hono/Fastify 这类普通 HTTP 框架，不要把业务写死在某一家云函数 SDK 上。

### 3.3 备选：腾讯云 CloudBase 主线

适合想尽快打通产品闭环，并且不想一开始维护 RDS/ORM 的情况。

优点：

- 静态托管、云函数、云数据库一体化。
- 控制台体验对新手比较友好。
- 适合快速做小流量 MVP。

风险：

- 数据模型长期会偏 NoSQL，需要提前设计好索引和权限。
- 后续复杂查询、报表、用户数据导出、版本历史可能比 PostgreSQL 更绕。
- 如果未来要迁移到标准 SQL，会有迁移成本。

建议：

- 如果目标是“最快让用户试用”，可以选 CloudBase。
- 如果目标是“长期产品化、账号体系、AI 用量、项目版本历史都要沉淀”，更推荐 PostgreSQL。

### 3.4 海外免费/低成本方案

推荐只作为 dev/staging/demo，不作为大陆正式生产默认方案。

可选组合：

- Cloudflare Pages/Workers + Supabase Postgres + DeepSeek/OpenAI。
- Vercel + Supabase + OpenAI/DeepSeek。
- Firebase Hosting/Auth/Firestore + Cloud Functions。

优点：

- 免费额度友好。
- GitHub 集成和预览部署方便。
- 适合不想维护本地终端的开发预览。

限制：

- Cloudflare Workers Free 有每日请求限制和 CPU 时间限制。
- Vercel Hobby 对函数运行时长、构建频率等有限制。
- Firebase Spark/Blaze 适合海外，但大陆访问不稳定。
- Supabase 免费层适合 demo，但正式用户数据默认海外不适合作大陆主线。

---

## 4. 域名、备案与访问策略

### 4.1 大陆用户优先的域名策略

推荐至少准备两个域名或子域名：

```text
app.yourdomain.cn      正式网页端
api.yourdomain.cn      正式 API
assets.yourdomain.cn   静态资源/附件/导出文件
staging.yourdomain.cn  预发布环境
```

如果使用中国内地 CDN 或内地服务器，域名通常需要 ICP 备案。阿里云 CDN 文档也明确提到，加速区域为中国内地或全球时，加速域名要求备案。

建议流程：

1. 购买域名。
2. 完成企业或个人实名认证。
3. 选择大陆云厂商作为接入服务商。
4. 提交 ICP 备案。
5. 备案完成后配置 CDN 和 HTTPS。
6. 站点正式开通后按要求处理公安备案。

### 4.2 没备案前怎么开发

没备案前不要卡住开发。

可以这样推进：

- Web 预览用 Vercel/Cloudflare/Netlify 临时域名。
- API 预览用云函数默认域名。
- 插件 dev 构建指向 staging API。
- 用户小范围测试先用海外/临时域名。
- 备案完成后切换正式域名。

### 4.3 大陆正式上线前必须补齐

- ICP 备案。
- 隐私政策。
- 用户协议。
- 数据删除/导出入口。
- AI 生成内容提示。
- 投诉/反馈入口。
- 账号注销流程。
- 云资源账单告警。

---

## 5. 账号体系设计

### 5.1 登录方式优先级

建议分阶段：

#### Phase 1：邮箱验证码登录

最推荐第一版先做：

- 用户输入邮箱。
- 收到验证码或 Magic Link。
- 登录网页端。
- 插件通过同一账号授权。

优点：

- 跨浏览器。
- 不依赖手机号短信成本。
- 不依赖微信开放平台审核。
- 对海外方案也通用。

#### Phase 2：手机号登录

大陆用户熟悉，但短信成本、风控和实名通道会更复杂。

建议等第一批用户试用后再加。

#### Phase 3：微信登录

非常适合中国大陆用户，但需要：

- 微信开放平台或公众号体系。
- 域名备案。
- 审核。
- 移动端/网页端回调配置。

建议作为正式增长阶段能力，不挡 MVP。

### 5.2 Authing vs 自建登录

#### Authing

优点：

- 国内访问更友好。
- 对微信、企业微信、手机号、邮箱、SSO 的支持更完整。
- 少写很多账号安全逻辑。

缺点：

- 免费/付费边界要以采购当日为准。
- 用户核心登录链路依赖第三方。
- 深度自定义会受平台约束。

#### 自建邮箱验证码登录

优点：

- 数据完全掌控。
- 成本低。
- 不受第三方 Auth SaaS 限制。

缺点：

- 要自己做验证码、频控、防刷、密码/会话安全。
- 后续接微信、手机号、多因素会变复杂。

#### 推荐

第一版建议：

- **如果你希望最快上线并且能接受采购第三方账号服务：选 Authing。**
- **如果你希望成本最低且功能先简单：自建邮箱验证码登录。**

本文后续按“Authing/OIDC + 后端会话”设计，同时保留自建邮箱验证码的替换口。

### 5.3 Web 登录流程

推荐采用授权码 + PKCE 或后端交换 code 的方式。

流程：

```text
1. 用户打开 web app。
2. 未登录时跳转到 /login。
3. 点击登录，进入 Authing 托管登录页或自建邮箱验证码页。
4. 登录成功后回调 /auth/callback?code=xxx。
5. 后端用 code 换取用户身份。
6. 后端创建/更新本地 users 表。
7. 后端写入 httpOnly Secure SameSite Cookie。
8. 前端调用 /api/me 获取用户信息。
```

为什么 Web 用 Cookie：

- access token 不暴露给前端 JS。
- 降低 XSS 窃取 token 的风险。
- API 权限统一由后端 session 判断。

### 5.4 插件登录流程

浏览器插件不能简单依赖网页端 Cookie，因为：

- 插件运行在 `chrome-extension://` 域下。
- sidepanel/options/content script 上下文不同。
- Cookie、CORS、权限和刷新 token 都要单独处理。

推荐两种方案。

#### 方案 A：Chrome Identity + OAuth PKCE

流程：

```text
1. 插件点击登录。
2. 插件调用 chrome.identity.launchWebAuthFlow。
3. 打开 Authing/OIDC 授权页面。
4. 用户登录。
5. 授权服务回调到 Chrome extension redirect URL。
6. 插件拿到 authorization code。
7. 插件发给后端 /auth/extension/exchange。
8. 后端换 token 并签发插件专用 refresh token。
9. 插件把 refresh token 存到 chrome.storage.local。
10. 插件后续请求 API 时携带短期 access token。
```

需要修改：

- `extension/wxt.config.ts` 增加 `identity` 权限。
- 增加 `extension/lib/auth.ts`。
- sidepanel/options 顶部增加登录状态。

优点：

- OAuth 标准。
- 用户体验完整。

缺点：

- 配置略复杂。
- 不同浏览器扩展 ID、redirect URI 要分环境配置。

#### 方案 B：设备码/一次性绑定码

流程：

```text
1. 插件生成 deviceId + nonce。
2. 插件打开网页 /extension/link?nonce=xxx。
3. 用户在网页登录。
4. 网页端确认“绑定此浏览器插件”。
5. 后端创建一次性 device session。
6. 插件轮询 /auth/extension/poll?nonce=xxx。
7. 成功后拿到插件专用 token。
```

优点：

- 跨 Chrome/Edge/国产浏览器更稳。
- 不强依赖 `chrome.identity`。
- 插件端实现更可控。

缺点：

- 需要多一步“绑定确认”。
- 轮询和过期逻辑要做严谨。

#### 推荐

第一版推荐 **方案 B：设备码/一次性绑定码**。

原因：

- 更容易解释给用户。
- 对国内浏览器更兼容。
- 后端可以清楚记录“这个插件设备属于哪个用户”。
- 以后再升级 OAuth PKCE 也不难。

### 5.5 插件 token 安全

规则：

- 插件只保存 refresh token，不保存 AI Key。
- access token 有效期 15 分钟。
- refresh token 有效期 30 天，支持轮换。
- 后端记录 token hash，不存明文。
- 用户可以在网页端“退出所有插件设备”。
- 插件本地 token 丢失后，只能访问该用户自己的 API，不能访问管理后台。

---

## 6. 用户数据存储方式

### 6.1 数据库选择

推荐 PostgreSQL。

原因：

- 用户、文件夹、笔记、片段、项目、对话、AI run、版本历史之间关系明确。
- 查询、筛选、分页、全文搜索、统计更自然。
- 未来做付费、团队空间、权限、导出更稳。
- 可以用 JSONB 存放 AI 分析结构，不牺牲关系模型。

### 6.2 ORM/迁移工具

推荐：

- ORM：Drizzle ORM。
- Schema 校验：Zod。
- 迁移：drizzle-kit。

为什么不首选 Prisma：

- Prisma 也可以，但 serverless 冷启动和连接池要更注意。
- Drizzle 更轻，更适合函数计算/边缘部署。

如果团队更熟 Prisma，可以用 Prisma + 数据库连接池/代理。

### 6.3 核心表设计

#### users

用户主表。

```sql
users (
  id uuid primary key,
  email text unique,
  phone text unique,
  display_name text,
  avatar_url text,
  auth_provider text not null,
  auth_subject text not null,
  status text not null default 'active',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  last_login_at timestamptz
)
```

#### user_identities

支持一个用户绑定多个登录方式。

```sql
user_identities (
  id uuid primary key,
  user_id uuid references users(id),
  provider text not null,
  provider_subject text not null,
  provider_payload jsonb,
  created_at timestamptz not null,
  unique(provider, provider_subject)
)
```

#### extension_devices

插件设备表。

```sql
extension_devices (
  id uuid primary key,
  user_id uuid references users(id),
  device_name text,
  browser text,
  extension_version text,
  refresh_token_hash text,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null
)
```

#### folders

文件夹。

```sql
folders (
  id uuid primary key,
  user_id uuid references users(id),
  name text not null,
  sort_order integer default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
)
```

#### notes

小红书笔记。

```sql
notes (
  id uuid primary key,
  user_id uuid references users(id),
  folder_id uuid references folders(id),
  title text not null,
  filename text not null,
  author_name text,
  source_url text not null,
  normalized_source_url text not null,
  cover_image_url text,
  content_text text,
  source_platform text not null default 'xiaohongshu',
  captured_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  unique(user_id, normalized_source_url)
)
```

#### snippets

标注片段。

```sql
snippets (
  id uuid primary key,
  user_id uuid references users(id),
  note_id uuid references notes(id),
  selected_text text not null,
  reason_text text,
  color_value text,
  color_tag_name text,
  start_offset integer,
  end_offset integer,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
)
```

第一版可以先不强求 `start_offset/end_offset`，因为小红书正文抽取稳定性一般；但建议预留字段。

#### projects

网页端项目。

```sql
projects (
  id uuid primary key,
  user_id uuid references users(id),
  name text not null,
  default_folder_id uuid references folders(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
)
```

#### conversations

项目内多轮文案对话。

```sql
conversations (
  id uuid primary key,
  user_id uuid references users(id),
  project_id uuid references projects(id),
  title text not null,
  step text not null default 'learn',
  pinned boolean not null default false,
  selected_reference_ids jsonb not null default '[]',
  length text,
  topic text,
  target_audience text,
  analysis_ready boolean not null default false,
  finalized_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
)
```

#### chat_messages

学习拆解、创作、改写对话都放这里，用 `channel` 区分。

```sql
chat_messages (
  id uuid primary key,
  user_id uuid references users(id),
  conversation_id uuid references conversations(id),
  channel text not null, -- learn | plan | rewrite | reader
  role text not null,    -- user | assistant | system
  content jsonb not null,
  model text,
  ai_run_id uuid,
  created_at timestamptz not null
)
```

#### drafts

草稿版本。

```sql
drafts (
  id uuid primary key,
  user_id uuid references users(id),
  conversation_id uuid references conversations(id),
  version integer not null,
  title text not null,
  body jsonb not null,
  source text not null, -- generated | edited | finalized
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique(conversation_id, version)
)
```

#### ai_runs

每一次真实 AI 调用都记录。

```sql
ai_runs (
  id uuid primary key,
  user_id uuid references users(id),
  conversation_id uuid references conversations(id),
  task_type text not null, -- analyze | draft | rewrite | reader_preview
  provider text not null,
  model text not null,
  status text not null, -- queued | running | succeeded | failed | canceled
  input_token_count integer,
  output_token_count integer,
  cost_estimate_cny numeric,
  latency_ms integer,
  prompt_hash text,
  error_code text,
  error_message text,
  created_at timestamptz not null,
  finished_at timestamptz
)
```

#### feedback_memory

记录用户偏好和反反馈。

```sql
feedback_memory (
  id uuid primary key,
  user_id uuid references users(id),
  conversation_id uuid references conversations(id),
  type text not null, -- like | dislike | rewrite_preference | ai_smell_feedback | final_choice
  content text not null,
  source_message_id uuid,
  created_at timestamptz not null
)
```

#### assets

附件、导出文件、未来图片缓存。

```sql
assets (
  id uuid primary key,
  user_id uuid references users(id),
  object_key text not null,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  purpose text, -- attachment | export | cover_cache
  created_at timestamptz not null,
  deleted_at timestamptz
)
```

### 6.4 数据权限原则

所有业务表必须有 `user_id`。

后端每个查询都必须带：

```sql
where user_id = current_user.id
```

不要依赖前端传来的 `userId`。

### 6.5 软删除策略

第一版：

- 笔记、文件夹、项目、对话使用 `deleted_at` 软删除。
- 回收站保留 7 天或 30 天，由产品配置决定。
- 真删除由后台定时任务处理。

插件当前本地回收站是 7 天，云端建议：

- MVP 继续 7 天，减少认知差异。
- 后续可以改成 30 天，作为正式产品能力。

---

## 7. API 设计

### 7.1 API 风格

建议：

- REST API + JSON。
- AI 流式输出用 SSE。
- 所有输入输出用 Zod schema。
- `packages/shared` 存共享类型和 schema。
- API 路径统一 `/api/v1`。

### 7.2 Auth API

```http
GET  /api/v1/me
POST /api/v1/auth/logout
POST /api/v1/auth/extension/link/start
POST /api/v1/auth/extension/link/confirm
GET  /api/v1/auth/extension/link/poll
POST /api/v1/auth/extension/token/refresh
POST /api/v1/auth/extension/revoke
```

### 7.3 Folder API

```http
GET    /api/v1/folders
POST   /api/v1/folders
PATCH  /api/v1/folders/:folderId
DELETE /api/v1/folders/:folderId
POST   /api/v1/folders/:folderId/restore
```

### 7.4 Note API

```http
GET    /api/v1/notes?folderId=&q=&tag=&sort=&cursor=
POST   /api/v1/notes
GET    /api/v1/notes/:noteId
PATCH  /api/v1/notes/:noteId
DELETE /api/v1/notes/:noteId
POST   /api/v1/notes/:noteId/restore
```

`POST /notes` 用于插件保存笔记。

请求示例：

```json
{
  "folderId": "uuid",
  "title": "原笔记标题",
  "filename": "用户保存的文件名",
  "authorName": "作者",
  "sourceUrl": "https://www.xiaohongshu.com/explore/xxx",
  "coverImageUrl": "https://...",
  "contentText": "正文"
}
```

后端职责：

- 规范化 URL。
- 判断是否已存在。
- 如果已存在，更新笔记而不是重复创建。
- 只允许写到当前用户自己的文件夹。

### 7.5 Snippet API

```http
GET    /api/v1/snippets?noteId=&folderId=&tag=
POST   /api/v1/snippets
PATCH  /api/v1/snippets/:snippetId
DELETE /api/v1/snippets/:snippetId
```

### 7.6 Sync API

插件从本地存储迁移到云端，需要专门同步接口。

```http
POST /api/v1/sync/bootstrap
POST /api/v1/sync/push
GET  /api/v1/sync/pull?since=
POST /api/v1/sync/resolve-conflicts
```

第一版可以不做复杂 CRDT，采用简单规则：

- 每条记录有 `clientUpdatedAt` 和 `serverUpdatedAt`。
- 服务端以 `updated_at` 为准。
- 同一字段冲突时，默认“较新的更新时间胜出”。
- 删除优先级高于更新，但 7 天内可恢复。
- 首次登录时让用户选择：
  - 上传本地文案库到云端。
  - 保留本地不上传。
  - 清空本地并使用云端。

### 7.7 Project API

```http
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:projectId
PATCH  /api/v1/projects/:projectId
DELETE /api/v1/projects/:projectId
```

### 7.8 Conversation API

```http
GET    /api/v1/projects/:projectId/conversations
POST   /api/v1/projects/:projectId/conversations
GET    /api/v1/conversations/:conversationId
PATCH  /api/v1/conversations/:conversationId
DELETE /api/v1/conversations/:conversationId
POST   /api/v1/conversations/:conversationId/references
```

### 7.9 Draft API

```http
GET   /api/v1/conversations/:conversationId/drafts
POST  /api/v1/conversations/:conversationId/drafts
PATCH /api/v1/drafts/:draftId
POST  /api/v1/drafts/:draftId/finalize
```

### 7.10 AI API

```http
POST /api/v1/ai/analyze
POST /api/v1/ai/draft
POST /api/v1/ai/rewrite
POST /api/v1/ai/reader-preview
GET  /api/v1/ai/runs/:runId
GET  /api/v1/ai/runs/:runId/stream
```

第一版可以先同步返回；一旦真实模型延迟明显，改成：

```text
1. 前端 POST /ai/analyze。
2. 后端创建 ai_run。
3. 返回 runId。
4. 前端打开 SSE stream。
5. 后端逐段推送 token 或结构化阶段结果。
6. 完成后保存 chat_messages、drafts、ai_runs。
```

---

## 8. 插件和网页端打通方案

### 8.1 插件本地存储迁移策略

当前插件已经有：

- `savedFolders`
- `savedNotes`
- `savedSnippets`
- `pendingSnippetSelection`
- `colorTagNames`
- `trashItems`

迁移不能一刀切替换，否则用户本地已有数据可能丢失。

建议分四步：

#### Step 1：抽象 Repository 层

把 `extension/lib/storage.ts` 从“直接读写 chrome.storage.local”改成：

```ts
interface LibraryRepository {
  getFolders(): Promise<SavedFolderRecord[]>
  saveFolder(input): Promise<SavedFolderRecord>
  getNotes(query): Promise<SavedNoteRecord[]>
  upsertNote(input): Promise<SavedNoteRecord>
  getSnippets(query): Promise<SavedSnippetRecord[]>
  upsertSnippet(input): Promise<SavedSnippetRecord>
}
```

实现两个版本：

- `LocalLibraryRepository`
- `CloudLibraryRepository`

#### Step 2：未登录继续走本地

未登录时：

- 插件保持现有体验。
- 顶部提示“登录后可同步到网页端”。

#### Step 3：登录后首次同步

用户登录后：

- 检查本地是否有 folders/notes/snippets。
- 如果有，弹出同步选择。
- 调用 `/api/v1/sync/bootstrap` 上传。
- 上传成功后，本地记录 `cloudSyncEnabled = true`。

#### Step 4：云端为主，本地为缓存

登录后：

- 保存笔记时先写 API。
- API 成功后同步更新 `chrome.storage.local`，作为离线缓存。
- API 失败时写入本地 `syncQueue`，稍后重试。

### 8.2 网页端替换 demo-data

当前网页端从 `demoFolders/demoNotes/demoSnippets` 读取数据。

迁移步骤：

1. 新增 `web/src/lib/api-client.ts`。
2. 新增 `web/src/hooks/use-library.ts`。
3. 项目页先调用 `/api/v1/folders`、`/api/v1/notes`、`/api/v1/snippets`。
4. loading 时显示骨架。
5. API 失败时显示错误和重试按钮。
6. demo 数据只保留为“未登录体验模式”。

### 8.3 共享类型整理

`packages/shared/src/index.ts` 已经有基础类型，但还需要增加：

- API request/response schema。
- enum。
- 数据库实体与前端 DTO 的区分。
- `normalizeNoteUrl` 继续保留。

建议新增文件结构：

```text
packages/shared/src/
  index.ts
  schemas/
    auth.ts
    folders.ts
    notes.ts
    snippets.ts
    projects.ts
    conversations.ts
    ai.ts
  types/
    api.ts
```

不要让 web/extension 分别定义一套相似类型。

---

## 9. AI 选型与采购方式

### 9.1 AI 任务拆分

这个产品不是只要一个“写文章”模型，需要拆成 4 类任务：

| 任务 | 输入 | 输出 | 推荐模型要求 |
|---|---|---|---|
| 学习拆解 | 参考笔记、标注片段、标注理由、用户追问 | 写作判断、可复用机制、避坑点 | 中文理解强，结构化输出稳 |
| 初稿生成 | 主题、目标读者、篇幅、参考偏好 | 标题 + 分段正文 | 中文创作强，风格可控 |
| 局部改写 | 选中文本、上下文、用户要求 | 替代表达或改写说明 | 低延迟、便宜、能保持局部范围 |
| 读者预演 | 当前稿、目标读者 | 批注、风险点、修改优先级 | 分析和审稿能力强 |

### 9.2 大陆默认模型池

推荐优先考虑：

1. 阿里云百炼 Qwen 系列  
   优点：大陆采购、网络稳定、中文能力强、可与阿里云资源同账号管理。阿里云百炼文档显示中国内地部署范围支持华北 2（北京），模型推理计算资源限于中国内地，适合大陆默认链路。

2. DeepSeek API  
   优点：成本低、OpenAI 格式兼容、长上下文能力强。DeepSeek 官方文档提供 OpenAI Format Base URL，并列出 DeepSeek-V4-Flash/Pro 的价格和上下文能力。

3. 火山方舟  
   优点：国内云厂商、模型选择多，适合后续做多模型路由。

推荐默认组合：

```text
学习拆解: qwen3-max / qwen3.6-max-preview / deepseek-v4-pro
初稿生成: qwen3-max / deepseek-v4-pro
局部改写: qwen-plus / qwen3-max 低档 / deepseek-v4-flash
读者预演: qwen3-max / deepseek-v4-pro
兜底模型: deepseek-v4-flash
```

实际模型名以采购当日 API 控制台为准。

### 9.3 海外模型池

海外可选：

- OpenAI GPT-5.4 mini：适合成本和质量平衡。
- OpenAI GPT-5.4 / GPT-5.5：适合复杂分析、长文优化、质量要求高的任务。
- OpenAI Batch：非实时任务可降低成本。

注意：

- 如果大陆用户数据发送到海外模型，必须走显式告知和同意。
- 默认不要把用户全部素材库发到海外。
- 可以提供“海外增强模型”开关，仅对明确选择的用户启用。

### 9.4 AI 采购步骤

#### 国内模型采购

1. 注册平台账号。
2. 完成实名认证。
3. 开通模型服务。
4. 创建 API Key。
5. 设置预算告警。
6. 设置每日调用上限。
7. 后端环境变量配置：

```text
AI_PROVIDER_PRIMARY=aliyun-bailian
AI_PROVIDER_FALLBACK=deepseek
ALIYUN_BAILIAN_API_KEY=...
DEEPSEEK_API_KEY=...
```

8. 后端保存每次调用：
   - provider
   - model
   - input tokens
   - output tokens
   - estimated cost
   - latency
   - status

#### 海外模型采购

1. 注册 OpenAI Platform。
2. 绑定付款方式。
3. 创建 Project API Key。
4. 配置限额和预算。
5. 仅在海外环境或用户明确授权后启用。

### 9.5 AI Provider Adapter

后端不要在业务代码里直接写某一家 API。

建议接口：

```ts
type AiTaskType = 'analyze' | 'draft' | 'rewrite' | 'reader_preview'

interface AiProvider {
  name: string
  generateObject<T>(input: {
    taskType: AiTaskType
    model: string
    messages: AiMessage[]
    schema: ZodSchema<T>
    temperature?: number
  }): Promise<{
    data: T
    usage: TokenUsage
    raw: unknown
  }>

  streamText(input: {
    taskType: AiTaskType
    model: string
    messages: AiMessage[]
  }): AsyncIterable<AiStreamChunk>
}
```

Provider 实现：

```text
providers/
  aliyun-bailian.ts
  deepseek.ts
  openai.ts
  volc-ark.ts
```

### 9.6 Prompt 规则

需要把 prompt 做成版本化文件，而不是散在组件里。

建议结构：

```text
server/prompts/
  analyze-v1.md
  draft-v1.md
  rewrite-v1.md
  reader-preview-v1.md
```

每次 AI run 记录：

- prompt version。
- prompt hash。
- model。
- provider。
- 输入摘要。
- 输出结构。

这样后续出现“为什么这次写得怪”时可以回溯。

### 9.7 成本控制

第一版必须有硬限制：

- 单用户每日 AI 请求上限。
- 单次最多参考笔记数。
- 单次最多参考片段数。
- 单次最多输入 token。
- 免费用户每日额度。
- 管理后台或数据库配置开关。

建议默认：

```text
免费用户:
  analyze: 20 次/日
  draft: 20 次/日
  rewrite: 50 次/日
  reader_preview: 20 次/日

单次分析:
  notes <= 20
  snippets <= 80
  content chars <= 40,000
```

---

## 10. 后端搭建方案

### 10.1 推荐目录结构

建议从当前 `server/functions` 演进为：

```text
server/
  api/
    src/
      app.ts
      index.ts
      routes/
        auth.ts
        folders.ts
        notes.ts
        snippets.ts
        projects.ts
        conversations.ts
        drafts.ts
        ai.ts
        sync.ts
      services/
        auth-service.ts
        library-service.ts
        sync-service.ts
        ai-service.ts
      providers/
        ai/
          aliyun-bailian.ts
          deepseek.ts
          openai.ts
      db/
        schema.ts
        client.ts
        migrations/
      middleware/
        require-auth.ts
        rate-limit.ts
        request-id.ts
        error-handler.ts
      config.ts
    package.json
```

也可以保留 `server/functions`，但建议改名为 `server/api`，因为它不应该被某一家函数平台绑定。

### 10.2 技术栈

推荐：

- Node.js 20+。
- TypeScript。
- Hono 或 Fastify。
- Drizzle ORM。
- Zod。
- Pino 日志。
- OpenAPI 文档。
- Vitest 单元测试。

Hono 更轻，适合 serverless；Fastify 插件生态更成熟。  
本项目 API 初期不复杂，推荐 Hono。

### 10.3 后端中间件

必须有：

- request id。
- auth。
- zod validation。
- error handler。
- CORS。
- rate limit。
- audit log。
- AI cost guard。

### 10.4 CORS 规则

允许来源：

```text
https://app.yourdomain.cn
https://staging.yourdomain.cn
chrome-extension://<production-extension-id>
chrome-extension://<staging-extension-id>
```

不要在生产环境使用：

```text
Access-Control-Allow-Origin: *
```

### 10.5 Secrets

严禁出现在前端和插件：

- AI API Key。
- Authing Client Secret。
- DB URL。
- OSS Secret。
- JWT signing secret。

只允许在后端环境变量/密钥管理里。

---

## 11. 前端改造方案

### 11.1 Web 端

需要新增：

```text
web/src/lib/api-client.ts
web/src/lib/auth.ts
web/src/hooks/use-current-user.ts
web/src/hooks/use-library.ts
web/src/hooks/use-projects.ts
web/src/hooks/use-ai-run.ts
```

改造顺序：

1. 增加登录页和 `/api/me`。
2. 项目页从 API 读取 projects。
3. 文案选择页从 API 读取 folders/notes/snippets。
4. 学习拆解调用 `/ai/analyze`。
5. 文案创作调用 `/ai/draft`。
6. 编辑细调调用 `/ai/rewrite`。
7. 读者预演调用 `/ai/reader-preview`。
8. 草稿编辑实时保存或手动保存。

### 11.2 插件端

需要新增：

```text
extension/lib/api-client.ts
extension/lib/auth.ts
extension/lib/repository.ts
extension/lib/sync-queue.ts
extension/components/login-banner.tsx
```

改造顺序：

1. 插件展示登录状态。
2. 登录后绑定设备。
3. 保存笔记改为调用 API。
4. 保存片段改为调用 API。
5. 管理页读取云端数据。
6. 本地缓存作为 fallback。
7. 增加同步队列和重试提示。

### 11.3 Content script 不直接访问后端

原则：

- content script 只负责页面抓取和选区。
- sidepanel/background 负责和后端通信。

原因：

- content script 运行在小红书页面上下文附近，权限和安全边界更复杂。
- API token 不要在 content script 里流转。

---

## 12. 开发调试不依赖本地终端的方案

### 12.1 目标

用户希望不用每次本地开终端跑：

```bash
pnpm dev:web
pnpm dev:extension
```

我们需要建立“云端预览 + 自动构建 + 可下载插件包”的流程。

### 12.2 Web 预览

每次 push 或 PR：

```text
GitHub Actions
  ├─ pnpm install
  ├─ pnpm lint
  ├─ pnpm typecheck
  ├─ pnpm --filter web build
  └─ 部署到 preview/staging
```

输出：

- PR 预览 URL。
- staging URL。
- prod URL。

大陆主线：

- GitHub Actions 构建后上传到阿里云 OSS staging bucket。
- 自动刷新 CDN。

海外免费：

- Vercel/Cloudflare 自动 PR preview。

### 12.3 API 预览

每次 push 到 `main`：

- 部署 API 到 staging。
- 跑数据库迁移。
- 跑 smoke test。
- 生成 OpenAPI 文档。

每次 tag/release：

- 部署 API 到 production。
- 迁移 production DB 前先备份。

### 12.4 插件构建

每次 push：

```text
GitHub Actions
  ├─ pnpm --filter extension build
  ├─ 生成 chrome-mv3 zip
  ├─ 写入 staging API base URL
  └─ 上传为 GitHub Actions artifact
```

用户不用本地终端，只需要：

1. 打开 GitHub Actions。
2. 下载最新 staging 插件 zip。
3. 解压。
4. 在浏览器扩展页面加载。

如果要更进一步：

- 发布 Chrome Web Store unlisted/staged extension。
- 发布 Edge Add-ons 内测版本。
- 测试用户直接从商店安装，不需要下载 zip。

### 12.5 Cloud IDE

为了彻底减少本地环境问题，可以配置：

```text
.devcontainer/
  devcontainer.json
```

支持：

- GitHub Codespaces。
- Gitpod。
- 腾讯云 Cloud Studio。

打开后自动：

- 安装 pnpm。
- 安装依赖。
- 提供“启动 Web”“构建插件”“运行测试”的按钮任务。

注意：

- Cloud IDE 适合改代码和跑 web。
- 浏览器插件调试最终仍要在真实浏览器里装插件包。

---

## 13. 环境划分

### 13.1 环境列表

```text
local      本机开发，可选
preview    每个 PR 自动生成，数据可随时清空
staging    长期预发布，给内部测试
production 正式用户
```

### 13.2 环境变量

Web：

```text
VITE_APP_ENV=staging
VITE_API_BASE_URL=https://api-staging.yourdomain.cn
```

Extension：

```text
WXT_PUBLIC_APP_ENV=staging
WXT_PUBLIC_API_BASE_URL=https://api-staging.yourdomain.cn
WXT_PUBLIC_WEB_APP_URL=https://staging.yourdomain.cn
```

API：

```text
APP_ENV=staging
DATABASE_URL=...
AUTH_PROVIDER=authing
AUTHING_ISSUER=...
AUTHING_CLIENT_ID=...
AUTHING_CLIENT_SECRET=...
SESSION_SECRET=...
AI_PROVIDER_PRIMARY=aliyun-bailian
ALIYUN_BAILIAN_API_KEY=...
DEEPSEEK_API_KEY=...
OSS_BUCKET=...
```

---

## 14. 联调阶段计划

### Phase 0：账号和云资源准备

目标：把必须由用户亲自操作的外部资源准备好。

用户需要做：

- 注册云平台账号。
- 完成实名认证。
- 准备域名。
- 决定是否先备案。
- 注册 AI 平台账号。
- 注册账号服务账号。
- 准备付款方式或充值。

工程输出：

- 云资源清单。
- 环境变量模板。
- 成本预估表。

验收标准：

- 有 staging API 可访问。
- 有 staging web 可访问。
- 有数据库连接串。
- 有 AI Key。

### Phase 1：后端骨架

目标：建立真实 API 服务。

任务：

- 创建 `server/api`。
- 接入 Hono/Fastify。
- 接入 Zod。
- 接入 Drizzle。
- 建立 users/folders/notes/snippets 基础表。
- 增加 `/health` 和 `/api/v1/me`。
- 增加 OpenAPI 文档。

验收：

- `GET /health` 返回 ok。
- staging 部署成功。
- CI 能 typecheck/build。
- DB migration 可自动执行。

### Phase 2：账号登录

目标：Web 端能登录，后端能识别用户。

任务：

- 接 Authing/OIDC 或自建邮箱验证码。
- Web 增加登录页。
- 后端创建 users/user_identities。
- Cookie session。
- `/api/v1/me` 返回当前用户。

验收：

- 未登录访问工作台会进入登录。
- 登录后可看到用户信息。
- 退出后 session 失效。

### Phase 3：插件设备绑定

目标：插件也能登录同一个账号。

任务：

- 实现设备码绑定。
- 插件打开绑定页。
- Web 登录后确认绑定。
- 插件拿到 refresh token。
- 后端记录 extension_devices。

验收：

- 插件 sidepanel 显示已登录账号。
- 网页端可看到已绑定插件设备。
- 网页端能撤销插件登录。

### Phase 4：云端文案库

目标：插件保存的笔记和片段能出现在网页端。

任务：

- 实现 folders/notes/snippets API。
- 插件保存笔记调用 API。
- 插件保存片段调用 API。
- 管理页读取 API。
- Web 选择文案页读取 API。

验收：

- 在小红书保存一篇笔记。
- 打开网页端，能看到这篇笔记。
- 保存一个标注片段。
- 网页端学习拆解页能选中这个片段。

### Phase 5：本地数据迁移

目标：老用户本地插件数据可上传到云端。

任务：

- 插件检测本地数据。
- Web/插件提供同步确认。
- `/sync/bootstrap` 批量上传。
- 冲突处理。
- 同步完成后本地标记云同步开启。

验收：

- 现有 `chrome.storage.local` 数据不会丢。
- 上传后网页端能看到。
- 重复上传不会生成重复笔记。

### Phase 6：真实 AI 学习拆解

目标：替换 `buildDemoAnalysis`。

任务：

- 建立 `analyze-v1.md` prompt。
- 实现 `/api/v1/ai/analyze`。
- 保存 ai_runs。
- 保存 assistant chat message。
- 前端展示真实返回。

验收：

- 选择真实标注片段后，AI 能输出结构化分析。
- 输出包含核心判断、可复用机制、避坑点、下一步建议。
- 失败时前端能重试。
- AI Key 不出现在前端 bundle。

### Phase 7：真实初稿生成

目标：替换本地 `buildInitialDraftCopy`。

任务：

- 建立 `draft-v1.md` prompt。
- `/api/v1/ai/draft`。
- 保存 drafts version 1。
- 前端展示真实草稿。

验收：

- 根据主题、目标读者、篇幅生成标题和正文。
- 草稿可以编辑。
- 编辑后保存新版本。

### Phase 8：真实局部改写

目标：编辑细调右侧对话由真实模型驱动。

任务：

- 建立 `rewrite-v1.md` prompt。
- `/api/v1/ai/rewrite`。
- 输入包含选中文本、所在段落、上下文、用户要求、用户偏好。
- 输出包含建议和可替换文本。

验收：

- 用户圈选一句话并输入“更口语”。
- AI 返回 2-3 个可替换版本。
- 用户可一键替换。

### Phase 9：真实读者预演

目标：替换 `buildReaderPreviewFeedback`。

任务：

- 建立 `reader-preview-v1.md` prompt。
- `/api/v1/ai/reader-preview`。
- 输出批注数组、风险点、修改优先级。

验收：

- 左侧文案出现编号批注。
- 右侧显示对应读者反馈。
- 可把建议发送回编辑细调。

### Phase 10：上线与监控

目标：让产品可小范围真实试用。

任务：

- staging 全链路测试。
- production 部署。
- 域名 HTTPS。
- 日志监控。
- AI 预算告警。
- 错误上报。
- 数据备份。

验收：

- 新用户可以注册。
- 插件可以绑定账号。
- 采集数据可以同步。
- 网页可以真实 AI 生成。
- 线上错误可追踪。

---

## 15. 测试计划

### 15.1 单元测试

覆盖：

- `normalizeNoteUrl`。
- API schema。
- sync conflict merge。
- AI provider adapter mock。
- prompt output parser。
- permission guard。

### 15.2 API 集成测试

覆盖：

- 未登录返回 401。
- 用户 A 不能访问用户 B 数据。
- 创建文件夹。
- 创建笔记。
- 重复 sourceUrl upsert。
- 创建片段。
- 删除/恢复。
- AI run 记录。

### 15.3 Web E2E

使用 Playwright：

- 登录。
- 创建项目。
- 选择参考片段。
- 开始分析。
- 选篇幅。
- 生成草稿。
- 编辑草稿。
- 读者预演。
- 确认复制。

### 15.4 插件 E2E

可以用 Playwright + Chromium extension context：

- 加载 extension build。
- 打开模拟小红书详情页 fixture。
- content script 抓取标题/正文。
- 选中文本。
- sidepanel 保存标注。
- API 收到 note/snippet。

如果真实小红书页面反爬或 DOM 改动，不要让测试依赖线上小红书。用本地 fixture 模拟 DOM。

### 15.5 手工联调清单

每次发 staging 前：

- 插件未登录能正常本地保存。
- 插件登录后能云端保存。
- Web 能看到插件保存数据。
- 断网时插件有失败提示，不丢数据。
- AI 超时时前端能恢复。
- AI 返回格式不对时有兜底提示。
- 删除笔记后 Web/插件状态一致。
- 回收站恢复后状态一致。

---

## 16. 安全与合规基线

### 16.1 必须遵守的工程规则

- AI Key 只放后端。
- DB 不暴露公网白名单以外访问。
- API 必须鉴权。
- 所有用户数据查询必须带 `user_id`。
- 所有写接口必须做 rate limit。
- 上传文件必须限制类型和大小。
- 日志不能记录完整用户正文和完整 prompt。
- 只记录 prompt hash、长度、摘要和必要错误信息。

### 16.2 个人信息与数据出境

如果默认使用大陆云和大陆模型，合规压力较小。

如果使用 OpenAI 等海外模型：

- 明确告知用户其输入内容可能发送到境外服务。
- 需要用户单独同意。
- 提供关闭海外模型的选项。
- 默认不要自动把用户整个文案库发往海外。
- 记录每次使用海外模型的 provider/model。

### 16.3 生成式 AI 服务注意点

产品是写作辅助工具，仍应做到：

- 告知用户内容由 AI 辅助生成。
- 用户发布前需自行确认真实性和合法性。
- 对违法、有害、侵权内容请求做基础拦截。
- 保留投诉/反馈入口。
- 不把用户输入用于训练，除非单独授权。

---

## 17. 监控、日志与成本控制

### 17.1 监控指标

API：

- 请求量。
- P50/P95 延迟。
- 5xx 错误率。
- 401/403 比例。
- AI 调用成功率。
- AI 超时率。

业务：

- 新注册用户数。
- 插件绑定数。
- 每日保存笔记数。
- 每日标注片段数。
- 每日 AI 分析次数。
- 每日草稿生成次数。

成本：

- 每日 AI tokens。
- 每日 AI 费用估算。
- 单用户成本排行。
- 异常高频用户。
- OSS/CDN 流量。

### 17.2 告警

必须配置：

- AI 日成本超过阈值。
- API 5xx 超过阈值。
- DB 连接失败。
- DB 存储超过阈值。
- 云函数错误率升高。
- 余额不足。

---

## 18. 发布策略

### 18.1 Web 发布

```text
feature branch -> PR preview -> staging -> production
```

生产发布前：

- CI 全绿。
- 数据库 migration 通过。
- staging smoke test 通过。
- 手工联调清单通过。

### 18.2 插件发布

建议分两个插件：

```text
Lumos AI Writer Staging
Lumos AI Writer
```

原因：

- 插件 ID 不同，API CORS 可以区分。
- staging 插件可以连 staging API。
- production 插件只连 production API。

发布路径：

1. CI 生成 zip。
2. 内部加载测试。
3. 提交浏览器商店审核。
4. 小范围用户测试。
5. 扩大发布。

注意：

- Chrome Web Store 在中国大陆访问不稳定。
- Edge Add-ons 对大陆用户可能更友好。
- 如果目标用户主要用 Chrome，需要准备清晰的安装说明。

---

## 19. 成本预估思路

### 19.1 初期固定成本

可能包括：

- 域名。
- 云数据库最低规格。
- 对象存储少量费用。
- CDN 少量流量费用。
- 账号服务费用。
- AI 预充值。
- 浏览器插件商店开发者账号费用。

### 19.2 变动成本

主要来自：

- AI token。
- CDN 流量。
- OSS/COS 存储和请求。
- 数据库规格。
- 云函数调用。
- 短信验证码，如果启用手机号登录。

### 19.3 成本控制原则

- 先邮箱登录，不先短信登录。
- AI 默认用国内性价比模型。
- 海外高价模型做高级开关。
- 单用户每日额度。
- 长文输入截断和摘要。
- 分析结果缓存。
- 同一批参考素材重复分析时复用结果。

---

## 20. 第一轮最小可落地版本

为了避免方案过大，第一轮只做这些：

1. 后端 API 骨架。
2. PostgreSQL 数据库。
3. 邮箱/Authing 登录。
4. 插件设备绑定。
5. folders/notes/snippets 云同步。
6. Web 读取真实文案库。
7. `/ai/analyze` 真实 AI。
8. `/ai/draft` 真实 AI。
9. staging 自动部署。
10. 插件 CI artifact。

第一轮暂不做：

- 付费系统。
- 团队空间。
- 手机号登录。
- 微信登录。
- 复杂权限。
- 向量数据库。
- 自动训练个人模型。
- 多平台内容采集。

---

## 21. 立即行动清单

### 21.1 需要用户决策

1. 大陆正式云选阿里云还是腾讯云。
2. 是否现在开始备案。
3. 账号体系先用 Authing 还是自建邮箱验证码。
4. 默认 AI 先用阿里云百炼还是 DeepSeek。
5. 是否允许海外模型作为增强选项。
6. 插件优先发布 Chrome 还是 Edge。

### 21.2 工程下一步

建议下一轮直接开始：

1. 新建 `server/api`。
2. 增加 `packages/shared` API schema。
3. 设计 Drizzle schema。
4. 写 `/health`、`/me`、folders/notes/snippets API。
5. 给 web 增加 API client。
6. 给 extension 增加 cloud repository 抽象。
7. 配置 GitHub Actions build/test。

---

## 22. 参考资料

以下链接用于核对平台能力、计费和合规边界；具体价格和限制以采购/部署当日官方页面为准。

- 阿里云函数计算 FC 计费概述：https://help.aliyun.com/zh/functioncompute/fc-3-0/product-overview/billing-overview-of-fc
- 阿里云函数计算产品说明：https://help.aliyun.com/zh/functioncompute/fc-3-0/product-overview/what-is-function-compute
- 阿里云 OSS 计费概述：https://help.aliyun.com/zh/oss/billing-overview
- 阿里云 CDN 添加加速域名与备案要求：https://help.aliyun.com/zh/cdn/getting-started/add-a-domain-name
- 阿里云百炼模型调用价格：https://help.aliyun.com/zh/model-studio/model-pricing
- DeepSeek API 模型与价格：https://api-docs.deepseek.com/quick_start/pricing/
- OpenAI API Pricing：https://openai.com/api/pricing/
- Cloudflare Workers Limits：https://developers.cloudflare.com/workers/platform/limits/
- Vercel Limits：https://vercel.com/docs/limits
- Firebase Pricing：https://firebase.google.com/pricing
- Clerk Pricing：https://clerk.com/pricing
- Authing Pricing：https://www.authing.co/pricing
- 促进和规范数据跨境流动规定：https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm
- 生成式人工智能服务管理暂行办法：https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm
- ICP 备案管理系统：https://beian.miit.gov.cn/
- 全国互联网安全管理服务平台：https://beian.mps.gov.cn/
