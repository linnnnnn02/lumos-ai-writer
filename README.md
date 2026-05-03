# XHS AI Studio

一个面向小红书创作场景的 AI 辅助工具。

当前仓库已经包含：

- `web`：网页端 React + Vite + Tailwind + shadcn 风格基础
- `extension`：浏览器插件骨架
- `packages/shared`：共享类型
- `server/functions`：CloudBase 云函数占位
- `design.md`：全仓 UI 设计语言规范
- `DEVELOPER.md`：产品与技术规划
- `HUMAN_CHECKPOINTS.md`：长期人工节点说明

## 当前进度

这次已经完成了：

- 单仓工程结构初始化
- 网页端首页改造成产品落地页
- 插件 popup 基础界面
- 共享类型与云函数占位代码
- TypeScript 类型检查通过

当前还没完成的一步是：

- 在“正常本机 Node 环境”下跑通 `vite / wxt` 的构建与开发命令

这不是代码逻辑问题，而是 Codex 内置运行时对原生构建依赖有签名限制，导致我在这个线程里没法替你完成最终构建验证。

## 你现在需要亲自做的第一件事

### 目标

让你的电脑具备“正常前端开发环境”，这样我们下一步就能真正把网页和插件跑起来。

### 第 1 步：安装 Node.js

1. 打开 [Node.js 官网](https://nodejs.org/)
2. 下载 `LTS` 版本
3. 双击安装包
4. 一路点击继续，保持默认设置

安装完成后：

1. 打开终端
2. 输入 `node -v`
3. 输入 `npm -v`

如果都能看到版本号，说明安装成功。

### 第 2 步：安装 pnpm

安装完 Node.js 后，继续在终端输入：

```bash
npm install -g pnpm
```

然后输入：

```bash
pnpm -v
```

如果能看到版本号，就说明 `pnpm` 也装好了。

### 第 3 步：在项目目录安装依赖

进入这个项目目录后，运行：

```bash
pnpm install
```

### 第 4 步：先启动网页端

运行：

```bash
pnpm dev:web
```

如果终端里出现本地地址，通常会长这样：

```bash
http://localhost:5173
```

用浏览器打开它。

### 第 5 步：再启动插件端

另开一个终端窗口，运行：

```bash
pnpm dev:extension
```

这一步会生成插件开发产物。

然后：

1. 打开 Chrome
2. 进入扩展程序页面
3. 打开右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择 WXT 生成出来的开发目录

如果你运行到这里，我会继续带你完成插件加载和调试。

## 你回来告诉我什么

你完成上面的步骤后，只需要把下面 3 件事告诉我：

1. `node -v` 的结果
2. `pnpm -v` 的结果
3. `pnpm dev:web` 和 `pnpm dev:extension` 有没有报错

只要你把报错原文贴给我，我就继续帮你处理。
