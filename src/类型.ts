export type 帖子状态 = "待定" | "待删除" | "保留" | "已删除" | "失败";
export type 帖子来源 = "同步" | "发帖监听" | "手动" | "旧队列";
export type 删帖方式 = "逐帖" | "批量";

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
  deleteMode: 删帖方式;
  singleDelayMs: number;
  batchDelayMs: number;
  batchSize: number;
  fetchDelayMs: number;
  fetchMinId: string;
  fetchMaxId: string;
}

export interface 用户动态 {
  post_id?: number;
  username?: string;
  excerpt?: string;
  created_at?: string;
  topic_id?: number;
  title?: string;
  slug?: string;
  post_number?: number;
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
