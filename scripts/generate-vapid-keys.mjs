// 生成 Web Push 用的 VAPID 密钥对（RFC 8292：一对 P-256 密钥，base64url 编码）。
//
// 一个部署生成一次，之后**不要更换**：applicationServerKey 是订阅的一部分，
// 换了密钥等于让所有已存在的订阅全部作废——用户会静默收不到推送，而且自己毫无察觉，
// 直到手动去通知设置里关掉再重新打开。
//
// 用 node:crypto 现算而不是调 web-push 的 generateVAPIDKeys：那个包装在
// packages/backend 里，仓库根跑脚本解析不到；而这段本身也就十行。
//
// 运行：pnpm gen:vapid

import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

// JWK 导出的 x / y / d 已经是 base64url 的裸数字，不带 DER 包装。
const jwk = privateKey.export({ format: "jwk" });
const x = Buffer.from(jwk.x, "base64url");
const y = Buffer.from(jwk.y, "base64url");

// 公钥是未压缩点：0x04 || X || Y，共 65 字节。浏览器的 applicationServerKey 只认这个形态。
const uncompressed = Buffer.concat([Buffer.from([0x04]), x, y]);

console.log(`VAPID_PUBLIC_KEY=${uncompressed.toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
console.log("");
console.log("把以上三行写进 .env（或部署用的 .env.docker）后重启 api 与 worker。");
console.log("VAPID_SUBJECT 必须是 mailto: 邮箱或 https:// 地址——其它格式 Apple 的");
console.log("web.push.apple.com 会直接返回 403，且错误信息不会告诉你原因。");
