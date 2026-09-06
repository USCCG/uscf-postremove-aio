import { 更新帖子状态, 写日志, 读取帖子 } from "./存储";
import type { 审核顺序, 帖子记录, 设置, 远程审核失败策略 } from "./类型";
import { 等待, 提取错误 } from "./工具";

type 远程动作 = "delete" | "edit" | "keep" | "ignore";

interface 远程审核请求 {
  id: string;
  type: "topic" | "post";
  post_detail: Record<string, unknown> | null;
  topic_defail: Record<string, unknown>;
}

interface 远程审核响应 {
  id: string;
  action: 远程动作;
}

interface GM响应 {
  status: number;
  statusText: string;
  responseText: string;
}

interface GM请求句柄 {
  abort(): void;
}

interface GM请求选项 {
  method: string;
  url: string;
  headers: Record<string, string>;
  data: string;
  timeout: number;
  onload(响应: GM响应): void;
  onerror(响应: GM响应): void;
  ontimeout(): void;
  onabort(): void;
}

declare const GM_xmlhttpRequest: ((选项: GM请求选项) => GM请求句柄) | undefined;

export const 远程审核提示词 = `你是帖子审核服务。你的 HTTP endpoint 会收到 JSON POST 请求，结构严格如下：
{
  "id": "帖子 ID 字符串",
  "type": "topic 或 post",
  "post_detail": "论坛 GET /posts/:id 返回的完整对象；取不到时为 null",
  "topic_defail": "论坛 GET /t/:topic_id.json 返回的完整话题对象"
}

请根据内容只返回一个 JSON 对象，不要使用 Markdown，不要添加解释：
{
  "id": "原样复制请求中的 id",
  "action": "delete、edit、keep 或 ignore 之一"
}

规则：
- id 必须是字符串，并与请求 id 完全一致；不得自行生成或转换。
- delete：加入删除队列。
- edit：加入编辑队列。
- keep：标记为保留。
- ignore：本次不作决定，帖子继续留在待定队列。
- 无法可靠判断时返回 ignore。`;

export class 远程审核器 {
  private 控制器: AbortController | null = null;

  constructor(
    private readonly 用户名: string,
    private readonly 更新状态: (消息: string) => void,
  ) {}

  get 运行中(): boolean {
    return this.控制器 !== null;
  }

  async 开始(设置: 设置): Promise<void> {
    if (this.控制器) return;
    this.控制器 = new AbortController();
    const 信号 = this.控制器.signal;
    try {
      验证Endpoint(设置.remoteEndpoint);
      const 队列 = 排序帖子(await 读取帖子(this.用户名, "待定"), 设置.remoteOrder);
      if (!队列.length) return void this.更新状态("远程审核队列为空。");
      for (const [索引, 帖子] of 队列.entries()) {
        信号.throwIfAborted();
        this.更新状态(`远程审核 ${索引 + 1}/${队列.length}：正在处理帖子 ${帖子.id}……`);
        await this.按失败策略处理(帖子, 设置, 信号);
        if (索引 < 队列.length - 1 && 设置.remoteDelayMs) await 等待(设置.remoteDelayMs, 信号);
      }
      this.更新状态(`远程审核完成，共检查 ${队列.length} 条。`);
    } catch (错误) {
      if (!信号.aborted) {
        const 消息 = 提取错误(错误);
        this.更新状态(`远程审核停止：${消息}`);
        await 写日志(this.用户名, `远程审核停止：${消息}`, undefined, "error");
      }
    } finally {
      this.控制器 = null;
    }
  }

  停止(): void {
    this.控制器?.abort();
    this.更新状态("已停止远程审核。");
  }

  private async 按失败策略处理(帖子: 帖子记录, 设置: 设置, 信号: AbortSignal): Promise<void> {
    const 允许重试 = 设置.remoteFailurePolicy === "重试后停止" || 设置.remoteFailurePolicy === "重试后跳过";
    const 最大尝试次数 = 1 + (允许重试 ? 设置.remoteRetryCount : 0);
    for (let 尝试次数 = 1; 尝试次数 <= 最大尝试次数; 尝试次数 += 1) {
      try {
        await this.处理帖子(帖子, 设置, 信号);
        return;
      } catch (错误) {
        if (信号.aborted) throw 错误;
        const 消息 = 提取错误(错误);
        const 还能重试 = 尝试次数 < 最大尝试次数;
        await 写日志(
          this.用户名,
          `帖子 ${帖子.id} 远程审核第 ${尝试次数}/${最大尝试次数} 次失败：${消息}`,
          undefined,
          "error",
        );
        if (还能重试) {
          this.更新状态(`帖子 ${帖子.id} 请求失败，准备第 ${尝试次数 + 1} 次尝试……`);
          if (设置.remoteDelayMs) await 等待(设置.remoteDelayMs, 信号);
          continue;
        }
        if (失败后跳过(设置.remoteFailurePolicy)) return;
        throw new Error(`帖子 ${帖子.id}：${消息}`, { cause: 错误 });
      }
    }
  }

  private async 处理帖子(帖子: 帖子记录, 设置: 设置, 信号: AbortSignal): Promise<void> {
    const 请求体 = await 构造请求体(帖子, 信号);
    const 响应 = await 请求远程Endpoint(设置.remoteEndpoint, 请求体, 设置.remoteTimeoutMs, 信号);
    const 状态 = 响应.action === "delete" ? "待删除" : 响应.action === "edit" ? "待编辑" : "保留";
    if (响应.action !== "ignore") await 更新帖子状态(this.用户名, [帖子.id], 状态);
    await 写日志(
      this.用户名,
      响应.action === "ignore"
        ? `帖子 ${帖子.id} 的远程审核结果为 ignore，继续保留在待定队列。`
        : `帖子 ${帖子.id} 的远程审核结果为 ${响应.action}，已标记为${状态}。`,
    );
  }
}

async function 构造请求体(帖子: 帖子记录, 信号: AbortSignal): Promise<远程审核请求> {
  const post_detail = await 获取帖子详情(帖子.id, 信号);
  const topicId = Number(post_detail?.topic_id ?? 帖子.topicId);
  if (!Number.isSafeInteger(topicId) || topicId <= 0) throw new Error("无法确定 topic_id。");
  const topic_defail = await 获取论坛JSON(`/t/${topicId}.json`, 信号, `话题 ${topicId}`);
  const 是话题 = 帖子.recordType === "话题" || Number(post_detail?.post_number ?? 帖子.postNumber) === 1;
  return {
    id: String(帖子.id),
    type: 是话题 ? "topic" : "post",
    post_detail,
    topic_defail,
  };
}

async function 获取帖子详情(id: number, 信号: AbortSignal): Promise<Record<string, unknown> | null> {
  const 响应 = await fetch(`/posts/${id}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: 信号,
  });
  if (响应.status === 404) return null;
  if (!响应.ok) throw new Error(`获取帖子 ${id} 失败：HTTP ${响应.status} ${(await 响应.text()).slice(0, 200)}`);
  return (await 响应.json()) as Record<string, unknown>;
}

async function 获取论坛JSON(路径: string, 信号: AbortSignal, 名称: string): Promise<Record<string, unknown>> {
  const 响应 = await fetch(路径, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: 信号,
  });
  if (!响应.ok) throw new Error(`获取${名称}失败：HTTP ${响应.status} ${(await 响应.text()).slice(0, 200)}`);
  return (await 响应.json()) as Record<string, unknown>;
}

async function 请求远程Endpoint(
  endpoint: string,
  请求体: 远程审核请求,
  超时毫秒: number,
  信号: AbortSignal,
): Promise<远程审核响应> {
  const 原始响应 =
    typeof GM_xmlhttpRequest === "function"
      ? await 使用GM请求(endpoint, 请求体, 超时毫秒, 信号)
      : await 使用Fetch请求(endpoint, 请求体, 超时毫秒, 信号);
  let 数据: unknown;
  try {
    数据 = JSON.parse(原始响应);
  } catch {
    throw new Error(`endpoint 返回的不是有效 JSON：${原始响应.slice(0, 200)}`);
  }
  if (!数据 || typeof 数据 !== "object") throw new Error("endpoint 响应必须是 JSON 对象。");
  const 响应 = 数据 as Partial<远程审核响应>;
  if (typeof 响应.id !== "string" || 响应.id !== 请求体.id)
    throw new Error(`endpoint 响应 id 不匹配；期望 ${请求体.id}，收到 ${String(响应.id)}。`);
  if (响应.action !== "delete" && 响应.action !== "edit" && 响应.action !== "keep" && 响应.action !== "ignore")
    throw new Error(`endpoint 返回了无效 action：${String(响应.action)}。`);
  return 响应 as 远程审核响应;
}

function 使用GM请求(endpoint: string, 请求体: 远程审核请求, 超时毫秒: number, 信号: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    信号.throwIfAborted();
    let 已结束 = false;
    let 句柄: GM请求句柄 | null = null;
    const 结束 = (回调: () => void): void => {
      if (已结束) return;
      已结束 = true;
      信号.removeEventListener("abort", 中止);
      回调();
    };
    const 中止 = (): void => {
      句柄?.abort();
      结束(() => reject(new DOMException("已停止", "AbortError")));
    };
    信号.addEventListener("abort", 中止, { once: true });
    句柄 = GM_xmlhttpRequest!({
      method: "POST",
      url: endpoint,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      data: JSON.stringify(请求体),
      timeout: 超时毫秒,
      onload: (响应) =>
        结束(() =>
          响应.status >= 200 && 响应.status < 300
            ? resolve(响应.responseText)
            : reject(new Error(`endpoint HTTP ${响应.status} ${响应.statusText}: ${响应.responseText.slice(0, 200)}`)),
        ),
      onerror: (响应) => 结束(() => reject(new Error(`endpoint 请求失败：${响应.statusText || "网络错误"}`))),
      ontimeout: () => 结束(() => reject(new Error(`endpoint 请求超过 ${超时毫秒} ms。`))),
      onabort: () => 结束(() => reject(new DOMException("已停止", "AbortError"))),
    });
  });
}

async function 使用Fetch请求(
  endpoint: string,
  请求体: 远程审核请求,
  超时毫秒: number,
  信号: AbortSignal,
): Promise<string> {
  const 控制器 = new AbortController();
  const 超时定时器 = window.setTimeout(() => 控制器.abort(new DOMException("请求超时", "TimeoutError")), 超时毫秒);
  const 中止 = (): void => 控制器.abort(信号.reason);
  信号.addEventListener("abort", 中止, { once: true });
  try {
    const 响应 = await fetch(endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(请求体),
      signal: 控制器.signal,
    });
    const 文本 = await 响应.text();
    if (!响应.ok) throw new Error(`endpoint HTTP ${响应.status} ${响应.statusText}: ${文本.slice(0, 200)}`);
    return 文本;
  } finally {
    window.clearTimeout(超时定时器);
    信号.removeEventListener("abort", 中止);
  }
}

function 验证Endpoint(值: string): void {
  if (!值.trim()) throw new Error("请先填写远程审核 endpoint。");
  const 地址 = new URL(值, location.href);
  if (地址.protocol !== "http:" && 地址.protocol !== "https:") throw new Error("endpoint 只支持 HTTP 或 HTTPS 地址。");
}

function 排序帖子(帖子: 帖子记录[], 顺序: 审核顺序): 帖子记录[] {
  const 方向 = 顺序 === "从旧到新" ? 1 : -1;
  return [...帖子].sort((左, 右) => {
    const 左时间 = Date.parse(左.createdAt) || 0;
    const 右时间 = Date.parse(右.createdAt) || 0;
    return 方向 * (左时间 - 右时间 || 左.id - 右.id);
  });
}

function 失败后跳过(策略: 远程审核失败策略): boolean {
  return 策略 === "跳过" || 策略 === "重试后跳过";
}
