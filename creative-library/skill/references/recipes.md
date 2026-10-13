# Reading a recipe entry

Each shelf line is `` `id` primitive — Label. source-path ``. The primitive (`canvas`, `svg`,
`three`) says what the construction draws into. Open the source file; its header comment
explains the mechanism and which detail carries the effect, and `UI.define()` (web) or the
`RECIPE` dict (Qt) lists its props and defaults.

"Verified" here means `npm run render` ran the recipe's demo in a real browser (or a Qt
window), took a screenshot, and found it painted something. It does not yet mean each
parameter's range has been measured — that is the parameter-map work in `PLAN.md`.

The rule that a page should copy a recipe instead of rebuilding it lives in design-guide as
`prefer-existing-recipe`, and its `recipeReinvention` check enforces it.
