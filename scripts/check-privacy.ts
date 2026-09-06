import { spawnSync } from "node:child_process";

const 允许公开的邮箱域名 = new Set(["example.com", "users.noreply.github.com"]);
const 敏感文件名 = /(^|\/)(?:\.env(?:\..+)?|\.secret|\.client-secret|[^/]+\.pem)$/i;
const 允许的示例文件 = new Set([".env.example"]);

const 内容规则: Array<{ 名称: string; 表达式: RegExp }> = [
  { 名称: "私钥", 表达式: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { 名称: "GitHub token", 表达式: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/ },
  { 名称: "URL 中的明文凭据", 表达式: /https?:\/\/[^\s/:@]+:[^\s/@]+@/i },
  { 名称: "Unix 用户主目录", 表达式: /\/(?:home|Users)\/[^\s/]+\// },
  { 名称: "Windows 用户主目录", 表达式: /[A-Za-z]:\\Users\\[^\s\\]+\\/ },
];

const 问题: string[] = [];
const 已跟踪文件 = Git输出(["ls-files", "-z"]).split("\0").filter(Boolean);

for (const 文件 of 已跟踪文件) {
  if (敏感文件名.test(文件) && !允许的示例文件.has(文件)) {
    问题.push(`敏感文件被 Git 跟踪：${文件}`);
    continue;
  }

  const 数据 = new Uint8Array(await Bun.file(文件).arrayBuffer());
  if (数据.includes(0)) continue;
  const 内容 = new TextDecoder().decode(数据);

  for (const 规则 of 内容规则) {
    if (规则.表达式.test(内容)) 问题.push(`${文件} 命中${规则.名称}规则`);
  }

  for (const 匹配 of 内容.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
    const 域名 = 匹配[1].toLowerCase();
    if (!允许公开的邮箱域名.has(域名)) 问题.push(`${文件} 包含非公开邮箱域名：${域名}`);
  }
}

const 历史身份 = Git输出(["log", "HEAD", "--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce"]);
for (const 行 of 历史身份.split("\n").filter(Boolean)) {
  const [提交, 作者名, 作者邮箱, 提交者名, 提交者邮箱] = 行.split("\x1f");
  if (!是机器人身份(作者名, 作者邮箱)) 问题.push(`commit ${提交.slice(0, 12)} 的 author 不是 bot 身份`);
  if (!是机器人身份(提交者名, 提交者邮箱)) 问题.push(`commit ${提交.slice(0, 12)} 的 committer 不是 bot 身份`);
}

if (问题.length) {
  console.error("隐私检查失败：");
  for (const 项目 of [...new Set(问题)]) console.error(`- ${项目}`);
  process.exitCode = 1;
} else {
  console.log(`隐私检查通过：${已跟踪文件.length} 个文件及完整 Git 历史未发现个人信息或秘密。`);
}

function 是机器人身份(姓名: string, 邮箱: string): boolean {
  return /\[bot\]$/i.test(姓名) && /^\d+\+.+\[bot\]@users\.noreply\.github\.com$/i.test(邮箱);
}

function Git输出(参数: string[]): string {
  const 结果 = spawnSync("git", 参数, { encoding: "utf8" });
  if (结果.status !== 0) throw new Error(结果.stderr.trim() || `git ${参数[0]} 执行失败。`);
  return 结果.stdout;
}
