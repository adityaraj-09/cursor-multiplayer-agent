export type MediaPart =
  | { kind: "md"; text: string }
  | { kind: "img"; src: string; alt: string }
  | { kind: "video"; src: string };

/** Pull raw HTML <img>/<video> tags out so react-markdown can still render prose. */
export function splitMediaHtml(content: string): MediaPart[] {
  if (!content) return [];
  const parts: MediaPart[] = [];
  const re =
    /<video\b([^>]*)>(?:[\s\S]*?<\/video>)?|<img\b([^>]*)\/?>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      parts.push({ kind: "md", text: content.slice(last, m.index) });
    }
    const attrs = m[1] ?? m[2] ?? "";
    const src = readAttr(attrs, "src");
    if (src) {
      if (m[0].toLowerCase().startsWith("<video")) {
        parts.push({ kind: "video", src });
      } else {
        parts.push({
          kind: "img",
          src,
          alt: readAttr(attrs, "alt") || "",
        });
      }
    } else {
      parts.push({ kind: "md", text: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    parts.push({ kind: "md", text: content.slice(last) });
  }
  return parts.length ? parts : [{ kind: "md", text: content }];
}

function readAttr(attrs: string, name: string): string {
  const re = new RegExp(
    `${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const m = attrs.match(re);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
}
