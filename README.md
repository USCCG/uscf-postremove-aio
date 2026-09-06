# USCardForum 帖子管理器

一个模块化 userscript，统一管理历史回帖/话题获取、普通/沉浸审核、正文与话题标题批量编辑、逐帖/批量删除、发帖拦截和新帖自动记录。

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
bun run syntax:check # 用 Bun 解析构建产物但不执行
```

`bun run check` 会依次执行 Prettier、ESLint 和 TypeScript 检查。

- 源码入口：`src/shantie.user.ts`
- 可安装产物：`dist/shantie.user.js`
- `src/` 中按职责拆分模块，由 Bun 运行构建脚本、esbuild 打包为一个 IIFE userscript。
- 不使用 `Bun.build`：当前 Bun 版本会截断中文标识符，可能导致作用域同名冲突。构建后会自动扫描这类回归。

## 界面

论坛页面只显示一个小型“帖子管理”入口。点击后打开同源的独立管理标签页，完整设置、审核、队列和日志都在该页中。

每条待定帖子都可以标记为“编辑”“删除”或“保留”。保留、编辑队列和删除队列中的帖子仍可随时改选；“沉浸审核”每次只显示一条帖子和三个决定按钮。

普通审核和沉浸审核共用审核顺序设置，可以随时切换“从新到旧”或“从旧到新”；选择会保存在当前浏览器中。

## 批量编辑

“编辑队列”页接受两个 JavaScript 函数。正文函数对回帖和话题首帖都会运行：

```js
(orig_post_full_json) => {
  const 原文 = String(orig_post_full_json.raw ?? "");
  return 原文.replaceAll("旧内容", "新内容");
};
```

话题标题函数仅对话题首帖运行：

```js
(orig_topic_full_json) => {
  const 原标题 = String(orig_topic_full_json.title ?? "");
  return 原标题.replaceAll("旧标题", "新标题");
};
```

脚本会为每条待编辑帖子获取 `/posts/:id` 的完整对象，并把正文函数返回的字符串作为新 Markdown，通过 `PUT /posts/:id` 提交。表单字段按照浏览器 HAR 构造：`post[raw]`、`post[topic_id]`、`post[edit_reason]`、`post[locale]`，并将 `post[original_text]` 固定为空字符串。

对于话题首帖，还会获取 `/t/:topic_id.json`，并通过 `PUT /t/:slug/:topic_id` 提交标题、原始标题、标签和分类。两个默认脚本都位于 `src/默认编辑脚本.js`，默认保持原内容不变；管理页支持同时预览正文和标题结果，再启动整个编辑队列。

这是一个刻意开放的高级接口：粘贴的代码与 userscript 拥有相同页面权限。只运行你自己编写或完整审阅过的脚本。

## 获取历史内容

“获取帖子”页可以选择仅回帖、仅话题或两者都获取。回帖使用 Discourse user action `reply (5)`，话题使用 `new_topic (4)`。本站的话题动态只返回 `topic_id`，不返回首帖 `post_id`，因此脚本会继续读取每个 `/t/:topic_id.json`，解析真正的首帖后放入统一队列。话题因此可以使用同一套编辑、删除和保留操作。

获取结果可以仅把新记录放入待定（保留已有决定）、把所有命中记录重新放回待定，或直接加入编辑队列。后两项是明确的批量重排操作。需要重新审核旧话题时选择“仅话题 + 命中记录全部重新进入待定”；需要批量修改旧话题时选择“仅话题 + 命中记录全部加入编辑队列”。

同步完成后会分别显示接口实际读取数、本地 ID 范围与去重后的命中数，以及命中记录最终所在的队列。已保存的最小/最大 `post_id` 会醒目提示，也可一键清空，避免把本地筛选后的数量误认为 API 只返回了少量记录。

## 远程自动审核

“设置”页可以指定一个 HTTP(S) endpoint，将待定帖子按所选顺序逐条发送。任意域名通过 userscript 的 `GM_xmlhttpRequest` 请求，因此安装或更新脚本时会申请 `@connect *` 权限。请求结构固定为：

```ts
{
  id: string;
  type: "topic" | "post";
  post_detail: object | null;
  topic_defail: object;
}
```

`topic_defail` 保留协议中约定的拼写。endpoint 必须返回：

```ts
{
  id: string;
  action: "delete" | "edit" | "keep" | "ignore";
}
```

响应中的 `id` 必须是字符串，并与请求完全一致；否则视为请求失败。`delete`、`edit` 和 `keep` 分别把帖子移入删除队列、编辑队列和保留列表，并不会立即编辑或删除论坛内容；`ignore` 会让帖子继续留在待定队列，但本轮不再请求它。

设置页还提供请求顺序、请求间隔、超时、重试次数和四种失败策略，并附有可一键复制给后端 LLM 的完整协议提示词。endpoint 会收到论坛帖子和话题的完整 JSON，因此只能配置你信任的服务。

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

`bun run privacy:check` 会扫描所有 Git 跟踪文件和当前分支的完整 commit 历史，拒绝私钥、GitHub token、凭据 URL、个人主目录和 Gmail 地址。其他邮箱域名可以使用；如果邮箱以 `users.noreply.github.com` 结尾，则姓名和邮箱身份必须属于 `wlf-bot`。该检查同时在 `bun run check`、pre-push hook 和 GitHub Actions 中执行。

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
