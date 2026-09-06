import { 管理页参数 } from "./常量";
import { 读取设置 } from "./设置";
import { 监听数据变化, 读取帖子 } from "./存储";

export interface 论坛入口控制器 {
  设置用户名: (用户名: string) => void;
  显示错误: (消息: string) => void;
}

export function 初始化论坛入口(初始用户名 = ""): 论坛入口控制器 {
  const 已有主机 = document.querySelector<HTMLElement>("#shantie-launcher");
  if (已有主机) return { 设置用户名: () => undefined, 显示错误: () => undefined };
  let 用户名 = 初始用户名;
  const 主机 = document.createElement("div");
  主机.id = "shantie-launcher";
  const 根 = 主机.attachShadow({ mode: "open" });
  根.innerHTML = `<style>:host{all:initial}.button{position:fixed;right:18px;bottom:18px;z-index:2147483646;display:flex;align-items:center;gap:7px;border:0;border-radius:12px;padding:10px 13px;color:white;background:#17365f;box-shadow:0 10px 30px #0004;cursor:pointer;font:600 12px system-ui}.dot{width:8px;height:8px;border-radius:50%;background:#f59e0b}.dot.ready{background:#22c55e}.dot.blocked,.dot.error{background:#ef4444}.count{padding:1px 6px;border-radius:999px;background:#ffffff24}</style><button class="button" title="正在读取会话……"><span class="dot"></span><span>帖子管理</span><span class="count">…</span></button>`;
  document.documentElement.append(主机);
  const 按钮 = 根.querySelector<HTMLButtonElement>(".button")!;
  按钮.addEventListener("click", () => window.open(`/?${管理页参数}=1`, "shantie-manager"));

  const 刷新 = async (): Promise<void> => {
    if (!用户名) return;
    const [待定, 待编辑, 待删] = await Promise.all([
      读取帖子(用户名, "待定"),
      读取帖子(用户名, "待编辑"),
      读取帖子(用户名, "待删除"),
    ]);
    根.querySelector<HTMLElement>(".count")!.textContent = String(待定.length + 待编辑.length + 待删.length);
    根.querySelector<HTMLElement>(".dot")!.className = `dot ${读取设置().blockPosting ? "blocked" : "ready"}`;
    按钮.title = `待定 ${待定.length} · 待编辑 ${待编辑.length} · 待删 ${待删.length}${读取设置().blockPosting ? " · 已拦截发帖" : ""}`;
  };
  监听数据变化(() => void 刷新());
  window.addEventListener("storage", () => void 刷新());
  window.addEventListener("shantie-settings-changed", () => void 刷新());
  void 刷新();
  return {
    设置用户名: (新用户名) => {
      用户名 = 新用户名;
      void 刷新();
    },
    显示错误: (消息) => {
      根.querySelector<HTMLElement>(".dot")!.className = "dot error";
      根.querySelector<HTMLElement>(".count")!.textContent = "!";
      按钮.title = 消息;
    },
  };
}
