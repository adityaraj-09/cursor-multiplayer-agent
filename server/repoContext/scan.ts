import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative, sep } from "path";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import type {
  RepoMapEdge,
  RepoMapGraph,
  RepoMapNode,
} from "../../shared/roomContext.js";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "__pycache__",
  "venv",
  ".venv",
  ".dual-graph",
  ".idea",
  ".vscode",
  "pnpm-store",
]);

const SCAN_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".md",
  ".json",
  ".yml",
  ".yaml",
]);

const SYMBOL_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);
const MAX_FILE_BYTES = 300_000;
const MAX_FILES = 2_500;

export interface LanguageAdapter {
  exts: string[];
  extractSymbols(content: string, filePath: string): ExtractedSymbol[];
}

export interface ExtractedSymbol {
  name: string;
  symbolType: string;
  lineStart: number;
  lineEnd: number;
  exported: boolean;
  keywords: string[];
}

export interface ScanResult {
  graph: RepoMapGraph;
  repoKey: string;
  gitSha: string | null;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
}

function splitCamel(name: string): string[] {
  const parts = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return parts.split(/\s+/).filter((p) => p.length >= 3).map((p) => p.toLowerCase());
}

function nameKeywords(name: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const add = (w: string) => {
    const t = w.toLowerCase().replace(/^_+|_+$/g, "");
    if (t.length >= 3 && !seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  };
  add(name);
  for (const p of splitCamel(name)) add(p);
  for (const p of name.split(/[_./-]+/)) add(p);
  return tokens.slice(0, 10);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length - 1;
}

function findBlockEndTs(lines: string[], start: number): number {
  let depth = 0;
  let foundOpen = false;
  const limit = Math.min(start + 400, lines.length);
  for (let i = start; i < limit; i++) {
    const line = lines[i];
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    depth += opens - closes;
    if (opens > 0) foundOpen = true;
    if (foundOpen && depth <= 0) return i;
  }
  return Math.min(start + 80, lines.length - 1);
}

function findBlockEndPy(lines: string[], start: number): number {
  const base = lines[start].length - lines[start].trimStart().length;
  let last = start;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= base && /^(?:async\s+)?def\s+|class\s+|@/.test(line.trim())) {
      return last;
    }
    last = i;
  }
  return last;
}

function classifyTs(name: string, exported: boolean): { type: string; exported: boolean } {
  if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name)) {
    return { type: "api_route", exported: true };
  }
  if (name.startsWith("use") && name.length > 3 && name[3] === name[3].toUpperCase()) {
    return { type: "hook", exported };
  }
  if (exported) return { type: "use_case", exported };
  return { type: "utility", exported };
}

export const tsAdapter: LanguageAdapter = {
  exts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  extractSymbols(content, filePath) {
    const lines = content.split("\n");
    const symbols: ExtractedSymbol[] = [];
    const seen = new Set<string>();
    const add = (
      name: string,
      index: number,
      type: string,
      exported: boolean,
    ) => {
      if (!name || seen.has(name)) return;
      seen.add(name);
      const start = lineOf(content, index);
      symbols.push({
        name,
        symbolType: type,
        lineStart: start,
        lineEnd: findBlockEndTs(lines, start),
        exported,
        keywords: nameKeywords(name),
      });
    };

    for (const m of content.matchAll(
      /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*[\(<]/gm,
    )) {
      add(m[1], m.index ?? 0, "api_route", true);
    }
    for (const m of content.matchAll(
      /^(export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)\s*[\(<]/gm,
    )) {
      const name = m[2];
      if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name)) continue;
      const { type, exported } = classifyTs(name, Boolean(m[1]));
      add(name, m.index ?? 0, type, exported);
    }
    for (const m of content.matchAll(
      /^export\s+(?:const|let)\s+([A-Za-z_]\w*)\s*=/gm,
    )) {
      const { type } = classifyTs(m[1], true);
      add(m[1], m.index ?? 0, type, true);
    }
    for (const m of content.matchAll(
      /^(export\s+)?(?:interface|type|class|enum)\s+([A-Za-z_]\w*)/gm,
    )) {
      add(m[2], m.index ?? 0, "model", Boolean(m[1]));
    }
    void filePath;
    return symbols;
  },
};

export const pyAdapter: LanguageAdapter = {
  exts: [".py"],
  extractSymbols(content) {
    const lines = content.split("\n");
    const symbols: ExtractedSymbol[] = [];
    const seen = new Set<string>();
    const routeLines = new Set<number>();
    for (const m of content.matchAll(
      /@(?:app|router|blueprint)\.(?:get|post|put|delete|patch)\s*\(/gim,
    )) {
      routeLines.add(lineOf(content, m.index ?? 0));
    }
    for (const m of content.matchAll(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm)) {
      const name = m[1];
      if (name.startsWith("_") || name.startsWith("test_")) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      const start = lineOf(content, m.index ?? 0);
      const isRoute = [...routeLines].some((dl) => Math.abs(dl - start) <= 3);
      symbols.push({
        name,
        symbolType: isRoute ? "api_route" : "use_case",
        lineStart: start,
        lineEnd: findBlockEndPy(lines, start),
        exported: !name.startsWith("_"),
        keywords: nameKeywords(name),
      });
    }
    for (const m of content.matchAll(/^class\s+([A-Za-z_]\w*)/gm)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const start = lineOf(content, m.index ?? 0);
      symbols.push({
        name: m[1],
        symbolType: "model",
        lineStart: start,
        lineEnd: findBlockEndPy(lines, start),
        exported: true,
        keywords: nameKeywords(m[1]),
      });
    }
    return symbols;
  },
};

export const LANGUAGE_ADAPTERS: LanguageAdapter[] = [tsAdapter, pyAdapter];

function adapterFor(ext: string): LanguageAdapter | undefined {
  return LANGUAGE_ADAPTERS.find((a) => a.exts.includes(ext));
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length && files.length < MAX_FILES) {
    const dir = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (files.length >= MAX_FILES) break;
      if (name.startsWith(".") && name !== ".env.example") {
        if (SKIP_DIRS.has(name)) continue;
        if (name !== ".github") continue;
      }
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      const ext = extname(name).toLowerCase();
      if (!SCAN_EXTS.has(ext)) continue;
      files.push(full);
    }
  }
  return files;
}

function extractKeywords(content: string, ext: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const add = (w: string) => {
    const t = w.toLowerCase().replace(/^_+|_+$/g, "");
    if (t.length >= 3 && !seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  };
  const addName = (name: string) => {
    add(name);
    for (const p of splitCamel(name)) add(p);
  };
  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
    for (const m of content.matchAll(
      /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|type|interface|enum)\s+([A-Za-z_]\w*)/g,
    )) {
      addName(m[1]);
    }
  }
  if (ext === ".py") {
    for (const m of content.matchAll(
      /^(?:async\s+)?def\s+([A-Za-z_]\w*)|^class\s+([A-Za-z_]\w*)/gm,
    )) {
      const name = m[1] || m[2];
      if (name && !name.startsWith("_")) addName(name);
    }
  }
  if (ext === ".go") {
    for (const m of content.matchAll(/^func\s+(?:\([^)]+\)\s+)?([A-Z]\w*)/gm)) {
      addName(m[1]);
    }
  }
  return tokens.slice(0, 80);
}

function parseRelations(relPath: string, text: string): RepoMapEdge[] {
  const edges: RepoMapEdge[] = [];
  for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    edges.push({ from: relPath, to: m[1], rel: "imports" });
  }
  for (const m of text.matchAll(/import\s+['"]([^'"]+)['"]/g)) {
    edges.push({ from: relPath, to: m[1], rel: "imports" });
  }
  for (const m of text.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
    edges.push({ from: relPath, to: m[1], rel: "requires" });
  }
  for (const m of text.matchAll(/^\s*from\s+([a-zA-Z0-9_\.]+)\s+import\s+/gm)) {
    edges.push({ from: relPath, to: m[1], rel: "imports" });
  }
  return edges;
}

function posixRel(root: string, full: string): string {
  return relative(root, full).split(sep).join("/");
}

export function readGitSha(root: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function repoKeyFor(root: string, repoUrl?: string | null): string {
  const url = repoUrl?.trim();
  if (url) return url.replace(/\.git$/i, "").replace(/\/+$/, "");
  return root;
}

export function scanRepository(
  root: string,
  opts?: { repoUrl?: string | null },
): ScanResult {
  if (!existsSync(root)) {
    throw new Error(`Repository path does not exist: ${root}`);
  }
  const files = walkFiles(root);
  const nodes: RepoMapNode[] = [];
  const edges: RepoMapEdge[] = [];
  const seenNodeIds = new Set<string>();

  for (const full of files) {
    let content: string;
    try {
      content = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const relPath = posixRel(root, full);
    if (seenNodeIds.has(relPath)) continue;
    seenNodeIds.add(relPath);
    const ext = extname(full).toLowerCase();
    nodes.push({
      id: relPath,
      kind: "file",
      path: relPath,
      ext,
      keywords: extractKeywords(content, ext),
    });
    edges.push(...parseRelations(relPath, content));
    const adapter = adapterFor(ext);
    if (adapter && SYMBOL_EXTS.has(ext)) {
      for (const s of adapter.extractSymbols(content, relPath)) {
        const id = `${relPath}::${s.name}`;
        if (seenNodeIds.has(id)) continue;
        seenNodeIds.add(id);
        nodes.push({
          id,
          kind: "symbol",
          path: relPath,
          ext,
          keywords: s.keywords,
          name: s.name,
          symbolType: s.symbolType,
          lineStart: s.lineStart,
          lineEnd: s.lineEnd,
          exported: s.exported,
        });
        edges.push({ from: relPath, to: id, rel: "contains" });
      }
    }
  }

  const seen = new Set<string>();
  const uniqueEdges: RepoMapEdge[] = [];
  for (const e of edges) {
    const key = `${e.from}|${e.to}|${e.rel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueEdges.push(e);
  }

  const symbolCount = nodes.filter((n) => n.kind === "symbol").length;
  return {
    graph: { nodes, edges: uniqueEdges },
    repoKey: repoKeyFor(root, opts?.repoUrl),
    gitSha: readGitSha(root),
    fileCount: nodes.length - symbolCount,
    symbolCount,
    edgeCount: uniqueEdges.length,
  };
}

export function graphFingerprint(graph: RepoMapGraph): string {
  const h = createHash("sha1");
  h.update(JSON.stringify({ n: graph.nodes.length, e: graph.edges.length }));
  return h.digest("hex").slice(0, 12);
}
