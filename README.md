# USCardForum 帖子管理器

一个模块化 userscript，统一管理帖子获取、人工审核、逐帖/批量删除、发帖拦截和新帖自动记录。

## 开发

```bash
bun install
bun run check
bun run build
```

常用质量命令：

```bash
bun run lint         # ESLint 检查
bun run lint:fix     # 自动修复可修复的 lint 问题
bun run format       # Prettier 格式化
bun run format:check # 只检查格式
bun run typecheck    # TypeScript 类型检查
```

`bun run check` 会依次执行 Prettier、ESLint 和 TypeScript 检查。

- 源码入口：`src/shantie.user.ts`
- 可安装产物：`dist/shantie.user.js`
- `src/` 中按职责拆分模块，由 Bun 运行构建脚本、esbuild 打包为一个 IIFE userscript。
- 不使用 `Bun.build`：当前 Bun 版本会截断中文标识符，可能导致作用域同名冲突。构建后会自动扫描这类回归。

## 界面

论坛页面只显示一个小型“帖子管理”入口。点击后打开同源的独立管理标签页，完整设置、审核、队列和日志都在该页中。

## 使用 GitHub App bot 推送

本项目默认阻止普通 `git push`，避免 credential helper 意外使用个人 GitHub 账号。推送时由本地脚本为 GitHub App 生成短期 installation token；token 不会写入 remote URL 或 Git credential helper。`bot:setup` 还会把本仓库的本地 commit 身份设置为 GitHub App bot，避免作者和提交者元数据泄露个人身份。

首次设置：

1. 创建或复用一个 GitHub App，并为目标仓库授予 **Contents: Read and write** 权限。
2. 把 App 安装到目标仓库，下载私钥并保存为项目根目录的 `.secret`。
3. 复制 `.env.example` 为 `.env`，填写 App ID 和 `owner/repository`。
4. 限制私钥权限并启用仓库 hook：

```bash
chmod 600 .secret
bun run bot:setup
```

之后照常创建本地 commit，但推送必须使用：

```bash
bun run bot:push
```

需要传递 Git push 选项时，可追加在命令后，例如 `bun run bot:push -- --dry-run`。`.env`、`.secret` 和 PEM 私钥都已被 `.gitignore` 排除。

`bun run privacy:check` 会扫描所有 Git 跟踪文件和当前分支的完整 commit 历史，拒绝私钥、GitHub token、凭据 URL、个人主目录、非公开邮箱以及非 bot 的 commit 身份。该检查同时在 `bun run check`、pre-push hook 和 GitHub Actions 中执行。

## 自动构建

`.github/workflows/build.yml` 会在 `master`/`main` push、Pull Request 和手动触发时：

1. 通过锁文件安装依赖；
2. 执行 Prettier、ESLint 和 TypeScript 检查；
3. 构建 `dist/shantie.user.js`；
4. 验证仓库中的构建产物没有过期，并上传为 Actions artifact。

使用 `v` 开头的 tag（例如 `v1.0.2`）推送后，工作流会在上述检查全部通过后创建同名 GitHub Release，并把 `dist/shantie.user.js` 作为 Release asset 上传。

```bash
git tag v1.0.2
bun run bot:push -- --follow-tags
```
