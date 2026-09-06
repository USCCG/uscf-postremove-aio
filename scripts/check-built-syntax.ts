export {};

const 产物路径 = "dist/shantie.user.js";
const 产物 = await Bun.file(产物路径).text();

try {
  // 只编译函数体、不执行 userscript；因此无需伪造 window/document。
  new Function(产物);
} catch (错误) {
  throw new Error(`Bun 无法解析 ${产物路径}：${错误 instanceof Error ? 错误.message : String(错误)}`, { cause: 错误 });
}

console.log(`Bun 语法检查通过：${产物路径}`);
