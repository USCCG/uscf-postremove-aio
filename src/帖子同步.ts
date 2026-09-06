import { 批量保存帖子, 写日志 } from "./存储";
import type { 新帖子记录, 用户动态, 用户动态响应 } from "./类型";
import { 等待 } from "./工具";

export interface 同步选项 {
  username: string;
  minId: number | null;
  maxId: number | null;
  delayMs: number;
  signal: AbortSignal;
  onProgress?: (消息: string) => void;
}

export async function 同步所有帖子(选项: 同步选项): Promise<number> {
  const 已见 = new Set<number>();
  const 已请求 = new Set<string>();
  let 下一路径: string | null = 构造路径(选项.username, 0);
  let 偏移量 = 0;
  let 页数 = 0;
  let 总数 = 0;

  while (下一路径) {
    选项.signal.throwIfAborted();
    if (已请求.has(下一路径)) throw new Error("分页地址重复，已停止以避免死循环。");
    已请求.add(下一路径);
    页数 += 1;
    选项.onProgress?.(`正在获取第 ${页数} 页，已写入 ${总数} 条……`);

    const 响应 = await fetch(new URL(下一路径, location.origin), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: 选项.signal,
    });
    if (!响应.ok) throw new Error(`获取帖子失败：HTTP ${响应.status} ${(await 响应.text()).slice(0, 200)}`);
    const 数据 = (await 响应.json()) as 用户动态响应;
    const 本页 = Array.isArray(数据.user_actions) ? 数据.user_actions : [];
    if (!本页.length) break;
    偏移量 += 本页.length;

    const 待保存 = 本页
      .filter((动态) => 命中范围(动态, 选项.minId, 选项.maxId, 已见))
      .map((动态) => 转为帖子(动态, 选项.username));
    总数 += await 批量保存帖子(待保存);

    const 有效编号 = 本页.map((项) => Number(项.post_id)).filter(Number.isSafeInteger);
    if (选项.minId !== null && 有效编号.length && Math.max(...有效编号) < 选项.minId) break;
    下一路径 =
      typeof 数据.load_more_user_actions_url === "string" && 数据.load_more_user_actions_url
        ? 数据.load_more_user_actions_url
        : 本页.length >= 30
          ? 构造路径(选项.username, 偏移量)
          : null;
    if (下一路径 && 选项.delayMs) await 等待(选项.delayMs, 选项.signal);
  }
  await 写日志(选项.username, `帖子同步完成，本次命中 ${总数} 条。`);
  return 总数;
}

function 命中范围(动态: 用户动态, min: number | null, max: number | null, 已见: Set<number>): boolean {
  const id = Number(动态.post_id);
  if (!Number.isSafeInteger(id) || 已见.has(id) || (min !== null && id < min) || (max !== null && id > max))
    return false;
  已见.add(id);
  return true;
}

function 转为帖子(动态: 用户动态, 用户名: string): 新帖子记录 {
  const id = Number(动态.post_id);
  const topicId = Number(动态.topic_id) || undefined;
  const postNumber = Number(动态.post_number) || undefined;
  const slug = String(动态.slug ?? "topic");
  return {
    id,
    ownerUsername: 用户名,
    username: String(动态.username ?? 用户名),
    raw: String(动态.excerpt ?? ""),
    cooked: String(动态.excerpt ?? ""),
    topicId,
    topicTitle: String(动态.title ?? ""),
    topicSlug: slug,
    postNumber,
    createdAt: String(动态.created_at ?? ""),
    postUrl: topicId
      ? `/t/${encodeURIComponent(slug)}/${topicId}${postNumber ? `/${postNumber}` : ""}`
      : `/posts/${id}`,
    status: "待定",
    source: "同步",
    lastError: "",
  };
}

function 构造路径(用户名: string, offset: number): string {
  return `/user_actions.json?${new URLSearchParams({ offset: String(offset), username: 用户名, filter: "5" })}`;
}
