import { 批量保存帖子, 写日志 } from "./存储";
import type { 同步目标, 同步类型, 帖子种类, 新帖子记录, 用户动态, 用户动态响应 } from "./类型";
import { 等待 } from "./工具";

export interface 同步选项 {
  username: string;
  minId: number | null;
  maxId: number | null;
  delayMs: number;
  type: 同步类型;
  target: 同步目标;
  signal: AbortSignal;
  onProgress?: (消息: string) => void;
}

export interface 分类同步统计 {
  类型: 帖子种类;
  接口条数: number;
  命中条数: number;
  写入条数: number;
  命中编号: number[];
}

interface 可同步动态 extends 用户动态 {
  raw?: string;
  cooked?: string;
}

interface 话题详情响应 {
  id?: number;
  title?: string;
  slug?: string;
  category_id?: number;
  tags?: unknown[];
  post_stream?: {
    posts?: Array<{
      id?: number;
      username?: string;
      raw?: string;
      cooked?: string;
      post_number?: number;
      created_at?: string;
    }>;
  };
}

export interface 同步结果 {
  接口条数: number;
  命中条数: number;
  写入条数: number;
  命中编号: number[];
  分类: 分类同步统计[];
}

export async function 同步所有帖子(选项: 同步选项): Promise<同步结果> {
  const 已见 = new Set<number>();
  const 类型列表: 帖子种类[] = 选项.type === "全部" ? ["回帖", "话题"] : [选项.type];
  const 分类: 分类同步统计[] = [];

  for (const 类型 of 类型列表) 分类.push(await 同步一种帖子(选项, 类型, 已见));

  const 结果: 同步结果 = {
    接口条数: 分类.reduce((总数, 当前) => 总数 + 当前.接口条数, 0),
    命中条数: 分类.reduce((总数, 当前) => 总数 + 当前.命中条数, 0),
    写入条数: 分类.reduce((总数, 当前) => 总数 + 当前.写入条数, 0),
    命中编号: 分类.flatMap((当前) => 当前.命中编号),
    分类,
  };
  const 分类文案 = 分类.map((当前) => `${当前.类型}：接口 ${当前.接口条数}，命中 ${当前.命中条数}`).join("；");
  await 写日志(
    选项.username,
    `${选项.type}同步完成，接口读取 ${结果.接口条数} 条，范围命中 ${结果.命中条数} 条（${分类文案}）。`,
  );
  return 结果;
}

async function 同步一种帖子(选项: 同步选项, 类型: 帖子种类, 已见: Set<number>): Promise<分类同步统计> {
  const 已请求 = new Set<string>();
  // Discourse 用户动态：4 是创建话题，5 是回复。用户提供的 HAR 已验证此站点也使用这两个值。
  const filter = 类型 === "话题" ? "4" : "5";
  let 下一路径: string | null = 构造路径(选项.username, 0, filter);
  let 偏移量 = 0;
  let 页数 = 0;
  let 接口条数 = 0;
  let 写入条数 = 0;
  const 命中编号: number[] = [];

  while (下一路径) {
    选项.signal.throwIfAborted();
    if (已请求.has(下一路径)) throw new Error("分页地址重复，已停止以避免死循环。");
    已请求.add(下一路径);
    页数 += 1;
    选项.onProgress?.(`正在获取${类型}第 ${页数} 页，接口已读取 ${接口条数} 条，范围命中 ${命中编号.length} 条……`);

    const 响应 = await fetch(new URL(下一路径, location.origin), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: 选项.signal,
    });
    if (!响应.ok) throw new Error(`获取帖子失败：HTTP ${响应.status} ${(await 响应.text()).slice(0, 200)}`);
    const 数据 = (await 响应.json()) as 用户动态响应;
    const 本页 = Array.isArray(数据.user_actions) ? 数据.user_actions : [];
    if (!本页.length) break;
    接口条数 += 本页.length;
    偏移量 += 本页.length;

    // 此站点的 new_topic(4) 记录只有 topic_id，post_id 为 null；必须读取话题详情取得真实首帖 ID。
    const 可用动态 = 类型 === "话题" ? await 补全话题首帖(本页, 选项) : 本页;
    const 待保存 = 可用动态
      .filter((动态) => 命中范围(动态, 选项.minId, 选项.maxId, 已见))
      .map((动态) => 转为帖子(动态, 选项.username, 类型, 选项.target));
    命中编号.push(...待保存.map((帖子) => 帖子.id));
    // “直接编辑”是明确的批量操作，需要覆盖旧决定；普通同步只让新记录进入待定。
    写入条数 += await 批量保存帖子(待保存, 选项.target === "待定");

    const 有效编号 = 可用动态
      .map((项) => 项.post_id)
      .filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
    if (选项.minId !== null && 有效编号.length && Math.max(...有效编号) < 选项.minId) break;
    下一路径 =
      typeof 数据.load_more_user_actions_url === "string" && 数据.load_more_user_actions_url
        ? 数据.load_more_user_actions_url
        : 本页.length >= 30
          ? 构造路径(选项.username, 偏移量, filter)
          : null;
    if (下一路径 && 选项.delayMs) await 等待(选项.delayMs, 选项.signal);
  }

  return { 类型, 接口条数, 命中条数: 命中编号.length, 写入条数, 命中编号 };
}

async function 补全话题首帖(本页: 用户动态[], 选项: 同步选项): Promise<可同步动态[]> {
  const 结果: 可同步动态[] = [];
  for (const [索引, 动态] of 本页.entries()) {
    选项.signal.throwIfAborted();
    const topicId = Number(动态.topic_id);
    if (!Number.isSafeInteger(topicId) || topicId <= 0) continue;
    选项.onProgress?.(`正在读取话题首帖 ${索引 + 1}/${本页.length}（topic_id ${topicId}）……`);
    const 响应 = await fetch(new URL(`/t/${topicId}.json`, location.origin), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: 选项.signal,
    });
    if (!响应.ok)
      throw new Error(`获取话题 ${topicId} 详情失败：HTTP ${响应.status} ${(await 响应.text()).slice(0, 200)}`);
    const 详情 = (await 响应.json()) as 话题详情响应;
    const 首帖 = 详情.post_stream?.posts?.find((帖子) => Number(帖子.post_number) === 1);
    const postId = Number(首帖?.id);
    if (!Number.isSafeInteger(postId) || postId <= 0) throw new Error(`话题 ${topicId} 的详情中没有有效首帖 ID。`);
    结果.push({
      ...动态,
      post_id: postId,
      topic_id: Number(详情.id) || topicId,
      post_number: 1,
      username: String(首帖?.username ?? 动态.username ?? 选项.username),
      title: String(详情.title ?? 动态.title ?? ""),
      slug: String(详情.slug ?? 动态.slug ?? "topic"),
      category_id: Number(详情.category_id ?? 动态.category_id) || undefined,
      tags: 规范化标签(详情.tags ?? 动态.tags),
      created_at: String(首帖?.created_at ?? 动态.created_at ?? ""),
      raw: String(首帖?.raw ?? 动态.excerpt ?? ""),
      cooked: String(首帖?.cooked ?? 动态.excerpt ?? ""),
    });
    if (索引 < 本页.length - 1 && 选项.delayMs) await 等待(选项.delayMs, 选项.signal);
  }
  return 结果;
}

function 命中范围(动态: 用户动态, min: number | null, max: number | null, 已见: Set<number>): boolean {
  const id = 动态.post_id;
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    已见.has(id) ||
    (min !== null && id < min) ||
    (max !== null && id > max)
  )
    return false;
  已见.add(id);
  return true;
}

function 转为帖子(动态: 可同步动态, 用户名: string, 类型: 帖子种类, 目标: 同步目标): 新帖子记录 {
  const id = Number(动态.post_id);
  const topicId = Number(动态.topic_id) || undefined;
  const postNumber = 类型 === "话题" ? 1 : Number(动态.post_number) || undefined;
  const slug = String(动态.slug ?? "topic");
  return {
    id,
    ownerUsername: 用户名,
    username: String(动态.username ?? 用户名),
    raw: String(动态.raw ?? 动态.excerpt ?? ""),
    cooked: String(动态.cooked ?? 动态.excerpt ?? ""),
    topicId,
    topicTitle: String(动态.title ?? ""),
    topicSlug: slug,
    postNumber,
    recordType: 类型,
    categoryId: Number(动态.category_id) || undefined,
    tags: Array.isArray(动态.tags) ? 动态.tags.map(String) : undefined,
    createdAt: String(动态.created_at ?? ""),
    postUrl: topicId
      ? `/t/${encodeURIComponent(slug)}/${topicId}${postNumber ? `/${postNumber}` : ""}`
      : `/posts/${id}`,
    status: 目标 === "重新待定" ? "待定" : 目标,
    source: "同步",
    lastError: "",
  };
}

function 规范化标签(标签: unknown): string[] | undefined {
  if (!Array.isArray(标签)) return undefined;
  return 标签
    .map((项) =>
      typeof 项 === "string" ? 项 : 项 && typeof 项 === "object" ? String((项 as { name?: unknown }).name ?? "") : "",
    )
    .filter(Boolean);
}

function 构造路径(用户名: string, offset: number, filter: string): string {
  return `/user_actions.json?${new URLSearchParams({ offset: String(offset), username: 用户名, filter })}`;
}
