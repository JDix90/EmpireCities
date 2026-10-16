/**
 * Do to a rendered tree what a browser's page translation does to the live
 * page. Edge's and Chrome's built-in translators (and the Google Translate
 * extension) replace each text node they translate with a <font> element
 * holding the new words. React still holds the original text node, so an
 * update that inserts an element *before* that text node asks the DOM to
 * insert before a node that is no longer there: `NotFoundError: Failed to
 * execute 'insertBefore' on 'Node'`, and the app falls to its error screen.
 *
 * Call it after rendering, then drive the UI as a player would; a component
 * that survives keeps its swapped icons and conditional elements out of the
 * way of a bare text node (wrap the label in a <span>).
 */
export function translatePage(root: Element): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.data.trim() && !node.parentElement?.closest('font')) texts.push(node);
  }
  for (const node of texts) {
    const outer = root.ownerDocument.createElement('font');
    const inner = root.ownerDocument.createElement('font');
    inner.textContent = node.data;
    outer.appendChild(inner);
    node.replaceWith(outer);
  }
}
