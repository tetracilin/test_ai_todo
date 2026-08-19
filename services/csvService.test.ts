import { describe, expect, it } from 'vitest';
import { toCSV, fromCSV } from './csvService';

describe('toCSV', () => {
  it('serializes rows in header order', () => {
    const csv = toCSV(
      [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ],
      ['id', 'name'],
    );
    expect(csv).toBe('id,name\n"1","Alice"\n"2","Bob"');
  });

  it('escapes embedded quotes and stringifies objects/arrays', () => {
    const csv = toCSV(
      [{ note: 'she said "hi"', tags: ['a', 'b'] }],
      ['note', 'tags'],
    );
    expect(csv).toBe('note,tags\n"she said ""hi""","[""a"",""b""]"');
  });

  it('renders null/undefined fields as an empty quoted string', () => {
    const csv = toCSV([{ id: '1', name: undefined }], ['id', 'name']);
    expect(csv).toBe('id,name\n"1",""');
  });
});

describe('fromCSV', () => {
  const headers = ['id', 'name', 'active'] as const;

  it('round-trips simple rows and coerces booleans/numbers', () => {
    const csv = 'id,name,active\n"1","Alice","true"\n"2","5","false"';
    const rows = fromCSV(csv, headers);
    expect(rows).toEqual([
      { id: 1, name: 'Alice', active: true },
      { id: 2, name: 5, active: false },
    ]);
  });

  it('returns an error object when headers do not match', () => {
    const result = fromCSV('id,wrong\n"1","x"', headers);
    expect(result).toEqual({ error: expect.stringContaining('Invalid headers') });
  });

  it('skips malformed rows with a mismatched column count', () => {
    const csv = 'id,name,active\n"1","Alice","true"\n"2","only-two"';
    const rows = fromCSV(csv, headers);
    expect(rows).toEqual([{ id: 1, name: 'Alice', active: true }]);
  });

  it('parses embedded JSON objects/arrays back into values', () => {
    const csv = 'id,name,active\n"1","[""a"",""b""]","true"';
    const rows = fromCSV(csv, headers) as any[];
    expect(rows[0].name).toEqual(['a', 'b']);
  });
});
