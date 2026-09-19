"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { isArtifactPath } from "../../shared/agentArtifacts";
import { splitMediaHtml } from "../../shared/markdownMedia";
import { fetchRoomUploadBlob } from "../lib/api";

const ROOM_UPLOAD_RE =
  /^\/api\/rooms\/([^/]+)\/uploads\/([^/?#]+)\/?$/i;

function parseRoomUpload(src: string): { roomId: string; fileId: string } | null {
  try {
    const path = src.startsWith("http") ? new URL(src).pathname : src;
    const m = path.match(ROOM_UPLOAD_RE);
    if (!m) return null;
    return { roomId: m[1], fileId: m[2] };
  } catch {
    return null;
  }
}

function AuthMedia({
  src,
  roomId,
  kind,
  alt,
  pendingArtifacts,
}: {
  src: string;
  roomId?: string;
  kind: "img" | "video";
  alt?: string;
  /** True while the agent may still rewrite /opt/cursor/artifacts paths. */
  pendingArtifacts?: boolean;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const upload = parseRoomUpload(src);
  const effectiveRoomId = upload?.roomId || roomId;
  const pendingArtifact = !upload && isArtifactPath(src);

  useEffect(() => {
    if (!upload || !effectiveRoomId) {
      setBlobUrl(null);
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    setFailed(false);
    void fetchRoomUploadBlob(effectiveRoomId, upload.fileId)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!revoked) setFailed(true);
      });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [upload?.fileId, upload?.roomId, effectiveRoomId, src]);

  if (pendingArtifact) {
    if (pendingArtifacts) {
      return (
        <span className="block my-2 text-[11px] text-[#6e6e6e]">
          Loading {kind === "video" ? "video" : "image"}…
        </span>
      );
    }
    return (
      <span className="block my-2 text-[11px] text-[#6e6e6e]">
        {kind === "video" ? "Video" : "Image"} unavailable
      </span>
    );
  }

  const resolved = blobUrl || (!upload ? src : null);

  if (failed || (!resolved && upload)) {
    return (
      <span className="block my-2 text-[11px] text-[#6e6e6e]">
        {kind === "video" ? "Video" : "Image"} unavailable
      </span>
    );
  }
  if (!resolved) {
    return (
      <span className="block my-2 h-24 max-w-md animate-pulse rounded-md bg-[#252525]" />
    );
  }

  if (kind === "video") {
    return (
      <video
        src={resolved}
        controls
        playsInline
        preload="metadata"
        className="my-2 max-h-[420px] w-full max-w-xl rounded-lg border border-[#2b2b2b] bg-black"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolved}
      alt={alt || ""}
      className="my-2 max-h-[420px] w-full max-w-xl rounded-lg border border-[#2b2b2b] object-contain"
    />
  );
}

function buildComponents(
  roomId?: string,
  pendingArtifacts?: boolean,
): Components {
  return {
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
    img: ({ src, alt }) =>
      src ? (
        <AuthMedia
          src={String(src)}
          roomId={roomId}
          kind="img"
          alt={alt || ""}
          pendingArtifacts={pendingArtifacts}
        />
      ) : null,
  };
}

export default function Markdown({
  content,
  roomId,
  pendingArtifacts,
}: {
  content: string;
  roomId?: string;
  pendingArtifacts?: boolean;
}) {
  if (!content.trim()) return null;
  const parts = splitMediaHtml(content);
  const components = buildComponents(roomId, pendingArtifacts);

  return (
    <div className="markdown-body text-[13px] text-[#e4e4e4] break-words">
      {parts.map((part, i) => {
        if (part.kind === "md") {
          if (!part.text.trim()) return null;
          return (
            <ReactMarkdown
              key={`md-${i}`}
              remarkPlugins={[remarkGfm]}
              components={components}
            >
              {part.text}
            </ReactMarkdown>
          );
        }
        if (part.kind === "img") {
          return (
            <AuthMedia
              key={`img-${i}-${part.src}`}
              src={part.src}
              roomId={roomId}
              kind="img"
              alt={part.alt}
              pendingArtifacts={pendingArtifacts}
            />
          );
        }
        return (
          <AuthMedia
            key={`vid-${i}-${part.src}`}
            src={part.src}
            roomId={roomId}
            kind="video"
            pendingArtifacts={pendingArtifacts}
          />
        );
      })}
    </div>
  );
}
