import { 读取设置 } from "./设置";
import { 写日志, 更新帖子内容, 更新帖子状态, 读取帖子 } from "./存储";
import type { 完整帖子JSON, 完整话题JSON, 编辑预览, 帖子记录 } from "./类型";
import { 等待 } from "./工具";

type 文本转换器<T> = (orig_full_json: T) => string | Promise<string>;

export interface 编辑脚本组 {
  正文脚本: string;
  标题脚本: string;
}

interface 请求结果 {
  ok: boolean;
  status: number;
  message: string;
  waitMs?: number;
  post?: 完整帖子JSON;
}

export class 编辑器 {
  private 控制器: AbortController | null = null;

  constructor(
    private readonly 用户名: string,
    private readonly 更新状态: (消息: string) => void,
  ) {}

  get 运行中(): boolean {
    return this.控制器 !== null;
  }

  async 开始(脚本组: 编辑脚本组): Promise<void> {
    if (this.控制器) return;
    const 正文转换器 = 编译编辑脚本<完整帖子JSON>(脚本组.正文脚本, "正文");
    const 标题转换器 = 编译编辑脚本<完整话题JSON>(脚本组.标题脚本, "标题");
    this.控制器 = new AbortController();
    const 信号 = this.控制器.signal;
    try {
      while (!信号.aborted) {
        const 队列 = await 读取帖子(this.用户名, "待编辑");
        if (!队列.length) return void this.更新状态("编辑队列已处理完。");
        const 帖子 = 队列[0]!;
        this.更新状态(`正在编辑${帖子.recordType ?? "帖子"} ${帖子.id}，队列剩余 ${队列.length} 条……`);
        try {
          await this.处理帖子(帖子, 正文转换器, 标题转换器, 信号);
          await 等待(读取设置().editDelayMs, 信号);
        } catch (错误) {
          if (信号.aborted || (错误 instanceof DOMException && 错误.name === "AbortError")) throw 错误;
          if (错误 instanceof 限流错误) {
            this.更新状态(`编辑遇到限流，${Math.ceil(错误.waitMs / 1000)} 秒后自动继续……`);
            await 等待(错误.waitMs, 信号);
          } else {
            const 消息 = 错误 instanceof Error ? 错误.message : String(错误);
            await 更新帖子状态(this.用户名, [帖子.id], "编辑失败", 消息);
            await 写日志(this.用户名, `帖子 ${帖子.id} 编辑失败：${消息}`, undefined, "error");
          }
        }
      }
    } catch (错误) {
      if (!信号.aborted) {
        const 消息 = 错误 instanceof Error ? 错误.message : String(错误);
        this.更新状态(`批量编辑停止：${消息}`);
        await 写日志(this.用户名, `批量编辑异常：${消息}`, undefined, "error");
      }
    } finally {
      this.控制器 = null;
    }
  }

  停止(): void {
    this.控制器?.abort();
    this.更新状态("已停止批量编辑。");
  }

  private async 处理帖子(
    帖子: 帖子记录,
    正文转换器: 文本转换器<完整帖子JSON>,
    标题转换器: 文本转换器<完整话题JSON>,
    信号: AbortSignal,
  ): Promise<void> {
    const 预览 = await 生成编辑预览(帖子, 正文转换器, 标题转换器, 信号);
    const 正文有变化 = 预览.新文 !== 预览.原文;
    const 标题有变化 = 预览.新标题 !== undefined && 预览.新标题 !== 预览.原标题;
    let cooked: string | undefined;

    if (正文有变化) {
      const 结果 = await 提交正文编辑(帖子, 预览, 信号);
      检查请求结果(结果);
      cooked = typeof 结果.post?.cooked === "string" ? 结果.post.cooked : undefined;
      await 更新帖子内容(this.用户名, 帖子.id, { raw: 预览.新文, cooked, status: "待编辑" });
    }

    if (标题有变化 && 预览.完整话题数据 && 预览.新标题 !== undefined) {
      const 结果 = await 提交标题编辑(帖子, 预览.完整话题数据, 预览.新标题, 信号);
      检查请求结果(结果);
      await 更新帖子内容(this.用户名, 帖子.id, {
        raw: 预览.新文,
        cooked,
        topicTitle: 预览.新标题,
        status: "待编辑",
      });
    }

    await 更新帖子内容(this.用户名, 帖子.id, {
      raw: 预览.新文,
      cooked,
      topicTitle: 预览.新标题,
      status: "已编辑",
    });
    const 变化 = [正文有变化 ? "正文" : "", 标题有变化 ? "标题" : ""].filter(Boolean).join("和");
    await 写日志(
      this.用户名,
      变化 ? `帖子 ${帖子.id} 的${变化}编辑成功。` : `帖子 ${帖子.id} 的脚本结果与原内容相同，未发送编辑请求。`,
    );
  }
}

export async function 预览编辑(帖子: 帖子记录, 脚本组: 编辑脚本组, 信号?: AbortSignal): Promise<编辑预览> {
  return 生成编辑预览(
    帖子,
    编译编辑脚本<完整帖子JSON>(脚本组.正文脚本, "正文"),
    编译编辑脚本<完整话题JSON>(脚本组.标题脚本, "标题"),
    信号,
  );
}

export function 编译编辑脚本<T extends Record<string, unknown>>(脚本文本: string, 用途 = "编辑"): 文本转换器<T> {
  let 候选: unknown;
  try {
    const 函数表达式 = 脚本文本.trim().replace(/;+\s*$/, "");
    // 这是刻意提供的高级接口：用户脚本会在论坛页面的同一 JavaScript 环境中运行。
    候选 = new Function(`"use strict"; return (${函数表达式});`)();
  } catch (错误) {
    throw new Error(`${用途}脚本语法错误：${错误 instanceof Error ? 错误.message : String(错误)}`, { cause: 错误 });
  }
  if (typeof 候选 !== "function") throw new Error(`${用途}脚本必须是一个接收完整 JSON 并返回字符串的函数。`);
  return 候选 as 文本转换器<T>;
}

async function 生成编辑预览(
  帖子: 帖子记录,
  正文转换器: 文本转换器<完整帖子JSON>,
  标题转换器: 文本转换器<完整话题JSON>,
  信号?: AbortSignal,
): Promise<编辑预览> {
  const 完整数据 = await 获取JSON<完整帖子JSON>(`/posts/${帖子.id}`, 信号, `帖子 ${帖子.id}`);
  const 原文 = typeof 完整数据.raw === "string" ? 完整数据.raw : "";
  const 新文 = await 运行转换器(正文转换器, 完整数据, "正文");
  const 是话题 = 帖子.recordType === "话题" || Number(完整数据.post_number) === 1;
  if (!是话题) return { 帖子, 完整数据, 原文, 新文 };

  const topicId = Number(完整数据.topic_id || 帖子.topicId);
  if (!Number.isSafeInteger(topicId) || topicId <= 0) throw new Error(`话题首帖 ${帖子.id} 缺少 topic_id。`);
  const 完整话题数据 = await 获取JSON<完整话题JSON>(`/t/${topicId}.json`, 信号, `话题 ${topicId}`);
  const 原标题 = String(完整话题数据.title ?? 帖子.topicTitle ?? "");
  const 新标题 = await 运行转换器(标题转换器, 完整话题数据, "标题");
  return { 帖子, 完整数据, 原文, 新文, 完整话题数据, 原标题, 新标题 };
}

async function 运行转换器<T>(转换器: 文本转换器<T>, 数据: T, 用途: string): Promise<string> {
  const 结果 = await 转换器(数据);
  if (typeof 结果 !== "string") throw new Error(`${用途}脚本必须返回字符串，当前返回 ${typeof 结果}。`);
  if (!结果.trim()) throw new Error(`${用途}脚本返回了空字符串；为避免误清空内容，已拒绝执行。`);
  return 结果;
}

async function 获取JSON<T extends Record<string, unknown>>(
  路径: string,
  信号: AbortSignal | undefined,
  名称: string,
): Promise<T> {
  const 响应 = await fetch(路径, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: 信号,
  });
  if (!响应.ok) {
    const 结果 = await 解析请求结果(响应);
    if (结果.status === 429) throw new 限流错误(结果.waitMs ?? 300_000);
    throw new Error(`获取${名称}完整内容失败：${结果.message}`);
  }
  return (await 响应.json()) as T;
}

async function 提交正文编辑(帖子: 帖子记录, 预览: 编辑预览, 信号: AbortSignal): Promise<请求结果> {
  const topicId = Number(预览.完整数据.topic_id || 帖子.topicId);
  if (!Number.isSafeInteger(topicId) || topicId <= 0) throw new Error(`帖子 ${帖子.id} 缺少 topic_id。`);
  const body = new URLSearchParams();
  body.set("post[edit_reason]", "");
  body.set("post[raw]", 预览.新文);
  body.set("post[topic_id]", String(topicId));
  // 依照实测 HAR：该字段为空字符串；不要再发送旧版本使用的 original=0。
  body.set("post[original_text]", "");
  body.set("post[locale]", "");
  if (Number(预览.完整数据.post_number) !== 1) {
    body.set("post[reply_to_post_number]", String(预览.完整数据.reply_to_post_number ?? ""));
  }
  return 发送请求(`/posts/${帖子.id}`, { method: "PUT", body }, 信号);
}

async function 提交标题编辑(帖子: 帖子记录, 话题: 完整话题JSON, 新标题: string, 信号: AbortSignal): Promise<请求结果> {
  const topicId = Number(话题.id || 帖子.topicId);
  if (!Number.isSafeInteger(topicId) || topicId <= 0) throw new Error(`话题首帖 ${帖子.id} 缺少 topic_id。`);
  const 原标题 = String(话题.title ?? 帖子.topicTitle ?? "");
  const 标签 = 规范化标签(话题.tags ?? 帖子.tags ?? []);
  const categoryId = Number(话题.category_id || 帖子.categoryId);
  const payload: Record<string, unknown> = {
    title: 新标题,
    tags: 标签,
    original_title: 原标题,
    original_tags: 标签,
    locale: "",
  };
  if (Number.isSafeInteger(categoryId) && categoryId >= 0) payload.category_id = categoryId;
  const slug = String(话题.slug || 帖子.topicSlug || "topic");
  return 发送请求(
    `/t/${encodeURIComponent(slug)}/${topicId}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    信号,
  );
}

function 规范化标签(值: unknown): string[] {
  if (!Array.isArray(值)) return [];
  return 值
    .map((项) =>
      typeof 项 === "string" ? 项 : typeof 项 === "object" && 项 ? String((项 as { name?: unknown }).name ?? "") : "",
    )
    .filter(Boolean);
}

async function 发送请求(路径: string, 初始化: RequestInit, 信号: AbortSignal): Promise<请求结果> {
  const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content;
  if (!csrf) return { ok: false, status: 0, message: "未找到 CSRF token，请刷新页面并确认已登录。" };
  const 响应 = await fetch(路径, {
    ...初始化,
    credentials: "include",
    signal: 信号,
    headers: {
      Accept: "application/json",
      "X-CSRF-Token": csrf,
      "X-Requested-With": "XMLHttpRequest",
      ...初始化.headers,
    },
  });
  return 解析请求结果(响应);
}

async function 解析请求结果(响应: Response): Promise<请求结果> {
  const 文本 = await 响应.text();
  let 数据: { errors?: string[]; extras?: { wait_seconds?: number }; post?: 完整帖子JSON } = {};
  try {
    数据 = 文本 ? JSON.parse(文本) : {};
  } catch {
    /* 非 JSON 响应保留文本摘要即可。 */
  }
  const 等待秒数 = Number(数据.extras?.wait_seconds || 响应.headers.get("retry-after") || 0);
  return {
    ok: 响应.ok,
    status: 响应.status,
    message: 数据.errors?.join(" | ") || (响应.ok ? "成功" : 文本.slice(0, 200) || `HTTP ${响应.status}`),
    waitMs: 等待秒数 ? Math.max(5_000, 等待秒数 * 1000) : undefined,
    post: 数据.post,
  };
}

function 检查请求结果(结果: 请求结果): void {
  if (结果.status === 429) throw new 限流错误(结果.waitMs ?? 300_000);
  if (!结果.ok) throw new Error(结果.message);
}

class 限流错误 extends Error {
  constructor(readonly waitMs: number) {
    super("请求限流");
  }
}
