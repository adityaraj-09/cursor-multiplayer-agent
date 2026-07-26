"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  p: ({ children }) => (
    <p className="mb-2.5 last:mb-0 leading-relaxed">{children}</p>
  ),
  h1: ({ children }) => (
    <h1 className="text-[16px] font-semibold mt-3 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[15px] font-semibold mt-3 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[14px] font-semibold mt-2.5 mb-1.5 first:mt-0">
      {children}
    </h3>
  ),
  ul: ({ children }) => (
    <ul className="mb-2.5 last:mb-0 pl-5 list-disc space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2.5 last:mb-0 pl-5 list-decimal space-y-1">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[#4d9fff] underline underline-offset-2 hover:opacity-90"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[#f0f0f0]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-[#d4d4d4]">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="mb-2.5 last:mb-0 border-l-2 border-[#3c3c3c] pl-3 text-[#a0a0a0]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-[#2b2b2b]" />,
  code: ({ className, children }) => {
    const isBlock = Boolean(className?.includes("language-"));
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="px-1 py-0.5 rounded bg-[#252525] border border-[#2b2b2b] text-[12px] font-mono text-[#e8c07a]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-2.5 last:mb-0 overflow-x-auto rounded-md bg-[#121212] border border-[#2b2b2b] px-3 py-2.5 text-[12px] font-mono leading-relaxed text-[#d4d4d4]">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-2.5 last:mb-0 overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[#2b2b2b] bg-[#252525] px-2 py-1.5 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[#2b2b2b] px-2 py-1.5 align-top">{children}</td>
  ),
};

export default function Markdown({ content }: { content: string }) {
  if (!content.trim()) return null;
  return (
    <div className="markdown-body text-[13px] text-[#e4e4e4] break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
