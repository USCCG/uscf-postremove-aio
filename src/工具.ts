export function 等待(毫秒: number, 信号?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const 定时器 = window.setTimeout(完成, 毫秒);
    信号?.addEventListener("abort", 取消, { once: true });

    function 完成(): void {
      信号?.removeEventListener("abort", 取消);
      resolve();
    }
    function 取消(): void {
      window.clearTimeout(定时器);
      reject(new DOMException("已停止", "AbortError"));
    }
  });
}

export function 数值限制(值: unknown, 默认值: number, 最小值: number, 最大值: number): number {
  const 数值 = Number(值);
  return Number.isFinite(数值) ? Math.min(最大值, Math.max(最小值, Math.floor(数值))) : 默认值;
}

export function 解析帖子编号(文本: string): number[] {
  return [
    ...new Set(
      文本
        .split(/[,\s，；;]+/)
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ];
}

export function 转义HTML(值: unknown): string {
  return String(值 ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function 去除HTML(值: string): string {
  const 容器 = document.createElement("div");
  容器.innerHTML = 值;
  return (容器.textContent ?? "").trim();
}

export function 提取错误(错误: unknown): string {
  return 错误 instanceof Error ? 错误.message : String(错误);
}

export function 帖子键(用户名: string, id: number): string {
  return `${用户名}:${id}`;
}
