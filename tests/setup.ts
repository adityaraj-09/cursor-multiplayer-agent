import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const dir = mkdtempSync(join(tmpdir(), "steer-vitest-"));
process.env.SQLITE_PATH = join(dir, "test.db");
