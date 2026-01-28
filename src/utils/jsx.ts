/**
 * Simple JSX to HTML string utility for SSR.
 */

export function h(tag: string | Function, props: any, ...children: any[]): string {
  if (typeof tag === "function") {
    return tag({ ...props, children: children.flat() });
  }

  const flatChildren = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  const kids = flatChildren.map((c) => (Array.isArray(c) ? c.join("") : String(c))).join("");

  if (!tag) return kids;

  const attributes = props
    ? Object.entries(props)
        .map(([key, value]) => {
          if (key === "children" || value === false || value === null || value === undefined)
            return "";
          if (value === true) return ` ${key}`;
          const val = String(value).replace(/"/g, "&quot;");
          return ` ${key === "className" ? "class" : key}="${val}"`;
        })
        .join("")
    : "";

  const selfClosing = [
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ];
  if (selfClosing.includes(tag.toLowerCase())) {
    return `<${tag}${attributes}>`;
  }

  return `<${tag}${attributes}>${kids}</${tag}>`;
}

export function Fragment({ children }: { children?: any }): string {
  if (!children) return "";
  return Array.isArray(children) ? children.join("") : String(children);
}

export function escapeHtml(str: string): string {
  return str.replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[m] || m,
  );
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}
