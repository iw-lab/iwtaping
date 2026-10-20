export interface GrowthStage { id: string; need: number; name: string }
export interface GrowthState { growth?: { xp: number; bond: Record<string, number> }; storySeen?: Record<string, number> }
export function createGrowth(o: { stages: GrowthStage[]; bondSteps?: number[]; unit?: string }): {
  stages: GrowthStage[]; bondSteps: number[];
  stageIdx(xp: number): number; bondLevel(pts: number): number;
  stageOf(s: GrowthState): GrowthStage;
  gain(s: GrowthState, g?: { xp?: number; bond?: Record<string, number> }): Array<{ type: 'stageUp' | 'bondUp'; [k: string]: unknown }>;
  nextGoal(s: GrowthState, label?: string): { text: string; left: number; pct: number; next: GrowthStage } | null;
  flat(s: GrowthState, extra?: Record<string, unknown>): Record<string, unknown>;
};
