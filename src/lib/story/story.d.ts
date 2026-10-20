export function beatsDue(script: unknown, state: unknown): string[];
export function createStory(o: { host?: HTMLElement; script: unknown; portrait: (who: string, ex: string) => string; sfx?: (n: string) => void; onEvent?: (e: string) => void; T?: (s: string) => string }): { play(id: string, vars?: Record<string, string>): Promise<{ skipped: boolean; set: Record<string, unknown> }> };
