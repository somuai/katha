import React from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";

const uuid = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const identifier = new RegExp("^" + uuid + "$", "i");
type Node = { type: string; value?: string; url?: string; children?: Node[] };

/** Presentation only. The host checks the turn's retained references before inspection. */
export function AnswerText({
  text,
  onSource,
}: {
  text: string;
  onSource: (id: string) => void;
}) {
  const positions = new Map<string, number>();
  const position = (id: string) => {
    if (!positions.has(id)) positions.set(id, positions.size + 1);
    return positions.get(id)!;
  };
  const references = () => (tree: Node) => {
    const visit = (node: Node) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child): Node[] => {
        if (child.type === "link" && child.url?.startsWith("katha-source:")) {
          const id = child.url.slice("katha-source:".length);
          if (identifier.test(id))
            child.children = [{ type: "text", value: String(position(id)) }];
          return [child];
        }
        if (child.type !== "text") {
          visit(child);
          return [child];
        }
        const value = child.value || "";
        const markers = new RegExp(
          "\\[(?:source[: ]*\\s*)?" + uuid + "(?:\\s*,\\s*" + uuid + ")*\\]",
          "gi",
        );
        const parts: Node[] = [];
        let end = 0;
        for (const match of value.matchAll(markers)) {
          if (match.index! > end)
            parts.push({ type: "text", value: value.slice(end, match.index) });
          for (const id of match[0].match(new RegExp(uuid, "gi")) || [])
            parts.push({
              type: "link",
              url: "katha-source:" + id,
              children: [{ type: "text", value: String(position(id)) }],
            });
          end = match.index! + match[0].length;
        }
        if (!end) return [child];
        if (end < value.length)
          parts.push({ type: "text", value: value.slice(end) });
        return parts;
      });
    };
    visit(tree);
  };
  return (
    <Markdown
      remarkPlugins={[references]}
      urlTransform={(url) =>
        url.startsWith("katha-source:") && identifier.test(url.slice(13))
          ? url
          : defaultUrlTransform(url)
      }
      components={{
        a({ href, children }) {
          const id = href?.startsWith("katha-source:") ? href.slice(13) : "";
          return identifier.test(id) ? (
            <button
              type="button"
              className="inline-citation"
              aria-label={"View source " + position(id)}
              onClick={() => onSource(id)}
            >
              {position(id)}
            </button>
          ) : (
            <a href={href}>{children}</a>
          );
        },
      }}
    >
      {text}
    </Markdown>
  );
}
