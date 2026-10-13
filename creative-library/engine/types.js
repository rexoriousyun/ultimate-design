/**
 * Shared contracts. Every other module in engine/ is written against these shapes.
 * Nothing here executes — JSDoc typedefs only, so both the web observer and a future
 * Qt observer emit the same bundle and every check stays a pure function over it.
 */

// ---------------------------------------------------------------------------
// Observation bundle — what an observer emits, and the only thing checks read.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Bundle
 * @property {SubjectInfo} subject
 * @property {AxNode[]} tree            Flattened accessibility tree.
 * @property {DomNode[]|null} dom       Web only. Null for Qt subjects.
 * @property {Screenshot[]} screenshots
 * @property {Interactions} interactions
 * @property {RepoFacts|null} repo      Null for black-box subjects.
 * @property {AxeResults|null} axe      Web only. Raw axe-core run.
 * @property {Record<string,string>} absent
 *   Keys deliberately not collected, mapped to the reason. A check whose evidence is
 *   listed here must return not-applicable, never pass. Silent passes are the one
 *   failure mode worse than having no audit at all.
 */

/**
 * @typedef {Object} SubjectInfo
 * @property {'url'|'repo'|'repo+running'} kind
 * @property {string} target            URL or absolute repo path.
 * @property {string} timestamp         ISO 8601, supplied by the caller.
 * @property {'web'|'qt'} platform
 */

/**
 * @typedef {Object} AxNode
 * @property {number} idx               Index into Bundle.tree. Stable within a bundle.
 * @property {number|null} parent       Index of parent, or null for root.
 * @property {string} role
 * @property {string} name              Computed accessible name. '' when absent.
 * @property {string[]} states          e.g. ['focusable','disabled','expanded']
 * @property {Rect|null} bounds
 * @property {number|null} domRef       Index into Bundle.dom, when the platform has one.
 */

/**
 * @typedef {Object} DomNode
 * @property {number} ref               Index into Bundle.dom.
 * @property {string} tag               Lowercase.
 * @property {string} selector          Unique CSS selector, used as a report locator.
 * @property {Record<string,string>} attrs
 * @property {Record<string,string>} styles   Computed, restricted to COLLECTED_STYLES.
 * @property {Rect} bounds
 * @property {string} text              Trimmed own text content.
 * @property {boolean} interactive      Clickable, focusable, or has a pointer handler.
 * @property {boolean} visible
 */

/**
 * @typedef {Object} Rect
 * @property {number} x @property {number} y @property {number} w @property {number} h
 */

/**
 * @typedef {Object} Screenshot
 * @property {'mobile'|'desktop'} viewport
 * @property {number} width @property {number} height
 * @property {string} path              Relative to the bundle output directory.
 */

/**
 * @typedef {Object} Interactions
 * @property {number[]} tabOrder             DOM refs in tab-traversal order.
 * @property {FocusProbe[]} focusVisible
 * @property {boolean} respectsReducedMotion Page rendered under prefers-reduced-motion
 *                                           differed from the default render.
 */

/**
 * @typedef {Object} FocusProbe
 * @property {number} ref
 * @property {boolean} hasVisibleIndicator   Focused render differs from unfocused.
 * @property {string} outlineStyle
 */

/**
 * @typedef {Object} RepoFacts
 * @property {Record<string,string>|null} tokens      Design tokens, name to value.
 * @property {{id:string,source:string}[]|null} components
 * @property {Record<string,unknown>|null} stance     Project preference overrides.
 */

/**
 * @typedef {Object} AxeResults
 * @property {{id:string,nodes:{target:string[],html:string,failureSummary:string}[]}[]} violations
 * @property {{id:string}[]} passes
 * @property {{id:string}[]} incomplete
 * @property {{id:string}[]} inapplicable
 */

// ---------------------------------------------------------------------------
// Entry — parsed from Markdown frontmatter. Validated against entry.schema.json.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Entry
 * @property {string} id
 * @property {'invariant'|'preference'|'recipe'|'art-direction'} tier
 * @property {string} category @property {string} title @property {string} summary
 * @property {AppliesWhen[]} applies_when
 * @property {Check} [check]
 * @property {'fail'|'flag'} severity
 * @property {Object} evidence
 * @property {{pass:string,fail:string}} [fixtures]
 * @property {boolean} [draft]
 * @property {string} body               Markdown after the frontmatter.
 * @property {string} path               Absolute path on disk.
 */

/**
 * A single applicability condition. All conditions on an entry must hold, or the
 * verdict is not-applicable. An entry with an empty applies_when is a bug — during a
 * whole-product audit most entries do not apply, and without this the report is noise.
 *
 * @typedef {{subject_has: SubjectFeature}
 *         | {viewport: 'any'|'mobile'|'desktop'}
 *         | {bundle_has: 'dom'|'axe'|'repo.tokens'|'repo.components'|'repo.stance'}
 *         | {form_fields: string}} AppliesWhen
 */

/**
 * @typedef {'interactive-elements'|'forms'|'images'|'headings'|'animation'
 *         |'destructive-action'|'text'} SubjectFeature
 */

/**
 * @typedef {Object} Check
 * @property {'deterministic'|'judge'} kind
 * @property {string} [fn]        Deterministic only. A key in the check registry, or
 *                                'axe:<rule-id>' to delegate to axe-core.
 * @property {Object} [params]
 * @property {string[]} [evidence_needed]  Judge only. Bundle paths the rubric reads.
 * @property {string} [rubric]             Judge only. Must be falsifiable.
 */

// ---------------------------------------------------------------------------
// Checks and verdicts.
// ---------------------------------------------------------------------------

/**
 * A check is a pure function. It must not touch the network, the filesystem, or a live
 * page — everything it needs is in the bundle. This is what lets one check serve web and
 * Qt, an owned repo and a black-box URL.
 *
 * Returning an array reports one verdict per offending element. Returning a single
 * not-applicable verdict is correct when the entry simply does not apply.
 *
 * @typedef {(bundle: Bundle, params: Object, entry: Entry) => Verdict|Verdict[]} CheckFn
 */

/**
 * @typedef {Object} Verdict
 * @property {string} entryId
 * @property {'pass'|'fail'|'flag'|'not-applicable'} verdict
 * @property {string} reason
 *   Always present. For not-applicable it must distinguish "this product has no forms"
 *   from "the observer could not see the forms".
 * @property {EvidenceRef[]} [evidence]
 * @property {string} [suggestion]
 */

/**
 * @typedef {Object} EvidenceRef
 * @property {string} locator          CSS selector, or a tree path for Qt.
 * @property {Rect} [bounds]
 * @property {string} [screenshot]     Path to a cropped image.
 * @property {string} [detail]
 */

/** Computed styles the web observer collects. Keep tight — bundles get large fast. */
export const COLLECTED_STYLES = [
  'display', 'visibility', 'opacity', 'position', 'pointer-events',
  'color', 'background-color', 'border-color',
  'font-size', 'font-weight', 'line-height',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border-radius', 'box-shadow', 'outline', 'outline-offset',
  'animation-name', 'animation-duration', 'transition-duration', 'transform',
];

export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
};
