import type { 设置 } from "./类型";
import { 默认标题编辑脚本文本, 默认编辑脚本文本 } from "./默认编辑脚本.js";

export const 脚本名称 = "USCardForum 帖子管理器";
export const 设置存储键 = "shantie-v3-settings";
export const 数据库名称 = "shantie-v3";
export const 数据库版本 = 1;
export const 管理页参数 = "shantie-manager";
export const 通信频道名 = "shantie-v3-events";

export const 默认设置: 设置 = {
  blockPosting: false,
  reviewOrder: "从新到旧",
  deleteMode: "批量",
  singleDelayMs: 60_000,
  batchDelayMs: 5_000,
  batchSize: 50,
  editDelayMs: 1_000,
  editScript: 默认编辑脚本文本,
  topicTitleScript: 默认标题编辑脚本文本,
  fetchDelayMs: 500,
  fetchType: "全部",
  fetchTarget: "待定",
  fetchMinId: "",
  fetchMaxId: "",
  remoteEndpoint: "",
  remoteOrder: "从新到旧",
  remoteFailurePolicy: "停止",
  remoteRetryCount: 2,
  remoteDelayMs: 1_000,
  remoteTimeoutMs: 30_000,
};
