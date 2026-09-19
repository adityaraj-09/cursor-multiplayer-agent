import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  extractArtifactPaths,
  hasArtifactRefs,
  rewriteArtifactSrcs,
  toRelativeArtifactPath,
  assistantIdsNeedingArtifactHydration,
} from "../shared/agentArtifacts.js";
import { materializeArtifactsInText } from "../server/agentArtifacts.js";
import { getUpload, isAllowedUpload, guessMime } from "../server/uploads.js";
import { splitMediaHtml } from "../shared/markdownMedia.js";

const SAMPLE = `
I built **Viva**.

<video src="/opt/cursor/artifacts/viva_studio_brief_settings_live_debrief.mp4"></video>
<img alt="Viva home" src="/opt/cursor/artifacts/viva_home_recent_sessions.webp" />
<img alt="Settings" src="/opt/cursor/artifacts/viva_settings_modal.webp" />
`;

describe("agent artifact path helpers", () => {
  it("normalizes absolute and relative artifact paths", () => {
    expect(toRelativeArtifactPath("/opt/cursor/artifacts/demo.mp4")).toBe(
      "artifacts/demo.mp4",
    );
    expect(toRelativeArtifactPath("artifacts/shot.webp")).toBe(
      "artifacts/shot.webp",
    );
    expect(toRelativeArtifactPath("./artifacts/shot.webp")).toBe(
      "artifacts/shot.webp",
    );
    expect(toRelativeArtifactPath("/etc/passwd")).toBeNull();
    expect(toRelativeArtifactPath("artifacts/../secret")).toBeNull();
  });

  it("extracts unique paths from HTML media tags", () => {
    expect(hasArtifactRefs(SAMPLE)).toBe(true);
    expect(extractArtifactPaths(SAMPLE)).toEqual([
      "artifacts/viva_studio_brief_settings_live_debrief.mp4",
      "artifacts/viva_home_recent_sessions.webp",
      "artifacts/viva_settings_modal.webp",
    ]);
  });

  it("rewrites absolute srcs to served URLs", () => {
    const map = new Map([
      [
        "artifacts/viva_home_recent_sessions.webp",
        "/api/rooms/r1/uploads/upl_abc",
      ],
    ]);
    const out = rewriteArtifactSrcs(SAMPLE, map);
    expect(out).toContain('src="/api/rooms/r1/uploads/upl_abc"');
    expect(out).not.toContain(
      "/opt/cursor/artifacts/viva_home_recent_sessions.webp",
    );
    expect(out).toContain(
      "/opt/cursor/artifacts/viva_studio_brief_settings_live_debrief.mp4",
    );
  });

  it("finds assistant bubbles that still need artifact hydration after close", () => {
    const ids = assistantIdsNeedingArtifactHydration(
      [
        {
          id: "m1",
          role: "assistant",
          agentId: "ag1",
          content: SAMPLE,
        },
        {
          id: "m2",
          role: "user",
          agentId: "ag1",
          content: SAMPLE,
        },
        {
          id: "m3",
          role: "assistant",
          agentId: "ag2",
          content: SAMPLE,
        },
        {
          id: "m4",
          role: "assistant",
          agentId: "ag1",
          content: "no media here",
        },
        {
          id: "m5",
          role: "assistant",
          agentId: "ag1",
          content: "",
        },
      ],
      "ag1",
    );
    // Simulates post-closeAssistant state: in-memory assistantId is null, but
    // the persisted bubble still has /opt/cursor/artifacts paths.
    expect(ids).toEqual(["m1"]);
  });
});

describe("materializeArtifactsInText", () => {
  let dir: string;
  const prev = process.env.UPLOAD_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "steer-artifacts-"));
    process.env.UPLOAD_DIR = dir;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("downloads artifacts and rewrites message content", async () => {
    const files = new Map<string, Buffer>([
      ["artifacts/viva_studio_brief_settings_live_debrief.mp4", Buffer.from("fake-mp4")],
      ["artifacts/viva_home_recent_sessions.webp", Buffer.from("fake-webp")],
      ["artifacts/viva_settings_modal.webp", Buffer.from("fake-webp-2")],
    ]);

    const result = await materializeArtifactsInText({
      text: SAMPLE,
      roomId: "room_art",
      download: async (path) => {
        const buf = files.get(path);
        if (!buf) throw new Error(`missing ${path}`);
        return buf;
      },
    });

    expect(result.attachments).toHaveLength(3);
    expect(result.text).not.toContain("/opt/cursor/artifacts/");
    expect(result.text).toMatch(/\/api\/rooms\/room_art\/uploads\/upl_/);
    expect(guessMime("clip.mp4")).toBe("video/mp4");
    expect(isAllowedUpload("video/mp4", "clip.mp4")).toBe(true);

    const first = result.uploads[0];
    const loaded = getUpload("room_art", first.id);
    expect(loaded).toBeTruthy();
    expect(readFileSync(loaded!.path)).toEqual(files.get(
      extractArtifactPaths(SAMPLE)[0],
    ));
  });

  it("leaves text alone when download fails", async () => {
    const result = await materializeArtifactsInText({
      text: SAMPLE,
      roomId: "room_fail",
      download: async () => {
        throw new Error("nope");
      },
    });
    expect(result.text).toBe(SAMPLE);
    expect(result.attachments).toHaveLength(0);
  });
});

describe("splitMediaHtml", () => {
  it("parses video and img tags into media parts", () => {
    const parts = splitMediaHtml(SAMPLE);
    expect(parts.some((p) => p.kind === "video")).toBe(true);
    expect(parts.filter((p) => p.kind === "img")).toHaveLength(2);
    expect(parts.some((p) => p.kind === "md" && p.text.includes("Viva"))).toBe(
      true,
    );
  });

  it("keeps plain markdown when there are no media tags", () => {
    expect(splitMediaHtml("hello **world**")).toEqual([
      { kind: "md", text: "hello **world**" },
    ]);
  });
});
