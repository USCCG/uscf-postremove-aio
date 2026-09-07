// ==UserScript==
// @name         USCardForum 帖子管理器
// @namespace    https://www.uscardforum.com/
// @version      1.0.5
// @description  统一获取、沉浸审核、批量编辑、删除、发帖拦截与新帖记录
// @author       Codex
// @match        *://www.uscardforum.com/*
// @match        *://uscardforum.com/*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      *
// @inject-into  page
// @sandbox      raw
// @run-at       document-start
// ==/UserScript==

import { 管理页参数 } from "./常量";
import { 安装发帖监听 } from "./发帖监听";
import { 获取当前用户名, type 页面窗口 } from "./会话";
import { 迁移旧删帖队列 } from "./迁移";
import { 启动管理页 } from "./管理页";
import { 初始化论坛入口 } from "./论坛入口";
import { 写日志, 清理无效帖子 } from "./存储";

declare const unsafeWindow: 页面窗口 | undefined;

const 页面窗口: 页面窗口 = typeof unsafeWindow === "undefined" ? window : unsafeWindow;
const 原始Fetch = 页面窗口.fetch.bind(页面窗口) as typeof fetch;

// 必须在 document-start 同步安装，否则 Discourse 可能先缓存 XHR/fetch。
let 发帖监听错误 = "";
try {
  安装发帖监听(页面窗口);
} catch (错误) {
  发帖监听错误 = 错误 instanceof Error ? 错误.message : String(错误);
  console.error("[帖子管理器] 发帖监听安装失败，其他功能仍会启动。", 错误);
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", () => void 初始化(), { once: true });
else void 初始化();

async function 初始化(): Promise<void> {
  const 是管理页 = new URLSearchParams(location.search).get(管理页参数) === "1";
  const 入口 = 是管理页 ? null : 初始化论坛入口();
  if (是管理页) 显示管理页启动状态("正在读取当前会话……");
  try {
    const 用户名 = await 获取当前用户名(原始Fetch, 页面窗口);
    if (!用户名) {
      const 消息 = "无法识别当前用户，请确认已登录后刷新。";
      console.warn(`[帖子管理器] ${消息}`);
      if (是管理页) 显示管理页启动状态(消息, true);
      else 入口?.显示错误(消息);
      return;
    }
    await 迁移旧删帖队列(用户名);
    const 已清理数量 = await 清理无效帖子(用户名);
    if (已清理数量) await 写日志(用户名, `已清理 ${已清理数量} 条旧版话题同步产生的无效记录。`);
    if (是管理页) 启动管理页(用户名);
    else {
      入口?.设置用户名(用户名);
      if (发帖监听错误) 入口?.显示错误(`发帖监听安装失败：${发帖监听错误}`);
    }
  } catch (错误) {
    const 消息 = `启动失败：${错误 instanceof Error ? 错误.message : String(错误)}`;
    console.error(`[帖子管理器] ${消息}`, 错误);
    if (是管理页) 显示管理页启动状态(消息, true);
    else 入口?.显示错误(消息);
  }
}

function 显示管理页启动状态(消息: string, 错误 = false): void {
  document.body.innerHTML = `<main style="position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#f5f7fb;font:16px system-ui;color:${错误 ? "#b42318" : "#334155"}"><div style="max-width:620px;padding:30px;text-align:center"><h1 style="color:#172033">帖子管理器</h1><p>${消息}</p>${错误 ? '<button onclick="location.reload()" style="padding:9px 14px">重新加载</button>' : ""}</div></main>`;
}
