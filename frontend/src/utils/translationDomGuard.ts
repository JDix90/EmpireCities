/**
 * A page the browser has translated (Edge's and Chrome's built-in translators,
 * the Google Translate extension) has had its text nodes replaced with <font>
 * elements holding the new words. React still holds the old text nodes. When
 * it then removes one (a label that appears and disappears) or inserts an
 * element in front of one (an icon swapped before a label), the node it names
 * is no longer where it left it, the DOM throws NotFoundError, and the whole
 * app falls to its error screen (facebook/react#11538).
 *
 * The guard catches exactly those two calls, when the node React names is not
 * a child of the element it calls, and does what React meant:
 *
 * - removeChild: takes the node out of the wrapper the translator put it in,
 *   or does nothing when the translator already took it out. The translated
 *   words can then stay on screen until that part of the page is drawn again.
 * - insertBefore: inserts in front of whatever now holds the node under that
 *   element, or at the end when the node is gone.
 *
 * Every other call goes straight to the browser. The first absorbed call in a
 * page load is reported to Sentry, so how often it happens can be seen.
 * `translation_dom_guard_enabled` is the kill switch: off, both calls throw as
 * they always did.
 */
import * as Sentry from '@sentry/react';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

type GuardedCall = 'removeChild' | 'insertBefore';

let originals: { removeChild: Node['removeChild']; insertBefore: Node['insertBefore'] } | null = null;
let reported = false;

const guardOn = (): boolean => useFeatureFlagsStore.getState().flags.translation_dom_guard_enabled;

function reportOnce(call: GuardedCall): void {
  if (reported) return;
  reported = true;
  const html = document.documentElement;
  Sentry.captureMessage('Translated page: a DOM call on a replaced node was absorbed', {
    level: 'warning',
    tags: {
      translation_dom_guard: call,
      // Chrome marks the page it translated; Edge does not, so this may read false on a translated page.
      page_translated: /\btranslated-(ltr|rtl)\b/.test(html.className),
      page_lang: html.lang || 'none',
    },
  });
}

/** The child of `parent` that holds `node` (or is it), or null when `node` is not under `parent`. */
function childHolding(parent: Node, node: Node): Node | null {
  let n: Node | null = node;
  while (n && n.parentNode !== parent) n = n.parentNode;
  return n;
}

/** Patch the two DOM calls. Call once, before React renders. */
export function installTranslationDomGuard(): void {
  if (originals || typeof Node !== 'function') return;
  const { removeChild, insertBefore } = Node.prototype;
  originals = { removeChild, insertBefore };

  Node.prototype.removeChild = function guardedRemoveChild<T extends Node>(this: Node, child: T): T {
    if (child.parentNode === this || !guardOn()) return removeChild.call(this, child) as T;
    reportOnce('removeChild');
    if (child.parentNode && this.contains(child)) return child.parentNode.removeChild(child);
    return child;
  };

  Node.prototype.insertBefore = function guardedInsertBefore<T extends Node>(
    this: Node,
    node: T,
    child: Node | null,
  ): T {
    if (!child || child.parentNode === this || !guardOn()) return insertBefore.call(this, node, child) as T;
    reportOnce('insertBefore');
    return insertBefore.call(this, node, childHolding(this, child)) as T;
  };
}

/** For tests: put the browser's own calls back. */
export function uninstallTranslationDomGuardForTests(): void {
  if (!originals) return;
  Node.prototype.removeChild = originals.removeChild;
  Node.prototype.insertBefore = originals.insertBefore;
  originals = null;
  reported = false;
}
