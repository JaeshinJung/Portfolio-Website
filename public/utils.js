/* Shared helpers for the public pages. No dependencies, no build step —
   imported directly by the inline <script type="module"> blocks. */

/* Escape a string for interpolation into HTML. Round-trips the text through a
   detached element's textContent, so the browser's own serializer decides what
   needs escaping: &, <, > and the non-breaking space.

   LIMITATION — it does NOT escape " or '. innerHTML only ever emits entities
   for the characters that are ambiguous in *text* position, and quotes are not.
   So this is safe for text nodes and for quoted attribute values it cannot
   reach, but NOT for an unquoted or single-quoted attribute value in a
   template: escapeHtml('a" onerror="x') comes back unchanged and closes the
   attribute early. When a value has to land on an attribute, set it as a DOM
   property instead (el.title = value), which needs no escaping at all —
   index.html does exactly that for the clamped project description. */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
