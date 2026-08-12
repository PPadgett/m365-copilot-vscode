import { inflateRawSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

export function readZip(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('VSIX archive must be provided as a Buffer.');
  }

  const endOffset = findEndRecord(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  assert(buffer.readUInt16LE(endOffset + 4) === 0, 'Multi-disk ZIP archives are not supported.');
  assert(buffer.readUInt16LE(endOffset + 6) === 0, 'Multi-disk ZIP archives are not supported.');
  assert(buffer.readUInt16LE(endOffset + 8) === entryCount, 'ZIP entry counts are inconsistent.');
  assert(centralOffset + centralSize <= endOffset, 'ZIP central directory is out of bounds.');

  const result = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert(buffer.readUInt32LE(cursor) === 0x02014b50, 'Invalid ZIP central-directory signature.');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    assert(nameEnd + extraLength + commentLength <= buffer.length, 'ZIP central entry is out of bounds.');
    const name = buffer.subarray(nameStart, nameEnd).toString('utf8');
    validateArchivePath(name);
    assert(!result.has(name), `ZIP contains duplicate path ${name}.`);
    assert((flags & ~0x0800) === 0, `ZIP entry ${name} uses unsupported flags.`);
    assert(method === 0 || method === 8, `ZIP entry ${name} uses unsupported compression.`);

    assert(buffer.readUInt32LE(localOffset) === 0x04034b50, `Invalid local ZIP header for ${name}.`);
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const localName = buffer.subarray(localNameStart, localNameEnd).toString('utf8');
    assert(localName === name, `ZIP local and central names differ for ${name}.`);
    assert(localFlags === flags && localMethod === method, `ZIP headers disagree for ${name}.`);
    assert(
      localCrc === expectedCrc &&
      localCompressedSize === compressedSize &&
      localUncompressedSize === uncompressedSize,
      `ZIP headers disagree on size or CRC for ${name}.`
    );

    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    assert(dataEnd <= centralOffset, `ZIP entry ${name} overlaps the central directory.`);
    const compressed = buffer.subarray(dataStart, dataEnd);
    const data = method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed);
    assert(data.length === uncompressedSize, `ZIP entry ${name} has the wrong uncompressed size.`);
    assert(crc32(data) === expectedCrc, `ZIP entry ${name} failed its CRC check.`);
    result.set(name, data);
    cursor = nameEnd + extraLength + commentLength;
  }
  assert(cursor === centralOffset + centralSize, 'ZIP central-directory size is inconsistent.');
  return result;
}

function findEndRecord(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) {
      continue;
    }
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) {
      return offset;
    }
  }
  throw new Error('ZIP end-of-central-directory record was not found.');
}

function validateArchivePath(path) {
  assert(path.length > 0, 'ZIP entry path must not be empty.');
  assert(!path.includes('\\'), `ZIP entry path must use forward slashes: ${path}`);
  assert(!path.startsWith('/') && !/^[A-Za-z]:/.test(path), `ZIP entry path must be relative: ${path}`);
  assert(!path.split('/').some(part => part === '..' || part === ''), `Unsafe ZIP entry path: ${path}`);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
