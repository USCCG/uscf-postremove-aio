// ==UserScript==
// @name         USCardForum 帖子管理器
// @namespace    https://www.uscardforum.com/
// @version      1.0.3
// @description  统一获取、审核、删除、发帖拦截与新帖记录
// @author       Codex
// @match        *://www.uscardforum.com/*
// @match        *://uscardforum.com/*
// @grant        unsafeWindow
// @inject-into  page
// @sandbox      raw
// @run-at       document-start
// ==/UserScript==
"use strict";
(() => {
  // src/常量.ts
  var 脚本名称 = "USCardForum 帖子管理器";
  var 设置存储键 = "shantie-v3-settings";
  var 数据库名称 = "shantie-v3";
  var 数据库版本 = 1;
  var 管理页参数 = "shantie-manager";
  var 通信频道名 = "shantie-v3-events";
  var 默认设置 = {
    blockPosting: false,
    deleteMode: "批量",
    singleDelayMs: 6e4,
    batchDelayMs: 5e3,
    batchSize: 50,
    fetchDelayMs: 500,
    fetchMinId: "",
    fetchMaxId: ""
  };

  // src/工具.ts
  function 等待(毫秒, 信号) {
    return new Promise((resolve, reject) => {
      const 定时器 = window.setTimeout(完成, 毫秒);
      信号?.addEventListener("abort", 取消, { once: true });
      function 完成() {
        信号?.removeEventListener("abort", 取消);
        resolve();
      }
      function 取消() {
        window.clearTimeout(定时器);
        reject(new DOMException("已停止", "AbortError"));
      }
    });
  }
  function 数值限制(值, 默认值, 最小值, 最大值) {
    const 数值 = Number(值);
    return Number.isFinite(数值) ? Math.min(最大值, Math.max(最小值, Math.floor(数值))) : 默认值;
  }
  function 解析帖子编号(文本) {
    return [
      ...new Set(
        文本.split(/[,\s，；;]+/).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
      )
    ];
  }
  function 转义HTML(值) {
    return String(值 ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }
  function 去除HTML(值) {
    const 容器 = document.createElement("div");
    容器.innerHTML = 值;
    return (容器.textContent ?? "").trim();
  }
  function 提取错误(错误) {
    return 错误 instanceof Error ? 错误.message : String(错误);
  }
  function 帖子键(用户名, id) {
    return `${用户名}:${id}`;
  }

  // src/设置.ts
  function 读取设置() {
    try {
      const 原始值 = localStorage.getItem(设置存储键);
      const 数据 = 原始值 ? JSON.parse(原始值) : {};
      return {
        blockPosting: 数据.blockPosting === true,
        deleteMode: 数据.deleteMode === "逐帖" ? "逐帖" : "批量",
        singleDelayMs: 数值限制(数据.singleDelayMs, 默认设置.singleDelayMs, 5e3, 864e5),
        batchDelayMs: 数值限制(数据.batchDelayMs, 默认设置.batchDelayMs, 1e3, 864e5),
        batchSize: 数值限制(数据.batchSize, 默认设置.batchSize, 2, 100),
        fetchDelayMs: 数值限制(数据.fetchDelayMs, 默认设置.fetchDelayMs, 0, 6e4),
        fetchMinId: typeof 数据.fetchMinId === "string" ? 数据.fetchMinId : "",
        fetchMaxId: typeof 数据.fetchMaxId === "string" ? 数据.fetchMaxId : ""
      };
    } catch {
      return { ...默认设置 };
    }
  }
  function 保存设置(设置值) {
    localStorage.setItem(设置存储键, JSON.stringify(设置值));
    window.dispatchEvent(new CustomEvent("shantie-settings-changed"));
  }

  // src/存储.ts
  var 帖子表 = "posts";
  var 日志表 = "logs";
  var 频道 = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(通信频道名);
  var 数据库Promise = null;
  function 监听数据变化(回调) {
    const 监听器 = () => 回调();
    频道?.addEventListener("message", 监听器);
    window.addEventListener("shantie-data-changed", 监听器);
    return () => {
      频道?.removeEventListener("message", 监听器);
      window.removeEventListener("shantie-data-changed", 监听器);
    };
  }
  function 通知数据变化() {
    频道?.postMessage("changed");
    window.dispatchEvent(new CustomEvent("shantie-data-changed"));
  }
  async function 保存帖子(新记录, 保留已有决定 = true) {
    const db = await 获取数据库();
    const key = 帖子键(新记录.ownerUsername, 新记录.id);
    const 读事务 = db.transaction(帖子表, "readonly");
    const 旧记录 = await 请求转Promise(读事务.objectStore(帖子表).get(key));
    const 记录 = {
      ...旧记录,
      ...新记录,
      key,
      status: 保留已有决定 ? 旧记录?.status ?? 新记录.status : 新记录.status,
      lastError: 保留已有决定 ? 旧记录?.lastError ?? 新记录.lastError : 新记录.lastError,
      updatedAt: Date.now()
    };
    const 写事务 = db.transaction(帖子表, "readwrite");
    写事务.objectStore(帖子表).put(记录);
    await 事务完成(写事务);
    通知数据变化();
    return 记录;
  }
  async function 批量保存帖子(记录列表) {
    if (!记录列表.length) return 0;
    const db = await 获取数据库();
    const 读事务 = db.transaction(帖子表, "readonly");
    const 读表 = 读事务.objectStore(帖子表);
    const 旧记录列表 = await Promise.all(
      记录列表.map(
        (记录) => 请求转Promise(读表.get(帖子键(记录.ownerUsername, 记录.id)))
      )
    );
    const 写事务 = db.transaction(帖子表, "readwrite");
    const 写表 = 写事务.objectStore(帖子表);
    for (const [索引, 新记录] of 记录列表.entries()) {
      const key = 帖子键(新记录.ownerUsername, 新记录.id);
      const 旧记录 = 旧记录列表[索引];
      写表.put({
        ...旧记录,
        ...新记录,
        key,
        status: 旧记录?.status ?? 新记录.status,
        lastError: 旧记录?.lastError ?? 新记录.lastError,
        updatedAt: Date.now()
      });
    }
    await 事务完成(写事务);
    通知数据变化();
    return 记录列表.length;
  }
  async function 读取帖子(用户名, 状态) {
    const db = await 获取数据库();
    const 事务 = db.transaction(帖子表, "readonly");
    const 表 = 事务.objectStore(帖子表);
    const 索引 = 状态 ? 表.index("ownerStatus") : 表.index("ownerUpdated");
    const 范围 = 状态 ? IDBKeyRange.only([用户名, 状态]) : IDBKeyRange.bound([用户名, 0], [用户名, Number.MAX_SAFE_INTEGER]);
    const 结果 = await 游标读取(索引.openCursor(范围, "prev"));
    return 结果.sort((左, 右) => {
      const 左时间 = Date.parse(左.createdAt) || 0;
      const 右时间 = Date.parse(右.createdAt) || 0;
      return 右时间 - 左时间 || 右.id - 左.id;
    });
  }
  async function 更新帖子状态(用户名, ids, 状态, 错误 = "") {
    if (!ids.length) return;
    const db = await 获取数据库();
    const 读表 = db.transaction(帖子表, "readonly").objectStore(帖子表);
    const 记录列表 = await Promise.all(
      ids.map((id) => 请求转Promise(读表.get(帖子键(用户名, id))))
    );
    const 写事务 = db.transaction(帖子表, "readwrite");
    const 写表 = 写事务.objectStore(帖子表);
    for (const 记录 of 记录列表) if (记录) 写表.put({ ...记录, status: 状态, lastError: 错误, updatedAt: Date.now() });
    await 事务完成(写事务);
    通知数据变化();
  }
  async function 写日志(用户名, message, details, level = "info") {
    const db = await 获取数据库();
    const time = Date.now();
    const 记录 = {
      key: `${用户名}:${time}:${crypto.randomUUID()}`,
      ownerUsername: 用户名,
      time,
      level,
      message,
      details
    };
    const 事务 = db.transaction(日志表, "readwrite");
    事务.objectStore(日志表).put(记录);
    await 事务完成(事务);
    通知数据变化();
  }
  async function 读取日志(用户名, 限制 = 200) {
    const db = await 获取数据库();
    const 索引 = db.transaction(日志表, "readonly").objectStore(日志表).index("ownerTime");
    const 范围 = IDBKeyRange.bound([用户名, 0], [用户名, Number.MAX_SAFE_INTEGER]);
    return 游标读取(索引.openCursor(范围, "prev"), 限制);
  }
  async function 获取数据库() {
    if (数据库Promise) return 数据库Promise;
    数据库Promise = new Promise((resolve, reject) => {
      const 请求 = indexedDB.open(数据库名称, 数据库版本);
      请求.onupgradeneeded = () => {
        const db = 请求.result;
        if (!db.objectStoreNames.contains(帖子表)) {
          const 表 = db.createObjectStore(帖子表, { keyPath: "key" });
          表.createIndex("ownerStatus", ["ownerUsername", "status"]);
          表.createIndex("ownerUpdated", ["ownerUsername", "updatedAt"]);
        }
        if (!db.objectStoreNames.contains(日志表)) {
          const 表 = db.createObjectStore(日志表, { keyPath: "key" });
          表.createIndex("ownerTime", ["ownerUsername", "time"]);
        }
      };
      请求.onsuccess = () => resolve(请求.result);
      请求.onerror = () => reject(请求.error ?? new Error("无法打开 IndexedDB"));
    });
    return 数据库Promise;
  }
  function 请求转Promise(请求) {
    return new Promise((resolve, reject) => {
      请求.onsuccess = () => resolve(请求.result);
      请求.onerror = () => reject(请求.error);
    });
  }
  function 事务完成(事务) {
    return new Promise((resolve, reject) => {
      事务.oncomplete = () => resolve();
      事务.onerror = () => reject(事务.error);
      事务.onabort = () => reject(事务.error);
    });
  }
  function 游标读取(请求, 限制 = Number.POSITIVE_INFINITY) {
    return new Promise((resolve, reject) => {
      const 结果 = [];
      请求.onsuccess = () => {
        const 游标 = 请求.result;
        if (!游标 || 结果.length >= 限制) return resolve(结果);
        结果.push(游标.value);
        游标.continue();
      };
      请求.onerror = () => reject(请求.error);
    });
  }

  // src/发帖监听.ts
  function 安装发帖监听(页面窗口2) {
    if (页面窗口2.__shantieInstalled) return;
    页面窗口2.__shantieInstalled = true;
    const 原始Fetch2 = 页面窗口2.fetch.bind(页面窗口2);
    const 原始Open = 页面窗口2.XMLHttpRequest.prototype.open;
    const 原始Send = 页面窗口2.XMLHttpRequest.prototype.send;
    const 请求信息 = /* @__PURE__ */ new WeakMap();
    页面窗口2.fetch = (async (...参数) => {
      const [输入, 初始化2] = 参数;
      if (!是发帖请求(输入, 初始化2, 页面窗口2)) return 原始Fetch2(...参数);
      if (读取设置().blockPosting) return 构造拦截响应(页面窗口2, "fetch");
      const 响应 = await 原始Fetch2(...参数);
      if (响应.ok) void 解析并记录发帖响应(响应.clone().text());
      return 响应;
    });
    页面窗口2.XMLHttpRequest.prototype.open = function(method, url, async = true, username, password) {
      请求信息.set(this, { method: method.toUpperCase(), url: String(url) });
      Reflect.apply(原始Open, this, [method, url, async, username, password]);
    };
    页面窗口2.XMLHttpRequest.prototype.send = function(body) {
      const 信息 = 请求信息.get(this);
      if (!信息 || !是发帖地址(信息.method, 信息.url)) return 原始Send.call(this, body);
      if (读取设置().blockPosting) {
        显示拦截提示();
        this.abort();
        this.dispatchEvent(new 页面窗口2.ProgressEvent("error"));
        this.dispatchEvent(new 页面窗口2.ProgressEvent("loadend"));
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
        { once: true }
      );
      原始Send.call(this, body);
    };
  }
  function 是发帖请求(输入, 初始化2, 页面窗口2) {
    const 是Request = 输入 instanceof 页面窗口2.Request;
    const method = String(初始化2?.method ?? (是Request ? 输入.method : "GET")).toUpperCase();
    return 是发帖地址(method, 是Request ? 输入.url : String(输入));
  }
  function 是发帖地址(method, 地址文本) {
    try {
      const 地址 = new URL(地址文本, location.href);
      return method === "POST" && 地址.origin === location.origin && /^\/posts(?:\.json)?\/?$/.test(地址.pathname);
    } catch {
      return false;
    }
  }
  function 构造拦截响应(页面窗口2, 通道) {
    显示拦截提示();
    console.warn(`[帖子管理器] 已拦截 ${通道} 发帖请求。`);
    return new 页面窗口2.Response(
      JSON.stringify({ errors: ["发帖已被本地脚本拦截"], error_type: "blocked_by_userscript" }),
      {
        status: 422,
        statusText: "Blocked by userscript",
        headers: { "Content-Type": "application/json" }
      }
    );
  }
  async function 解析并记录发帖响应(文本Promise) {
    try {
      const 数据 = JSON.parse(await 文本Promise);
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
        topicId: Number(帖子?.topic_id) || void 0,
        topicTitle: "",
        topicSlug: String(帖子?.topic_slug ?? ""),
        postNumber: Number(帖子?.post_number) || void 0,
        createdAt: String(帖子?.created_at ?? ""),
        postUrl: String(帖子?.post_url ?? ""),
        status: "待定",
        source: "发帖监听",
        lastError: ""
      });
      await 写日志(用户名, `新帖子 ${id} 已自动追加到待定队列。`);
    } catch (错误) {
      console.warn("[帖子管理器] 解析发帖响应失败", 错误);
    }
  }
  function 显示拦截提示() {
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
      font: "600 14px system-ui"
    });
    document.documentElement.append(提示);
    window.setTimeout(() => 提示.remove(), 5e3);
  }

  // src/会话.ts
  function 从页面读取用户名(页面窗口2 = window) {
    const 全局 = 页面窗口2;
    const 候选 = [
      全局.currentUser?.username,
      全局.Discourse?.User?.current?.()?.username,
      document.querySelector('meta[name="discourse-current-username"]')?.content,
      document.querySelector('meta[name="current-user"]')?.content,
      document.querySelector('meta[name="discourse-username"]')?.content,
      document.documentElement?.getAttribute("data-current-username"),
      document.body?.getAttribute("data-current-username")
    ];
    const 直接值 = String(候选.find((值) => String(值 ?? "").trim()) ?? "").trim();
    if (直接值) return 直接值;
    try {
      const 预载 = document.querySelector("#data-preloaded")?.dataset.preloaded;
      if (!预载) return "";
      const 外层 = JSON.parse(预载);
      const 当前用户 = typeof 外层.currentUser === "string" ? JSON.parse(外层.currentUser) : 外层.currentUser;
      return String(当前用户?.username ?? "").trim();
    } catch {
      return "";
    }
  }
  async function 获取当前用户名(原始Fetch2 = fetch, 页面窗口2 = window) {
    const 页面值 = 从页面读取用户名(页面窗口2);
    if (页面值) return 页面值;
    try {
      const 响应 = await 原始Fetch2("/session/current.json", {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      if (!响应.ok) return "";
      const 数据 = await 响应.json();
      const 用户名 = String(数据.current_user?.username ?? "").trim();
      if (用户名) return 用户名;
    } catch {
    }
    for (let 次数 = 0; 次数 < 3; 次数 += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      const 重试值 = 从页面读取用户名(页面窗口2);
      if (重试值) return 重试值;
    }
    return "";
  }

  // src/迁移.ts
  async function 迁移旧删帖队列(用户名) {
    const 迁移键 = `shantie-v3-migrated:${用户名}`;
    if (localStorage.getItem(迁移键)) return;
    try {
      const 原始值 = localStorage.getItem(`shantie-delete-state-v2:${用户名}`);
      const 数据 = 原始值 ? JSON.parse(原始值) : {};
      const ids = [
        ...new Set((数据.queue ?? []).map((项) => Number(项.id)).filter((id) => Number.isSafeInteger(id) && id > 0))
      ];
      for (const id of ids) {
        await 保存帖子(
          {
            id,
            ownerUsername: 用户名,
            username: 用户名,
            raw: "",
            cooked: "",
            topicTitle: "",
            topicSlug: "",
            createdAt: "",
            postUrl: `/posts/${id}`,
            status: "待删除",
            source: "旧队列",
            lastError: ""
          },
          false
        );
      }
      if (ids.length) await 写日志(用户名, `已从旧脚本迁移 ${ids.length} 个待删帖子。`);
      localStorage.setItem(迁移键, "1");
    } catch (错误) {
      console.warn("[帖子管理器] 旧队列迁移失败，下次会重试。", 错误);
    }
  }

  // src/删帖器.ts
  var 删帖器 = class {
    constructor(用户名, 更新状态) {
      this.用户名 = 用户名;
      this.更新状态 = 更新状态;
    }
    用户名;
    更新状态;
    控制器 = null;
    get 运行中() {
      return this.控制器 !== null;
    }
    async 开始() {
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
              this.更新状态(`遇到限流，${Math.ceil(错误.waitMs / 1e3)} 秒后自动继续……`);
              await 等待(错误.waitMs, 信号);
            } else throw 错误;
          }
        }
      } catch (错误) {
        if (!信号.aborted) {
          const 消息 = 错误 instanceof Error ? 错误.message : String(错误);
          this.更新状态(`删帖停止：${消息}`);
          await 写日志(this.用户名, `删帖异常：${消息}`, void 0, "error");
        }
      } finally {
        this.控制器 = null;
      }
    }
    停止() {
      this.控制器?.abort();
      this.更新状态("已停止删帖。");
    }
    async 处理批次(帖子, 使用批量, 信号) {
      const 结果 = 使用批量 ? await 批量删除(
        帖子.map((项) => 项.id),
        信号
      ) : await 单个删除(帖子[0].id, 信号);
      if (结果.ok) {
        await 更新帖子状态(
          this.用户名,
          帖子.map((项) => 项.id),
          "已删除"
        );
        await 写日志(this.用户名, `删除成功：${帖子.map((项) => 项.id).join(", ")}`);
        return;
      }
      if (结果.status === 429) throw new 限流错误(结果.waitMs ?? 3e5);
      if (帖子.length > 1) {
        const 中点 = Math.ceil(帖子.length / 2);
        await this.处理批次(帖子.slice(0, 中点), true, 信号);
        await this.处理批次(帖子.slice(中点), true, 信号);
        return;
      }
      const 单帖结果 = 使用批量 ? await 单个删除(帖子[0].id, 信号) : 结果;
      if (单帖结果.ok || 单帖结果.status === 404) {
        await 更新帖子状态(this.用户名, [帖子[0].id], "已删除");
      } else if (单帖结果.status === 429) {
        throw new 限流错误(单帖结果.waitMs ?? 3e5);
      } else {
        await 更新帖子状态(this.用户名, [帖子[0].id], "失败", 单帖结果.message);
        await 写日志(this.用户名, `帖子 ${帖子[0].id} 删除失败：${单帖结果.message}`, void 0, "error");
      }
    }
  };
  var 限流错误 = class extends Error {
    constructor(waitMs) {
      super("请求限流");
      this.waitMs = waitMs;
    }
    waitMs;
  };
  async function 批量删除(ids, 信号) {
    const body = new URLSearchParams();
    ids.forEach((id) => body.append("post_ids[]", String(id)));
    return 请求删除("/posts/destroy_many", body, 信号);
  }
  async function 单个删除(id, 信号) {
    return 请求删除(`/posts/${id}`, new URLSearchParams({ context: "/" }), 信号);
  }
  async function 请求删除(路径, body, 信号) {
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
    if (!csrf) return { ok: false, status: 0, message: "未找到 CSRF token，请刷新页面并确认已登录。" };
    const 响应 = await fetch(路径, {
      method: "DELETE",
      credentials: "include",
      signal: 信号,
      headers: {
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-CSRF-Token": csrf,
        "X-Requested-With": "XMLHttpRequest"
      },
      body
    });
    if (响应.ok) return { ok: true, status: 响应.status, message: "成功" };
    const 文本 = await 响应.text();
    let 数据 = {};
    try {
      数据 = JSON.parse(文本);
    } catch {
    }
    const 等待秒数 = Number(数据.extras?.wait_seconds || 响应.headers.get("retry-after") || 0);
    return {
      ok: false,
      status: 响应.status,
      message: 数据.errors?.join(" | ") || 文本.slice(0, 200) || `HTTP ${响应.status}`,
      waitMs: 等待秒数 ? Math.max(5e3, 等待秒数 * 1e3) : void 0
    };
  }

  // src/帖子同步.ts
  async function 同步所有帖子(选项) {
    const 已见 = /* @__PURE__ */ new Set();
    const 已请求 = /* @__PURE__ */ new Set();
    let 下一路径 = 构造路径(选项.username, 0);
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
        signal: 选项.signal
      });
      if (!响应.ok) throw new Error(`获取帖子失败：HTTP ${响应.status} ${(await 响应.text()).slice(0, 200)}`);
      const 数据 = await 响应.json();
      const 本页 = Array.isArray(数据.user_actions) ? 数据.user_actions : [];
      if (!本页.length) break;
      偏移量 += 本页.length;
      const 待保存 = 本页.filter((动态) => 命中范围(动态, 选项.minId, 选项.maxId, 已见)).map((动态) => 转为帖子(动态, 选项.username));
      总数 += await 批量保存帖子(待保存);
      const 有效编号 = 本页.map((项) => Number(项.post_id)).filter(Number.isSafeInteger);
      if (选项.minId !== null && 有效编号.length && Math.max(...有效编号) < 选项.minId) break;
      下一路径 = typeof 数据.load_more_user_actions_url === "string" && 数据.load_more_user_actions_url ? 数据.load_more_user_actions_url : 本页.length >= 30 ? 构造路径(选项.username, 偏移量) : null;
      if (下一路径 && 选项.delayMs) await 等待(选项.delayMs, 选项.signal);
    }
    await 写日志(选项.username, `帖子同步完成，本次命中 ${总数} 条。`);
    return 总数;
  }
  function 命中范围(动态, min, max, 已见) {
    const id = Number(动态.post_id);
    if (!Number.isSafeInteger(id) || 已见.has(id) || min !== null && id < min || max !== null && id > max)
      return false;
    已见.add(id);
    return true;
  }
  function 转为帖子(动态, 用户名) {
    const id = Number(动态.post_id);
    const topicId = Number(动态.topic_id) || void 0;
    const postNumber = Number(动态.post_number) || void 0;
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
      postUrl: topicId ? `/t/${encodeURIComponent(slug)}/${topicId}${postNumber ? `/${postNumber}` : ""}` : `/posts/${id}`,
      status: "待定",
      source: "同步",
      lastError: ""
    };
  }
  function 构造路径(用户名, offset) {
    return `/user_actions.json?${new URLSearchParams({ offset: String(offset), username: 用户名, filter: "5" })}`;
  }

  // src/管理页.ts
  function 启动管理页(用户名) {
    document.title = `${脚本名称} · ${用户名}`;
    document.body.innerHTML = `<main id="shantie-manager"><div class="loading">正在载入帖子数据……</div></main>`;
    const 根 = document.querySelector("#shantie-manager");
    const 样式 = document.createElement("style");
    样式.textContent = 管理页样式;
    document.head.append(样式);
    let 当前页签 = "review";
    let 审核页码 = 1;
    const 每页审核数 = 40;
    let 运行状态 = "就绪";
    let 同步控制器 = null;
    let 刷新定时器 = null;
    const 删帖器实例 = new 删帖器(用户名, (消息) => {
      运行状态 = 消息;
      void 渲染();
    });
    监听数据变化(() => {
      if (刷新定时器 !== null) window.clearTimeout(刷新定时器);
      刷新定时器 = window.setTimeout(() => void 渲染(), 80);
    });
    根.addEventListener("click", (event) => void 处理点击(event));
    根.addEventListener("change", (event) => void 处理设置变更(event));
    void 渲染();
    async function 渲染() {
      const [全部, 日志] = await Promise.all([
        读取帖子(用户名),
        ["delete", "logs"].includes(当前页签) ? 读取日志(用户名) : Promise.resolve([])
      ]);
      const 分组 = (状态) => 全部.filter((帖子) => 帖子.status === 状态);
      const 待定 = 分组("待定");
      const 待删除 = 分组("待删除");
      const 保留 = 分组("保留");
      const 失败 = 分组("失败");
      const 设置 = 读取设置();
      根.innerHTML = `
      <header class="topbar">
        <div><h1>${转义HTML(脚本名称)}</h1><p>${转义HTML(用户名)} · 已记录 ${全部.length} 条 · ${转义HTML(运行状态)}</p></div>
        <a class="forum-link" href="/" target="_blank" rel="noopener">返回论坛 ↗</a>
      </header>
      <nav class="tabs">
        ${页签按钮("review", `待定审核 <b>${待定.length}</b>`)}
        ${页签按钮("delete", `删帖队列 <b>${待删除.length}</b>`)}
        ${页签按钮("sync", "获取帖子")}
        ${页签按钮("logs", "日志")}
        ${页签按钮("settings", `设置${设置.blockPosting ? " · 已拦截发帖" : ""}`)}
      </nav>
      <section class="content">${渲染页签(待定, 保留, 待删除, 失败, 日志, 设置)}</section>`;
    }
    function 页签按钮(页签, 文案) {
      return `<button class="tab ${当前页签 === 页签 ? "active" : ""}" data-tab="${页签}">${文案}</button>`;
    }
    function 渲染页签(待定, 保留, 待删除, 失败, 日志, 设置) {
      if (当前页签 === "review") return 渲染审核(待定, 保留);
      if (当前页签 === "delete") return 渲染删帖(待删除, 失败, 日志, 设置);
      if (当前页签 === "sync") return 渲染同步(设置);
      if (当前页签 === "logs") return 渲染日志(日志);
      return 渲染设置(设置);
    }
    function 渲染审核(帖子, 保留) {
      const 总页数 = Math.max(1, Math.ceil(帖子.length / 每页审核数));
      审核页码 = Math.min(审核页码, 总页数);
      const 起始 = (审核页码 - 1) * 每页审核数;
      const 本页帖子 = 帖子.slice(起始, 起始 + 每页审核数);
      const 分页 = 帖子.length ? `<div class="pagination"><button data-action="review-prev" ${审核页码 <= 1 ? "disabled" : ""}>上一页</button><span>第 ${审核页码} / ${总页数} 页 · 共 ${帖子.length} 条</span><button data-action="review-next" ${审核页码 >= 总页数 ? "disabled" : ""}>下一页</button></div>` : "";
      const 待定内容 = 帖子.length ? `${分页}<div class="post-list">${本页帖子.map((项) => 帖子卡片(项, true)).join("")}</div>${分页}` : 空状态("没有待定帖子", "可以去“获取帖子”同步历史帖。之后的新发帖也会自动进入这里。");
      const 保留内容 = 保留.length ? `<div class="section-head secondary"><div><h2>最近保留</h2><p>可将误操作的帖子移回待定。</p></div></div><div class="compact-list">${保留.slice(0, 20).map((项) => 帖子卡片(项, false)).join("")}</div>` : "";
      return `<div class="section-head"><div><h2>待定审核</h2><p>按发布时间从新到旧；没有时间的手动 ID 按 post_id 从大到小。</p></div></div>${待定内容}${保留内容}`;
    }
    function 渲染删帖(队列, 失败, 日志, 设置) {
      return `<div class="grid two">
      <article class="card"><h2>加入删帖队列</h2><textarea id="manual-ids" placeholder="123456, 123457"></textarea><button class="primary" data-action="add-ids">加入待删除</button></article>
      <article class="card"><h2>删帖执行</h2>
        <div class="segmented"><label><input type="radio" name="delete-mode" value="逐帖" ${设置.deleteMode === "逐帖" ? "checked" : ""}>逐帖</label><label><input type="radio" name="delete-mode" value="批量" ${设置.deleteMode === "批量" ? "checked" : ""}>批量</label></div>
        <div class="form-row"><label>逐帖间隔 <input id="single-delay" type="number" min="5000" value="${设置.singleDelayMs}"></label><label>批量大小 <input id="batch-size" type="number" min="2" max="100" value="${设置.batchSize}"></label><label>批次间隔 <input id="batch-delay" type="number" min="1000" value="${设置.batchDelayMs}"></label></div>
        <div class="actions"><button class="danger" data-action="start-delete">开始删除</button><button data-action="stop-delete">停止</button></div>
      </article></div>
      <div class="section-head"><div><h2>待删除 ${队列.length} 条</h2><p>失败 ${失败.length} 条。批量失败时会自动二分定位。</p></div></div>
      <div class="compact-list">${[...失败, ...队列].slice(0, 100).map((项) => 帖子卡片(项, false)).join("") || 空状态("队列为空", "在审核页选择删除，或手动输入 ID。")}</div>
      <div class="section-head secondary"><div><h2>删帖日志</h2><p>最近 50 条；“日志”页保留更多。</p></div></div><div class="logs">${日志.slice(0, 50).map(
        (项) => `<div class="log ${项.level}"><time>${new Date(项.time).toLocaleString()}</time><span>${转义HTML(项.message)}</span></div>`
      ).join("") || 空状态("暂无日志", "")}</div>`;
    }
    function 渲染同步(设置) {
      return `<article class="card narrow"><h2>获取已发布的帖子</h2><p>通过 Discourse 用户动态分页获取，新帖会进入“待定”，已审核帖子的决定不会被覆盖。</p>
      <div class="form-row"><label>最小 post_id（可空）<input id="fetch-min" type="number" value="${转义HTML(设置.fetchMinId)}"></label><label>最大 post_id（可空）<input id="fetch-max" type="number" value="${转义HTML(设置.fetchMaxId)}"></label><label>请求间隔<input id="fetch-delay" type="number" min="0" value="${设置.fetchDelayMs}"></label></div>
      <div class="actions"><button class="primary" data-action="start-sync" ${同步控制器 ? "disabled" : ""}>开始获取</button><button data-action="stop-sync" ${同步控制器 ? "" : "disabled"}>停止</button></div></article>`;
    }
    function 渲染日志(日志) {
      return `<div class="section-head"><div><h2>最近日志</h2><p>最新的 200 条。</p></div></div><div class="logs">${日志.map((项) => `<div class="log ${项.level}"><time>${new Date(项.time).toLocaleString()}</time><span>${转义HTML(项.message)}</span></div>`).join("") || 空状态("暂无日志", "")}</div>`;
    }
    function 渲染设置(设置) {
      return `<article class="card narrow"><h2>发帖保护</h2><label class="switch"><input id="block-posting" type="checkbox" ${设置.blockPosting ? "checked" : ""}><span></span><b>阻止当前浏览器发帖</b></label><p>开启后会在页面环境拦截 Fetch 和 XMLHttpRequest 的 POST /posts。关闭时，成功发帖的响应会自动写入待定队列。</p></article>`;
    }
    function 帖子卡片(帖子, 可审核) {
      const 内容 = 帖子.raw || 去除HTML(帖子.cooked) || "（未获取到内容）";
      return `<article class="post-card"><div class="post-meta"><a href="${转义HTML(帖子.postUrl || `/posts/${帖子.id}`)}" target="_blank" rel="noopener">#${帖子.id}</a><span>${转义HTML(帖子.topicTitle)}</span><time>${帖子.createdAt ? new Date(帖子.createdAt).toLocaleString() : ""}</time><em>${转义HTML(帖子.source)} · ${转义HTML(帖子.status)}</em></div><pre>${转义HTML(内容)}</pre>${帖子.lastError ? `<p class="error-text">${转义HTML(帖子.lastError)}</p>` : ""}<div class="post-actions">${可审核 ? `<button class="danger" data-decision="待删除" data-id="${帖子.id}">加入删除</button><button class="keep" data-decision="保留" data-id="${帖子.id}">保留</button>` : `<button data-decision="待定" data-id="${帖子.id}">移回待定</button>`}</div></article>`;
    }
    function 空状态(标题, 说明) {
      return `<div class="empty"><h3>${转义HTML(标题)}</h3><p>${转义HTML(说明)}</p></div>`;
    }
    async function 处理点击(event) {
      const 目标 = event.target instanceof HTMLElement ? event.target.closest("[data-tab],[data-action],[data-decision]") : null;
      if (!目标) return;
      if (目标.dataset.tab) {
        当前页签 = 目标.dataset.tab;
        return void 渲染();
      }
      if (目标.dataset.decision) {
        const id = Number(目标.dataset.id);
        const 决定 = 目标.dataset.decision;
        await 更新帖子状态(用户名, [id], 决定);
        await 写日志(用户名, `帖子 ${id} 已标记为${决定}。`);
        return;
      }
      const action = 目标.dataset.action;
      if (action === "add-ids") return void 加入手动编号();
      if (action === "review-prev") {
        审核页码 = Math.max(1, 审核页码 - 1);
        return void 渲染();
      }
      if (action === "review-next") {
        审核页码 += 1;
        return void 渲染();
      }
      if (action === "start-delete") {
        保存删帖表单();
        void 删帖器实例.开始();
        return;
      }
      if (action === "stop-delete") return 删帖器实例.停止();
      if (action === "start-sync") return void 开始同步();
      if (action === "stop-sync") return 同步控制器?.abort();
    }
    async function 处理设置变更(event) {
      const 输入 = event.target;
      if (!(输入 instanceof HTMLInputElement)) return;
      if (输入.id === "block-posting") {
        保存设置({ ...读取设置(), blockPosting: 输入.checked });
        await 写日志(用户名, `发帖拦截已${输入.checked ? "开启" : "关闭"}。`);
      }
      if (输入.name === "delete-mode") 保存设置({ ...读取设置(), deleteMode: 输入.value === "逐帖" ? "逐帖" : "批量" });
    }
    function 保存删帖表单() {
      const 旧设置 = 读取设置();
      保存设置({
        ...旧设置,
        singleDelayMs: 数值限制(输入值("single-delay"), 旧设置.singleDelayMs, 5e3, 864e5),
        batchSize: 数值限制(输入值("batch-size"), 旧设置.batchSize, 2, 100),
        batchDelayMs: 数值限制(输入值("batch-delay"), 旧设置.batchDelayMs, 1e3, 864e5)
      });
    }
    async function 加入手动编号() {
      const ids = 解析帖子编号(输入值("manual-ids"));
      const 已有编号 = new Set((await 读取帖子(用户名)).map((帖子) => 帖子.id));
      const 已有 = ids.filter((id) => 已有编号.has(id));
      const 新增 = ids.filter((id) => !已有编号.has(id));
      await 更新帖子状态(用户名, 已有, "待删除");
      for (const id of 新增)
        await 保存帖子(
          {
            id,
            ownerUsername: 用户名,
            username: 用户名,
            raw: "",
            cooked: "",
            topicTitle: "",
            topicSlug: "",
            createdAt: "",
            postUrl: `/posts/${id}`,
            status: "待删除",
            source: "手动",
            lastError: ""
          },
          false
        );
      await 写日志(用户名, `手动加入 ${ids.length} 个帖子 ID。`);
    }
    async function 开始同步() {
      if (同步控制器) return;
      const 旧设置 = 读取设置();
      const min = 输入值("fetch-min").trim();
      const max = 输入值("fetch-max").trim();
      const minId = min ? Number(min) : null;
      const maxId = max ? Number(max) : null;
      if (minId !== null && (!Number.isSafeInteger(minId) || minId <= 0) || maxId !== null && (!Number.isSafeInteger(maxId) || maxId <= 0) || minId !== null && maxId !== null && minId > maxId) {
        运行状态 = "帖子 ID 范围无效。";
        return void 渲染();
      }
      const delay = 数值限制(输入值("fetch-delay"), 旧设置.fetchDelayMs, 0, 6e4);
      保存设置({ ...旧设置, fetchMinId: min, fetchMaxId: max, fetchDelayMs: delay });
      同步控制器 = new AbortController();
      void 渲染();
      try {
        const 数量 = await 同步所有帖子({
          username: 用户名,
          minId,
          maxId,
          delayMs: delay,
          signal: 同步控制器.signal,
          onProgress: (消息) => {
            运行状态 = 消息;
            void 渲染();
          }
        });
        const 数据库总数 = (await 读取帖子(用户名)).length;
        运行状态 = `同步完成，API 返回 ${数量} 条，数据库共 ${数据库总数} 条。`;
      } catch (错误) {
        运行状态 = 错误 instanceof DOMException && 错误.name === "AbortError" ? "同步已停止。" : `同步失败：${提取错误(错误)}`;
      } finally {
        同步控制器 = null;
        void 渲染();
      }
    }
    function 输入值(id) {
      return document.getElementById(id)?.value ?? "";
    }
  }
  var 管理页样式 = `
  #shantie-manager, #shantie-manager *{box-sizing:border-box}body{margin:0!important;background:#f5f7fb!important;color:#172033!important;font:14px/1.55 system-ui,-apple-system,sans-serif!important}
  #shantie-manager{position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#f5f7fb}.topbar{display:flex;align-items:center;justify-content:space-between;padding:24px max(24px,calc((100vw - 1180px)/2));background:#10233f;color:white}.topbar h1{margin:0;font-size:24px}.topbar p{margin:4px 0 0;color:#aec3dd}.forum-link{color:white;text-decoration:none;border:1px solid #57708e;border-radius:9px;padding:8px 12px}
  .tabs{position:sticky;top:0;z-index:2;display:flex;gap:4px;padding:10px max(24px,calc((100vw - 1180px)/2));overflow:auto;background:white;border-bottom:1px solid #dce3ed}.tab{white-space:nowrap;border:0;border-radius:8px;padding:10px 14px;background:transparent;color:#52647a;cursor:pointer}.tab.active{background:#e8f0ff;color:#1754b5}.tab b{display:inline-block;margin-left:5px;padding:1px 7px;border-radius:999px;background:#dce9ff}
  .content{max-width:1180px;margin:0 auto;padding:24px}.section-head{display:flex;justify-content:space-between;margin-bottom:14px}.section-head.secondary{margin-top:30px}.section-head h2,.card h2{margin:0 0 5px;font-size:18px}.section-head p,.card p{margin:0;color:#66758a}.grid.two{display:grid;grid-template-columns:1fr 1.5fr;gap:16px;margin-bottom:24px}.card,.post-card,.empty{padding:18px;border:1px solid #dce3ed;border-radius:13px;background:white;box-shadow:0 3px 14px rgba(33,51,78,.04)}.card.narrow{max-width:800px;margin:auto}
  textarea,input{width:100%;border:1px solid #c9d3e0;border-radius:8px;padding:9px 10px;background:white;color:#172033}textarea{height:90px;margin:10px 0}.form-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}.form-row label{color:#5d6d82;font-size:12px}.form-row input{margin-top:5px}.actions,.post-actions{display:flex;gap:8px;margin-top:12px}button{border:1px solid #c9d3e0;border-radius:8px;padding:9px 13px;background:white;cursor:pointer}button.primary{border-color:#2563eb;background:#2563eb;color:white}button.danger{border-color:#dc2626;background:#dc2626;color:white}button.keep{border-color:#16845b;background:#16845b;color:white}button:disabled{opacity:.45;cursor:not-allowed}
  .segmented{display:flex;gap:15px;margin:10px 0}.segmented label{display:flex;align-items:center;gap:5px}.segmented input,.switch input{width:auto}.pagination{display:flex;align-items:center;justify-content:center;gap:14px;margin:0 0 14px}.pagination+.post-list{margin-bottom:14px}.post-list,.compact-list,.logs{display:grid;gap:12px}.post-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:#718096;font-size:12px}.post-meta a{font-weight:700;color:#1754b5}.post-meta span{font-weight:600;color:#34445a}.post-meta em{margin-left:auto}.post-card pre{margin:12px 0 0;white-space:pre-wrap;word-break:break-word;font:14px/1.6 system-ui;color:#26364b}.error-text{color:#b42318}.compact-list .post-card pre{max-height:90px;overflow:auto}.empty{text-align:center;color:#718096}.empty h3{margin:0;color:#34445a}.empty p{margin:5px 0 0}.log{display:flex;gap:16px;padding:11px 14px;border-radius:8px;background:white;border:1px solid #e0e6ee}.log time{flex:0 0 180px;color:#718096}.log.error span{color:#b42318}.switch{display:flex;gap:10px;align-items:center;margin:18px 0}.switch b{font-size:16px}.loading{padding:60px;text-align:center}
  @media(max-width:760px){.grid.two,.form-row{grid-template-columns:1fr}.topbar{padding:18px}.content{padding:14px}.tabs{padding:8px 14px}.post-meta em{margin-left:0}.log{display:block}.log time{display:block;margin-bottom:4px}}
`;

  // src/论坛入口.ts
  function 初始化论坛入口(初始用户名 = "") {
    const 已有主机 = document.querySelector("#shantie-launcher");
    if (已有主机) return { 设置用户名: () => void 0, 显示错误: () => void 0 };
    let 用户名 = 初始用户名;
    const 主机 = document.createElement("div");
    主机.id = "shantie-launcher";
    const 根 = 主机.attachShadow({ mode: "open" });
    根.innerHTML = `<style>:host{all:initial}.button{position:fixed;right:18px;bottom:18px;z-index:2147483646;display:flex;align-items:center;gap:7px;border:0;border-radius:12px;padding:10px 13px;color:white;background:#17365f;box-shadow:0 10px 30px #0004;cursor:pointer;font:600 12px system-ui}.dot{width:8px;height:8px;border-radius:50%;background:#f59e0b}.dot.ready{background:#22c55e}.dot.blocked,.dot.error{background:#ef4444}.count{padding:1px 6px;border-radius:999px;background:#ffffff24}</style><button class="button" title="正在读取会话……"><span class="dot"></span><span>帖子管理</span><span class="count">…</span></button>`;
    document.documentElement.append(主机);
    const 按钮 = 根.querySelector(".button");
    按钮.addEventListener("click", () => window.open(`/?${管理页参数}=1`, "shantie-manager"));
    const 刷新 = async () => {
      if (!用户名) return;
      const [待定, 待删] = await Promise.all([读取帖子(用户名, "待定"), 读取帖子(用户名, "待删除")]);
      根.querySelector(".count").textContent = String(待定.length + 待删.length);
      根.querySelector(".dot").className = `dot ${读取设置().blockPosting ? "blocked" : "ready"}`;
      按钮.title = `待定 ${待定.length} · 待删 ${待删.length}${读取设置().blockPosting ? " · 已拦截发帖" : ""}`;
    };
    监听数据变化(() => void 刷新());
    window.addEventListener("storage", () => void 刷新());
    window.addEventListener("shantie-settings-changed", () => void 刷新());
    void 刷新();
    return {
      设置用户名: (新用户名) => {
        用户名 = 新用户名;
        void 刷新();
      },
      显示错误: (消息) => {
        根.querySelector(".dot").className = "dot error";
        根.querySelector(".count").textContent = "!";
        按钮.title = 消息;
      }
    };
  }

  // src/shantie.user.ts
  var 页面窗口 = typeof unsafeWindow === "undefined" ? window : unsafeWindow;
  var 原始Fetch = 页面窗口.fetch.bind(页面窗口);
  var 发帖监听错误 = "";
  try {
    安装发帖监听(页面窗口);
  } catch (错误) {
    发帖监听错误 = 错误 instanceof Error ? 错误.message : String(错误);
    console.error("[帖子管理器] 发帖监听安装失败，其他功能仍会启动。", 错误);
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => void 初始化(), { once: true });
  else void 初始化();
  async function 初始化() {
    const 是管理页 = new URLSearchParams(location.search).get(管理页参数) === "1";
    const 入口 = 是管理页 ? null : 初始化论坛入口();
    if (是管理页) 显示管理页启动状态("正在读取当前会话……");
    try {
      const 用户名 = await 获取当前用户名(原始Fetch, 页面窗口);
      if (!用户名) {
        const 消息 = "无法识别当前用户，请确认已登录后刷新。";
        console.warn(`[帖子管理器] ${消息}`);
        if (是管理页) 显示管理页启动状态(消息, true);
        else 入口?.显示错误(消息);
        return;
      }
      await 迁移旧删帖队列(用户名);
      if (是管理页) 启动管理页(用户名);
      else {
        入口?.设置用户名(用户名);
        if (发帖监听错误) 入口?.显示错误(`发帖监听安装失败：${发帖监听错误}`);
      }
    } catch (错误) {
      const 消息 = `启动失败：${错误 instanceof Error ? 错误.message : String(错误)}`;
      console.error(`[帖子管理器] ${消息}`, 错误);
      if (是管理页) 显示管理页启动状态(消息, true);
      else 入口?.显示错误(消息);
    }
  }
  function 显示管理页启动状态(消息, 错误 = false) {
    document.body.innerHTML = `<main style="position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#f5f7fb;font:16px system-ui;color:${错误 ? "#b42318" : "#334155"}"><div style="max-width:620px;padding:30px;text-align:center"><h1 style="color:#172033">帖子管理器</h1><p>${消息}</p>${错误 ? '<button onclick="location.reload()" style="padding:9px 14px">重新加载</button>' : ""}</div></main>`;
  }
})();
