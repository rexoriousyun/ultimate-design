/**
 * Ranks techniques against a design ask ("make this feel hand-made") — PLAN.md phase 4.
 *
 * Pure and dependency-free, so the same file runs in Node (techniques.js, the tests) and in
 * the studio's browser (Ultimate Design imports it from /creative-library/). One ranker, not
 * a copy per caller.
 *
 * Still shallow on purpose, and it shows its reasoning: each result lists the words that
 * matched. What changed from plain word overlap:
 * - the intent index (recipes/web/intents.json) says what each recipe is *for*; a word found
 *   there counts 3, in the label 2, in the description 1, so the purpose outranks mechanism;
 * - words are stemmed lightly ("printed" meets "print", "loads" meets "loading") and
 *   compounds are joined as well as split ("hand-made" is hand, made and handmade);
 * - a negation ("without 3D", "no motion") turns the words after it into a penalty;
 * - a small table of design synonyms (broken ~ corrupted, screen ~ tv, mouse ~ pointer) lets an
 *   ask reach an index phrase worded differently, one point below an exact match.
 * An empty result stays a real answer: the shelf has nothing for this.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'that', 'this',
  'it', 'its', 'is', 'be', 'i', 'we', 'you', 'my', 'our', 'your', 'want', 'need', 'make', 'build',
  'some', 'something', 'how', 'do', 'feel', 'look', 'like', 'more', 'less', 'very', 'into', 'from',
  'while', 'when', 'what', 'there', 'add', 'use', 'get', 'have', 'can', 'should', 'page', 'design',
]);
const NEGATIONS = new Set(['without', 'no', 'not', 'never', 'avoid']);
/** Two-letter words that mean something in a design ask (most two-letter words do not). */
const SHORT_WORDS = new Set(['tv', 'ui', 'ux', 'ai', 'vr', 'ar']);

/**
 * Words design asks use interchangeably. Plain design vocabulary, not phrases from the cases:
 * a group says "these mean the same thing here", so an ask that says *broken* reaches an index
 * that says *corrupted*. A synonym match scores one less than the same word matched exactly,
 * so the literal reading still wins a tie of meaning.
 */
const SYNONYM_GROUPS = [
  ['broken', 'corrupted', 'glitch', 'glitchy', 'damaged', 'distorted', 'error'],
  ['screen', 'display', 'monitor', 'crt', 'tv', 'television'],
  ['mouse', 'cursor', 'pointer'],
  ['photo', 'image', 'picture'],
  ['retro', 'vintage', 'old', 'nostalgic'],
  ['print', 'ink', 'press', 'newsprint'],
  ['calm', 'ambient', 'quiet', 'gentle', 'subtle'],
  ['moving', 'motion', 'animated', 'animation'],
  ['glow', 'neon', 'shine', 'luminous'],
  ['loading', 'waiting', 'pending'],
  ['organic', 'natural', 'fluid'],
  ['divider', 'separator'],
  ['sketchy', 'doodle', 'scribble'],
];
const SYNONYMS = new Map();
for (const group of SYNONYM_GROUPS) {
  const stems = group.map(stem);
  for (const s of stems) SYNONYMS.set(s, new Set([...(SYNONYMS.get(s) ?? []), ...stems.filter((t) => t !== s)]));
}

/** A light stemmer: enough to meet plural, past and -ing forms, no more. */
export function stem(word) {
  let w = word;
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1); // "shape" and "shap(es)" meet
  return w;
}

/** Words of a text, stemmed; a hyphenated compound also yields its joined form. */
export function words(text) {
  const out = [];
  for (const raw of String(text ?? '').toLowerCase().split(/[^a-z0-9-]+/)) {
    const parts = raw.split('-').filter(Boolean);
    if (parts.length > 1) out.push(parts.join(''));
    out.push(...parts);
  }
  // Two-letter words only when they carry meaning: a digit ("3d") or a known short word ("tv").
  return out.filter((w) => (w.length > 2 || /\d/.test(w) || SHORT_WORDS.has(w)) && !STOPWORDS.has(w)).map(stem);
}

/** The ask split into wanted words and unwanted ones (those after a negation). */
export function parseIntent(intent) {
  const wanted = [];
  const unwanted = [];
  let negated = false;
  for (const raw of String(intent ?? '').toLowerCase().split(/[\s,;.]+/)) {
    if (NEGATIONS.has(raw)) {
      negated = true;
      continue;
    }
    const ws = words(raw);
    (negated ? unwanted : wanted).push(...ws);
    if (ws.length) negated = false; // a negation reaches the next real word only
  }
  return { wanted: [...new Set(wanted)], unwanted: [...new Set(unwanted)] };
}

/**
 * @param {{id: string, label: string, description: string, primitive: string, intents?: string[]}[]} techniques
 * @param {string} intent
 * @returns {{technique: object, score: number, matched: string[], phrases: string[]}[]} only
 *   positive scores, best first; `phrases` are the intent-index phrases the ask reached
 */
export function rankByIntent(techniques, intent) {
  const { wanted, unwanted } = parseIntent(intent);
  if (wanted.length === 0) return [];
  return techniques
    .map((technique) => {
      const fields = [
        [3, new Set(words((technique.intents ?? []).join(' ')))],
        [2, new Set(words(`${technique.label} ${technique.id}`))],
        // The parameter map's `controls` prose counts as description: it says what each knob does.
        [1, new Set(words(`${technique.description} ${technique.primitive} ${Object.values(technique.props ?? {}).map((p) => p.controls ?? '').join(' ')}`))],
      ];
      const reaches = (w, set) => set.has(w) || [...(SYNONYMS.get(w) ?? [])].some((s) => set.has(s));
      // The best field a word reaches: exactly, or through a synonym at one point less.
      const weight = (w) => Math.max(0, ...fields.map(([n, set]) => (set.has(w) ? n : reaches(w, set) ? n - 1 : 0)));
      const matched = wanted.filter((w) => weight(w) > 0);
      const score = matched.reduce((s, w) => s + weight(w), 0) - unwanted.reduce((s, w) => s + weight(w), 0);
      // The index phrases the ask reached, so a reader sees which purpose it matched.
      const phrases = (technique.intents ?? []).filter((phrase) => {
        const set = new Set(words(phrase));
        return matched.some((w) => reaches(w, set));
      });
      return { technique, score, matched, phrases };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.technique.id.localeCompare(b.technique.id));
}
