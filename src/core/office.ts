import type { RedactionEngine } from './types.ts';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return new Uint8Array(data).buffer;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]!) & 0xFF]! ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function bytes(value: string | ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function text(value: Uint8Array): string {
  return new TextDecoder('utf-8').decode(value);
}

function findEocd(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const limit = Math.max(0, data.length - 65557);
  for (let index = data.length - 22; index >= limit; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      return index;
    }
  }
  throw new Error('不是有效的 ZIP 文件');
}

export async function readZip(source: Uint8Array | ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const input = bytes(source);
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const eocd = findEocd(input);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('ZIP 目录损坏');
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder('utf-8').decode(input.slice(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = input.slice(dataStart, dataStart + compressedSize);
    let content: Uint8Array;
    if (method === 0) {
      content = compressed;
    } else if (method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      content = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error(`暂不支持的 ZIP 压缩方法：${method}`);
    }
    entries.set(name, content);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function dosTime(date: Date): { time: number; day: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function uint32Bytes(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xFF,
    (value >> 8) & 0xFF,
    (value >> 16) & 0xFF,
    (value >> 24) & 0xFF
  ]);
}

export function buildZip(inputEntries: ZipEntry[]): Uint8Array {
  const now = dosTime(new Date());
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of inputEntries) {
    const name = new TextEncoder().encode(entry.name);
    const content = bytes(entry.data);
    const crc = crc32(content);
    const local = concatBytes([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00]),
      new Uint8Array([now.time & 0xFF, now.time >> 8, now.day & 0xFF, now.day >> 8]),
      uint32Bytes(crc),
      uint32Bytes(content.length),
      uint32Bytes(content.length),
      new Uint8Array([name.length & 0xFF, name.length >> 8, 0, 0]),
      name,
      content
    ]);
    locals.push(local);
    const central = concatBytes([
      new Uint8Array([0x50, 0x4b, 0x01, 0x02, 0x14, 0x00, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00]),
      new Uint8Array([now.time & 0xFF, now.time >> 8, now.day & 0xFF, now.day >> 8]),
      uint32Bytes(crc),
      uint32Bytes(content.length),
      uint32Bytes(content.length),
      new Uint8Array([name.length & 0xFF, name.length >> 8, 0, 0, 0, 0, 0, 0, 0, 0]),
      new Uint8Array([0, 0, 0, 0]),
      uint32Bytes(offset),
      name
    ]);
    centrals.push(central);
    offset += local.length;
  }
  const centralDirectory = concatBytes(centrals);
  const eocd = concatBytes([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]),
    new Uint8Array([inputEntries.length & 0xFF, inputEntries.length >> 8, inputEntries.length & 0xFF, inputEntries.length >> 8]),
    uint32Bytes(centralDirectory.length),
    uint32Bytes(offset),
    new Uint8Array([0, 0])
  ]);
  return concatBytes([...locals, centralDirectory, eocd]);
}

export function redactXmlText(xml: string, engine: RedactionEngine, tags: string[]): string {
  const tagPattern = tags.join('|');
  const pattern = new RegExp(`(<(?:${tagPattern})(?:\\s[^>]*)?>)([\\s\\S]*?)(</(?:${tagPattern})>)`, 'giu');
  return xml.replace(pattern, (whole, opening: string, content: string, closing: string) => {
    if (!/[A-Za-z0-9\u4e00-\u9fff@]/.test(content)) {
      return whole;
    }
    return opening + engine.redact(content).text + closing;
  });
}

export function redactXlsxNumericCells(xml: string, engine: RedactionEngine): string {
  return xml.replace(/<c((?:\s[^>]*)?)>(<v>([\s\S]*?)<\/v>)<\/c>/giu, (whole, attrs: string, _valueNode: string, value: string) => {
    if (/\st\s*=\s*(?:"s"|'s'|"b"|'b'|"e"|'e')/iu.test(attrs)) {
      return whole;
    }
    const result = engine.redact(value);
    if (!result.hits.length) {
      return whole;
    }
    const nextAttrs = /\st\s*=/iu.test(attrs)
      ? attrs.replace(/\st\s*=\s*(?:"[^"]*"|'[^']*')/iu, ' t="str"')
      : `${attrs} t="str"`;
    return `<c${nextAttrs}><v>${result.text}</v></c>`;
  });
}

async function redactOffice(
  data: Uint8Array,
  engine: RedactionEngine,
  tags: string[],
  postProcess?: (name: string, xml: string) => string
): Promise<Uint8Array> {
  const entries = await readZip(data);
  const output: ZipEntry[] = [];
  for (const [name, content] of entries) {
    let next = content;
    if (/\.xml$|\.rels$/i.test(name)) {
      let xml = redactXmlText(text(content), engine, tags);
      if (postProcess) {
        xml = postProcess(name, xml);
      }
      next = new TextEncoder().encode(xml);
    }
    output.push({ name, data: next });
  }
  return buildZip(output);
}

export function redactDocx(data: Uint8Array, engine: RedactionEngine): Promise<Uint8Array> {
  return redactOffice(data, engine, ['w:t', 'a:t']);
}

export function redactXlsx(data: Uint8Array, engine: RedactionEngine): Promise<Uint8Array> {
  return redactOffice(data, engine, ['w:t', 'a:t', 't'], (name, xml) => {
    return /xl\/worksheets\/.+\.xml$/i.test(name) ? redactXlsxNumericCells(xml, engine) : xml;
  });
}
