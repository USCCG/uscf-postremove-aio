import { 数据库名称, 数据库版本, 通信频道名 } from "./常量";
import type { 新帖子记录, 日志记录, 帖子记录, 帖子状态 } from "./类型";
import { 帖子键 } from "./工具";

const 帖子表 = "posts";
const 日志表 = "logs";
const 频道 = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(通信频道名);
let 数据库Promise: Promise<IDBDatabase> | null = null;

export function 监听数据变化(回调: () => void): () => void {
  const 监听器 = (): void => 回调();
  频道?.addEventListener("message", 监听器);
  window.addEventListener("shantie-data-changed", 监听器);
  return () => {
    频道?.removeEventListener("message", 监听器);
    window.removeEventListener("shantie-data-changed", 监听器);
  };
}

function 通知数据变化(): void {
  频道?.postMessage("changed");
  window.dispatchEvent(new CustomEvent("shantie-data-changed"));
}

export async function 保存帖子(新记录: 新帖子记录, 保留已有决定 = true): Promise<帖子记录> {
  const db = await 获取数据库();
  const key = 帖子键(新记录.ownerUsername, 新记录.id);
  const 读事务 = db.transaction(帖子表, "readonly");
  const 旧记录 = (await 请求转Promise(读事务.objectStore(帖子表).get(key))) as 帖子记录 | undefined;
  // 重新同步时保留人工做过的删除/保留决定。
  const 记录: 帖子记录 = {
    ...旧记录,
    ...新记录,
    key,
    status: 保留已有决定 ? (旧记录?.status ?? 新记录.status) : 新记录.status,
    lastError: 保留已有决定 ? (旧记录?.lastError ?? 新记录.lastError) : 新记录.lastError,
    updatedAt: Date.now(),
  };
  const 写事务 = db.transaction(帖子表, "readwrite");
  写事务.objectStore(帖子表).put(记录);
  await 事务完成(写事务);
  通知数据变化();
  return 记录;
}

export async function 批量保存帖子(记录列表: 新帖子记录[]): Promise<number> {
  if (!记录列表.length) return 0;
  const db = await 获取数据库();
  const 读事务 = db.transaction(帖子表, "readonly");
  const 读表 = 读事务.objectStore(帖子表);
  const 旧记录列表 = await Promise.all(
    记录列表.map(
      (记录) => 请求转Promise(读表.get(帖子键(记录.ownerUsername, 记录.id))) as Promise<帖子记录 | undefined>,
    ),
  );
  const 写事务 = db.transaction(帖子表, "readwrite");
  const 写表 = 写事务.objectStore(帖子表);
  for (const [索引, 新记录] of 记录列表.entries()) {
    const key = 帖子键(新记录.ownerUsername, 新记录.id);
    const 旧记录 = 旧记录列表[索引];
    写表.put({
      ...旧记录,
      ...新记录,
      key,
      status: 旧记录?.status ?? 新记录.status,
      lastError: 旧记录?.lastError ?? 新记录.lastError,
      updatedAt: Date.now(),
    });
  }
  await 事务完成(写事务);
  通知数据变化();
  return 记录列表.length;
}

export async function 读取帖子(用户名: string, 状态?: 帖子状态): Promise<帖子记录[]> {
  const db = await 获取数据库();
  const 事务 = db.transaction(帖子表, "readonly");
  const 表 = 事务.objectStore(帖子表);
  const 索引 = 状态 ? 表.index("ownerStatus") : 表.index("ownerUpdated");
  const 范围 = 状态
    ? IDBKeyRange.only([用户名, 状态])
    : IDBKeyRange.bound([用户名, 0], [用户名, Number.MAX_SAFE_INTEGER]);
  const 结果 = await 游标读取<帖子记录>(索引.openCursor(范围, "prev"));
  // 索引只用于筛选，不依赖 IndexedDB 对重复索引键的主键排序。
  return 结果.sort((左, 右) => {
    const 左时间 = Date.parse(左.createdAt) || 0;
    const 右时间 = Date.parse(右.createdAt) || 0;
    return 右时间 - 左时间 || 右.id - 左.id;
  });
}

export async function 更新帖子状态(用户名: string, ids: number[], 状态: 帖子状态, 错误 = ""): Promise<void> {
  if (!ids.length) return;
  const db = await 获取数据库();
  const 读表 = db.transaction(帖子表, "readonly").objectStore(帖子表);
  const 记录列表 = await Promise.all(
    ids.map((id) => 请求转Promise(读表.get(帖子键(用户名, id))) as Promise<帖子记录 | undefined>),
  );
  const 写事务 = db.transaction(帖子表, "readwrite");
  const 写表 = 写事务.objectStore(帖子表);
  for (const 记录 of 记录列表) if (记录) 写表.put({ ...记录, status: 状态, lastError: 错误, updatedAt: Date.now() });
  await 事务完成(写事务);
  通知数据变化();
}

export async function 写日志(
  用户名: string,
  message: string,
  details?: unknown,
  level: "info" | "error" = "info",
): Promise<void> {
  const db = await 获取数据库();
  const time = Date.now();
  const 记录: 日志记录 = {
    key: `${用户名}:${time}:${crypto.randomUUID()}`,
    ownerUsername: 用户名,
    time,
    level,
    message,
    details,
  };
  const 事务 = db.transaction(日志表, "readwrite");
  事务.objectStore(日志表).put(记录);
  await 事务完成(事务);
  通知数据变化();
}

export async function 读取日志(用户名: string, 限制 = 200): Promise<日志记录[]> {
  const db = await 获取数据库();
  const 索引 = db.transaction(日志表, "readonly").objectStore(日志表).index("ownerTime");
  const 范围 = IDBKeyRange.bound([用户名, 0], [用户名, Number.MAX_SAFE_INTEGER]);
  return 游标读取<日志记录>(索引.openCursor(范围, "prev"), 限制);
}

async function 获取数据库(): Promise<IDBDatabase> {
  if (数据库Promise) return 数据库Promise;
  数据库Promise = new Promise((resolve, reject) => {
    const 请求 = indexedDB.open(数据库名称, 数据库版本);
    请求.onupgradeneeded = () => {
      const db = 请求.result;
      if (!db.objectStoreNames.contains(帖子表)) {
        const 表 = db.createObjectStore(帖子表, { keyPath: "key" });
        表.createIndex("ownerStatus", ["ownerUsername", "status"]);
        表.createIndex("ownerUpdated", ["ownerUsername", "updatedAt"]);
      }
      if (!db.objectStoreNames.contains(日志表)) {
        const 表 = db.createObjectStore(日志表, { keyPath: "key" });
        表.createIndex("ownerTime", ["ownerUsername", "time"]);
      }
    };
    请求.onsuccess = () => resolve(请求.result);
    请求.onerror = () => reject(请求.error ?? new Error("无法打开 IndexedDB"));
  });
  return 数据库Promise;
}

function 请求转Promise<T>(请求: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    请求.onsuccess = () => resolve(请求.result);
    请求.onerror = () => reject(请求.error);
  });
}

function 事务完成(事务: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    事务.oncomplete = () => resolve();
    事务.onerror = () => reject(事务.error);
    事务.onabort = () => reject(事务.error);
  });
}

function 游标读取<T>(请求: IDBRequest<IDBCursorWithValue | null>, 限制 = Number.POSITIVE_INFINITY): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const 结果: T[] = [];
    请求.onsuccess = () => {
      const 游标 = 请求.result;
      if (!游标 || 结果.length >= 限制) return resolve(结果);
      结果.push(游标.value as T);
      游标.continue();
    };
    请求.onerror = () => reject(请求.error);
  });
}
