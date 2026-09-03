/** Renders an assistant reply from the block tree `parseMarkdown` builds. */

import { useMemo, type ReactNode } from "react";
import { parseMarkdown, type InlineNode } from "../../app/chatMarkdown";

function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;
    }
  });
}

export function ChatMarkdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="chat-markdown">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "paragraph":
            return <p key={index}>{renderInline(block.children)}</p>;
          case "heading": {
            // Replies sit inside a view that already has h2/h3 headings, so
            // a reply's own heading levels are offset to stay below them.
            const level = Math.min(block.level + 3, 6);
            const Tag = `h${level}` as "h4" | "h5" | "h6";
            return <Tag key={index}>{renderInline(block.children)}</Tag>;
          }
          case "code":
            return (
              <pre key={index} data-language={block.language || undefined}>
                <code>{block.text}</code>
              </pre>
            );
          case "list": {
            const items = block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ));
            return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
          }
        }
      })}
    </div>
  );
}
