import { canonicalize, jsonSchema, type Json } from '@tracekit/protocol';
export type Redaction = {
  keys?: string[];
  patterns?: RegExp[];
  custom?: (value: unknown) => unknown;
};
const denied = [
  'authorization',
  'cookie',
  'setcookie',
  'token',
  'apikey',
  'secret',
  'password',
  'privatekey',
  'accesskey',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'clientsecret',
];
const normalized = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
export function createSanitizer(rules: Redaction = {}) {
  const keys = new Set([...denied, ...(rules.keys ?? []).map(normalized)]);
  function scrub(s: string): string {
    let result = s
      .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
      .replace(
        /\b(password|token|api[_-]?key|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
        '$1=[REDACTED]',
      );
    for (const pattern of rules.patterns ?? [])
      result = result.replace(
        new RegExp(
          pattern.source,
          pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g',
        ),
        '[REDACTED]',
      );
    return result;
  }
  function serialize(value: unknown, strict = false): Json {
    const seen = new WeakSet<object>();
    function walk(v: unknown, depth: number): Json {
      if (depth > 8) {
        if (strict) throw new Error('Replay value exceeds maximum depth');
        return '[Depth limit]';
      }
      if (v === null || typeof v === 'boolean') return v;
      if (typeof v === 'string') {
        const s = scrub(v);
        if (strict && s.length > 32768) throw new Error('Replay string exceeds limit');
        return s.slice(0, 32768);
      }
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v !== 'object') {
        if (strict) throw new Error('Replay requires JSON values');
        return typeof v === 'bigint' ? v.toString() : `[${typeof v}]`;
      }
      if (seen.has(v!)) {
        if (strict) throw new Error('Replay requires acyclic JSON');
        return '[Circular]';
      }
      if (
        strict &&
        !Array.isArray(v) &&
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null
      )
        throw new Error('Replay requires plain JSON objects');
      seen.add(v!);
      try {
        if (v instanceof Date) return v.toISOString();
        if (v instanceof Error) return { type: scrub(v.name), message: scrub(v.message) };
        if (ArrayBuffer.isView(v)) return '[Binary]';
        if (Array.isArray(v)) {
          if (strict && v.length > 1024) throw new Error('Replay array exceeds limit');
          return Array.from({ length: Math.min(v.length, 1024) }, (_, i) => walk(v[i], depth + 1));
        }
        const descriptors = Object.entries(Object.getOwnPropertyDescriptors(v));
        if (strict && (Object.getOwnPropertySymbols(v!).length > 0 || descriptors.length > 128))
          throw new Error('Replay object exceeds limits');
        return Object.fromEntries(
          descriptors.slice(0, 128).map(([k, d]) => {
            if (strict && k.length > 200) throw new Error('Replay key exceeds limit');
            const key = scrub(k).slice(0, 200);
            if (keys.has(normalized(k))) return [key, '[REDACTED]'];
            if (!('value' in d)) {
              if (strict) throw new Error('Replay cannot capture accessors');
              return [key, '[Accessor]'];
            }
            return [key, walk(d.value, depth + 1)];
          }),
        );
      } finally {
        seen.delete(v!);
      }
    }
    let result = walk(value, 0);
    if (rules.custom) result = walk(rules.custom(result), 0);
    jsonSchema.parse(result);
    if (strict && Buffer.byteLength(canonicalize(result)) > 262144)
      throw new Error('Replay value exceeds 256 KiB');
    return result;
  }
  return {
    serialize,
    scrub,
    preview(value: unknown): { value: Json; truncated: boolean } {
      const result = serialize(value);
      const encoded = JSON.stringify(result);
      if (Buffer.byteLength(encoded) > 12000)
        return { value: '[Payload exceeds preview limit]', truncated: true };
      return { value: result, truncated: false };
    },
  };
}
