import { 脚本名称 } from "./常量";
import { 删帖器 } from "./删帖器";
import { 编辑器, 编译编辑脚本, 预览编辑, type 编辑脚本组 } from "./编辑器";
import { 保存设置, 读取设置 } from "./设置";
import { 保存帖子, 写日志, 更新帖子状态, 监听数据变化, 读取帖子, 读取日志 } from "./存储";
import { 同步所有帖子 } from "./帖子同步";
import type { 审核顺序, 同步目标, 同步类型, 帖子记录, 帖子状态, 设置, 远程审核失败策略 } from "./类型";
import { 提取错误, 数值限制, 解析帖子编号, 转义HTML } from "./工具";
import { 远程审核器, 远程审核提示词 } from "./远程审核";

type 页签 = "review" | "focus" | "decided" | "edit" | "delete" | "sync" | "logs" | "settings";

export function 启动管理页(用户名: string): void {
  document.title = `${脚本名称} · ${用户名}`;
  document.body.innerHTML = `<main id="shantie-manager"><div class="loading">正在载入帖子数据……</div></main>`;
  const 根 = document.querySelector<HTMLElement>("#shantie-manager")!;
  const 样式 = document.createElement("style");
  样式.textContent = 管理页样式;
  document.head.append(样式);

  let 当前页签: 页签 = "review";
  let 审核页码 = 1;
  let 已处理页码 = 1;
  const 每页审核数 = 40;
  let 运行状态 = "就绪";
  let 编辑预览内容: { id: number; 原文: string; 新文: string; 原标题?: string; 新标题?: string } | null = null;
  let 同步控制器: AbortController | null = null;
  let 刷新定时器: number | null = null;
  const 删帖器实例 = new 删帖器(用户名, (消息) => {
    运行状态 = 消息;
    void 渲染();
  });
  const 编辑器实例 = new 编辑器(用户名, (消息) => {
    运行状态 = 消息;
    void 渲染();
  });
  const 远程审核器实例 = new 远程审核器(用户名, (消息) => {
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
      ["edit", "delete", "logs"].includes(当前页签) ? 读取日志(用户名) : Promise.resolve([]),
    ]);
    const 设置 = 读取设置();
    const 分组 = (状态: 帖子状态): 帖子记录[] => 全部.filter((帖子) => 帖子.status === 状态);
    const 待定 = 排序审核帖子(分组("待定"), 设置.reviewOrder);
    const 待删除 = 分组("待删除");
    const 待编辑 = 分组("待编辑");
    const 保留 = 分组("保留");
    const 已编辑 = 分组("已编辑");
    const 已处理 = 全部
      .filter((帖子) => 帖子.status === "保留" || 帖子.status === "已编辑")
      .sort((左, 右) => 右.updatedAt - 左.updatedAt);
    const 编辑失败 = 分组("编辑失败");
    const 失败 = 分组("失败");
    根.innerHTML = `
      <header class="topbar">
        <div><h1>${转义HTML(脚本名称)}</h1><p>${转义HTML(用户名)} · 已记录 ${全部.length} 条 · ${转义HTML(运行状态)}</p></div>
        <a class="forum-link" href="/" target="_blank" rel="noopener">返回论坛 ↗</a>
      </header>
      <nav class="tabs">
        ${页签按钮("review", `待定审核 <b>${待定.length}</b>`)}
        ${页签按钮("focus", `沉浸审核 <b>${待定.length}</b>`)}
        ${页签按钮("decided", `已处理 <b>${保留.length + 已编辑.length}</b>`)}
        ${页签按钮("edit", `编辑队列 <b>${待编辑.length}</b>`)}
        ${页签按钮("delete", `删帖队列 <b>${待删除.length}</b>`)}
        ${页签按钮("sync", "获取帖子")}
        ${页签按钮("logs", "日志")}
        ${页签按钮("settings", `设置${设置.blockPosting ? " · 已拦截发帖" : ""}`)}
      </nav>
      <section class="content">${渲染页签(待定, 已处理, 待编辑, 编辑失败, 待删除, 失败, 日志, 设置)}</section>`;
    准备帖子HTML();
  }

  function 页签按钮(页签: 页签, 文案: string): string {
    return `<button class="tab ${当前页签 === 页签 ? "active" : ""}" data-tab="${页签}">${文案}</button>`;
  }

  function 渲染页签(
    待定: 帖子记录[],
    已处理: 帖子记录[],
    待编辑: 帖子记录[],
    编辑失败: 帖子记录[],
    待删除: 帖子记录[],
    失败: 帖子记录[],
    日志: Awaited<ReturnType<typeof 读取日志>>,
    设置: 设置,
  ): string {
    if (当前页签 === "review") return 渲染审核(待定, 设置.reviewOrder);
    if (当前页签 === "focus") return 渲染沉浸审核(待定, 设置.reviewOrder);
    if (当前页签 === "decided") return 渲染已处理(已处理);
    if (当前页签 === "edit") return 渲染编辑(待编辑, 编辑失败, 日志, 设置);
    if (当前页签 === "delete") return 渲染删帖(待删除, 失败, 日志, 设置);
    if (当前页签 === "sync") return 渲染同步(设置);
    if (当前页签 === "logs") return 渲染日志(日志);
    return 渲染设置(设置, 待定.length);
  }

  function 渲染审核(帖子: 帖子记录[], 顺序: 审核顺序): string {
    const 总页数 = Math.max(1, Math.ceil(帖子.length / 每页审核数));
    审核页码 = Math.min(审核页码, 总页数);
    const 起始 = (审核页码 - 1) * 每页审核数;
    const 本页帖子 = 帖子.slice(起始, 起始 + 每页审核数);
    const 分页 = 帖子.length
      ? `<div class="pagination"><button data-action="review-prev" ${审核页码 <= 1 ? "disabled" : ""}>上一页</button><span>第 ${审核页码} / ${总页数} 页 · 共 ${帖子.length} 条</span><button data-action="review-next" ${审核页码 >= 总页数 ? "disabled" : ""}>下一页</button></div>`
      : "";
    const 待定内容 = 帖子.length
      ? `${分页}<div class="post-list">${本页帖子.map((项) => 帖子卡片(项)).join("")}</div>${分页}`
      : 空状态("没有待定帖子", "可以去“获取帖子”同步历史帖。之后的新发帖也会自动进入这里。");
    return `<div class="section-head"><div><h2>待定审核</h2><p>当前${顺序}；没有发布时间时使用 post_id 排序。</p></div>${渲染审核顺序选择(顺序)}</div>${待定内容}`;
  }

  function 渲染已处理(帖子: 帖子记录[]): string {
    const 总页数 = Math.max(1, Math.ceil(帖子.length / 每页审核数));
    已处理页码 = Math.min(已处理页码, 总页数);
    const 起始 = (已处理页码 - 1) * 每页审核数;
    const 本页帖子 = 帖子.slice(起始, 起始 + 每页审核数);
    const 分页 = 帖子.length
      ? `<div class="pagination"><button data-action="decided-prev" ${已处理页码 <= 1 ? "disabled" : ""}>上一页</button><span>第 ${已处理页码} / ${总页数} 页 · 共 ${帖子.length} 条</span><button data-action="decided-next" ${已处理页码 >= 总页数 ? "disabled" : ""}>下一页</button></div>`
      : "";
    const 内容 = 帖子.length
      ? `${分页}<div class="post-list">${本页帖子.map((项) => 帖子卡片(项)).join("")}</div>${分页}`
      : 空状态("还没有已处理帖子", "审核时选择保留，或成功编辑后，帖子会出现在这里。");
    return `<div class="section-head"><div><h2>已处理帖子</h2><p>保留和已编辑的帖子都可重新选择编辑、删除或保留。</p></div></div>${内容}`;
  }

  function 渲染沉浸审核(帖子: 帖子记录[], 顺序: 审核顺序): string {
    const 当前帖子 = 帖子[0];
    if (!当前帖子)
      return `<div class="focus-shell">${空状态("待定队列已经审核完", "可以去“获取帖子”同步历史帖，或返回普通审核页查看保留项目。")}</div>`;
    return `<div class="focus-shell">
      <div class="section-head"><div><h2>沉浸审核</h2><p>一次只处理一条；作出决定后按${顺序}显示下一条。还剩 ${帖子.length} 条。</p></div>${渲染审核顺序选择(顺序)}</div>
      <article class="post-card focus-card">
        <div class="post-meta"><a href="${转义HTML(当前帖子.postUrl || `/posts/${当前帖子.id}`)}" target="_blank" rel="noopener">#${当前帖子.id}</a><span>${转义HTML(当前帖子.topicTitle)}</span><time>${当前帖子.createdAt ? new Date(当前帖子.createdAt).toLocaleString() : ""}</time></div>
        ${渲染帖子正文(当前帖子)}
        <div class="focus-actions">
          <button class="edit" data-decision="待编辑" data-id="${当前帖子.id}">编辑</button>
          <button class="danger" data-decision="待删除" data-id="${当前帖子.id}">删除</button>
          <button class="keep" data-decision="保留" data-id="${当前帖子.id}">保留</button>
        </div>
      </article>
    </div>`;
  }

  function 渲染编辑(
    队列: 帖子记录[],
    失败: 帖子记录[],
    日志: Awaited<ReturnType<typeof 读取日志>>,
    设置: 设置,
  ): string {
    const 预览 = 编辑预览内容
      ? `<div class="preview-grid"><div><h3>正文原文 · #${编辑预览内容.id}</h3><pre>${转义HTML(编辑预览内容.原文)}</pre></div><div><h3>正文脚本结果</h3><pre>${转义HTML(编辑预览内容.新文)}</pre></div>${编辑预览内容.原标题 !== undefined ? `<div><h3>原标题</h3><pre>${转义HTML(编辑预览内容.原标题)}</pre></div><div><h3>标题脚本结果</h3><pre>${转义HTML(编辑预览内容.新标题 ?? "")}</pre></div>` : ""}</div>`
      : `<p class="muted">点击“预览第一条”后，这里会并排显示完整原文和脚本结果，不会修改论坛内容。</p>`;
    return `<article class="card editor-card">
      <h2>批量编辑脚本</h2>
      <p class="warning">高级功能：这里的 JavaScript 会在已登录论坛页面的权限下运行。不要粘贴来源不可信的脚本。两个函数都必须返回字符串。</p>
      <label class="script-label">正文脚本：参数是 GET /posts/:id 返回的完整帖子 JSON；回帖和话题首帖都会执行。</label>
      <textarea id="edit-script" class="code-editor" spellcheck="false">${转义HTML(设置.editScript)}</textarea>
      <label class="script-label">话题标题脚本：参数是 GET /t/:topic_id.json 返回的完整话题 JSON；仅话题首帖执行。</label>
      <textarea id="topic-title-script" class="code-editor title-editor" spellcheck="false">${转义HTML(设置.topicTitleScript)}</textarea>
      <div class="form-row edit-form"><label>每帖间隔（ms）<input id="edit-delay" type="number" min="500" value="${设置.editDelayMs}"></label></div>
      <label class="danger-confirm"><input id="edit-confirm" type="checkbox"> 我确认已经阅读脚本，并允许它在论坛页面环境中执行</label>
      <div class="actions"><button data-action="save-edit-script">保存脚本</button><button class="primary" data-action="preview-edit" ${队列.length ? "" : "disabled"}>预览第一条</button><button class="edit" data-action="start-edit" ${编辑器实例.运行中 ? "disabled" : ""}>开始批量编辑</button><button data-action="stop-edit" ${编辑器实例.运行中 ? "" : "disabled"}>停止</button></div>
      ${预览}
    </article>
    <div class="section-head secondary"><div><h2>待编辑 ${队列.length} 条</h2><p>失败 ${失败.length} 条。正文请求使用 HAR 中的表单字段，post[original_text] 固定为空；话题标题使用独立 JSON 请求。</p></div></div>
    <div class="compact-list">${
      [...失败, ...队列]
        .slice(0, 100)
        .map((项) => 帖子卡片(项))
        .join("") || 空状态("编辑队列为空", "在普通审核或沉浸审核中选择“编辑”。")
    }</div>
    <div class="section-head secondary"><div><h2>编辑日志</h2><p>最近 50 条。</p></div></div><div class="logs">${
      日志
        .slice(0, 50)
        .map(
          (项) =>
            `<div class="log ${项.level}"><time>${new Date(项.time).toLocaleString()}</time><span>${转义HTML(项.message)}</span></div>`,
        )
        .join("") || 空状态("暂无日志", "")
    }</div>`;
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
          .map((项) => 帖子卡片(项))
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
    const 有范围 = Boolean(设置.fetchMinId || 设置.fetchMaxId);
    const 范围说明 = 有范围
      ? `<p class="warning">当前启用了 post_id 范围：${转义HTML(设置.fetchMinId || "不限")} ～ ${转义HTML(设置.fetchMaxId || "不限")}。范围外的帖子不会进入队列。</p>`
      : "";
    return `<article class="card narrow"><h2>批量获取历史回帖和话题</h2><p>分别通过用户动态的 reply(5) 和 new_topic(4) 分页获取。话题以首帖进入统一队列；“新记录进入待定”不会覆盖已有的删除、编辑或保留决定。</p>
      ${范围说明}
      <div class="form-row sync-form"><label>获取类型<select id="fetch-type"><option value="全部" ${设置.fetchType === "全部" ? "selected" : ""}>回帖和话题</option><option value="回帖" ${设置.fetchType === "回帖" ? "selected" : ""}>仅回帖</option><option value="话题" ${设置.fetchType === "话题" ? "selected" : ""}>仅话题</option></select></label><label>获取后操作<select id="fetch-target"><option value="待定" ${设置.fetchTarget === "待定" ? "selected" : ""}>仅新记录进入待定（保留旧决定）</option><option value="重新待定" ${设置.fetchTarget === "重新待定" ? "selected" : ""}>命中记录全部重新进入待定</option><option value="待编辑" ${设置.fetchTarget === "待编辑" ? "selected" : ""}>命中记录全部加入编辑队列</option></select></label><label>最小 post_id（可空）<input id="fetch-min" type="number" value="${转义HTML(设置.fetchMinId)}"></label><label>最大 post_id（可空）<input id="fetch-max" type="number" value="${转义HTML(设置.fetchMaxId)}"></label><label>请求间隔<input id="fetch-delay" type="number" min="0" value="${设置.fetchDelayMs}"></label></div>
      <div class="actions"><button class="primary" data-action="start-sync" ${同步控制器 ? "disabled" : ""}>开始获取</button><button data-action="stop-sync" ${同步控制器 ? "" : "disabled"}>停止</button><button data-action="clear-fetch-range" ${同步控制器 ? "disabled" : ""}>清空 ID 范围</button></div></article>`;
  }

  function 渲染日志(日志: Awaited<ReturnType<typeof 读取日志>>): string {
    return `<div class="section-head"><div><h2>最近日志</h2><p>最新的 200 条。</p></div></div><div class="logs">${日志.map((项) => `<div class="log ${项.level}"><time>${new Date(项.time).toLocaleString()}</time><span>${转义HTML(项.message)}</span></div>`).join("") || 空状态("暂无日志", "")}</div>`;
  }

  function 渲染设置(设置: 设置, 待定数量: number): string {
    return `<div class="settings-stack">
      <article class="card narrow"><h2>发帖保护</h2><label class="switch"><input id="block-posting" type="checkbox" ${设置.blockPosting ? "checked" : ""}><span></span><b>阻止当前浏览器发帖</b></label><p>开启后会在页面环境拦截 Fetch 和 XMLHttpRequest 的 POST /posts。关闭时，成功发帖的响应会自动写入待定队列。</p></article>
      <article class="card narrow"><h2>远程自动审核</h2>
        <p class="warning">启动后会把帖子和话题的完整 JSON 发送到你指定的 endpoint。请只使用你信任的服务；返回结果只负责移动队列，不会立即执行编辑或删除。</p>
        <label class="script-label">HTTP(S) endpoint</label><input id="remote-endpoint" type="url" autocomplete="off" placeholder="https://example.com/review" value="${转义HTML(设置.remoteEndpoint)}">
        <div class="form-row remote-form">
          <label>请求顺序<select id="remote-order"><option value="从新到旧" ${设置.remoteOrder === "从新到旧" ? "selected" : ""}>从新到旧</option><option value="从旧到新" ${设置.remoteOrder === "从旧到新" ? "selected" : ""}>从旧到新</option></select></label>
          <label>失败策略<select id="remote-failure-policy"><option value="停止" ${设置.remoteFailurePolicy === "停止" ? "selected" : ""}>立即停止</option><option value="跳过" ${设置.remoteFailurePolicy === "跳过" ? "selected" : ""}>跳过并继续</option><option value="重试后停止" ${设置.remoteFailurePolicy === "重试后停止" ? "selected" : ""}>重试耗尽后停止</option><option value="重试后跳过" ${设置.remoteFailurePolicy === "重试后跳过" ? "selected" : ""}>重试耗尽后跳过</option></select></label>
          <label>重试次数<input id="remote-retry-count" type="number" min="0" max="10" value="${设置.remoteRetryCount}"></label>
          <label>请求间隔（ms）<input id="remote-delay" type="number" min="0" value="${设置.remoteDelayMs}"></label>
          <label>endpoint 超时（ms）<input id="remote-timeout" type="number" min="1000" max="300000" value="${设置.remoteTimeoutMs}"></label>
        </div>
        <p>待定队列当前有 ${待定数量} 条。endpoint 的响应 ID 必须与请求 ID 完全一致；否则按请求失败处理。<code>ignore</code> 会让帖子留在待定队列，但本轮不再重复请求。</p>
        <div class="actions"><button data-action="save-remote-settings">保存配置</button><button class="primary" data-action="start-remote-review" ${远程审核器实例.运行中 || !待定数量 ? "disabled" : ""}>开始远程审核</button><button data-action="stop-remote-review" ${远程审核器实例.运行中 ? "" : "disabled"}>停止</button></div>
        <label class="script-label">提供给 endpoint 后方 LLM 的协议提示词</label>
        <textarea id="remote-prompt" class="code-editor remote-prompt" readonly>${转义HTML(远程审核提示词)}</textarea>
        <div class="actions"><button data-action="copy-remote-prompt">复制提示词</button></div>
      </article>
    </div>`;
  }

  function 帖子卡片(帖子: 帖子记录): string {
    return `<article class="post-card"><div class="post-meta"><a href="${转义HTML(帖子.postUrl || `/posts/${帖子.id}`)}" target="_blank" rel="noopener">#${帖子.id}</a><span>${转义HTML(帖子.topicTitle)}</span><time>${帖子.createdAt ? new Date(帖子.createdAt).toLocaleString() : ""}</time><em>${转义HTML(帖子.recordType ?? (帖子.postNumber === 1 ? "话题" : "回帖"))} · ${转义HTML(帖子.source)} · ${转义HTML(帖子.status)}</em></div>${渲染帖子正文(帖子)}${帖子.lastError ? `<p class="error-text">${转义HTML(帖子.lastError)}</p>` : ""}<div class="post-actions"><button class="edit" data-decision="待编辑" data-id="${帖子.id}">编辑</button><button class="danger" data-decision="待删除" data-id="${帖子.id}">删除</button><button class="keep" data-decision="保留" data-id="${帖子.id}">保留</button>${帖子.status !== "待定" ? `<button data-decision="待定" data-id="${帖子.id}">移回待定</button>` : ""}</div></article>`;
  }

  function 渲染帖子正文(帖子: 帖子记录): string {
    // cooked 来自已登录的论坛接口；按用户要求视为可信 HTML，并保留图片、链接和论坛排版。
    if (帖子.cooked.trim()) return `<div class="post-content">${帖子.cooked}</div>`;
    const 原文 = 帖子.raw || "（未获取到内容）";
    return `<pre class="post-content-raw">${转义HTML(原文)}</pre>`;
  }

  function 准备帖子HTML(): void {
    for (const 链接 of 根.querySelectorAll<HTMLAnchorElement>(".post-content a")) {
      链接.target = "_blank";
      链接.rel = "noopener noreferrer";
      if (是缺少预览的图片链接(链接)) {
        const 图片 = document.createElement("img");
        图片.src = 链接.href;
        图片.alt = 链接.title || 链接.textContent?.trim() || "帖子图片";
        图片.loading = "lazy";
        图片.decoding = "async";
        链接.replaceChildren(图片);
      }
    }
    for (const 图片 of 根.querySelectorAll<HTMLImageElement>(".post-content img")) {
      图片.loading = "lazy";
      图片.decoding = "async";
    }
  }

  function 是缺少预览的图片链接(链接: HTMLAnchorElement): boolean {
    if (链接.querySelector("img")) return false;
    if (链接.classList.contains("lightbox")) return true;
    try {
      return /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(new URL(链接.href, location.href).pathname);
    } catch {
      return false;
    }
  }

  function 空状态(标题: string, 说明: string): string {
    return `<div class="empty"><h3>${转义HTML(标题)}</h3><p>${转义HTML(说明)}</p></div>`;
  }

  function 渲染审核顺序选择(顺序: 审核顺序): string {
    return `<label class="order-control">审核顺序<select id="review-order"><option value="从新到旧" ${顺序 === "从新到旧" ? "selected" : ""}>从新到旧</option><option value="从旧到新" ${顺序 === "从旧到新" ? "selected" : ""}>从旧到新</option></select></label>`;
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
    if (action === "decided-prev") {
      已处理页码 = Math.max(1, 已处理页码 - 1);
      return void 渲染();
    }
    if (action === "decided-next") {
      已处理页码 += 1;
      return void 渲染();
    }
    if (action === "save-edit-script") {
      try {
        保存编辑表单();
        运行状态 = "编辑脚本已保存并通过语法检查，尚未执行。";
      } catch (错误) {
        运行状态 = `保存失败：${提取错误(错误)}`;
      }
      return void 渲染();
    }
    if (action === "preview-edit") return void 运行编辑预览();
    if (action === "start-edit") {
      if (!确认执行编辑脚本()) return;
      if (删帖器实例.运行中 || 远程审核器实例.运行中) {
        运行状态 = "删帖或远程审核正在运行，请先停止对应任务。";
        return void 渲染();
      }
      try {
        const 脚本组 = 保存编辑表单();
        void 编辑器实例.开始(脚本组);
      } catch (错误) {
        运行状态 = 提取错误(错误);
        void 渲染();
      }
      return;
    }
    if (action === "stop-edit") return 编辑器实例.停止();
    if (action === "start-delete") {
      if (编辑器实例.运行中 || 远程审核器实例.运行中) {
        运行状态 = "批量编辑或远程审核正在运行，请先停止对应任务。";
        return void 渲染();
      }
      保存删帖表单();
      void 删帖器实例.开始();
      return;
    }
    if (action === "stop-delete") return 删帖器实例.停止();
    if (action === "start-sync") {
      if (远程审核器实例.运行中) {
        运行状态 = "远程审核正在运行，请先停止远程审核。";
        return void 渲染();
      }
      return void 开始同步();
    }
    if (action === "stop-sync") return 同步控制器?.abort();
    if (action === "clear-fetch-range") {
      保存设置({ ...读取设置(), fetchMinId: "", fetchMaxId: "" });
      运行状态 = "已清空帖子 ID 范围；下次同步不会按 ID 过滤。";
      return void 渲染();
    }
    if (action === "save-remote-settings") {
      try {
        保存远程审核表单(false);
        运行状态 = "远程审核配置已保存。";
      } catch (错误) {
        运行状态 = `保存远程审核配置失败：${提取错误(错误)}`;
      }
      return void 渲染();
    }
    if (action === "start-remote-review") {
      if (删帖器实例.运行中 || 编辑器实例.运行中 || 同步控制器) {
        运行状态 = "当前有删帖、编辑或同步任务正在运行，请先停止。";
        return void 渲染();
      }
      try {
        const 新设置 = 保存远程审核表单(true);
        void 远程审核器实例.开始(新设置);
      } catch (错误) {
        运行状态 = `无法启动远程审核：${提取错误(错误)}`;
        void 渲染();
      }
      return;
    }
    if (action === "stop-remote-review") return 远程审核器实例.停止();
    if (action === "copy-remote-prompt") {
      try {
        await navigator.clipboard.writeText(远程审核提示词);
        运行状态 = "远程审核协议提示词已复制。";
      } catch (错误) {
        运行状态 = `复制失败：${提取错误(错误)}`;
      }
      return void 渲染();
    }
  }

  async function 处理设置变更(event: Event): Promise<void> {
    const 输入 = event.target;
    if (!(输入 instanceof HTMLInputElement || 输入 instanceof HTMLSelectElement)) return;
    if (输入.id === "review-order") {
      const reviewOrder: 审核顺序 = 输入.value === "从旧到新" ? "从旧到新" : "从新到旧";
      审核页码 = 1;
      保存设置({ ...读取设置(), reviewOrder });
      运行状态 = `审核顺序已切换为${reviewOrder}。`;
      return void 渲染();
    }
    if (输入.id === "block-posting" && 输入 instanceof HTMLInputElement) {
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

  function 保存编辑表单(): 编辑脚本组 {
    const 旧设置 = 读取设置();
    const 正文脚本 = 输入值("edit-script").trim();
    const 标题脚本 = 输入值("topic-title-script").trim();
    if (!正文脚本 || !标题脚本) throw new Error("正文脚本和标题脚本都不能为空。");
    编译编辑脚本(正文脚本, "正文");
    编译编辑脚本(标题脚本, "标题");
    保存设置({
      ...旧设置,
      editScript: 正文脚本,
      topicTitleScript: 标题脚本,
      editDelayMs: 数值限制(输入值("edit-delay"), 旧设置.editDelayMs, 500, 86_400_000),
    });
    return { 正文脚本, 标题脚本 };
  }

  function 保存远程审核表单(必须填写Endpoint: boolean): 设置 {
    const 旧设置 = 读取设置();
    const endpoint输入 = 输入值("remote-endpoint").trim();
    if (必须填写Endpoint && !endpoint输入) throw new Error("请填写 endpoint。");
    let endpoint = endpoint输入;
    if (endpoint输入) {
      const 地址 = new URL(endpoint输入, location.href);
      if (地址.protocol !== "http:" && 地址.protocol !== "https:") throw new Error("endpoint 只支持 HTTP 或 HTTPS。");
      endpoint = 地址.href;
    }
    const 顺序输入 = 输入值("remote-order");
    const remoteOrder: 审核顺序 = 顺序输入 === "从旧到新" ? "从旧到新" : "从新到旧";
    const 策略输入 = 输入值("remote-failure-policy");
    const remoteFailurePolicy: 远程审核失败策略 =
      策略输入 === "跳过" || 策略输入 === "重试后停止" || 策略输入 === "重试后跳过" ? 策略输入 : "停止";
    const 新设置: 设置 = {
      ...旧设置,
      remoteEndpoint: endpoint,
      remoteOrder,
      remoteFailurePolicy,
      remoteRetryCount: 数值限制(输入值("remote-retry-count"), 旧设置.remoteRetryCount, 0, 10),
      remoteDelayMs: 数值限制(输入值("remote-delay"), 旧设置.remoteDelayMs, 0, 86_400_000),
      remoteTimeoutMs: 数值限制(输入值("remote-timeout"), 旧设置.remoteTimeoutMs, 1_000, 300_000),
    };
    保存设置(新设置);
    return 新设置;
  }

  function 确认执行编辑脚本(): boolean {
    const 勾选框 = document.getElementById("edit-confirm") as HTMLInputElement | null;
    if (勾选框?.checked) return true;
    运行状态 = "请先勾选脚本执行确认。";
    void 渲染();
    return false;
  }

  async function 运行编辑预览(): Promise<void> {
    if (!确认执行编辑脚本()) return;
    try {
      const 脚本组 = 保存编辑表单();
      const 帖子 = (await 读取帖子(用户名, "待编辑"))[0];
      if (!帖子) throw new Error("编辑队列为空。");
      运行状态 = `正在获取帖子 ${帖子.id} 的完整内容并运行预览……`;
      const 结果 = await 预览编辑(帖子, 脚本组);
      编辑预览内容 = {
        id: 帖子.id,
        原文: 结果.原文,
        新文: 结果.新文,
        原标题: 结果.原标题,
        新标题: 结果.新标题,
      };
      const 没有变化 = 结果.原文 === 结果.新文 && 结果.原标题 === 结果.新标题;
      运行状态 = 没有变化 ? "预览完成：结果与原内容相同。" : "预览完成，尚未修改论坛帖子。";
    } catch (错误) {
      编辑预览内容 = null;
      运行状态 = `预览失败：${提取错误(错误)}`;
    }
    void 渲染();
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
    const 类型输入 = 输入值("fetch-type");
    const type: 同步类型 = 类型输入 === "回帖" || 类型输入 === "话题" ? 类型输入 : "全部";
    const 目标输入 = 输入值("fetch-target");
    const target: 同步目标 = 目标输入 === "待编辑" || 目标输入 === "重新待定" ? 目标输入 : "待定";
    保存设置({
      ...旧设置,
      fetchMinId: min,
      fetchMaxId: max,
      fetchDelayMs: delay,
      fetchType: type,
      fetchTarget: target,
    });
    同步控制器 = new AbortController();
    void 渲染();
    try {
      const 结果 = await 同步所有帖子({
        username: 用户名,
        minId,
        maxId,
        delayMs: delay,
        type,
        target,
        signal: 同步控制器.signal,
        onProgress: (消息) => {
          运行状态 = 消息;
          void 渲染();
        },
      });
      const 全部帖子 = await 读取帖子(用户名);
      const 命中编号 = new Set(结果.命中编号);
      const 目标状态 = target === "重新待定" ? "待定" : target;
      const 位于目标队列 = 全部帖子.filter((帖子) => 命中编号.has(帖子.id) && 帖子.status === 目标状态).length;
      const 保留旧状态 = Math.max(0, 结果.命中条数 - 位于目标队列);
      const 分类文案 = 结果.分类.map((统计) => `${统计.类型} ${统计.接口条数}/${统计.命中条数}`).join("，");
      运行状态 = `同步完成：接口读取 ${结果.接口条数} 条（${分类文案}），ID 范围及去重后命中 ${结果.命中条数} 条；当前位于${目标状态}队列 ${位于目标队列} 条${保留旧状态 ? `，另有 ${保留旧状态} 条保留原决定` : ""}。数据库共 ${全部帖子.length} 条。`;
    } catch (错误) {
      运行状态 =
        错误 instanceof DOMException && 错误.name === "AbortError" ? "同步已停止。" : `同步失败：${提取错误(错误)}`;
    } finally {
      同步控制器 = null;
      void 渲染();
    }
  }

  function 输入值(id: string): string {
    return (
      (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.value ?? ""
    );
  }

  function 排序审核帖子(帖子: 帖子记录[], 顺序: 审核顺序): 帖子记录[] {
    const 方向 = 顺序 === "从旧到新" ? 1 : -1;
    return [...帖子].sort((左, 右) => {
      const 左时间 = Date.parse(左.createdAt) || 0;
      const 右时间 = Date.parse(右.createdAt) || 0;
      return 方向 * (左时间 - 右时间 || 左.id - 右.id);
    });
  }
}

const 管理页样式 = `
  #shantie-manager, #shantie-manager *{box-sizing:border-box}body{margin:0!important;background:#f5f7fb!important;color:#172033!important;font:14px/1.55 system-ui,-apple-system,sans-serif!important}
  #shantie-manager{position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#f5f7fb}.topbar{display:flex;align-items:center;justify-content:space-between;padding:24px max(24px,calc((100vw - 1180px)/2));background:#10233f;color:white}.topbar h1{margin:0;font-size:24px}.topbar p{margin:4px 0 0;color:#aec3dd}.forum-link{color:white;text-decoration:none;border:1px solid #57708e;border-radius:9px;padding:8px 12px}
  .tabs{position:sticky;top:0;z-index:2;display:flex;gap:4px;padding:10px max(24px,calc((100vw - 1180px)/2));overflow:auto;background:white;border-bottom:1px solid #dce3ed}.tab{white-space:nowrap;border:0;border-radius:8px;padding:10px 14px;background:transparent;color:#52647a;cursor:pointer}.tab.active{background:#e8f0ff;color:#1754b5}.tab b{display:inline-block;margin-left:5px;padding:1px 7px;border-radius:999px;background:#dce9ff}
  .content{max-width:1180px;margin:0 auto;padding:24px}.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}.section-head.secondary{margin-top:30px}.section-head h2,.card h2{margin:0 0 5px;font-size:18px}.section-head p,.card p{margin:0;color:#66758a}.grid.two{display:grid;grid-template-columns:1fr 1.5fr;gap:16px;margin-bottom:24px}.card,.post-card,.empty{padding:18px;border:1px solid #dce3ed;border-radius:13px;background:white;box-shadow:0 3px 14px rgba(33,51,78,.04)}.card.narrow{max-width:800px;margin:auto}.order-control{flex:0 0 150px;color:#5d6d82;font-size:12px}.order-control select{margin-top:5px}
  textarea,input,select{width:100%;border:1px solid #c9d3e0;border-radius:8px;padding:9px 10px;background:white;color:#172033}textarea{height:90px;margin:10px 0}.form-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}.form-row label{color:#5d6d82;font-size:12px}.form-row input,.form-row select{margin-top:5px}.actions,.post-actions,.focus-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}button{border:1px solid #c9d3e0;border-radius:8px;padding:9px 13px;background:white;cursor:pointer}button.primary{border-color:#2563eb;background:#2563eb;color:white}button.danger{border-color:#dc2626;background:#dc2626;color:white}button.keep{border-color:#16845b;background:#16845b;color:white}button.edit{border-color:#7c3aed;background:#7c3aed;color:white}button:disabled{opacity:.45;cursor:not-allowed}
  .segmented{display:flex;gap:15px;margin:10px 0}.segmented label{display:flex;align-items:center;gap:5px}.segmented input,.switch input,.danger-confirm input{width:auto}.pagination{display:flex;align-items:center;justify-content:center;gap:14px;margin:0 0 14px}.pagination+.post-list{margin-bottom:14px}.post-list,.compact-list,.logs{display:grid;gap:12px}.post-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:#718096;font-size:12px}.post-meta a{font-weight:700;color:#1754b5}.post-meta span{font-weight:600;color:#34445a}.post-meta em{margin-left:auto}.post-content,.post-content-raw{margin:12px 0 0;color:#26364b;font:14px/1.6 system-ui;overflow-wrap:anywhere}.post-content-raw{white-space:pre-wrap}.post-content img{max-width:100%;height:auto;border-radius:8px}.post-content pre{max-width:100%;overflow:auto;padding:10px;border-radius:8px;background:#f3f5f8;white-space:pre-wrap}.post-content blockquote{margin:12px 0;padding:4px 14px;border-left:4px solid #c9d3e0;color:#52647a}.post-content a{color:#1754b5}.error-text{color:#b42318}.compact-list .post-content,.compact-list .post-content-raw{max-height:160px;overflow:auto}.empty{text-align:center;color:#718096}.empty h3{margin:0;color:#34445a}.empty p{margin:5px 0 0}.log{display:flex;gap:16px;padding:11px 14px;border-radius:8px;background:white;border:1px solid #e0e6ee}.log time{flex:0 0 180px;color:#718096}.log.error span{color:#b42318}.switch{display:flex;gap:10px;align-items:center;margin:18px 0}.switch b{font-size:16px}.loading{padding:60px;text-align:center}
  .focus-shell{max-width:900px;margin:auto}.focus-card{padding:28px}.focus-card .post-content,.focus-card .post-content-raw{min-height:240px;font-size:17px;line-height:1.8}.focus-actions{justify-content:center;margin-top:24px}.focus-actions button{min-width:130px;padding:13px 20px;font-size:15px}.editor-card{max-width:1040px;margin:auto}.editor-card .code-editor{height:280px;background:#111827;color:#e5e7eb;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}.editor-card .title-editor{height:190px}.script-label{display:block;margin-top:16px;font-weight:700}.warning{margin:10px 0!important;padding:12px;border-left:4px solid #dc2626;background:#fff1f2;color:#9f1239!important}.danger-confirm{display:flex;align-items:center;gap:8px;color:#9f1239}.edit-form{grid-template-columns:minmax(180px,260px)}.sync-form,.remote-form{grid-template-columns:repeat(5,1fr)}.settings-stack{display:grid;gap:18px}.settings-stack .card.narrow{width:100%}.remote-prompt{height:360px;background:#111827;color:#e5e7eb;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}.preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.preview-grid>div{min-width:0;padding:14px;border:1px solid #dce3ed;border-radius:10px}.preview-grid h3{margin:0}.preview-grid pre{max-height:360px;overflow:auto;white-space:pre-wrap;word-break:break-word}.muted{margin-top:15px!important;color:#718096!important}
  @media(max-width:760px){.grid.two,.form-row,.preview-grid{grid-template-columns:1fr}.topbar{padding:18px}.content{padding:14px}.tabs{padding:8px 14px}.post-meta em{margin-left:0}.log{display:block}.log time{display:block;margin-bottom:4px}.focus-card{padding:18px}.focus-card .post-content,.focus-card .post-content-raw{min-height:160px}.focus-actions button{flex:1;min-width:90px}}
`;
