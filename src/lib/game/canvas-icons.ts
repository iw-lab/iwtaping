/**
 * 캔버스(<canvas>) 전용 벡터 아이콘 — <canvas> 는 DOM 트리가 아니라 React/SVG 컴포넌트를
 * 꽂을 수 없어 lucide-react 컴포넌트를 그대로 쓸 수 없다. 대신 같은 라이브러리가 쓰는
 * 24x24 viewBox·stroke 벡터 path 데이터(lucide-react v0.577.0, ISC 라이선스)를 가져와
 * Path2D 로 직접 그린다 — 이모지 글자가 아니라 진짜 벡터 그림이다.
 */

/** path 데이터 배열을 (cx, cy) 중심에 size px 정사각형으로 그린다(선 색 color, 두께 2 — lucide 기본값). */
export function drawVectorIcon(
  ctx: CanvasRenderingContext2D,
  paths: readonly string[],
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of paths) ctx.stroke(new Path2D(d));
  ctx.restore();
}

/** lucide-react `Snowflake` (freeze). */
export const ICON_SNOWFLAKE = [
  'm10 20-1.25-2.5L6 18',
  'M10 4 8.75 6.5 6 6',
  'm14 20 1.25-2.5L18 18',
  'm14 4 1.25 2.5L18 6',
  'm17 21-3-6h-4',
  'm17 3-3 6 1.5 3',
  'M2 12h6.5L10 9',
  'm20 10-1.5 2 1.5 2',
  'M22 12h-6.5L14 15',
  'm4 10 1.5 2L4 14',
  'm7 21 3-6-1.5-3',
  'm7 3 3 6h4',
] as const;

/** lucide-react `Zap` (clear — 전체 제거/정화). */
export const ICON_ZAP = [
  'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
] as const;

/** lucide-react `Heart` (heal — 회복/성 수리). */
export const ICON_HEART = [
  'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5',
] as const;

/** lucide-react `Droplet` (heal — pH 회복, 산성비 전용). */
export const ICON_DROPLET = [
  'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
] as const;
