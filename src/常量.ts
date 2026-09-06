import type { 设置 } from "./类型";

export const 脚本名称 = "USCardForum 帖子管理器";
export const 设置存储键 = "shantie-v3-settings";
export const 数据库名称 = "shantie-v3";
export const 数据库版本 = 1;
export const 管理页参数 = "shantie-manager";
export const 通信频道名 = "shantie-v3-events";

export const 默认设置: 设置 = {
  blockPosting: false,
  deleteMode: "批量",
  singleDelayMs: 60_000,
  batchDelayMs: 5_000,
  batchSize: 50,
  fetchDelayMs: 500,
  fetchMinId: "",
  fetchMaxId: "",
};
