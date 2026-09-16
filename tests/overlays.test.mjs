import test from "node:test";
import assert from "node:assert/strict";
import { createOverlayManager } from "../src/lib/overlays.js";

function fixture() {
  const listeners = new Map();
  const classes = new Set();
  const doc = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    documentElement: { classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } } }
  };
  function node(tagName = "DIV", parent, focusable = false) {
    const item = {
      tagName, parent, children: [], inert: false, isConnected: true, visible: true, tabIndex: focusable ? 0 : -1,
      contains(other) { return other === this || this.children.some((child) => child.contains(other)); },
      closest() { return this.inert ? this : this.parent?.closest(); },
      matches() { return this.disabled; },
      getClientRects() { return this.visible ? [{}] : []; },
      querySelectorAll() { return this.children.flatMap((child) => [child, ...child.querySelectorAll()]); },
      focus(options) { doc.activeElement = this; this.focusOptions = options; listeners.get("focusin")?.({ target: this }); }
    };
    parent?.children.push(item);
    return item;
  }
  doc.body = node("BODY");
  const main = node("MAIN", doc.body);
  const opener = node("BUTTON", main, true);
  const title = node("H1", main);
  const oldInert = node("DIV", doc.body);
  oldInert.inert = true;
  const modal = node("DIV", doc.body);
  const first = node("BUTTON", modal, true);
  const disabled = node("BUTTON", modal, true);
  disabled.disabled = true;
  const hidden = node("BUTTON", modal, true);
  hidden.visible = false;
  const last = node("BUTTON", modal, true);
  const error = node("DIV", doc.body);
  const confirm = node("BUTTON", error, true);
  doc.querySelector = () => title;
  doc.activeElement = opener;
  const overlays = createOverlayManager(doc);
  const key = (key, shiftKey = false) => {
    const event = { key, shiftKey, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    listeners.get("keydown")(event);
    return event;
  };
  return { doc, node, main, opener, title, oldInert, modal, first, last, error, confirm, overlays, classes, key };
}

test("opening locks the page, closing restores original inert state and focus without scrolling", () => {
  const f = fixture();
  f.overlays.open(f.modal);
  assert.equal(f.overlays.active, true);
  assert.equal(f.main.inert, true);
  assert.equal(f.doc.activeElement, f.first);
  assert.equal(f.classes.has("overlay-open"), true);
  f.overlays.close(f.modal);
  assert.equal(f.main.inert, false);
  assert.equal(f.oldInert.inert, true);
  assert.equal(f.classes.has("overlay-open"), false);
  assert.equal(f.doc.activeElement, f.opener);
  assert.deepEqual(f.opener.focusOptions, { preventScroll: true });
});

test("Tab wraps visible enabled controls and programmatic focus cannot escape", () => {
  const f = fixture();
  f.overlays.open(f.modal);
  assert.equal(f.key("Tab", true).prevented, true);
  assert.equal(f.doc.activeElement, f.last);
  assert.equal(f.key("Tab").prevented, true);
  assert.equal(f.doc.activeElement, f.first);
  f.opener.focus();
  assert.equal(f.doc.activeElement, f.first);
});

test("nested error stays until confirmed, then restores modal focus and scroll lock", () => {
  const f = fixture();
  let escaped = 0;
  f.overlays.open(f.modal, { onEscape: () => { escaped++; f.overlays.close(f.modal); } });
  f.last.focus();
  f.overlays.open(f.error);
  assert.equal(f.modal.inert, true);
  const event = f.key("Escape");
  assert.equal(event.stopped, true);
  assert.equal(escaped, 0);
  assert.equal(f.doc.activeElement, f.confirm);
  f.overlays.close(f.error);
  assert.equal(f.modal.inert, false);
  assert.equal(f.main.inert, true);
  assert.equal(f.doc.activeElement, f.last);
  assert.equal(f.classes.has("overlay-open"), true);
  f.key("Escape");
  assert.equal(escaped, 1);
  assert.equal(f.overlays.active, false);
});

test("replacing dialog contents retains the original opener and detached opener falls back to title", () => {
  const f = fixture();
  f.overlays.open(f.modal);
  f.overlays.open(f.modal);
  f.overlays.close(f.modal);
  assert.equal(f.doc.activeElement, f.opener);
  f.overlays.open(f.modal);
  f.opener.isConnected = false;
  f.overlays.close(f.modal);
  assert.equal(f.doc.activeElement, f.title);
});

test("mobile sidebar and backdrop remain interactive while the main content is inert", () => {
  const f = fixture();
  const sidebar = f.node("ASIDE", f.main);
  const link = f.node("BUTTON", sidebar, true);
  const backdrop = f.node("DIV", f.main);
  f.overlays.open(sidebar, { allow: [backdrop] });
  assert.equal(f.main.inert, false);
  assert.equal(sidebar.inert, false);
  assert.equal(backdrop.inert, false);
  assert.equal(f.opener.inert, true);
  assert.equal(f.doc.activeElement, link);
  f.overlays.open(f.error);
  assert.equal(f.main.inert, true);
  f.overlays.close(f.error);
  assert.equal(f.main.inert, false);
  assert.equal(f.doc.activeElement, link);
  f.overlays.close(sidebar);
  assert.equal(f.opener.inert, false);
});
