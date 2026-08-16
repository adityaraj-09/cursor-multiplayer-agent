import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { looksLikePlan, planImplementPrompt } from "../shared/plans.js";
import {
  guessMime,
  isAllowedUpload,
  saveUpload,
  getUpload,
  toAttachment,
  buildAttachmentPromptSuffix,
  materializeUploadsForAgent,
} from "../server/uploads.js";

describe("looksLikePlan", () => {
  it("rejects short or empty replies", () => {
    expect(looksLikePlan("")).toBe(false);
    expect(looksLikePlan("Here is a plan")).toBe(false);
  });

  it("accepts markdown headings", () => {
    const plan = [
      "# Implementation plan",
      "",
      "1. Update the chat composer",
      "2. Persist attachments on the server",
      "3. Show an approve button when the plan is ready",
    ].join("\n");
    expect(looksLikePlan(plan)).toBe(true);
  });

  it("accepts longer prose that mentions implementation", () => {
    const plan =
      "I would take this approach: first inspect the chat input, then add file uploads, then wire an approve action so the room can start implementation.";
    expect(looksLikePlan(plan)).toBe(true);
  });

  it("accepts long replies without keywords", () => {
    expect(looksLikePlan("x".repeat(240))).toBe(true);
    expect(looksLikePlan("x".repeat(200))).toBe(false);
  });
});

describe("planImplementPrompt", () => {
  it("asks the agent to implement the approved plan", () => {
    const prompt = planImplementPrompt("## Steps\n- do the thing");
    expect(prompt).toContain("approved by the room");
    expect(prompt).toContain("## Steps");
    expect(prompt).toContain("implement it now");
  });
});

describe("upload helpers", () => {
  let dir: string;
  const prev = process.env.UPLOAD_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "steer-uploads-"));
    process.env.UPLOAD_DIR = dir;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("guesses mime and allows images plus common docs", () => {
    expect(guessMime("shot.png")).toBe("image/png");
    expect(guessMime("notes.md")).toBe("text/markdown");
    expect(isAllowedUpload("image/jpeg", "a.jpg")).toBe(true);
    expect(isAllowedUpload("application/zip", "a.zip")).toBe(false);
  });

  it("stores files temporarily and resolves them by id", () => {
    const rec = saveUpload({
      roomId: "room_1",
      name: "notes.txt",
      mime: "text/plain",
      data: Buffer.from("hello steer"),
    });
    expect(rec.id.startsWith("upl_")).toBe(true);
    expect(existsSync(rec.path)).toBe(true);
    const loaded = getUpload("room_1", rec.id);
    expect(loaded?.name).toBe("notes.txt");
    expect(readFileSync(loaded!.path, "utf8")).toBe("hello steer");
    const att = toAttachment(loaded!);
    expect(att.url).toBe(`/api/rooms/room_1/uploads/${rec.id}`);
  });

  it("rejects empty and unsupported files", () => {
    expect(() =>
      saveUpload({
        roomId: "room_1",
        name: "empty.txt",
        data: Buffer.from(""),
      }),
    ).toThrow(/empty/i);
    expect(() =>
      saveUpload({
        roomId: "room_1",
        name: "payload.exe",
        mime: "application/x-msdownload",
        data: Buffer.from("mz"),
      }),
    ).toThrow(/unsupported/i);
  });

  it("materializes uploads into the agent workspace and inlines text", () => {
    const rec = saveUpload({
      roomId: "room_1",
      name: "brief.md",
      mime: "text/markdown",
      data: Buffer.from("# Brief\nDo the work"),
    });
    const cwd = mkdtempSync(join(tmpdir(), "steer-cwd-"));
    const materialized = materializeUploadsForAgent(cwd, [rec]);
    expect(materialized).toHaveLength(1);
    expect(existsSync(materialized[0].agentPath)).toBe(true);
    const suffix = buildAttachmentPromptSuffix([rec], materialized);
    expect(suffix).toContain("brief.md");
    expect(suffix).toContain("# Brief");
    rmSync(cwd, { recursive: true, force: true });
  });
});
