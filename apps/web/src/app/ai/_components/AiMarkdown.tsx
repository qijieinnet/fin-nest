import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type AiMarkdownProps = {
  content: string;
};

/** Render model-authored Markdown while keeping raw HTML inert. */
export function AiMarkdown({ content }: AiMarkdownProps) {
  return (
    <div className="ai-markdown">
      <ReactMarkdown
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} rel="noreferrer noopener" target="_blank" />
          ),
        }}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
