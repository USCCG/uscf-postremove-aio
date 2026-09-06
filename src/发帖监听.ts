import { 读取设置 } from "./设置";
import { 保存帖子, 写日志 } from "./存储";
import type { 发帖响应 } from "./类型";
import type { 页面窗口 } from "./会话";

interface XHR信息 {
  method: string;
  url: string;
}

export function 安装发帖监听(页面窗口: 页面窗口): void {
  if ((页面窗口 as 页面窗口 & { __shantieInstalled?: boolean }).__shantieInstalled) return;
  (页面窗口 as 页面窗口 & { __shantieInstalled?: boolean }).__shantieInstalled = true;

  const 原始Fetch = 页面窗口.fetch.bind(页面窗口);
  const 原始Open = 页面窗口.XMLHttpRequest.prototype.open;
  const 原始Send = 页面窗口.XMLHttpRequest.prototype.send;
  const 请求信息 = new WeakMap<XMLHttpRequest, XHR信息>();

  页面窗口.fetch = (async (...参数: Parameters<typeof fetch>) => {
    const [输入, 初始化] = 参数;
    if (!是发帖请求(输入, 初始化, 页面窗口)) return 原始Fetch(...参数);
    if (读取设置().blockPosting) return 构造拦截响应(页面窗口, "fetch");
    const 响应 = await 原始Fetch(...参数);
    if (响应.ok) void 解析并记录发帖响应(响应.clone().text());
    return 响应;
  }) as typeof fetch;

  页面窗口.XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async = true,
    username?: string | null,
    password?: string | null,
  ): void {
    请求信息.set(this, { method: method.toUpperCase(), url: String(url) });
    Reflect.apply(原始Open, this, [method, url, async, username, password]);
  } as typeof XMLHttpRequest.prototype.open;

  页面窗口.XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const 信息 = 请求信息.get(this);
    if (!信息 || !是发帖地址(信息.method, 信息.url)) return 原始Send.call(this, body);
    if (读取设置().blockPosting) {
      显示拦截提示();
      this.abort();
      this.dispatchEvent(new 页面窗口.ProgressEvent("error"));
      this.dispatchEvent(new 页面窗口.ProgressEvent("loadend"));
      return;
    }
    this.addEventListener(
      "load",
      () => {
        if (this.status >= 200 && this.status < 300) {
          const 文本 = typeof this.response === "string" ? this.response : JSON.stringify(this.response);
          void 解析并记录发帖响应(Promise.resolve(文本));
        }
      },
      { once: true },
    );
    原始Send.call(this, body);
  } as typeof XMLHttpRequest.prototype.send;
}

function 是发帖请求(输入: RequestInfo | URL, 初始化: RequestInit | undefined, 页面窗口: 页面窗口): boolean {
  const 是Request = 输入 instanceof 页面窗口.Request;
  const method = String(初始化?.method ?? (是Request ? 输入.method : "GET")).toUpperCase();
  return 是发帖地址(method, 是Request ? 输入.url : String(输入));
}

function 是发帖地址(method: string, 地址文本: string): boolean {
  try {
    const 地址 = new URL(地址文本, location.href);
    return method === "POST" && 地址.origin === location.origin && /^\/posts(?:\.json)?\/?$/.test(地址.pathname);
  } catch {
    return false;
  }
}

function 构造拦截响应(页面窗口: 页面窗口, 通道: string): Response {
  显示拦截提示();
  console.warn(`[帖子管理器] 已拦截 ${通道} 发帖请求。`);
  return new 页面窗口.Response(
    JSON.stringify({ errors: ["发帖已被本地脚本拦截"], error_type: "blocked_by_userscript" }),
    {
      status: 422,
      statusText: "Blocked by userscript",
      headers: { "Content-Type": "application/json" },
    },
  );
}

async function 解析并记录发帖响应(文本Promise: Promise<string>): Promise<void> {
  try {
    const 数据 = JSON.parse(await 文本Promise) as 发帖响应;
    const 帖子 = 数据.post;
    const id = Number(帖子?.id);
    const 用户名 = String(帖子?.username ?? "").trim();
    if (!数据.success || !Number.isSafeInteger(id) || !用户名) return;
    await 保存帖子({
      id,
      ownerUsername: 用户名,
      username: 用户名,
      raw: String(帖子?.raw ?? ""),
      cooked: String(帖子?.cooked ?? ""),
      topicId: Number(帖子?.topic_id) || undefined,
      topicTitle: "",
      topicSlug: String(帖子?.topic_slug ?? ""),
      postNumber: Number(帖子?.post_number) || undefined,
      recordType: Number(帖子?.post_number) === 1 ? "话题" : "回帖",
      createdAt: String(帖子?.created_at ?? ""),
      postUrl: String(帖子?.post_url ?? ""),
      status: "待定",
      source: "发帖监听",
      lastError: "",
    });
    await 写日志(用户名, `新帖子 ${id} 已自动追加到待定队列。`);
  } catch (错误) {
    console.warn("[帖子管理器] 解析发帖响应失败", 错误);
  }
}

function 显示拦截提示(): void {
  document.querySelector("#shantie-block-toast")?.remove();
  const 提示 = document.createElement("div");
  提示.id = "shantie-block-toast";
  提示.textContent = "发帖已被帖子管理器拦截，可在管理页关闭。";
  Object.assign(提示.style, {
    position: "fixed",
    top: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    padding: "12px 18px",
    borderRadius: "10px",
    color: "white",
    background: "#b91c1c",
    font: "600 14px system-ui",
  });
  document.documentElement.append(提示);
  window.setTimeout(() => 提示.remove(), 5000);
}
