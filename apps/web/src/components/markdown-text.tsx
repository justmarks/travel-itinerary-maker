import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Renders user-supplied markdown — used for todo notes. `react-markdown`
 * does not interpret raw HTML by default, which is what we want for safety.
 * `remark-gfm` adds GitHub-flavoured features: bare-URL autolinking, task
 * lists, strikethrough, and tables.
 *
 * Margins on block elements are reset to 0 so a single line of markdown
 * (the common case) doesn't add vertical space the parent wasn't expecting.
 */
export function MarkdownText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </a>
          ),
          p: ({ children }) => <p className="m-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="m-0 list-disc pl-4">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="m-0 list-decimal pl-4">{children}</ol>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
              {children}
            </code>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
