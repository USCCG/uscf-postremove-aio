export type 页面窗口 = Window & typeof globalThis;

export function 从页面读取用户名(页面窗口: 页面窗口 = window): string {
  const 全局 = 页面窗口 as 页面窗口 & {
    currentUser?: { username?: string | null };
    Discourse?: { User?: { current?: () => { username?: string | null } | null } };
  };
  const 候选 = [
    全局.currentUser?.username,
    全局.Discourse?.User?.current?.()?.username,
    document.querySelector<HTMLMetaElement>('meta[name="discourse-current-username"]')?.content,
    document.querySelector<HTMLMetaElement>('meta[name="current-user"]')?.content,
    document.querySelector<HTMLMetaElement>('meta[name="discourse-username"]')?.content,
    document.documentElement?.getAttribute("data-current-username"),
    document.body?.getAttribute("data-current-username"),
  ];
  const 直接值 = String(候选.find((值) => String(值 ?? "").trim()) ?? "").trim();
  if (直接值) return 直接值;
  try {
    const 预载 = document.querySelector<HTMLElement>("#data-preloaded")?.dataset.preloaded;
    if (!预载) return "";
    const 外层 = JSON.parse(预载) as { currentUser?: string | { username?: string } };
    const 当前用户 =
      typeof 外层.currentUser === "string" ? (JSON.parse(外层.currentUser) as { username?: string }) : 外层.currentUser;
    return String(当前用户?.username ?? "").trim();
  } catch {
    return "";
  }
}

export async function 获取当前用户名(原始Fetch: typeof fetch = fetch, 页面窗口: 页面窗口 = window): Promise<string> {
  const 页面值 = 从页面读取用户名(页面窗口);
  if (页面值) return 页面值;
  try {
    const 响应 = await 原始Fetch("/session/current.json", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!响应.ok) return "";
    const 数据 = (await 响应.json()) as { current_user?: { username?: string } };
    const 用户名 = String(数据.current_user?.username ?? "").trim();
    if (用户名) return 用户名;
  } catch {
    // 下面仍会重试页面状态。
  }
  for (let 次数 = 0; 次数 < 3; 次数 += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    const 重试值 = 从页面读取用户名(页面窗口);
    if (重试值) return 重试值;
  }
  return "";
}
