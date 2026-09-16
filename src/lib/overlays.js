const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";

export function createOverlayManager(doc = document) {
  const stack = [];
  const inertBefore = new Map();
  const top = () => stack.at(-1);
  const focusable = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((node) =>
    node.tabIndex >= 0 && !node.matches(":disabled") && !node.closest("[inert]") && node.getClientRects().length);
  const focusFirst = (entry) => {
    const target = focusable(entry.root)[0] || entry.root;
    if (target === entry.root) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  };
  function sync() {
    for (const [node, value] of inertBefore) node.inert = value;
    inertBefore.clear();
    doc.documentElement.classList.toggle("overlay-open", stack.length > 0);
    const entry = top();
    if (!entry) return;
    const allowed = [entry.root, ...(entry.allow || [])];
    // Keep only the top dialog and its backdrop interactive, including nested menus.
    const visit = (parent) => {
      for (const child of parent.children) {
        if (allowed.includes(child)) continue;
        if (allowed.some((node) => child.contains(node))) visit(child);
        else if (!["SCRIPT", "STYLE", "LINK"].includes(child.tagName)) {
          inertBefore.set(child, child.inert);
          child.inert = true;
        }
      }
    };
    visit(doc.body);
  }
  doc.addEventListener("keydown", (event) => {
    const entry = top();
    if (!entry) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      entry.onEscape?.();
    } else if (event.key === "Tab") {
      const nodes = focusable(entry.root);
      const index = nodes.indexOf(doc.activeElement);
      if (!nodes.length || index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === nodes.length - 1) {
        event.preventDefault();
        (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
        if (!nodes.length) focusFirst(entry);
      }
    }
  }, true);
  doc.addEventListener("focusin", (event) => {
    const entry = top();
    if (entry && !entry.root.contains(event.target)) focusFirst(entry);
  });
  return {
    get active() { return stack.length > 0; },
    open(root, options = {}) {
      const existing = stack.find((entry) => entry.root === root);
      const entry = existing || { root, returnFocus: doc.activeElement };
      Object.assign(entry, options);
      if (!existing) stack.push(entry);
      sync();
      if (top() === entry) focusFirst(entry);
    },
    close(root) {
      const index = stack.findIndex((entry) => entry.root === root);
      if (index < 0) return;
      const wasTop = index === stack.length - 1;
      const [entry] = stack.splice(index, 1);
      sync();
      if (!wasTop) return;
      const target = entry.returnFocus;
      if (target?.isConnected && !target.closest("[inert]") && target.getClientRects().length) target.focus({ preventScroll: true });
      else if (top()) focusFirst(top());
      else doc.querySelector("#page-title")?.focus({ preventScroll: true });
    }
  };
}
