import { crc32, deflateRawSync } from "node:zlib";

export interface ZipFile {
  path: string;
  data: string | Buffer;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(0, Math.min(127, date.getFullYear() - 1980));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return { time, date: (year << 9) | (month << 5) | day };
}

/** Deflate a set of files into a ZIP archive (UTF-8 names, no encryption). */
export function buildZip(files: ZipFile[], when = new Date()): Buffer {
  const dos = dosDateTime(when);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const path = file.path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!path || path.split("/").some((part) => part === ".." || part === ".")) {
      throw new Error(`Unsafe zip path: ${file.path}`);
    }
    const name = Buffer.from(path, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const checksum = crc32(data) >>> 0;
    let method = 0;
    let payload = data;
    if (data.length > 32) {
      const deflated = deflateRawSync(data, { level: 6 });
      if (deflated.length < data.length) {
        method = 8;
        payload = deflated;
      }
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dos.time, 10);
    local.writeUInt16LE(dos.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dos.time, 12);
    central.writeUInt16LE(dos.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, Buffer.from(name));
    offset += local.length + name.length + payload.length;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}
