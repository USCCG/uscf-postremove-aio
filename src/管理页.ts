import { 脚本名称 } from "./常量";
import { 删帖器 } from "./删帖器";
import { 保存设置, 读取设置 } from "./设置";
import { 保存帖子, 写日志, 更新帖子状态, 监听数据变化, 读取帖子, 读取日志 } from "./存储";
import { 同步所有帖子 } from "./帖子同步";
import type { 帖子记录, 帖子状态, 设置 } from "./类型";
import { 去除HTML, 提取错误, 数值限制, 解析帖子编号, 转义HTML } from "./工具";

type 页签 = "review" | "delete" | "sync" | "logs" | "settings";

export function 启动管理页(用户名: string): void {
  document.title = `${脚本名称} · ${用户名}`;
  document.body.innerHTML = `<main id="shantie-manager"><div class="loading">正在载入帖子数据……</div></main>`;
  const 根 = document.querySelector<HTMLElement>("#shantie-manager")!;
  const 样式 = document.createElement("style");
  样式.textContent = 管理页样式;
  document.head.append(样式);

  let 当前页签: 页签 = "review";
  let 审核页码 = 1;
  const 每页审核数 = 40;
  let 运行状态 = "就绪";
  let 同步控制器: AbortController | null = null;
  let 刷新定时器: number | null = null;
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

  async function 渲染(): Promise<void> {
    const [全部, 日志] = await Promise.all([
      读取帖子(用户名),
      ["delete", "logs"].includes(当前页签) ? 读取日志(用户名) : Promise.resolve([]),
    ]);
    const 分组 = (状态: 帖子状态): 帖子记录[] => 全部.filter((帖子) => 帖子.status === 状态);
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

  function 页签按钮(页签: 页签, 文案: string): string {
    return `<button class="tab ${当前页签 === 页签 ? "active" : ""}" data-tab="${页签}">${文案}</button>`;
  }

  function 渲染页签(
    待定: 帖子记录[],
    保留: 帖子记录[],
    待删除: 帖子记录[],
    失败: 帖子记录[],
    日志: Awaited<ReturnType<typeof 读取日志>>,
    设置: 设置,
  ): string {
    if (当前页签 === "review") return 渲染审核(待定, 保留);
    if (当前页签 === "delete") return 渲染删帖(待删除, 失败, 日志, 设置);
    if (当前页签 === "sync") return 渲染同步(设置);
    if (当前页签 === "logs") return 渲染日志(日志);
    return 渲染设置(设置);
  }

  function 渲染审核(帖子: 帖子记录[], 保留: 帖子记录[]): string {
    const 总页数 = Math.max(1, Math.ceil(帖子.length / 每页审核数));
    审核页码 = Math.min(审核页码, 总页数);
    const 起始 = (审核页码 - 1) * 每页审核数;
    const 本页帖子 = 帖子.slice(起始, 起始 + 每页审核数);
    const 分页 = 帖子.length
      ? `<div class="pagination"><button data-action="review-prev" ${审核页码 <= 1 ? "disabled" : ""}>上一页</button><span>第 ${审核页码} / ${总页数} 页 · 共 ${帖子.length} 条</span><button data-action="review-next" ${审核页码 >= 总页数 ? "disabled" : ""}>下一页</button></div>`
      : "";
    const 待定内容 = 帖子.length
      ? `${分页}<div class="post-list">${本页帖子.map((项) => 帖子卡片(项, true)).join("")}</div>${分页}`
      : 空状态("没有待定帖子", "可以去“获取帖子”同步历史帖。之后的新发帖也会自动进入这里。");
    const 保留内容 = 保留.length
      ? `<div class="section-head secondary"><div><h2>最近保留</h2><p>可将误操作的帖子移回待定。</p></div></div><div class="compact-list">${保留
          .slice(0, 20)
          .map((项) => 帖子卡片(项, false))
          .join("")}</div>`
      : "";
    return `<div class="section-head"><div><h2>待定审核</h2><p>按发布时间从新到旧；没有时间的手动 ID 按 post_id 从大到小。</p></div></div>${待定内容}${保留内容}`;
  }

  function 渲染删帖(
    队列: 帖子记录[],
    失败: 帖子记录[],
    日志: Awaited<ReturnType<typeof 读取日志>>,
    设置: 设置,
  ): string {
    return `<div class="grid two">
      <article class="card"><h2>加入删帖队列</h2><textarea id="manual-ids" placeholder="123456, 123457"></textarea><button class="primary" data-action="add-ids">加入待删除</button></article>
      <article class="card"><h2>删帖执行</h2>
        <div class="segmented"><label><input type="radio" name="delete-mode" value="逐帖" ${设置.deleteMode === "逐帖" ? "checked" : ""}>逐帖</label><label><input type="radio" name="delete-mode" value="批量" ${设置.deleteMode === "批量" ? "checked" : ""}>批量</label></div>
        <div class="form-row"><label>逐帖间隔 <input id="single-delay" type="number" min="5000" value="${设置.singleDelayMs}"></label><label>批量大小 <input id="batch-size" type="number" min="2" max="100" value="${设置.batchSize}"></label><label>批次间隔 <input id="batch-delay" type="number" min="1000" value="${设置.batchDelayMs}"></label></div>
        <div class="actions"><button class="danger" data-action="start-delete">开始删除</button><button data-action="stop-delete">停止</button></div>
      </article></div>
      <div class="section-head"><div><h2>待删除 ${队列.length} 条</h2><p>失败 ${失败.length} 条。批量失败时会自动二分定位。</p></div></div>
      <div class="compact-list">${
        [...失败, ...队列]
          .slice(0, 100)
          .map((项) => 帖子卡片(项, false))
          .join("") || 空状态("队列为空", "在审核页选择删除，或手动输入 ID。")
      }</div>
      <div class="section-head secondary"><div><h2>删帖日志</h2><p>最近 50 条；“日志”页保留更多。</p></div></div><div class="logs">${
        日志
          .slice(0, 50)
          .map(
            (项) =>
              `<div class="log ${项.level}"><time>${new Date(项.time).toLocaleString()}</time><span>${转义HTML(项.message)}</span></div>`,
          )
          .join("") || 空状态("暂无日志", "")
      }</div>`;
  }

  function 渲染同步(设置: 设置): string {
    return `<article class="card narrow"><h2>获取已发布的帖子</h2><p>通过 Discourse 用户动态分页获取，新帖会进入“待定”，已审核帖子的决定不会被覆盖。</p>
      <div class="form-row"><label>最小 post_id（可空）<input id="fetch-min" type="number" value="${转义HTML(设置.fetchMinId)}"></label><label>最大 post_id（可空）<input id="fetch-max" type="number" value="${转义HTML(设置.fetchMaxId)}"></label><label>请求间隔<input id="fetch-delay" type="number" min="0" value="${设置.fetchDelayMs}"></label></div>
      <div class="actions"><button class="primary" data-action="start-sync" ${同步控制器 ? "disabled" : ""}>开始获取</button><button data-action="stop-sync" ${同步控制器 ? "" : "disabled"}>停止</button></div></article>`;
  }

  function 渲染日志(日志: Awaited<ReturnType<typeof 读取日志>>): string {
    return `<div class="section-head"><div><h2>最近日志</h2><p>最新的 200 条。</p></div></div><div class="logs">${日志.map((项) => `<div class="log ${项.level}"><time>${new Date(项.time).toLocaleString()}</time><span>${转义HTML(项.message)}</span></div>`).join("") || 空状态("暂无日志", "")}</div>`;
  }

  function 渲染设置(设置: 设置): string {
    return `<article class="card narrow"><h2>发帖保护</h2><label class="switch"><input id="block-posting" type="checkbox" ${设置.blockPosting ? "checked" : ""}><span></span><b>阻止当前浏览器发帖</b></label><p>开启后会在页面环境拦截 Fetch 和 XMLHttpRequest 的 POST /posts。关闭时，成功发帖的响应会自动写入待定队列。</p></article>`;
  }

  function 帖子卡片(帖子: 帖子记录, 可审核: boolean): string {
    const 内容 = 帖子.raw || 去除HTML(帖子.cooked) || "（未获取到内容）";
    return `<article class="post-card"><div class="post-meta"><a href="${转义HTML(帖子.postUrl || `/posts/${帖子.id}`)}" target="_blank" rel="noopener">#${帖子.id}</a><span>${转义HTML(帖子.topicTitle)}</span><time>${帖子.createdAt ? new Date(帖子.createdAt).toLocaleString() : ""}</time><em>${转义HTML(帖子.source)} · ${转义HTML(帖子.status)}</em></div><pre>${转义HTML(内容)}</pre>${帖子.lastError ? `<p class="error-text">${转义HTML(帖子.lastError)}</p>` : ""}<div class="post-actions">${可审核 ? `<button class="danger" data-decision="待删除" data-id="${帖子.id}">加入删除</button><button class="keep" data-decision="保留" data-id="${帖子.id}">保留</button>` : `<button data-decision="待定" data-id="${帖子.id}">移回待定</button>`}</div></article>`;
  }

  function 空状态(标题: string, 说明: string): string {
    return `<div class="empty"><h3>${转义HTML(标题)}</h3><p>${转义HTML(说明)}</p></div>`;
  }

  async function 处理点击(event: MouseEvent): Promise<void> {
    const 目标 =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-tab],[data-action],[data-decision]")
        : null;
    if (!目标) return;
    if (目标.dataset.tab) {
      当前页签 = 目标.dataset.tab as 页签;
      return void 渲染();
    }
    if (目标.dataset.decision) {
      const id = Number(目标.dataset.id);
      const 决定 = 目标.dataset.decision as 帖子状态;
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

  async function 处理设置变更(event: Event): Promise<void> {
    const 输入 = event.target;
    if (!(输入 instanceof HTMLInputElement)) return;
    if (输入.id === "block-posting") {
      保存设置({ ...读取设置(), blockPosting: 输入.checked });
      await 写日志(用户名, `发帖拦截已${输入.checked ? "开启" : "关闭"}。`);
    }
    if (输入.name === "delete-mode") 保存设置({ ...读取设置(), deleteMode: 输入.value === "逐帖" ? "逐帖" : "批量" });
  }

  function 保存删帖表单(): void {
    const 旧设置 = 读取设置();
    保存设置({
      ...旧设置,
      singleDelayMs: 数值限制(输入值("single-delay"), 旧设置.singleDelayMs, 5_000, 86_400_000),
      batchSize: 数值限制(输入值("batch-size"), 旧设置.batchSize, 2, 100),
      batchDelayMs: 数值限制(输入值("batch-delay"), 旧设置.batchDelayMs, 1_000, 86_400_000),
    });
  }

  async function 加入手动编号(): Promise<void> {
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
          lastError: "",
        },
        false,
      );
    await 写日志(用户名, `手动加入 ${ids.length} 个帖子 ID。`);
  }

  async function 开始同步(): Promise<void> {
    if (同步控制器) return;
    const 旧设置 = 读取设置();
    const min = 输入值("fetch-min").trim();
    const max = 输入值("fetch-max").trim();
    const minId = min ? Number(min) : null;
    const maxId = max ? Number(max) : null;
    if (
      (minId !== null && (!Number.isSafeInteger(minId) || minId <= 0)) ||
      (maxId !== null && (!Number.isSafeInteger(maxId) || maxId <= 0)) ||
      (minId !== null && maxId !== null && minId > maxId)
    ) {
      运行状态 = "帖子 ID 范围无效。";
      return void 渲染();
    }
    const delay = 数值限制(输入值("fetch-delay"), 旧设置.fetchDelayMs, 0, 60_000);
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
        },
      });
      const 数据库总数 = (await 读取帖子(用户名)).length;
      运行状态 = `同步完成，API 返回 ${数量} 条，数据库共 ${数据库总数} 条。`;
    } catch (错误) {
      运行状态 =
        错误 instanceof DOMException && 错误.name === "AbortError" ? "同步已停止。" : `同步失败：${提取错误(错误)}`;
    } finally {
      同步控制器 = null;
      void 渲染();
    }
  }

  function 输入值(id: string): string {
    return (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
  }
}

const 管理页样式 = `
  #shantie-manager, #shantie-manager *{box-sizing:border-box}body{margin:0!important;background:#f5f7fb!important;color:#172033!important;font:14px/1.55 system-ui,-apple-system,sans-serif!important}
  #shantie-manager{position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#f5f7fb}.topbar{display:flex;align-items:center;justify-content:space-between;padding:24px max(24px,calc((100vw - 1180px)/2));background:#10233f;color:white}.topbar h1{margin:0;font-size:24px}.topbar p{margin:4px 0 0;color:#aec3dd}.forum-link{color:white;text-decoration:none;border:1px solid #57708e;border-radius:9px;padding:8px 12px}
  .tabs{position:sticky;top:0;z-index:2;display:flex;gap:4px;padding:10px max(24px,calc((100vw - 1180px)/2));overflow:auto;background:white;border-bottom:1px solid #dce3ed}.tab{white-space:nowrap;border:0;border-radius:8px;padding:10px 14px;background:transparent;color:#52647a;cursor:pointer}.tab.active{background:#e8f0ff;color:#1754b5}.tab b{display:inline-block;margin-left:5px;padding:1px 7px;border-radius:999px;background:#dce9ff}
  .content{max-width:1180px;margin:0 auto;padding:24px}.section-head{display:flex;justify-content:space-between;margin-bottom:14px}.section-head.secondary{margin-top:30px}.section-head h2,.card h2{margin:0 0 5px;font-size:18px}.section-head p,.card p{margin:0;color:#66758a}.grid.two{display:grid;grid-template-columns:1fr 1.5fr;gap:16px;margin-bottom:24px}.card,.post-card,.empty{padding:18px;border:1px solid #dce3ed;border-radius:13px;background:white;box-shadow:0 3px 14px rgba(33,51,78,.04)}.card.narrow{max-width:800px;margin:auto}
  textarea,input{width:100%;border:1px solid #c9d3e0;border-radius:8px;padding:9px 10px;background:white;color:#172033}textarea{height:90px;margin:10px 0}.form-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}.form-row label{color:#5d6d82;font-size:12px}.form-row input{margin-top:5px}.actions,.post-actions{display:flex;gap:8px;margin-top:12px}button{border:1px solid #c9d3e0;border-radius:8px;padding:9px 13px;background:white;cursor:pointer}button.primary{border-color:#2563eb;background:#2563eb;color:white}button.danger{border-color:#dc2626;background:#dc2626;color:white}button.keep{border-color:#16845b;background:#16845b;color:white}button:disabled{opacity:.45;cursor:not-allowed}
  .segmented{display:flex;gap:15px;margin:10px 0}.segmented label{display:flex;align-items:center;gap:5px}.segmented input,.switch input{width:auto}.pagination{display:flex;align-items:center;justify-content:center;gap:14px;margin:0 0 14px}.pagination+.post-list{margin-bottom:14px}.post-list,.compact-list,.logs{display:grid;gap:12px}.post-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:#718096;font-size:12px}.post-meta a{font-weight:700;color:#1754b5}.post-meta span{font-weight:600;color:#34445a}.post-meta em{margin-left:auto}.post-card pre{margin:12px 0 0;white-space:pre-wrap;word-break:break-word;font:14px/1.6 system-ui;color:#26364b}.error-text{color:#b42318}.compact-list .post-card pre{max-height:90px;overflow:auto}.empty{text-align:center;color:#718096}.empty h3{margin:0;color:#34445a}.empty p{margin:5px 0 0}.log{display:flex;gap:16px;padding:11px 14px;border-radius:8px;background:white;border:1px solid #e0e6ee}.log time{flex:0 0 180px;color:#718096}.log.error span{color:#b42318}.switch{display:flex;gap:10px;align-items:center;margin:18px 0}.switch b{font-size:16px}.loading{padding:60px;text-align:center}
  @media(max-width:760px){.grid.two,.form-row{grid-template-columns:1fr}.topbar{padding:18px}.content{padding:14px}.tabs{padding:8px 14px}.post-meta em{margin-left:0}.log{display:block}.log time{display:block;margin-bottom:4px}}
`;
