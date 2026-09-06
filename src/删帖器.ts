import { 读取设置 } from "./设置";
import { 写日志, 更新帖子状态, 读取帖子 } from "./存储";
import type { 删帖结果, 帖子记录 } from "./类型";
import { 等待 } from "./工具";

export class 删帖器 {
  private 控制器: AbortController | null = null;
  constructor(
    private readonly 用户名: string,
    private readonly 更新状态: (消息: string) => void,
  ) {}

  get 运行中(): boolean {
    return this.控制器 !== null;
  }

  async 开始(): Promise<void> {
    if (this.控制器) return;
    this.控制器 = new AbortController();
    const 信号 = this.控制器.signal;
    try {
      while (!信号.aborted) {
        const 队列 = await 读取帖子(this.用户名, "待删除");
        if (!队列.length) return void this.更新状态("删帖队列已处理完。");
        const 设置 = 读取设置();
        const 本批 = 设置.deleteMode === "批量" ? 队列.slice(0, 设置.batchSize) : 队列.slice(0, 1);
        this.更新状态(`正在${设置.deleteMode}删除 ${本批.length} 条，队列剩余 ${队列.length} 条……`);
        try {
          await this.处理批次(本批, 设置.deleteMode === "批量", 信号);
          await 等待(设置.deleteMode === "批量" ? 设置.batchDelayMs : 设置.singleDelayMs, 信号);
        } catch (错误) {
          if (错误 instanceof 限流错误) {
            this.更新状态(`遇到限流，${Math.ceil(错误.waitMs / 1000)} 秒后自动继续……`);
            await 等待(错误.waitMs, 信号);
          } else throw 错误;
        }
      }
    } catch (错误) {
      if (!信号.aborted) {
        const 消息 = 错误 instanceof Error ? 错误.message : String(错误);
        this.更新状态(`删帖停止：${消息}`);
        await 写日志(this.用户名, `删帖异常：${消息}`, undefined, "error");
      }
    } finally {
      this.控制器 = null;
    }
  }

  停止(): void {
    this.控制器?.abort();
    this.更新状态("已停止删帖。");
  }

  private async 处理批次(帖子: 帖子记录[], 使用批量: boolean, 信号: AbortSignal): Promise<void> {
    const 结果 = 使用批量
      ? await 批量删除(
          帖子.map((项) => 项.id),
          信号,
        )
      : await 单个删除(帖子[0]!.id, 信号);
    if (结果.ok) {
      await 更新帖子状态(
        this.用户名,
        帖子.map((项) => 项.id),
        "已删除",
      );
      await 写日志(this.用户名, `删除成功：${帖子.map((项) => 项.id).join(", ")}`);
      return;
    }
    if (结果.status === 429) throw new 限流错误(结果.waitMs ?? 300_000);
    if (帖子.length > 1) {
      const 中点 = Math.ceil(帖子.length / 2);
      await this.处理批次(帖子.slice(0, 中点), true, 信号);
      await this.处理批次(帖子.slice(中点), true, 信号);
      return;
    }
    // destroy_many 只剩一条仍失败时，用普通接口获得更准确的结果。
    const 单帖结果 = 使用批量 ? await 单个删除(帖子[0]!.id, 信号) : 结果;
    if (单帖结果.ok || 单帖结果.status === 404) {
      await 更新帖子状态(this.用户名, [帖子[0]!.id], "已删除");
    } else if (单帖结果.status === 429) {
      throw new 限流错误(单帖结果.waitMs ?? 300_000);
    } else {
      await 更新帖子状态(this.用户名, [帖子[0]!.id], "失败", 单帖结果.message);
      await 写日志(this.用户名, `帖子 ${帖子[0]!.id} 删除失败：${单帖结果.message}`, undefined, "error");
    }
  }
}

class 限流错误 extends Error {
  constructor(readonly waitMs: number) {
    super("请求限流");
  }
}

async function 批量删除(ids: number[], 信号: AbortSignal): Promise<删帖结果> {
  const body = new URLSearchParams();
  ids.forEach((id) => body.append("post_ids[]", String(id)));
  return 请求删除("/posts/destroy_many", body, 信号);
}

async function 单个删除(id: number, 信号: AbortSignal): Promise<删帖结果> {
  return 请求删除(`/posts/${id}`, new URLSearchParams({ context: "/" }), 信号);
}

async function 请求删除(路径: string, body: URLSearchParams, 信号: AbortSignal): Promise<删帖结果> {
  const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content;
  if (!csrf) return { ok: false, status: 0, message: "未找到 CSRF token，请刷新页面并确认已登录。" };
  const 响应 = await fetch(路径, {
    method: "DELETE",
    credentials: "include",
    signal: 信号,
    headers: {
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-CSRF-Token": csrf,
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });
  if (响应.ok) return { ok: true, status: 响应.status, message: "成功" };
  const 文本 = await 响应.text();
  let 数据: { errors?: string[]; extras?: { wait_seconds?: number } } = {};
  try {
    数据 = JSON.parse(文本);
  } catch {
    /* 非 JSON 错误保留摘要即可。 */
  }
  const 等待秒数 = Number(数据.extras?.wait_seconds || 响应.headers.get("retry-after") || 0);
  return {
    ok: false,
    status: 响应.status,
    message: 数据.errors?.join(" | ") || 文本.slice(0, 200) || `HTTP ${响应.status}`,
    waitMs: 等待秒数 ? Math.max(5_000, 等待秒数 * 1000) : undefined,
  };
}
