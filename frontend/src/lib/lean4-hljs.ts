import hljs from 'highlight.js/lib/core'
import type { Language } from 'highlight.js'

const lean4: Language = {
  name: 'Lean 4',
  keywords: {
    keyword:
      'import open namespace end def theorem axiom example by decide native_decide sorry ' +
      'inductive structure class instance where have let in show from return do pure match ' +
      'fun if then else with deriving extends abbrev noncomputable protected private',
    literal: 'true false',
    built_in:
      'Nat Int Float Bool String Unit Prop Type List Array Option Result IO ' +
      'Char UInt8 UInt16 UInt32 UInt64 Int8 Int16 Int32 Int64',
  },
  contains: [
    hljs.COMMENT('--', '$'),
    {
      className: 'comment',
      begin: '/-',
      end: '-/',
      contains: ['self'],
    },
    {
      className: 'string',
      begin: '"',
      end: '"',
      illegal: '\\n',
      contains: [{ begin: '\\\\.' }],
    },
    {
      className: 'number',
      begin: /\b\d+(\.\d+)?\b/,
      relevance: 0,
    },
    {
      className: 'operator',
      begin: /[≤≥→←↔∧∨¬∀∃λΠΣ]/,
      relevance: 10,
    },
    {
      className: 'title',
      begin: /\b[A-Z][A-Za-z0-9_]*/,
      relevance: 0,
    },
  ],
}

hljs.registerLanguage('lean4', () => lean4)
export { hljs }
