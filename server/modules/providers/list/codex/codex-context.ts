import { open } from 'node:fs/promises';

import { readCodexContextBudget } from '@/shared/context-budget.js';

/** Read backwards until the latest occupancy/compaction, without loading chat history. */
export async function readCodexSessionBudget(filePath: string): Promise<Record<string, unknown>> {
  const file = await open(filePath, 'r');
  try {
    let position = (await file.stat()).size;
    let carry = '';
    while (position > 0) {
      const length = Math.min(position, 64 * 1024);
      position -= length;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, position);
      const lines = (buffer.subarray(0, bytesRead).toString('utf8') + carry).split('\n');
      carry = position > 0 ? lines.shift()! : '';
      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const budget = readCodexContextBudget(JSON.parse(lines[index]));
          if (budget) return budget;
        } catch { /* Partial or malformed rows cannot replace a known snapshot. */ }
      }
    }
    return { used: null };
  } finally {
    await file.close();
  }
}
