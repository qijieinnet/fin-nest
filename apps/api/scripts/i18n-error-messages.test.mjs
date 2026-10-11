// 校验：后端抛给用户的中文错误文案（new AppError / internalError 的字面量）都有英文对照。
// 漏了不会报错，只会让英文界面看到中文原文——所以靠这个用例兜底。
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { translateErrorMessage } from "@fin-nest/backend";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const roots = ["apps/api/src", "packages/backend/src"].map((dir) => join(repoRoot, dir));
const HAN = /[一-鿿]/;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (/\.ts$/.test(entry.name) && !/\.(spec|test)\.ts$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** 模板字符串的插值换成样例值，模拟运行期拼出来的文案。 */
function sampleText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `x${span.literal.text}`).join("");
  }
  if (ts.isConditionalExpression(node)) return [sampleText(node.whenTrue), sampleText(node.whenFalse)];
  return null;
}

function collectMessages() {
  const messages = [];
  for (const file of roots.flatMap((root) => walk(root))) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      let message;
      if (ts.isNewExpression(node) && node.expression.getText(source) === "AppError") message = node.arguments?.[1];
      if (ts.isCallExpression(node) && node.expression.getText(source) === "internalError") message = node.arguments[0];
      if (message) {
        for (const text of [sampleText(message)].flat()) {
          if (text && HAN.test(text)) {
            const line = source.getLineAndCharacterOfPosition(message.getStart(source)).line + 1;
            messages.push({ text, where: `${relative(repoRoot, file)}:${line}` });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return messages;
}

test("每条中文错误文案都有英文翻译", () => {
  const messages = collectMessages();
  assert.ok(messages.length > 100, "应能扫描到业务错误文案");
  const missing = messages.filter(({ text }) => HAN.test(translateErrorMessage(text, "en")));
  assert.deepEqual(
    missing.map(({ text, where }) => `${where} ${text}`),
    [],
    "以上文案缺英文翻译，请补到 packages/backend/src/i18n/error-messages.en.ts",
  );
});

test("中文请求原样返回，英文请求按模板插值", () => {
  assert.equal(translateErrorMessage("请先登录", "zh-CN"), "请先登录");
  assert.equal(translateErrorMessage("一次最多上传 4 张图片", "en"), "Up to 4 images per upload");
});
