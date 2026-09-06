export type 帖子状态 = "待定" | "待编辑" | "待删除" | "保留" | "已编辑" | "已删除" | "编辑失败" | "失败";
export type 帖子来源 = "同步" | "发帖监听" | "手动" | "旧队列";
export type 删帖方式 = "逐帖" | "批量";
export type 帖子种类 = "回帖" | "话题";
export type 同步类型 = 帖子种类 | "全部";
export type 同步目标 = "待定" | "重新待定" | "待编辑";
export type 审核顺序 = "从新到旧" | "从旧到新";
export type 远程审核失败策略 = "停止" | "跳过" | "重试后停止" | "重试后跳过";

export interface 帖子记录 {
  key: string;
  id: number;
  ownerUsername: string;
  username: string;
  raw: string;
  cooked: string;
  topicId?: number;
  topicTitle: string;
  topicSlug: string;
  postNumber?: number;
  recordType?: 帖子种类;
  categoryId?: number;
  tags?: string[];
  createdAt: string;
  postUrl: string;
  status: 帖子状态;
  source: 帖子来源;
  lastError: string;
  updatedAt: number;
}

export type 新帖子记录 = Omit<帖子记录, "key" | "updatedAt">;

export interface 日志记录 {
  key: string;
  ownerUsername: string;
  time: number;
  level: "info" | "error";
  message: string;
  details?: unknown;
}

export interface 设置 {
  blockPosting: boolean;
  reviewOrder: 审核顺序;
  deleteMode: 删帖方式;
  singleDelayMs: number;
  batchDelayMs: number;
  batchSize: number;
  editDelayMs: number;
  editScript: string;
  topicTitleScript: string;
  fetchDelayMs: number;
  fetchType: 同步类型;
  fetchTarget: 同步目标;
  fetchMinId: string;
  fetchMaxId: string;
  remoteEndpoint: string;
  remoteOrder: 审核顺序;
  remoteFailurePolicy: 远程审核失败策略;
  remoteRetryCount: number;
  remoteDelayMs: number;
  remoteTimeoutMs: number;
}

export interface 用户动态 {
  post_id?: number | null;
  username?: string;
  excerpt?: string;
  created_at?: string;
  topic_id?: number;
  title?: string;
  slug?: string;
  post_number?: number;
  category_id?: number;
  tags?: string[];
  [key: string]: unknown;
}

export interface 用户动态响应 {
  user_actions?: 用户动态[];
  load_more_user_actions_url?: string;
}

export interface Discourse帖子 {
  id?: number;
  username?: string;
  raw?: string;
  cooked?: string;
  topic_id?: number;
  topic_slug?: string;
  post_number?: number;
  created_at?: string;
  post_url?: string;
}

export interface 发帖响应 {
  success?: boolean;
  post?: Discourse帖子;
}

export interface 删帖结果 {
  ok: boolean;
  status: number;
  message: string;
  waitMs?: number;
}

export type 完整帖子JSON = Record<string, unknown> & {
  id?: number;
  raw?: string;
  cooked?: string;
  topic_id?: number;
  topic_slug?: string;
  post_number?: number;
  reply_to_post_number?: number | null;
};

export type 完整话题JSON = Record<string, unknown> & {
  id?: number;
  title?: string;
  slug?: string;
  category_id?: number;
  tags?: unknown[];
};

export interface 编辑预览 {
  帖子: 帖子记录;
  完整数据: 完整帖子JSON;
  原文: string;
  新文: string;
  完整话题数据?: 完整话题JSON;
  原标题?: string;
  新标题?: string;
}
