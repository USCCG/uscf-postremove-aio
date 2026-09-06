import { createSign } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const GitHub接口版本 = "2022-11-28";
const GitHub接口地址 = "https://api.github.com";
const 默认私钥路径 = ".secret";

type GitHub应用信息 = { slug?: string };
type GitHub安装信息 = { id?: number; account?: { login?: string } };
type GitHub安装令牌 = { token?: string; expires_at?: string };

async function 主程序(): Promise<void> {
  const 仅安装钩子 = process.argv.includes("--setup-only");
  const 推送参数 = process.argv.slice(2).filter((参数) => 参数 !== "--setup-only");

  确认位于Git仓库();
  安装推送保护钩子();
  const 应用编号 = 读取必需环境变量("GITHUB_APP_ID");
  const 私钥 = 读取GitHub应用私钥();
  const 应用令牌 = 创建应用JWT(应用编号, 私钥);

  const 应用 = await 请求GitHub接口<GitHub应用信息>("/app", 应用令牌);
  if (!应用.slug) throw new Error("GitHub 没有返回 App slug。");
  const 机器人姓名 = `${应用.slug}[bot]`;
  const 机器人邮箱 = `${应用编号}+${机器人姓名}@users.noreply.github.com`;
  设置提交身份(机器人姓名, 机器人邮箱);

  if (仅安装钩子) {
    console.log(`已启用 pre-push 保护，本仓库的 commit 身份已设为 ${机器人姓名}。`);
    return;
  }

  执行Git(["run", "privacy:check"], {}, "bun");
  const { 所有者, 仓库名 } = 解析目标仓库();

  const 安装 = await 请求GitHub接口<GitHub安装信息>(
    `/repos/${encodeURIComponent(所有者)}/${encodeURIComponent(仓库名)}/installation`,
    应用令牌,
  );
  if (!安装.id) throw new Error(`请先把 ${应用.slug} 安装到 ${所有者}/${仓库名}。`);

  const 安装令牌 = await 请求GitHub接口<GitHub安装令牌>(`/app/installations/${安装.id}/access_tokens`, 应用令牌, {
    method: "POST",
    body: JSON.stringify({ repositories: [仓库名] }),
  });
  if (!安装令牌.token) throw new Error("GitHub 没有返回 installation token。");

  const 当前分支 = Git输出(["branch", "--show-current"]);
  if (!当前分支) throw new Error("不支持 detached HEAD，请先切换到一个分支。");

  const 基础认证 = Buffer.from(`x-access-token:${安装令牌.token}`).toString("base64");
  const 远端地址 = `https://github.com/${所有者}/${仓库名}.git`;
  执行Git(["push", ...推送参数, 远端地址, `${当前分支}:${当前分支}`], {
    // 凭据只存在于子进程环境中，不写入 origin、credential helper 或命令行参数。
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${基础认证}`,
    GIT_TERMINAL_PROMPT: "0",
    GITHUB_APP_PUSH_AUTHORIZED: "1",
  });
  console.log(`已把 ${当前分支} 推送为 ${应用.slug}[bot]。`);
}

function 确认位于Git仓库(): void {
  Git输出(["rev-parse", "--show-toplevel"]);
}

function 安装推送保护钩子(): void {
  执行Git(["config", "--local", "core.hooksPath", ".githooks"]);
}

function 设置提交身份(姓名: string, 邮箱: string): void {
  执行Git(["config", "--local", "user.name", 姓名]);
  执行Git(["config", "--local", "user.email", 邮箱]);
}

function 解析目标仓库(): { 所有者: string; 仓库名: string } {
  const 已配置仓库 = process.env.GITHUB_REPOSITORY?.trim();
  if (已配置仓库) {
    const [所有者, 仓库名, ...多余部分] = 已配置仓库.split("/");
    if (所有者 && 仓库名 && 多余部分.length === 0) return { 所有者, 仓库名 };
    throw new Error("GITHUB_REPOSITORY 必须使用 owner/repository 格式。");
  }

  const origin = Git输出(["remote", "get-url", "origin"])
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  const 匹配 = origin.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
  if (!匹配) throw new Error("无法从 origin 推断 GitHub 仓库，请在 .env 设置 GITHUB_REPOSITORY。");
  return { 所有者: 匹配[1], 仓库名: 匹配[2] };
}

function 读取必需环境变量(名称: string): string {
  const 值 = process.env[名称]?.trim();
  if (!值) throw new Error(`缺少 ${名称}，请复制 .env.example 为 .env 后填写。`);
  return 值;
}

function 读取GitHub应用私钥(): string {
  const 环境变量私钥 = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (环境变量私钥) return 环境变量私钥.replaceAll("\\n", "\n");

  const 私钥路径 = process.env.GITHUB_APP_PRIVATE_KEY_PATH?.trim() || 默认私钥路径;
  if (process.platform !== "win32") {
    const 权限 = statSync(私钥路径).mode & 0o777;
    if ((权限 & 0o077) !== 0) {
      throw new Error(`${私钥路径} 不能允许组内或其他用户读取，请执行 chmod 600 ${私钥路径}。`);
    }
  }
  return readFileSync(私钥路径, "utf8");
}

function 创建应用JWT(应用编号: string, 私钥: string): string {
  const 当前秒 = Math.floor(Date.now() / 1000);
  const 头部 = 编码JSON({ alg: "RS256", typ: "JWT" });
  const 载荷 = 编码JSON({ iat: 当前秒 - 60, exp: 当前秒 + 9 * 60, iss: 应用编号 });
  const 待签名内容 = `${头部}.${载荷}`;
  const 签名器 = createSign("RSA-SHA256");
  签名器.update(待签名内容);
  签名器.end();
  return `${待签名内容}.${签名器.sign(私钥).toString("base64url")}`;
}

function 编码JSON(值: unknown): string {
  return Buffer.from(JSON.stringify(值)).toString("base64url");
}

async function 请求GitHub接口<结果类型>(路径: string, 令牌: string, 初始化: RequestInit = {}): Promise<结果类型> {
  const 响应 = await fetch(`${GitHub接口地址}${路径}`, {
    ...初始化,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${令牌}`,
      "X-GitHub-Api-Version": GitHub接口版本,
      "User-Agent": "uscf-postremove-aio-bot-push",
      ...(初始化.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!响应.ok) {
    const 数据 = (await 响应.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`GitHub API ${路径} 请求失败（${响应.status}）：${数据?.message ?? 响应.statusText}`);
  }
  return (await 响应.json()) as 结果类型;
}

function 执行Git(参数: string[], 附加环境变量: Record<string, string> = {}, 命令 = "git"): void {
  const 结果 = spawnSync(命令, 参数, {
    env: { ...process.env, ...附加环境变量 },
    stdio: "inherit",
  });
  if (结果.status !== 0) throw new Error(`${命令} ${参数[0]} 执行失败。`);
}

function Git输出(参数: string[]): string {
  const 结果 = spawnSync("git", 参数, { encoding: "utf8" });
  if (结果.status !== 0) throw new Error(结果.stderr.trim() || `git ${参数[0]} 执行失败。`);
  return 结果.stdout.trim();
}

await 主程序().catch((错误: unknown) => {
  console.error(错误 instanceof Error ? 错误.message : 错误);
  process.exitCode = 1;
});
