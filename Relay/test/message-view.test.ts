import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";

const require = createRequire(import.meta.url);
require.extensions[".css"] = (module) => {
  module.exports = {};
};
const { MessageView } = await import("../src/message-view.js");

function renderMessage(message: unknown, live = false): string {
  return renderToStaticMarkup(
    createElement(MessageView, { message, live }),
  );
}

test("assistant markdown renders bold, list, and fenced code", () => {
  const html = renderMessage({
    role: "assistant",
    text: [
      "Hello **bold** world",
      "",
      "- item one",
      "- item two",
      "",
      "```",
      "const x = 1",
      "```",
    ].join("\n"),
  });

  assert.match(html, /class="message assistant"/);
  assert.match(html, /class="markdown-body"/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>/);
  assert.match(html, /<pre><code[^>]*>const x = 1\n?<\/code><\/pre>/);
});

test("user message with script-like text stays plain text (no tags)", () => {
  const html = renderMessage({
    role: "user",
    text: 'hi <script>alert(1)</script> and **not bold**',
  });

  assert.match(html, /class="message user"/);
  assert.doesNotMatch(html, /markdown-body/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<strong>/);
  assert.match(html, /hi &lt;script&gt;alert\(1\)&lt;\/script&gt; and \*\*not bold\*\*/);
});

test("assistant does not execute raw HTML from untrusted LLM text", () => {
  const html = renderMessage({
    role: "assistant",
    text: 'safe <script>alert(1)</script> and <img src=x onerror=alert(1)>',
  });

  assert.match(html, /markdown-body/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;script&gt;|safe/);
});

test("GFM table alignment does not emit inline style (CSP style-src)", () => {
  const html = renderMessage({
    role: "assistant",
    text: [
      "| a | b |",
      "| --- | ---: |",
      "| 1 | 2 |",
    ].join("\n"),
  });

  assert.match(html, /<table>/);
  assert.match(html, /md-align-right/);
  assert.doesNotMatch(html, /style=/);
  assert.doesNotMatch(html, /text-align/);
});
