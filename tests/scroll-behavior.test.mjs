import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const start = app.indexOf("function renderAssistantMessages(");
const end = app.indexOf("\nfunction currentViewLabel", start);
function renderAt(scrollTop, pending = false) {
  const messages = { scrollTop, scrollHeight: 1000, clientHeight: 300, set innerHTML(value) { this.html = value; this.scrollHeight = 1200; } };
  const context = {
    state: { assistantMessages: [{ role: "assistant", text: "test" }], assistantBusy: pending },
    elements: { assistantMessages: messages, assistantForm: { querySelector: () => ({}) }, assistantInput: {} },
    e: String, assistantMessageHtml: String, refreshIcons() {}
  };
  runInNewContext(`${app.slice(start, end)}\nrenderAssistantMessages(${pending});`, context);
  return messages.scrollTop;
}
test("AI reply does not pull readers away from older messages", () => {
  assert.equal(renderAt(120), 120);
  assert.equal(renderAt(700), 1200);
  assert.equal(renderAt(680), 1200);
  assert.equal(renderAt(120, true), 1200);
});
test("long dialogs scroll their body while actions remain outside the scroll area", () => {
  assert.match(styles, /\.modal \{[^}]*display: flex;[^}]*overflow: hidden/);
  assert.match(styles, /\.modal-body \{[^}]*min-height: 0;[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain/);
  assert.match(styles, /\.modal-header, \.modal-footer \{ flex-shrink: 0/);
  assert.match(styles, /\.help-toc \{[^}]*max-height: calc\(100dvh - 40px\);[^}]*overflow-y: auto/);
  assert.match(styles, /@media print[^]*\.table-scroll:has\(\.accounting-ledger\) \{ max-height: none; overflow: visible/);
});
