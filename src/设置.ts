import { 默认设置, 设置存储键 } from "./常量";
import type { 设置 } from "./类型";
import { 数值限制 } from "./工具";

export function 读取设置(): 设置 {
  try {
    const 原始值 = localStorage.getItem(设置存储键);
    const 数据 = 原始值 ? (JSON.parse(原始值) as Partial<设置>) : {};
    return {
      blockPosting: 数据.blockPosting === true,
      deleteMode: 数据.deleteMode === "逐帖" ? "逐帖" : "批量",
      singleDelayMs: 数值限制(数据.singleDelayMs, 默认设置.singleDelayMs, 5_000, 86_400_000),
      batchDelayMs: 数值限制(数据.batchDelayMs, 默认设置.batchDelayMs, 1_000, 86_400_000),
      batchSize: 数值限制(数据.batchSize, 默认设置.batchSize, 2, 100),
      fetchDelayMs: 数值限制(数据.fetchDelayMs, 默认设置.fetchDelayMs, 0, 60_000),
      fetchMinId: typeof 数据.fetchMinId === "string" ? 数据.fetchMinId : "",
      fetchMaxId: typeof 数据.fetchMaxId === "string" ? 数据.fetchMaxId : "",
    };
  } catch {
    return { ...默认设置 };
  }
}

export function 保存设置(设置值: 设置): void {
  localStorage.setItem(设置存储键, JSON.stringify(设置值));
  window.dispatchEvent(new CustomEvent("shantie-settings-changed"));
}
