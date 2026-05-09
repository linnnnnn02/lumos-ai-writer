# Lumos AI Writer 前后端联调与上线计划

更新时间：2026-05-09  
适用范围：`web`、`extension`、`packages/shared`、`server/functions`

当前本地联调进度：

- 已建立 `server/api` Hono API，并通过 `/api/health`、`/api/v1/me`、`/api/v1/folders`、`/api/v1/notes`、`/api/v1/snippets` 跑通 Supabase。
- Web 端已接入 Supabase 邮箱密码登录，登录后可看到云端文案库数量。
- 插件 sidepanel 已接入 MVP 级云端同步：同一测试账号邮箱密码登录；保存标注时先写 `chrome.storage.local`，再同步到云端 API。
- Web 学习拆解已接入 `/api/v1/ai/analyze`，并已用 DeepSeek 跑通真实模型调用。
- Web 初版文案已接入 `/api/v1/ai/draft`；计划页进入后先显示“生成初版文案”，不再自动展示本地假稿。
- `ai_runs` 已开始记录 `analyze` / `draft` 的成功或失败、模型和 token 用量，方便 MVP 阶段观察成本与稳定性。
- 本地开发端口固定为：Web `http://localhost:5173`，API `http://localhost:8788/api`。

这份文档的目标不是做一个泛泛的技术选型表，而是把 Lumos AI Writer 从“本地前端原型 + 浏览器本地存储插件”推进到：

- 插件和网页端共用同一套账号体系。
- 小红书采集、标注、文案库、项目、对话、草稿都能云端持久化。
- 网页端不再使用 `demo-data`，而是读取真实用户数据。
- AI 分析、生成、改写、读者预演由真实模型完成。
- 开发、测试、预览、发版不依赖每次手动在本机开终端。
- MVP 阶段优先用海外免费/低成本路线验证产品闭环；验证成功后再决定是否迁回国内云做正式生产。

> 说明：本文是工程计划，不构成法律意见。涉及备案、个人信息、数据跨境、生成式 AI 服务等事项时，需要以官方规定、平台合同和专业合规意见为准。

---

## 0. 当前 MVP 决策

当前目标是 **MVP 验证**，不是一开始就按正式生产环境做完整云资源采购。

已确定：

- 部署路线：海外免费/低成本路线优先。
- 域名：继续使用阿里云注册和已备案域名，不做域名转出。
- DNS：MVP 初期优先继续用阿里云 DNS；必要时再把特定子域名或整站 DNS 切到 Cloudflare。
- Web/API：Cloudflare Pages + Pages Functions，优先把 API 放在同一域名的 `/api/*` 下，减少跨域和额外域名配置。
- 数据库/Auth/Storage：Supabase Free。
- 登录方式：MVP 先用 Supabase 默认邮件服务 + 邮箱密码；GitHub + Google OAuth 作为后续开启项，不要求用户再手动绑定一个邮箱密码账号。
- AI：DeepSeek API，所有 Key 只放后端环境变量。
- 成本目标：除 AI 调用和可能的一次性浏览器商店账号费用外，MVP 阶段尽量保持 0 固定月成本。

建议域名规划：

```text
app.yourdomain.com        MVP Web + API，同源 /api/*
preview.yourdomain.com    可选，长期预览环境
```

暂不建议 MVP 直接使用根域名，因为根域名接 Cloudflare Pages 时 DNS 约束更多；先用 `app.` 子域名足够验证产品。

保留国内路线的原因：

- 如果核心用户主要在中国大陆，海外服务访问稳定性仍可能影响体验。
- 已备案域名和腾讯云备案接入可以作为后续国内正式生产的迁移基础。
- MVP 跑通后，可以把 Cloudflare/Supabase 迁到阿里云/腾讯云 + 国内数据库 + 国内 CDN。

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

### 2.1 MVP 推荐主线：海外 0 成本验证环境

当前推荐先用这一套做 MVP：

```text
用户浏览器
  ├─ Web App: React SPA
  └─ Browser Extension: WXT MV3

阿里云域名
  └─ app.yourdomain.com CNAME 到 Cloudflare Pages

账号体系
  ├─ Supabase Auth 邮箱登录
  └─ 插件通过 Web 登录态/设备码绑定同一账号

海外免费/低成本云资源
  ├─ Web 静态站: Cloudflare Pages
  ├─ API: Cloudflare Pages Functions，同源 /api/*
  ├─ 数据库: Supabase Postgres Free
  ├─ 文件存储: Supabase Storage Free，早期尽量只保存图片 URL
  └─ 日志: Cloudflare/Supabase 基础日志 + 应用内 ai_runs 记录

AI 服务
  ├─ 默认: DeepSeek API
  └─ 后端通过统一 AI Provider Adapter 调用，前端和插件永不接触 API Key
```

MVP 阶段的核心判断：

- 先验证“插件采集 -> 云端文案库 -> Web 选择素材 -> DeepSeek 生成/改写”的闭环。
- 不先采购国内 RDS、对象存储、短信、Authing 或正式 CDN。
- 不为了长期生产架构提前承担固定月成本。
- 代码仍保持可迁移，后端接口和共享 schema 不写死在某个前端组件里。

### 2.2 验证成功后的大陆正式生产环境

如果 MVP 证明用户愿意用，再迁移到国内生产主线：

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
  ├─ 默认: DeepSeek API
  ├─ 可选: 阿里云百炼 Qwen / 火山方舟
  └─ 后端通过统一 AI Provider Adapter 调用，前端和插件永不接触 API Key
```

### 2.3 为什么 MVP 不先上国内正式资源

Firebase、Supabase、Vercel、Cloudflare 很适合快速试验和海外免费部署。如果第一批核心用户在中国大陆，仍然有三个现实问题：

1. 访问稳定性不可控。  
   大陆用户访问海外服务时，DNS、跨境链路、第三方脚本、验证码、OAuth 回调都有不确定性。

2. 合规链路更复杂。  
   如果用户笔记、标注、草稿等个人内容默认存到海外，后续需要处理数据出境告知、同意、评估或标准合同等问题。

3. AI 请求链路可能变慢。  
   真实 AI 生成如果走海外模型，大陆用户会明显感觉等待时间和失败率。

但是当前目标是 MVP 验证，不是正式大规模服务。因此第一阶段接受这些限制，换取：

- 0 固定月成本。
- 自动 preview/staging。
- 更快打通数据库、Auth、部署和 AI 调用。
- 更少运维和备案接入操作。

一旦出现真实用户留存、频繁使用或国内访问稳定性问题，再启动国内迁移。

---

## 3. 服务器与云平台选型

### 3.1 选型结论

推荐分三档：

| 档位 | 用途 | 推荐组合 | 适合阶段 |
|---|---|---|---|
| A. 海外免费 MVP | 尽快验证产品闭环 | Cloudflare Pages/Functions + Supabase Free + DeepSeek + 阿里云域名 | 当前阶段 |
| B. 大陆正式主线 | 面向中国大陆用户正式使用 | 阿里云 OSS/CDN + FC/SAE + RDS PostgreSQL + DeepSeek/Authing | MVP 验证成功后 |
| C. 大陆快速低运维 | 尽快把云端打通 | 腾讯云 CloudBase/SCF + 云数据库 + COS/CDN + DeepSeek | 如果想回国内但继续少运维 |

### 3.2 当前首选：Cloudflare + Supabase

推荐理由：

- Cloudflare Pages 可以免费部署 Web，并自动生成 preview。
- Pages Functions 可以承载轻量 API，MVP 可以把接口放在同源 `/api/*` 下。
- Supabase Free 自带 Postgres、Auth、Storage 和基础管理界面。
- DeepSeek API 兼容 OpenAI 风格调用，适合先快速接入真实 AI。
- 阿里云域名无需转出，只要给 `app.` 子域名增加 CNAME。

建议资源：

- Web 静态站点：Cloudflare Pages。
- API：Cloudflare Pages Functions，路径 `/api/*`。
- 数据库：Supabase Postgres。
- Auth：Supabase Auth 邮箱登录。
- Storage：Supabase Storage，MVP 只存必要附件；小红书封面先保存 URL，不搬运图片。
- Secrets：Cloudflare Pages 环境变量。
- AI：DeepSeek API。

MVP 阶段建议：

- 普通业务 CRUD 尽量走后端 API，前端不直接接触服务端密钥。
- Auth 可以用 Supabase 用户 session，API 通过 Supabase JWT 识别用户。
- 数据库 schema 先用 Supabase SQL migration；Drizzle 可以后续迁移国内 Node/RDS 时再引入。
- API 写成清晰 service/repository 边界，避免未来迁移时全量重写前端。

限制：

- Cloudflare Workers/Pages Functions 有运行时和请求限制，不适合长时间任务。
- Supabase Free 有容量和休眠限制，适合 MVP，不适合长期正式生产。
- 大陆用户访问海外服务可能不稳定。

### 3.3 验证成功后：阿里云主线

适合产品已经验证、需要面向中国大陆用户稳定访问时启用。

推荐理由：

- 中国大陆访问稳定。
- 静态托管、CDN、函数计算、RDS、OSS、日志、密钥管理都齐。
- 域名备案、CDN、HTTPS、监控链路相对完整。
- 已有阿里云域名和腾讯云备案接入，后续国内切换条件较好。

建议资源：

- Web 静态站点：OSS Bucket + CDN。
- API：阿里云函数计算 FC 3.0，或 SAE 部署 Node.js API。
- 数据库：RDS PostgreSQL。
- 对象存储：OSS。
- 日志：SLS。
- 密钥：KMS 或函数计算环境变量 + RAM 最小权限。
- AI：DeepSeek 默认；必要时增加百炼 Qwen 作为国内备用。

### 3.4 备选：腾讯云 CloudBase 主线

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

- 如果海外 MVP 的访问体验不行，但仍希望低运维，可以选 CloudBase。
- 如果目标是“长期产品化、账号体系、AI 用量、项目版本历史都要沉淀”，更推荐 PostgreSQL。

---

## 4. 域名、备案与访问策略

### 4.1 MVP 域名策略

当前域名在阿里云，腾讯云已经导入备案。MVP 阶段不需要转出域名，也不需要立刻把整站 DNS 迁到 Cloudflare。

推荐先用子域名：

```text
app.yourdomain.com      MVP Web + API，同源 /api/*
preview.yourdomain.com  可选，长期预览环境
```

DNS 操作：

1. 在 Cloudflare Pages 创建项目。
2. 绑定 `app.yourdomain.com`。
3. 在阿里云 DNS 中给 `app` 增加 CNAME，指向 Cloudflare Pages 提供的目标地址。
4. 等待 HTTPS 证书签发完成。
5. Extension 的 `WXT_PUBLIC_WEB_APP_URL` 和 `WXT_PUBLIC_API_BASE_URL` 指向这个子域名。

API 域名策略：

- MVP 优先不单独开 `api.` 子域名。
- 使用 `https://app.yourdomain.com/api/*`，让 Web 和 API 同源，减少 CORS、Cookie 和插件配置复杂度。
- 如果后面 API 独立部署成 Worker 或国内 API，再切到 `api.yourdomain.com`。

### 4.2 备案的角色

当前已经有备案是好事，但海外 MVP 不依赖备案。

需要区分：

- 域名注册在阿里云：只影响购买、续费、实名认证和 DNS 管理入口。
- 腾讯云导入备案：主要用于以后接腾讯云中国内地资源。
- Cloudflare/Supabase 海外服务：不因为已有备案而自动获得国内访问加速。

MVP 阶段：

- 可以正常把子域名解析到海外服务。
- 保留腾讯云备案接入，作为以后国内部署基础。
- 不把备案作为当前开发阻塞项。

正式国内上线前：

- 如果使用中国内地 CDN、OSS/COS 静态托管、FC/SCF/CloudBase 等，域名通常需要备案接入到对应服务商。
- 需要确认备案主体、接入服务商、加速域名和实际部署资源一致。
- 如果长期完全不使用国内接入资源，接入商可能做接入核查；这不影响海外 MVP 技术可行性，但后续正式国内路线要重新核对。

### 4.3 国内迁移时的域名策略

如果 MVP 成功，需要迁回国内生产，推荐域名规划：

```text
app.yourdomain.com      正式网页端
api.yourdomain.com      正式 API
assets.yourdomain.com   静态资源/附件/导出文件
staging.yourdomain.com  预发布环境
```

迁移流程：

1. 创建国内 Web/API/DB 资源。
2. 从 Supabase 导出数据并迁入国内 PostgreSQL。
3. 切换 `api.` 到国内 API。
4. 切换 `app.` 到国内静态站/CDN。
5. 更新插件生产环境 API base URL。
6. 保留海外环境作为 preview 或海外 demo。

### 4.4 正式上线前必须补齐

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

#### Phase 1：邮箱密码登录

最推荐第一版先做：

- 用户输入邮箱和密码。
- Supabase 用默认邮件服务处理注册确认和找回密码。
- 登录网页端。
- 插件通过同一账号授权。

优点：

- 跨浏览器。
- 不依赖手机号短信成本。
- 不依赖微信开放平台审核。
- 对海外方案也通用。

MVP 小范围测试前再评估是否继续使用 Supabase 默认邮件，还是切到自定义 SMTP/邮件服务，避免送达率和品牌可信度影响测试反馈。

#### Phase 2：GitHub + Google OAuth

产品体验上可以只开放三方登录，不要求用户额外绑定邮箱密码；但 OAuth provider 通常仍会向 Supabase 返回 email，Supabase 会把它作为账号资料和同邮箱身份合并线索保存。

适合英文路线或开发者用户测试。国内正式路线再评估微信/手机号。

#### Phase 3：手机号登录

大陆用户熟悉，但短信成本、风控和实名通道会更复杂。

建议等第一批用户试用后再加。

#### Phase 4：微信登录

非常适合中国大陆用户，但需要：

- 微信开放平台或公众号体系。
- 域名备案。
- 审核。
- 移动端/网页端回调配置。

建议作为正式增长阶段能力，不挡 MVP。

### 5.2 Supabase Auth vs 后续国内登录

#### MVP：Supabase Auth

优点：

- 和 Supabase Postgres/RLS 集成自然。
- 邮箱密码能快速上线，默认邮件服务可以支撑早期开发联调。
- GitHub/Google OAuth 可以后续接入同一套 Supabase 用户体系。
- Free 阶段足够 MVP 验证。
- Web 端接入成本低。

缺点：

- 大陆邮箱送达和访问稳定性需要实际测试。
- 如果后续迁回国内云，需要迁移用户身份或做账号绑定。
- 插件端不能直接假设网页 Cookie 可用，需要单独绑定流程。

#### 后续国内路线：Authing 或自建邮箱验证码

优点：

- Authing 国内访问和微信/手机号扩展更友好。
- 自建邮箱验证码成本可控，数据更可控。

缺点：

- Authing 免费/付费边界要以采购当日为准。
- 自建要自己做验证码、频控、防刷、密码/会话安全。

#### 推荐

第一版建议：

- **MVP 验证：Supabase Auth 邮箱密码登录。**
- **MVP 后续：GitHub + Google OAuth。**
- **国内正式生产：再评估 Authing 或自建邮箱验证码。**

本文后续按“Supabase Auth + 后端校验 Supabase JWT”设计，同时保留国内账号体系的迁移口。

### 5.3 Web 登录流程

MVP 推荐先用 Supabase Auth 的邮箱密码，使用 Supabase 默认邮件处理注册确认。

流程：

```text
1. 用户打开 web app。
2. 未登录时可打开登录弹窗。
3. 用户输入邮箱和密码。
4. Supabase 注册或校验邮箱密码。
5. 登录成功后 Web 获得 Supabase session。
6. 前端调用 /api/v1/me。
7. API 校验 Supabase JWT。
8. API 创建/更新本地 profile/users 映射并返回用户信息。
```

为什么 MVP 接受 Supabase session：

- 接入最快。
- 与 Supabase RLS 和用户表自然集成。
- 后续如果迁回国内，可以在 API 层替换 session 校验方式，前端调用路径不大改。

### 5.4 插件登录流程

浏览器插件不能简单依赖网页端 Cookie，因为：

- 插件运行在 `chrome-extension://` 域下。
- sidepanel/options/content script 上下文不同。
- Cookie、CORS、权限和刷新 token 都要单独处理。

MVP 推荐设备码/一次性绑定码。

流程：

```text
1. 插件点击登录。
2. 插件请求 /api/v1/auth/extension/link/start。
3. 后端返回一次性 deviceCode 和绑定链接。
4. 插件打开 Web 绑定页。
5. 用户在 Web 端用 Supabase 登录。
6. Web 确认绑定 deviceCode。
7. 插件轮询 /api/v1/auth/extension/link/poll。
8. 后端签发插件专用 token 或 refresh token。
9. 插件把 token 存到 chrome.storage.local。
10. 插件后续请求 API 时携带 token。
```

需要修改：

- 增加 `extension/lib/auth.ts`。
- sidepanel/options 顶部增加登录状态。
- API 增加 extension_devices、device_code、token refresh/revoke。

优点：

- 跨 Chrome/Edge/国产浏览器更稳。
- 不强依赖 `chrome.identity`。
- 插件端实现更可控。
- 后端可以清楚记录“这个插件设备属于哪个用户”。

缺点：

- 需要多一步“绑定确认”。
- 轮询和过期逻辑要做严谨。
- 以后如果要改成 OAuth PKCE，需要再补浏览器扩展 redirect URI 配置。

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

MVP 推荐 Supabase Postgres，本质仍是 PostgreSQL。

原因：

- 用户、文件夹、笔记、片段、项目、对话、AI run、版本历史之间关系明确。
- 查询、筛选、分页、全文搜索、统计更自然。
- 未来做付费、团队空间、权限、导出更稳。
- 可以用 JSONB 存放 AI 分析结构，不牺牲关系模型。
- Supabase 自带 Auth、RLS、SQL Editor 和基础管理面板，适合 0 成本 MVP。

### 6.2 ORM/迁移工具

MVP 推荐：

- Supabase SQL migration。
- Supabase RLS。
- Zod 做 API 输入输出 schema。

暂不在 Cloudflare Pages Functions runtime 里强依赖 Drizzle，因为边缘运行时连接 PostgreSQL 的方式和 Node/RDS 不完全一样。

国内正式生产迁移后，可以改为：

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

### 9.2 MVP 默认模型池

当前 MVP 默认只接 DeepSeek。

推荐原因：

- 成本低，适合 MVP 高频试错。
- OpenAI 格式兼容，后端 provider adapter 容易写。
- 中文写作、拆解和改写能力足够先验证产品价值。
- 不需要同时维护多家模型配置和预算。

建议默认组合：

```text
学习拆解: deepseek-v4-flash
初稿生成: deepseek-v4-flash
局部改写: deepseek-v4-flash
读者预演: deepseek-v4-flash / deepseek-v4-pro 按质量需求选择
```

接入时按 DeepSeek 2026-05 官方文档使用 OpenAI 兼容 Chat Completions，并通过 `response_format: { type: "json_object" }` 要求结构化 JSON 输出。旧模型名需以官方 deprecation 说明为准。

后续迁回国内生产时，可以再补：

1. 阿里云百炼 Qwen 系列  
   优点：大陆采购、网络稳定、中文能力强、可与阿里云资源同账号管理。

2. 火山方舟  
   优点：国内云厂商、模型选择多，适合后续做多模型路由。

迁移后的多模型组合可以是：

```text
学习拆解: deepseek-chat / qwen-max
初稿生成: deepseek-chat / qwen-max
局部改写: deepseek-chat / qwen-plus
读者预演: deepseek-chat / qwen-max
兜底模型: deepseek-chat
```

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

#### MVP DeepSeek 采购

1. 注册 DeepSeek 平台账号。
2. 开通 API 服务。
3. 设置预算告警或充值上限。
4. 创建 API Key。
5. 后端环境变量配置：

```text
AI_PROVIDER_PRIMARY=deepseek
DEEPSEEK_API_KEY=...
```

6. 后端保存每次调用：
   - provider
   - model
   - input tokens
   - output tokens
   - estimated cost
   - latency
   - status

#### 后续海外增强模型采购

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
  deepseek.ts
  aliyun-bailian.ts
  openai.ts
  volc-ark.ts
```

MVP 第一版只实现 `deepseek.ts`，其他 provider 先保留接口位置。

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
      worker.ts
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
          deepseek.ts
          aliyun-bailian.ts
          openai.ts
      db/
        supabase-server.ts
        migrations/
      middleware/
        require-auth.ts
        rate-limit.ts
        request-id.ts
        error-handler.ts
      config.ts
    package.json
```

MVP 可以把 Cloudflare Pages Functions 的入口放在 `web/functions/api/[[path]].ts`，再复用 `server/api/src/app.ts` 的 Hono app。这样开发目录清晰，部署又能贴合 Cloudflare Pages。

也可以保留 `server/functions` 的旧占位，但真实 API 建议迁到 `server/api`，因为它不应该被某一家国内云函数平台绑定。

### 10.2 技术栈

MVP 推荐：

- TypeScript。
- Hono。
- Zod。
- Supabase JS server client。
- Supabase SQL migration。
- Vitest 单元测试。

本地开发端口：

```bash
corepack pnpm dev:api  # http://localhost:8788
corepack pnpm dev:web  # http://localhost:5173，/api 代理到 8788
```

说明：当前本机 `8787` 可能被 Codex 本地服务占用，因此 Lumos API 本地默认使用 `8788`。

国内生产迁移后可补：

- Node.js 20+。
- TypeScript。
- Hono 或 Fastify。
- Drizzle ORM。
- Zod。
- Pino 日志。
- OpenAPI 文档。
- Vitest 单元测试。

Hono 更轻，适合 Cloudflare Pages Functions/Workers；Fastify 插件生态更成熟，但更适合后续 Node 服务。

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
https://app.yourdomain.com
https://preview.yourdomain.com
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
- Supabase service role key。
- Supabase JWT secret。
- DeepSeek API Key。
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

1. 增加登录页和 `/api/v1/me`。
2. 项目页从 API 读取 projects。
3. 文案选择页从 API 读取 folders/notes/snippets。
4. 学习拆解调用 `/api/v1/ai/analyze`。
5. 文案创作调用 `/api/v1/ai/draft`。
6. 编辑细调调用 `/api/v1/ai/rewrite`。
7. 读者预演调用 `/api/v1/ai/reader-preview`。
8. 草稿编辑实时保存或手动保存。

### 11.2 插件端

需要新增：

```text
extension/lib/cloud-api.ts
extension/lib/cloud-auth.ts
extension/lib/api-client.ts        后续可合并抽象
extension/lib/auth.ts              后续设备码绑定时补充
extension/lib/repository.ts
extension/lib/sync-queue.ts
extension/components/login-banner.tsx
```

改造顺序：

1. 插件展示登录状态。已完成 MVP 版。
2. 登录后绑定设备。MVP 先用插件内邮箱密码登录，设备码绑定后续补。
3. 保存笔记改为调用 API。已完成 MVP 版。
4. 保存片段改为调用 API。已完成 MVP 版。
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

MVP 海外免费主线：

- Cloudflare Pages 连接 GitHub 仓库。
- PR 自动生成 preview deployment。
- `main` 自动部署到 production/staging。
- API 使用 Pages Functions，同仓库同域名部署。

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
VITE_API_BASE_URL=/api
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Extension：

```text
WXT_PUBLIC_APP_ENV=staging
WXT_PUBLIC_API_BASE_URL=https://app.yourdomain.com/api
WXT_PUBLIC_WEB_APP_URL=https://app.yourdomain.com
WXT_PUBLIC_SUPABASE_URL=...
WXT_PUBLIC_SUPABASE_ANON_KEY=...
```

API：

```text
APP_ENV=staging
PUBLIC_APP_URL=https://app.yourdomain.com
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_JWT_SECRET=...
AI_PROVIDER_PRIMARY=deepseek
DEEPSEEK_API_KEY=...
AI_DAILY_BUDGET_CNY=...
```

---

## 14. 联调阶段计划

### Phase 0：MVP 账号和云资源准备

目标：把必须由用户亲自操作的外部资源准备好。

用户需要做：

- 确认阿里云域名可添加 DNS 记录。
- 注册 Cloudflare 账号。
- 注册 Supabase 账号。
- 注册 DeepSeek 平台账号并创建 API Key。
- 准备 GitHub 仓库权限，用于 Cloudflare Pages 自动部署。
- 可选：如果插件要发布商店，准备 Chrome Web Store 开发者账号。

工程输出：

- Cloudflare Pages 项目。
- Supabase 项目。
- DeepSeek provider 配置。
- 环境变量模板。
- 成本预估表。

验收标准：

- `https://app.yourdomain.com` 可访问。
- `https://app.yourdomain.com/api/health` 可访问。
- Supabase 数据库可连接。
- 有 AI Key。

### Phase 1：MVP 后端/API 骨架

目标：建立真实 API 服务。

任务：

- 创建 `server/api` 或 Cloudflare Pages Functions API 入口。
- 接入 Hono。
- 接入 Zod。
- 接入 Supabase server client。
- 建立 users/folders/notes/snippets 基础表。
- 增加 `/health` 和 `/api/v1/me`。
- 增加 API schema 文档。

验收：

- `GET /api/health` 返回 ok。
- Cloudflare Pages 部署成功。
- CI 能 typecheck/build。
- Supabase SQL migration 可重复执行。

### Phase 2：Supabase 账号登录

目标：Web 端能登录，后端能识别用户。

任务：

- 接 Supabase Auth 邮箱密码登录。
- Web 增加登录入口。
- 数据库创建 users/profile 映射。
- API 校验 Supabase JWT。
- `/api/v1/me` 返回当前用户。

验收：

- 未登录可以继续看本地 demo 工作台，并可打开登录入口。
- 登录后可看到用户信息。
- 退出后 session 失效。

当前本地状态：已完成。测试账号可通过 Web 登录，`/api/v1/me` 能识别用户并 upsert profile。

### Phase 3：插件设备绑定

目标：插件也能登录同一个账号。

任务：

- 实现设备码绑定。
- 插件打开绑定页。
- Web 登录后确认绑定。
- 插件拿到可刷新登录状态或插件专用 token。
- 后端记录 extension_devices。

验收：

- 插件 sidepanel 显示已登录账号。
- 网页端可看到已绑定插件设备。
- 网页端能撤销插件登录。

当前本地状态：MVP 先完成“插件内邮箱密码登录 + token 存本地”。正式设备码绑定、设备表和撤销登录后移。

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

当前本地状态：API 与插件 sidepanel 保存链路已跑通。Web 目前先显示云端数量，文案库详情页仍需从 demo data 迁到 API 数据。

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
- 实现 `/api/v1/ai/analyze`。已完成 MVP 版。
- 保存 ai_runs。
- 保存 assistant chat message。
- 前端展示真实返回。已完成 MVP 版，等待 `DEEPSEEK_API_KEY` 做真实调用验收。

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
- Supabase service role key 只放后端。
- 前端和插件只能使用 Supabase anon key，并依赖 RLS/API 鉴权。
- API 必须鉴权。
- 所有用户数据查询必须带 `user_id`。
- 所有写接口必须做 rate limit。
- 上传文件必须限制类型和大小。
- 日志不能记录完整用户正文和完整 prompt。
- 只记录 prompt hash、长度、摘要和必要错误信息。

### 16.2 个人信息与数据出境

MVP 默认使用 Cloudflare/Supabase 海外服务和 DeepSeek API，需要把它当作海外/跨境处理来设计。

必须做到：

- 小范围测试时明确告知用户这是 MVP 测试环境。
- 隐私政策里说明数据存储和模型调用服务。
- 不收集和处理不必要的敏感个人信息。
- 默认不要自动把用户整个文案库发给模型；只发送本次选择的参考内容。
- 记录每次 AI 调用的 provider/model、token、成本和状态。

如果后续迁回大陆云和大陆模型，合规压力会降低，但仍需要隐私政策、用户协议、数据删除/导出和账号注销入口。

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
- Supabase 存储/出站流量。
- Cloudflare Functions 请求量。

### 17.2 告警

必须配置：

- AI 日成本超过阈值。
- API 5xx 超过阈值。
- Supabase 请求或 DB 错误升高。
- Supabase DB/Storage 接近 Free 限制。
- Cloudflare Functions 错误率升高。
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

- 域名续费，当前已有域名则不算新增月成本。
- Supabase Free，MVP 阶段 0 固定月成本。
- Cloudflare Pages/Functions Free，MVP 阶段 0 固定月成本。
- DeepSeek API 预充值或按量费用。
- 浏览器插件商店开发者账号费用。

### 19.2 变动成本

主要来自：

- AI token。
- Supabase 超出 Free 后的数据库、存储和出站流量。
- Cloudflare 超出 Free 后的请求或高级能力。
- 浏览器商店发布费用。
- 邮件服务，如果需要自定义 SMTP 或更稳定送达。

### 19.3 成本控制原则

- 先邮箱登录，不先短信登录。
- AI 默认用 DeepSeek。
- 暂不接 OpenAI 等更高价模型。
- 单用户每日额度。
- 长文输入截断和摘要。
- 分析结果缓存。
- 同一批参考素材重复分析时复用结果。
- 只保存小红书图片 URL，不在 MVP 阶段搬运封面图片到自有存储。

---

## 20. 第一轮最小可落地版本

为了避免方案过大，第一轮只做这些：

1. Cloudflare Pages 部署 Web。
2. 阿里云 DNS 绑定 `app.` 子域名。
3. Cloudflare Pages Functions / API 骨架。
4. Supabase Auth 邮箱登录。
5. Supabase Postgres schema、RLS 和基础 migration。
6. 插件设备绑定或最小登录态桥接。
7. folders/notes/snippets 云同步。
8. Web 读取真实文案库。
9. DeepSeek `/ai/analyze` 和 `/ai/draft`。
10. GitHub 自动部署和插件 CI artifact。

第一轮暂不做：

- 付费系统。
- 团队空间。
- 手机号登录。
- 微信登录。
- 复杂权限。
- 向量数据库。
- 自动训练个人模型。
- 多平台内容采集。
- 国内云迁移。
- 独立 `api.` 子域名。
- 图片搬运和自有对象存储。

---

## 21. 立即行动清单

### 21.1 已确定决策

1. MVP 阶段使用海外免费/低成本路线。
2. 域名继续在阿里云。
3. 腾讯云备案接入先保留，暂不作为 MVP 阻塞项。
4. 默认 AI 使用 DeepSeek。
5. MVP 先用 Supabase 默认邮件 + 邮箱密码，后续开启 GitHub + Google OAuth。
6. 非 AI 固定月成本尽量保持 0。

### 21.2 仍需用户确认

1. MVP 子域名是否使用 `app.yourdomain.com`。
2. 插件内测优先本地加载 zip，还是尽早注册 Chrome Web Store。

### 21.3 工程下一步

建议下一轮直接开始：

1. 填入 `DEEPSEEK_API_KEY`，验收真实学习拆解调用。
2. 保存 ai_runs，记录 provider/model/token/status，便于后续成本控制。
3. 接入真实初稿生成 `/api/v1/ai/draft`。
4. 配置 Cloudflare Pages 自动部署和 GitHub Actions build/test。
5. 补插件同步队列：云端失败时可重试，避免用户重复点保存。
6. 后续再做正式插件设备码绑定、设备列表和撤销登录。

---

## 22. 参考资料

以下链接用于核对平台能力、计费和合规边界；具体价格和限制以采购/部署当日官方页面为准。

- 阿里云函数计算 FC 计费概述：https://help.aliyun.com/zh/functioncompute/fc-3-0/product-overview/billing-overview-of-fc
- 阿里云函数计算产品说明：https://help.aliyun.com/zh/functioncompute/fc-3-0/product-overview/what-is-function-compute
- 阿里云 OSS 计费概述：https://help.aliyun.com/zh/oss/billing-overview
- 阿里云 CDN 添加加速域名与备案要求：https://help.aliyun.com/zh/cdn/getting-started/add-a-domain-name
- 阿里云百炼模型调用价格：https://help.aliyun.com/zh/model-studio/model-pricing
- DeepSeek API 模型与价格：https://api-docs.deepseek.com/quick_start/pricing/
- Cloudflare Pages 自定义域名：https://developers.cloudflare.com/pages/configuration/custom-domains/
- Cloudflare Pages Functions 价格：https://developers.cloudflare.com/pages/functions/pricing/
- OpenAI API Pricing：https://openai.com/api/pricing/
- Cloudflare Workers Limits：https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers Pricing：https://developers.cloudflare.com/workers/platform/pricing/
- Supabase Pricing：https://supabase.com/pricing
- Vercel Limits：https://vercel.com/docs/limits
- Firebase Pricing：https://firebase.google.com/pricing
- Clerk Pricing：https://clerk.com/pricing
- Authing Pricing：https://www.authing.co/pricing
- 促进和规范数据跨境流动规定：https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm
- 生成式人工智能服务管理暂行办法：https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm
- ICP 备案管理系统：https://beian.miit.gov.cn/
- 全国互联网安全管理服务平台：https://beian.mps.gov.cn/
