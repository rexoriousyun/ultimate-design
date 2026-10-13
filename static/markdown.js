// A small Markdown subset for agent replies in the chat: paragraphs, "-"/"*" and "1."
// lists, **bold**, *italic*, `code`. Headings become bold paragraphs, so a reply can't
// break the page's heading outline. Builds DOM nodes and never parses HTML, so text from
// the model cannot inject markup.
function renderMarkdown(source) {
  const fragment = document.createDocumentFragment();
  const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/;

  function inline(parent, text) {
    for (const part of text.split(INLINE)) {
      if (!part) continue;
      let node;
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        node = document.createElement("strong");
        node.textContent = part.slice(2, -2);
      } else if (/^`[^`]+`$/.test(part)) {
        node = document.createElement("code");
        node.textContent = part.slice(1, -1);
      } else if (/^(\*[^*\s][^*]*\*|_[^_\s][^_]*_)$/.test(part)) {
        node = document.createElement("em");
        node.textContent = part.slice(1, -1);
      } else {
        node = document.createTextNode(part);
      }
      parent.append(node);
    }
  }

  let list = null;
  let paragraph = null;
  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (bullet || numbered) {
      const tag = bullet ? "UL" : "OL";
      if (!list || list.tagName !== tag) {
        list = document.createElement(tag.toLowerCase());
        fragment.append(list);
      }
      const li = document.createElement("li");
      inline(li, (bullet || numbered)[1]);
      list.append(li);
      paragraph = null;
    } else if (!line.trim()) {
      list = null;
      paragraph = null;
    } else if (heading) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      inline(strong, heading[1]);
      p.append(strong);
      fragment.append(p);
      list = null;
      paragraph = null;
    } else if (paragraph) {
      paragraph.append(document.createElement("br"));
      inline(paragraph, line);
    } else {
      list = null;
      paragraph = document.createElement("p");
      inline(paragraph, line);
      fragment.append(paragraph);
    }
  }
  return fragment;
}
