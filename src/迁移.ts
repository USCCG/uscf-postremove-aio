import { 保存帖子, 写日志 } from "./存储";

/** 只执行一次：把 0.3.x 删帖脚本的未处理 ID 带入新数据库。 */
export async function 迁移旧删帖队列(用户名: string): Promise<void> {
  const 迁移键 = `shantie-v3-migrated:${用户名}`;
  if (localStorage.getItem(迁移键)) return;
  try {
    const 原始值 = localStorage.getItem(`shantie-delete-state-v2:${用户名}`);
    const 数据 = 原始值 ? (JSON.parse(原始值) as { queue?: Array<{ id?: number }> }) : {};
    const ids = [
      ...new Set((数据.queue ?? []).map((项) => Number(项.id)).filter((id) => Number.isSafeInteger(id) && id > 0)),
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
          lastError: "",
        },
        false,
      );
    }
    if (ids.length) await 写日志(用户名, `已从旧脚本迁移 ${ids.length} 个待删帖子。`);
    localStorage.setItem(迁移键, "1");
  } catch (错误) {
    console.warn("[帖子管理器] 旧队列迁移失败，下次会重试。", 错误);
  }
}
