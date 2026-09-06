/**
 * 管理页首次打开时展示的默认脚本。
 *
 * 参数是 GET /posts/:id.json 返回的完整帖子对象；返回值必须是编辑后的 Markdown 字符串。
 * 默认保持原文不变，避免用户在没有修改脚本时误编辑整个队列。
 */
export const 默认编辑脚本文本 = `(orig_post_full_json) => {
  const 原文 = String(orig_post_full_json.raw ?? "");

  // 在这里编写替换规则，例如：
  // return 原文.replaceAll("旧内容", "新内容");
  return 原文;
}`;

/** 仅在编辑话题首帖时运行；普通回帖不会执行这个函数。 */
export const 默认标题编辑脚本文本 = `(orig_topic_full_json) => {
  const 原标题 = String(orig_topic_full_json.title ?? "");

  // 在这里编写标题替换规则，例如：
  // return 原标题.replaceAll("旧标题", "新标题");
  return 原标题;
}`;
