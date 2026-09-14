import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ConsigliereKind = 'due' | 'overdue';

export type PushPolicy = {
  consigliere: {
    enabled: boolean;
    kinds: ConsigliereKind[];
    restore_silent: boolean;
  };
  bots: {
    enabled: boolean;
    grace_min: number;
    mute: string[];
  };
  mazda: {
    enabled: boolean;
  };
};

function policyPath(): string {
  return process.env.STICKY_PUSH_POLICY
    || path.join(os.homedir(), '.cloudcli', 'push-policy.json');
}

const DEFAULT_POLICY: PushPolicy = {
  consigliere: { enabled: true, kinds: ['due', 'overdue'], restore_silent: true },
  bots: { enabled: true, grace_min: 5, mute: [] },
  mazda: { enabled: false },
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function asKinds(value: unknown): ConsigliereKind[] {
  const allowed = new Set<ConsigliereKind>(['due', 'overdue']);
  const raw = asStringArray(value).filter((item): item is ConsigliereKind => allowed.has(item as ConsigliereKind));
  return raw.length ? raw : [...DEFAULT_POLICY.consigliere.kinds];
}

export function normalizePushPolicy(raw: unknown): PushPolicy {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const consigliere = source.consigliere && typeof source.consigliere === 'object' ? source.consigliere : {};
  const bots = source.bots && typeof source.bots === 'object' ? source.bots : {};
  const mazda = source.mazda && typeof source.mazda === 'object' ? source.mazda : {};
  const grace = Number(bots.grace_min);
  return {
    consigliere: {
      enabled: consigliere.enabled !== false,
      kinds: asKinds(consigliere.kinds),
      restore_silent: consigliere.restore_silent !== false,
    },
    bots: {
      enabled: bots.enabled !== false,
      grace_min: Number.isFinite(grace) ? Math.min(Math.max(grace, 1), 180) : DEFAULT_POLICY.bots.grace_min,
      mute: asStringArray(bots.mute),
    },
    mazda: {
      enabled: mazda.enabled === true,
    },
  };
}

export function getPolicyPath(): string {
  return policyPath();
}

export function readPushPolicy(): PushPolicy {
  try {
    const parsed = JSON.parse(fs.readFileSync(policyPath(), 'utf8')) as unknown;
    return normalizePushPolicy(parsed);
  } catch {
    return { ...DEFAULT_POLICY, consigliere: { ...DEFAULT_POLICY.consigliere, kinds: [...DEFAULT_POLICY.consigliere.kinds] }, bots: { ...DEFAULT_POLICY.bots, mute: [] } };
  }
}

export function ensurePushPolicyFile(): PushPolicy {
  const policy = readPushPolicy();
  try {
    if (!fs.existsSync(policyPath())) {
      fs.mkdirSync(path.dirname(policyPath()), { recursive: true });
      fs.writeFileSync(policyPath(), `${JSON.stringify(policy, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    }
  } catch {
    // Policy still works from defaults in memory.
  }
  return policy;
}
