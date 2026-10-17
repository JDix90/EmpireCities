/**
 * borderfall/no-conditional-element-before-text
 *
 * A page the browser has translated (Edge's and Chrome's built-in translators,
 * the Google Translate extension) has had its text nodes swapped for <font>
 * elements holding the new words. React still holds the original text nodes.
 * When it mounts an element in front of one (an icon swapped for another, a
 * badge shown on a condition, a fragment), it asks the DOM to insert before a
 * node that is no longer there, and the app crashes with "NotFoundError: Failed
 * to execute 'insertBefore' on 'Node'" (facebook/react#11538; Sentry,
 * 2026-10-16, the HUD's Tools & options toggle).
 *
 * This flags a JSX child that can mount an element in front of a text node:
 * `{cond && <X />}`, `{cond ? <A /> : <B />}` with different element types, or
 * either of those holding a fragment, followed by JSX text or a string-valued
 * expression, directly or past other conditionals that can render nothing. The fix is to wrap the text in a <span>: the node
 * React inserts before is then an element, which the translator leaves in place.
 *
 * Only what the AST can show is flagged. A following `{label}` or `{fn()}` of
 * unknown type is left alone; a following ' ' is not text a translator touches.
 */

const isJsx = (node) => !!node && (node.type === 'JSXElement' || node.type === 'JSXFragment');

const TEXT_METHODS = new Set([
  't', 'String', 'toLocaleString', 'toFixed', 'toString', 'join', 'toUpperCase', 'toLowerCase',
  'trim', 'padStart', 'padEnd', 'replace', 'slice', 'format',
]);

const isNullish = (node) =>
  !node
  || (node.type === 'Literal' && (node.value === null || node.value === false || node.value === ''))
  || (node.type === 'Identifier' && node.name === 'undefined');

/** True when `node` evaluates to text that a translator would replace. */
function isText(node) {
  if (!node) return false;
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'number' || (typeof node.value === 'string' && /\S/.test(node.value));
    case 'TemplateLiteral':
      return true;
    case 'BinaryExpression':
      return node.operator === '+' && (isText(node.left) || isText(node.right));
    case 'ConditionalExpression':
      return (isText(node.consequent) || isText(node.alternate))
        && (isText(node.consequent) || isNullish(node.consequent))
        && (isText(node.alternate) || isNullish(node.alternate));
    case 'LogicalExpression':
      return isText(node.right);
    case 'CallExpression': {
      const callee = node.callee;
      const name = callee.type === 'Identifier'
        ? callee.name
        : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
          ? callee.property.name
          : '';
      return TEXT_METHODS.has(name);
    }
    default:
      return false;
  }
}

/** The element name a JSX branch renders, so a swap between two of one type reads as an update. */
function elementName(node) {
  if (node.type === 'JSXFragment') return '<>';
  const print = (n) => (n.type === 'JSXIdentifier' ? n.name
    : n.type === 'JSXMemberExpression' ? `${print(n.object)}.${n.property.name}`
      : n.type === 'JSXNamespacedName' ? `${n.namespace.name}:${n.name.name}`
        : '?');
  const hasKey = node.openingElement.attributes.some((a) => a.type === 'JSXAttribute' && a.name.name === 'key');
  // A key makes even the same type a different element.
  return hasKey ? null : print(node.openingElement.name);
}

/** True when this child expression can mount an element that was not there before. */
function canMountElement(node) {
  if (!node) return false;
  if (node.type === 'LogicalExpression') {
    if (isJsx(node.right) || canMountElement(node.right)) return true;
    return node.operator !== '&&' && (isJsx(node.left) || canMountElement(node.left));
  }
  if (node.type === 'ConditionalExpression') {
    const a = node.consequent;
    const b = node.alternate;
    if (isJsx(a) && isJsx(b)) {
      const nameA = elementName(a);
      return nameA === null || nameA !== elementName(b);
    }
    return isJsx(a) || isJsx(b) || canMountElement(a) || canMountElement(b);
  }
  return false;
}

/** JSX text React drops: whitespace that spans a line break. */
const isDroppedWhitespace = (child) =>
  child.type === 'JSXText' && /^\s*$/.test(child.value) && /\n/.test(child.value);

const isTextChild = (child) =>
  (child.type === 'JSXText' && /\S/.test(child.value))
  || (child.type === 'JSXExpressionContainer' && isText(child.expression));

/** True when this child expression can render nothing (so React looks past it). */
function canRenderNothing(node) {
  if (!node) return true;
  if (node.type === 'LogicalExpression') return true;
  if (node.type === 'ConditionalExpression') {
    return canRenderNothing(node.consequent) || canRenderNothing(node.alternate)
      || isNullish(node.consequent) || isNullish(node.alternate);
  }
  return isNullish(node);
}

/**
 * React inserts in front of the next node that is actually on the page, so a
 * conditional that can render nothing is looked past: `{a && <X />}{b && <Y />}text`
 * puts X in front of the text whenever Y is absent.
 */
function textFollows(children, from) {
  for (let j = from + 1; j < children.length; j += 1) {
    const child = children[j];
    if (isTextChild(child)) return true;
    if (child.type === 'JSXExpressionContainer' && canRenderNothing(child.expression)) continue;
    return false;
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow a JSX child that can mount an element directly in front of a text node, which crashes React on a page the browser has translated.',
    },
    schema: [],
    messages: {
      beforeText:
        'This can mount an element in front of the text after it, which crashes React on a page the browser has translated (NotFoundError on insertBefore). Wrap that text in a <span>.',
    },
  },
  create(context) {
    function check(node) {
      const children = node.children.filter((child) => !isDroppedWhitespace(child));
      children.forEach((child, i) => {
        if (child.type !== 'JSXExpressionContainer' || !canMountElement(child.expression)) return;
        if (textFollows(children, i)) context.report({ node: child, messageId: 'beforeText' });
      });
    }
    return { JSXElement: check, JSXFragment: check };
  },
};
