import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerText } from "../client/src/AnswerText.tsx";

const id = "12345678-1234-4234-8234-123456789012";
test("answer references are compact controls without raw identifiers or arbitrary source URLs", () => {
  const html = renderToStaticMarkup(
    React.createElement(AnswerText, {
      text: `A fact [${id}]. Another [source: ${id}]. [Source 12345678](katha-source:${id}).`,
      onSource() {},
    }),
  );
  assert.doesNotMatch(html, new RegExp(id));
  assert.doesNotMatch(html, /href="katha-source/);
  assert.match(html, /View source 1/);
  assert.equal((html.match(/>1<\/button>/g) || []).length, 3);
});
test("ordinary prose, code examples and safe web links remain readable", () => {
  const html = renderToStaticMarkup(
    React.createElement(AnswerText, {
      text: `Use \`[${id}]\` as a literal example. [Docs](https://example.com). [Unsafe](javascript:alert(1)).`,
      onSource() {},
    }),
  );
  assert.match(html, new RegExp(id));
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /View source/);
});
