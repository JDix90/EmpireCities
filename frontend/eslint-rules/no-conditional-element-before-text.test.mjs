/**
 * The lint rule against mounting an element in front of a text node (the
 * crash a page the browser has translated hits). Run by the frontend's vitest.
 */
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-conditional-element-before-text.mjs';

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const wrap = (body) => `export const C = ({ a, b, n, label }) => (\n  <div>\n${body}\n  </div>\n);`;

tester.run('no-conditional-element-before-text', rule, {
  valid: [
    // The fixes: the text is an element, which a translator leaves in place.
    wrap(`<button>{a ? <Up /> : <Down />}<span>Tools</span></button>`),
    wrap(`<button>{a && <Check />}<span>{a ? 'Copied' : 'Copy'}</span></button>`),
    // One element turned, not two swapped: nothing is mounted.
    wrap(`<button><Up className={a ? 'rotate-180' : ''} />Tools</button>`),
    // A swap between two of the same type is an update, not a mount.
    wrap(`<button>{a ? <Icon name="up" /> : <Icon name="down" />}Tools</button>`),
    // The conditional comes after the text: React appends, it inserts before nothing.
    wrap(`<button>Tools{a && <Badge />}</button>`),
    // What follows is an element, or a space a translator does not replace.
    wrap(`<p>{a && <Badge />}<strong>Tools</strong></p>`),
    wrap(`<p>{a && <Badge />} {b && <Badge />}</p>`),
    // Of unknown type: left alone rather than guessed at.
    wrap(`<p>{a && <Badge />}{label}</p>`),
    // Something always renders between: the swap below inserts before its own text,
    // but the first badge is always followed by an element.
    wrap(`<p>{a && <Badge />}{b ? <Up /> : <Up />}<span>Tools</span></p>`),
    // Whitespace across a line break is dropped by JSX, so the next child is the span.
    wrap(`<p>
      {a && <Badge />}
      <span>Tools</span>
    </p>`),
  ],
  invalid: [
    // The Sentry crash: two icons swapped in front of the label.
    { code: wrap(`<button>{a ? <Down /> : <Up />}Tools &amp; options</button>`), errors: [{ messageId: 'beforeText' }] },
    { code: wrap(`<button>
      {a ? <Down /> : <Up />}
      Tools &amp; options
    </button>`), errors: [{ messageId: 'beforeText' }] },
    // A badge shown on a condition, in front of a string expression.
    { code: wrap(`<span>{a && <Check />}{a ? 'Completed' : 'Pending'}</span>`), errors: [{ messageId: 'beforeText' }] },
    { code: wrap(`<span>{a && <Check />}{t('done')}</span>`), errors: [{ messageId: 'beforeText' }] },
    { code: wrap(`<span>{a && <Check />}{n.toLocaleString()}</span>`), errors: [{ messageId: 'beforeText' }] },
    { code: wrap(`<span>{a && <Check />}{\`\${n} left\`}</span>`), errors: [{ messageId: 'beforeText' }] },
    // A fragment mounts its children in front of the text too.
    { code: wrap(`<p>{a && <> and <b>{n} XP</b></>}. Kept.</p>`), errors: [{ messageId: 'beforeText' }] },
    // A key makes two of one type different elements.
    { code: wrap(`<p>{a ? <Icon key="a" /> : <Icon key="b" />}Tools</p>`), errors: [{ messageId: 'beforeText' }] },
    // Either side of || or ?? can be the element.
    { code: wrap(`<p>{a || <Badge />}Tools</p>`), errors: [{ messageId: 'beforeText' }] },
    // Inside a fragment, the same.
    { code: `export const C = ({ a }) => (<>{a && <Badge />}Tools</>);`, errors: [{ messageId: 'beforeText' }] },
    // Past a conditional that can render nothing: when Y is absent, X lands in front of the text.
    { code: wrap(`<p>{a && <X />}{b && <Y />}. Kept.</p>`), errors: [{ messageId: 'beforeText' }, { messageId: 'beforeText' }] },
    // Past one, to a conditional text node.
    { code: wrap(`<p>{a && <X />}{b && <Y />}{n > 0 && ' (new)'}</p>`), errors: [{ messageId: 'beforeText' }, { messageId: 'beforeText' }] },
  ],
});
