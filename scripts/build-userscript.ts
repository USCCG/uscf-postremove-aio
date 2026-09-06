export {};

const 入口路径 = "src/shantie.user.ts";
const 源码 = await Bun.file(入口路径).text();
const 元数据 = 源码.match(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==/m)?.[0];
if (!元数据) throw new Error("入口文件缺少 userscript 元数据。");

// Bun.build 会错误截断中文标识符，甚至产生作用域同名冲突。
// 这里直接调用 esbuild 原生可执行文件，避免 Bun 运行 esbuild JS service 时不退出的问题。
const 构建进程 = Bun.spawn(
  [
    "./node_modules/.bin/esbuild",
    入口路径,
    "--bundle",
    "--format=iife",
    "--platform=browser",
    "--target=es2022",
    "--charset=utf8",
    "--legal-comments=none",
    "--outfile=dist/shantie.user.js",
    `--banner:js=${元数据}`,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
const 退出码 = await 构建进程.exited;
if (退出码 !== 0) throw new Error(`esbuild 构建失败，退出码 ${退出码}`);

const 产物 = await Bun.file("dist/shantie.user.js").text();
if (!产物.startsWith("// ==UserScript==") || !产物.includes("function 安装发帖监听(")) {
  throw new Error("构建产物验证失败：userscript 元数据或中文标识符丢失。");
}
if (/function\s+[一-鿿]_\s*\(/.test(产物)) {
  throw new Error("构建产物验证失败：发现 Bun 风格的中文标识符截断。");
}
console.log("已生成 dist/shantie.user.js");
