/**
 * Shared game rendering utilities - particle systems, backgrounds, effects
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  type: 'circle' | 'spark' | 'ring' | 'star' | 'smoke';
  rotation?: number;
  rotationSpeed?: number;
}

export interface Star {
  x: number;
  y: number;
  z: number; // for parallax depth
  brightness: number;
  size: number;
  twinkleSpeed: number;
}

export interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  color: string;
  life: number;
}

// ===== SPRITE MANAGER =====
// AI-generated sprites/backgrounds live in public/game/**. They load lazily in
// the browser; every draw helper falls back to the procedural art until the
// image is decoded, so the game never blanks out waiting on a texture.
const _sprites: Record<string, HTMLImageElement> = {};
const _spriteReady: Record<string, boolean> = {};

/** Kick off loading a set of {key: url} sprites. Safe to call repeatedly. */
export function preloadSprites(map: Record<string, string>) {
  if (typeof window === 'undefined') return;
  for (const key in map) {
    if (_sprites[key]) continue;
    const img = new Image();
    img.onload = () => { _spriteReady[key] = true; };
    img.onerror = () => { /* keep procedural fallback */ };
    img.src = map[key];
    _sprites[key] = img;
  }
}

/** The decoded image for a key, or null if not ready (→ caller draws fallback). */
export function getSprite(key: string): HTMLImageElement | null {
  return _spriteReady[key] ? _sprites[key] : null;
}

/**
 * Draw a sprite centered at (x,y), fit inside a box. Returns false if the sprite
 * isn't ready yet so the caller can draw the procedural version instead.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  key: string,
  x: number,
  y: number,
  opts: { w?: number; h?: number; flip?: boolean; rotate?: number; alpha?: number } = {}
): boolean {
  const img = getSprite(key);
  if (!img || !img.width) return false;
  const ar = img.width / img.height;
  let w = opts.w, h = opts.h;
  if (w && !h) h = w / ar;
  else if (h && !w) w = h * ar;
  else if (!w && !h) { w = img.width; h = img.height; }
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  ctx.translate(x, y);
  if (opts.rotate) ctx.rotate(opts.rotate);
  if (opts.flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -(w as number) / 2, -(h as number) / 2, w as number, h as number);
  ctx.restore();
  return true;
}

/**
 * 주어진 높이로 그렸을 때 스프라이트가 차지하는 너비. 라벨 배치에서 몸통 상자를
 * 잡을 때 쓴다. 이미지가 아직 안 왔으면 fallback(절차적 그림 기준 너비)을 준다.
 */
export function spriteWidthFor(key: string, h: number, fallback: number): number {
  const img = getSprite(key);
  if (!img || !img.width || !img.height) return fallback;
  return h * (img.width / img.height);
}

/**
 * Cover-fit a full-scene background image + optional darkening overlay for text
 * readability. Returns false if not ready (→ caller draws procedural background).
 */
export function drawBackgroundImage(
  ctx: CanvasRenderingContext2D,
  key: string,
  W: number,
  H: number,
  overlay = 0.28
): boolean {
  const img = getSprite(key);
  if (!img || !img.width) return false;
  const ar = img.width / img.height;
  const sar = W / H;
  let dw = W, dh = H, dx = 0, dy = 0;
  if (ar > sar) { dh = H; dw = H * ar; dx = (W - dw) / 2; }
  else { dw = W; dh = W / ar; dy = (H - dh) / 2; }
  ctx.drawImage(img, dx, dy, dw, dh);
  if (overlay > 0) {
    ctx.fillStyle = `rgba(6,4,20,${overlay})`;
    ctx.fillRect(0, 0, W, H);
  }
  return true;
}

// ===== PARTICLE SYSTEM =====
export class ParticleSystem {
  particles: Particle[] = [];
  debris: Debris[] = [];

  emit(x: number, y: number, count: number, config: Partial<{
    speed: number;
    life: number;
    size: number;
    colors: string[];
    type: Particle['type'];
    spread: number;
    angle: number;
    gravity: number;
  }> = {}) {
    const {
      speed = 3,
      life = 40,
      size = 3,
      colors = ['#FF6B6B', '#FECA57', '#FD79A8', '#00D2D3'],
      type = 'circle',
      spread = Math.PI * 2,
      angle = 0,
    } = config;

    for (let i = 0; i < count; i++) {
      const a = angle - spread / 2 + Math.random() * spread;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        maxLife: life,
        size: size * (0.5 + Math.random() * 0.5),
        color: colors[Math.floor(Math.random() * colors.length)],
        type,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.2,
      });
    }
  }

  explode(x: number, y: number, intensity: number = 1) {
    // Main explosion particles
    this.emit(x, y, Math.floor(20 * intensity), {
      speed: 5 * intensity,
      life: 35,
      size: 4,
      colors: ['#FF6B6B', '#FF9F43', '#FECA57', '#FFF'],
      type: 'circle',
    });
    // Sparks
    this.emit(x, y, Math.floor(12 * intensity), {
      speed: 7 * intensity,
      life: 25,
      size: 2,
      colors: ['#FECA57', '#FFF', '#FF6B6B'],
      type: 'spark',
    });
    // Ring
    this.emit(x, y, 1, {
      speed: 0,
      life: 20,
      size: 30 * intensity,
      colors: ['rgba(255,107,107,0.6)'],
      type: 'ring',
    });
    // Debris
    for (let i = 0; i < Math.floor(6 * intensity); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 4;
      this.debris.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.3,
        size: 2 + Math.random() * 4,
        color: ['#6C5CE7', '#A29BFE', '#DDD'][Math.floor(Math.random() * 3)],
        life: 30 + Math.random() * 20,
      });
    }
  }

  laserHit(x: number, y: number) {
    this.emit(x, y, 8, {
      speed: 3,
      life: 15,
      size: 2,
      colors: ['#00D2D3', '#48DBFB', '#FFF'],
      type: 'spark',
      spread: Math.PI,
    });
  }

  update() {
    this.particles = this.particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.life--;
      if (p.rotation !== undefined && p.rotationSpeed !== undefined) {
        p.rotation += p.rotationSpeed;
      }
      return p.life > 0;
    });

    this.debris = this.debris.filter(d => {
      d.x += d.vx;
      d.y += d.vy;
      d.vy += 0.05; // gravity
      d.rotation += d.rotationSpeed;
      d.life--;
      return d.life > 0;
    });
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;

      if (p.type === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      } else if (p.type === 'spark') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation || 0);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size * 2, -0.5, p.size * 4, 1);
        ctx.fillRect(-0.5, -p.size * 2, 1, p.size * 4);
      } else if (p.type === 'ring') {
        const ringSize = p.size * (1 - alpha) * 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, ringSize, 0, Math.PI * 2);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2 * alpha;
        ctx.stroke();
      } else if (p.type === 'star') {
        drawStar(ctx, p.x, p.y, 5, p.size * alpha, p.size * alpha * 0.4, p.color);
      } else if (p.type === 'smoke') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.5 - alpha * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha * 0.3;
        ctx.fill();
      }

      ctx.restore();
    }

    // Draw debris
    for (const d of this.debris) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rotation);
      ctx.globalAlpha = Math.min(1, d.life / 15);
      ctx.fillStyle = d.color;
      ctx.fillRect(-d.size / 2, -d.size / 4, d.size, d.size / 2);
      ctx.restore();
    }
  }
}

// ===== STARFIELD =====
export function createStarfield(count: number, W: number, H: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      z: Math.random() * 3 + 0.5,
      brightness: 0.3 + Math.random() * 0.7,
      size: 0.5 + Math.random() * 2,
      twinkleSpeed: 0.001 + Math.random() * 0.003,
    });
  }
  return stars;
}

export function drawStarfield(ctx: CanvasRenderingContext2D, stars: Star[], time: number, scrollSpeed: number = 0.02) {
  for (const star of stars) {
    const y = (star.y + time * scrollSpeed * star.z) % ctx.canvas.height;
    const twinkle = 0.5 + Math.sin(time * star.twinkleSpeed + star.x) * 0.5;
    const alpha = star.brightness * twinkle;
    const size = star.size * (0.8 + twinkle * 0.4);

    ctx.beginPath();
    ctx.arc(star.x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220,220,255,${alpha})`;
    ctx.fill();

    // Bright stars get a glow
    if (star.size > 1.5 && twinkle > 0.7) {
      ctx.beginPath();
      ctx.arc(star.x, y, size * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180,180,255,${alpha * 0.15})`;
      ctx.fill();
    }
  }
}

// ===== NEBULA =====
export function drawNebula(ctx: CanvasRenderingContext2D, W: number, H: number, time: number) {
  ctx.save();
  ctx.globalAlpha = 0.06;
  const gradient1 = ctx.createRadialGradient(
    W * 0.3 + Math.sin(time * 0.0003) * 50, H * 0.4, 0,
    W * 0.3 + Math.sin(time * 0.0003) * 50, H * 0.4, 200
  );
  gradient1.addColorStop(0, '#6C5CE7');
  gradient1.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient1;
  ctx.fillRect(0, 0, W, H);

  const gradient2 = ctx.createRadialGradient(
    W * 0.7 + Math.cos(time * 0.0002) * 30, H * 0.6, 0,
    W * 0.7 + Math.cos(time * 0.0002) * 30, H * 0.6, 180
  );
  gradient2.addColorStop(0, '#00D2D3');
  gradient2.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient2;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ===== DRAW HELPERS =====
export function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, points: number, outer: number, inner: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / points - Math.PI / 2;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// ===== PLAYER SHIP DRAWING =====
export function drawPlayerShip(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, shieldActive: boolean = false) {
  ctx.save();
  ctx.translate(x, y);

  // Engine flame
  const flameLength = 15 + Math.sin(time * 0.02) * 5;
  const flameGrad = ctx.createLinearGradient(0, 10, 0, 10 + flameLength);
  flameGrad.addColorStop(0, '#FFF');
  flameGrad.addColorStop(0.3, '#48DBFB');
  flameGrad.addColorStop(0.6, '#6C5CE7');
  flameGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = flameGrad;
  ctx.beginPath();
  ctx.moveTo(-8, 12);
  ctx.quadraticCurveTo(-4, 12 + flameLength * 0.6, 0, 12 + flameLength);
  ctx.quadraticCurveTo(4, 12 + flameLength * 0.6, 8, 12);
  ctx.closePath();
  ctx.fill();

  // Side flames
  const sideFlame = 8 + Math.sin(time * 0.03 + 1) * 3;
  ctx.fillStyle = 'rgba(108,92,231,0.5)';
  ctx.beginPath();
  ctx.moveTo(-14, 8);
  ctx.quadraticCurveTo(-16, 8 + sideFlame * 0.5, -12, 8 + sideFlame);
  ctx.quadraticCurveTo(-11, 8 + sideFlame * 0.3, -10, 8);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14, 8);
  ctx.quadraticCurveTo(16, 8 + sideFlame * 0.5, 12, 8 + sideFlame);
  ctx.quadraticCurveTo(11, 8 + sideFlame * 0.3, 10, 8);
  ctx.closePath();
  ctx.fill();

  // Ship body
  ctx.fillStyle = '#4A3FAF';
  ctx.beginPath();
  ctx.moveTo(0, -24);
  ctx.lineTo(-18, 14);
  ctx.lineTo(-12, 12);
  ctx.lineTo(0, 16);
  ctx.lineTo(12, 12);
  ctx.lineTo(18, 14);
  ctx.closePath();
  ctx.fill();

  // Ship detail overlay
  ctx.fillStyle = '#6C5CE7';
  ctx.beginPath();
  ctx.moveTo(0, -24);
  ctx.lineTo(-10, 8);
  ctx.lineTo(0, 12);
  ctx.lineTo(10, 8);
  ctx.closePath();
  ctx.fill();

  // Cockpit
  const cockpitGrad = ctx.createLinearGradient(0, -16, 0, -4);
  cockpitGrad.addColorStop(0, '#48DBFB');
  cockpitGrad.addColorStop(1, '#00B894');
  ctx.fillStyle = cockpitGrad;
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(-5, -6);
  ctx.lineTo(0, -3);
  ctx.lineTo(5, -6);
  ctx.closePath();
  ctx.fill();

  // Wing accents
  ctx.strokeStyle = '#A29BFE';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-18, 14);
  ctx.lineTo(-10, 4);
  ctx.moveTo(18, 14);
  ctx.lineTo(10, 4);
  ctx.stroke();

  // Glow
  ctx.beginPath();
  ctx.arc(0, -5, 30, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(108,92,231,0.08)';
  ctx.fill();

  // Shield effect
  if (shieldActive) {
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,210,211,${0.3 + Math.sin(time * 0.01) * 0.15})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,210,211,${0.1 + Math.sin(time * 0.015) * 0.05})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}

// ===== ENEMY SHIP TYPES =====
export function drawEnemyShip(ctx: CanvasRenderingContext2D, x: number, y: number, type: number, time: number, color: string) {
  ctx.save();
  ctx.translate(x, y);

  switch (type % 4) {
    case 0: // Scout - small fast ship
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.lineTo(-12, -8);
      ctx.lineTo(-4, -4);
      ctx.lineTo(0, -14);
      ctx.lineTo(4, -4);
      ctx.lineTo(12, -8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Engine glow
      ctx.beginPath();
      ctx.arc(0, -16, 3 + Math.sin(time * 0.02) * 1, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,107,107,${0.5 + Math.sin(time * 0.03) * 0.2})`;
      ctx.fill();
      break;

    case 1: // Cruiser - medium ship
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 12);
      ctx.lineTo(-16, 4);
      ctx.lineTo(-20, -8);
      ctx.lineTo(-6, -12);
      ctx.lineTo(0, -16);
      ctx.lineTo(6, -12);
      ctx.lineTo(20, -8);
      ctx.lineTo(16, 4);
      ctx.closePath();
      ctx.fill();
      // Window
      ctx.fillStyle = 'rgba(254,202,87,0.6)';
      ctx.beginPath();
      ctx.arc(0, -4, 4, 0, Math.PI * 2);
      ctx.fill();
      // Wings detail
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-20, -8);
      ctx.lineTo(-8, 0);
      ctx.moveTo(20, -8);
      ctx.lineTo(8, 0);
      ctx.stroke();
      break;

    case 2: // Bomber - heavy ship
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 14);
      ctx.lineTo(-10, 8);
      ctx.lineTo(-22, 2);
      ctx.lineTo(-18, -10);
      ctx.lineTo(-8, -14);
      ctx.lineTo(0, -12);
      ctx.lineTo(8, -14);
      ctx.lineTo(18, -10);
      ctx.lineTo(22, 2);
      ctx.lineTo(10, 8);
      ctx.closePath();
      ctx.fill();
      // Armor plates
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-10, 8);
      ctx.lineTo(-8, -4);
      ctx.lineTo(8, -4);
      ctx.lineTo(10, 8);
      ctx.stroke();
      // Engines
      ctx.fillStyle = `rgba(255,50,50,${0.4 + Math.sin(time * 0.025) * 0.2})`;
      ctx.beginPath();
      ctx.arc(-14, -12, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(14, -12, 3, 0, Math.PI * 2);
      ctx.fill();
      break;

    case 3: // Interceptor - sleek ship
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 16);
      ctx.lineTo(-6, 6);
      ctx.lineTo(-24, 0);
      ctx.lineTo(-8, -6);
      ctx.lineTo(0, -18);
      ctx.lineTo(8, -6);
      ctx.lineTo(24, 0);
      ctx.lineTo(6, 6);
      ctx.closePath();
      ctx.fill();
      // Center detail
      ctx.fillStyle = 'rgba(0,210,211,0.4)';
      ctx.beginPath();
      ctx.ellipse(0, -2, 3, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      // Wing tips
      ctx.fillStyle = `rgba(253,121,168,${0.3 + Math.sin(time * 0.02) * 0.15})`;
      ctx.beginPath();
      ctx.arc(-24, 0, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(24, 0, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
  }

  ctx.restore();
}

// ===== LASER BEAM =====
export function drawLaser(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, time: number, color: string = '#00D2D3') {
  ctx.save();
  // Outer glow
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.2 + Math.sin(time * 0.05) * 0.1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Core beam
  ctx.strokeStyle = '#FFF';
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Hit point glow
  ctx.beginPath();
  ctx.arc(x2, y2, 6, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,210,211,${0.3 + Math.sin(time * 0.04) * 0.15})`;
  ctx.fill();

  ctx.restore();
}

// ===== MISSILE =====
export function drawMissile(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, time: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Trail
  const trailGrad = ctx.createLinearGradient(0, 0, 20, 0);
  trailGrad.addColorStop(0, 'rgba(255,107,107,0.5)');
  trailGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = trailGrad;
  ctx.fillRect(0, -2, 20 + Math.sin(time * 0.03) * 5, 4);

  // Body
  ctx.fillStyle = '#CCC';
  ctx.fillRect(-8, -2, 12, 4);
  // Warhead
  ctx.fillStyle = '#FF6B6B';
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  ctx.lineTo(-8, -3);
  ctx.lineTo(-8, 3);
  ctx.closePath();
  ctx.fill();
  // Fins
  ctx.fillStyle = '#999';
  ctx.beginPath();
  ctx.moveTo(2, -2);
  ctx.lineTo(6, -5);
  ctx.lineTo(4, -2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(2, 2);
  ctx.lineTo(6, 5);
  ctx.lineTo(4, 2);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ===== SHIELD BAR =====
export function drawShieldBar(ctx: CanvasRenderingContext2D, x: number, y: number, current: number, max: number, width: number = 200) {
  const h = 12;
  const ratio = Math.max(0, current / max);
  const barColor = ratio > 0.6 ? '#00D2D3' : ratio > 0.3 ? '#FECA57' : '#FF6B6B';

  // Background
  ctx.fillStyle = 'rgba(30,30,74,0.8)';
  ctx.beginPath();
  ctx.roundRect(x, y, width, h, 4);
  ctx.fill();

  // Fill
  if (ratio > 0) {
    const fillGrad = ctx.createLinearGradient(x, y, x + width * ratio, y);
    fillGrad.addColorStop(0, barColor);
    fillGrad.addColorStop(1, barColor + '80');
    ctx.fillStyle = fillGrad;
    ctx.beginPath();
    ctx.roundRect(x, y, width * ratio, h, 4);
    ctx.fill();
  }

  // Segments
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  for (let i = 1; i < max; i++) {
    const sx = x + (width / max) * i;
    ctx.beginPath();
    ctx.moveTo(sx, y);
    ctx.lineTo(sx, y + h);
    ctx.stroke();
  }

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, width, h, 4);
  ctx.stroke();
}

// ===== HUD =====
export function drawHUD(ctx: CanvasRenderingContext2D, stats: {
  score: number;
  level: number;
  combo: number;
  label: string;
}, W: number) {
  ctx.save();

  // Score
  ctx.font = "bold 20px 'JetBrains Mono', monospace";
  ctx.fillStyle = '#E8E8FF';
  ctx.textAlign = 'left';
  ctx.fillText(`${stats.score}`, 20, 30);
  ctx.font = "10px 'Noto Sans KR', sans-serif";
  ctx.fillStyle = 'rgba(232,232,255,0.5)';
  ctx.fillText('SCORE', 20, 14);

  // Level
  ctx.font = "bold 18px 'JetBrains Mono', monospace";
  ctx.fillStyle = '#A29BFE';
  ctx.textAlign = 'center';
  ctx.fillText(`${stats.label} ${stats.level}`, W / 2, 28);

  // Combo
  if (stats.combo > 1) {
    ctx.font = "bold 16px 'JetBrains Mono', monospace";
    ctx.fillStyle = '#FD79A8';
    ctx.textAlign = 'right';
    ctx.fillText(`${stats.combo}x COMBO`, W - 20, 28);
  }

  ctx.restore();
}

// ===== SCREEN SHAKE =====
export class ScreenShake {
  private intensity = 0;
  private offsetX = 0;
  private offsetY = 0;

  shake(intensity: number = 5) {
    this.intensity = intensity;
  }

  update(): { x: number; y: number } {
    if (this.intensity > 0.1) {
      this.offsetX = (Math.random() - 0.5) * this.intensity;
      this.offsetY = (Math.random() - 0.5) * this.intensity;
      this.intensity *= 0.9;
    } else {
      this.offsetX = 0;
      this.offsetY = 0;
      this.intensity = 0;
    }
    return { x: this.offsetX, y: this.offsetY };
  }
}

// ===== SPACE BACKGROUND =====
export function drawSpaceBackground(ctx: CanvasRenderingContext2D, W: number, H: number, time: number) {
  // Deep space gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#05051A');
  grad.addColorStop(0.5, '#0A0A2A');
  grad.addColorStop(1, '#0D0D35');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

// ===== CASTLE DRAWING (for defense game) =====
export function drawCastle(ctx: CanvasRenderingContext2D, x: number, y: number, hp: number, maxHp: number, time: number) {
  ctx.save();
  ctx.translate(x, y);

  const hpRatio = hp / maxHp;

  // Castle base
  ctx.fillStyle = '#4A3FAF';
  ctx.fillRect(-25, -30, 50, 60);

  // Tower left
  ctx.fillRect(-35, -50, 16, 80);
  // Tower right
  ctx.fillRect(19, -50, 16, 80);

  // Battlements
  const bw = 8;
  for (let i = -35; i < 35; i += bw * 2) {
    ctx.fillStyle = '#5B4FCF';
    ctx.fillRect(i, -55, bw, 8);
  }

  // Tower tops
  ctx.fillStyle = '#6C5CE7';
  ctx.beginPath();
  ctx.moveTo(-35, -50);
  ctx.lineTo(-27, -65);
  ctx.lineTo(-19, -50);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(19, -50);
  ctx.lineTo(27, -65);
  ctx.lineTo(35, -50);
  ctx.fill();

  // Gate
  ctx.fillStyle = '#1A1A3E';
  ctx.beginPath();
  ctx.arc(0, 30, 12, Math.PI, 0);
  ctx.lineTo(12, 30);
  ctx.lineTo(-12, 30);
  ctx.fill();
  ctx.fillRect(-12, 18, 24, 12);

  // Windows
  ctx.fillStyle = hpRatio > 0.3 ? `rgba(254,202,87,${0.4 + Math.sin(time * 0.003) * 0.2})` : 'rgba(255,0,0,0.3)';
  ctx.fillRect(-8, -20, 6, 8);
  ctx.fillRect(2, -20, 6, 8);
  ctx.fillRect(-8, -5, 6, 8);
  ctx.fillRect(2, -5, 6, 8);

  // Flag
  ctx.strokeStyle = '#A29BFE';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -55);
  ctx.lineTo(0, -75);
  ctx.stroke();
  ctx.fillStyle = '#6C5CE7';
  ctx.beginPath();
  ctx.moveTo(0, -75);
  ctx.lineTo(14, -68 + Math.sin(time * 0.005) * 2);
  ctx.lineTo(0, -61);
  ctx.fill();

  // HP bar
  drawShieldBar(ctx, -30, 35, hp, maxHp, 60);

  // Damage cracks (when HP low)
  if (hpRatio < 0.5) {
    ctx.strokeStyle = 'rgba(255,107,107,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-15, -10);
    ctx.lineTo(-8, 5);
    ctx.lineTo(-12, 15);
    ctx.stroke();
    if (hpRatio < 0.25) {
      ctx.beginPath();
      ctx.moveTo(10, -25);
      ctx.lineTo(5, -10);
      ctx.lineTo(12, 0);
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ===== ZOMBIE DRAWING =====
export function drawZombie(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, color: string) {
  ctx.save();
  ctx.translate(x, y);

  // Body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, -6, 8, 0, Math.PI * 2);
  ctx.fill();

  // Arms (shambling)
  const armAngle = Math.sin(time * 0.005 + x) * 0.3;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(-14 + Math.cos(armAngle) * 4, 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(14 + Math.cos(armAngle + 1) * 4, 4);
  ctx.stroke();

  // Eyes
  ctx.fillStyle = '#FF0000';
  ctx.beginPath();
  ctx.arc(-3, -8, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(3, -8, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ===== NEW ZOMBIE GAME VISUALS =====
export function drawZombieSprite(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, variant: number, walkPhase: number, time: number) {
  ctx.save();
  ctx.translate(x, y);

  // Walking animation
  const bobY = Math.sin(walkPhase * 8) * 2;
  const armSwing = Math.sin(walkPhase * 8) * 0.4;

  ctx.translate(0, bobY);

  if (variant === 0) {
    // Standard zombie - greenish, tall
    const scale = size / 12;
    ctx.scale(scale, scale);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 16, 8, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = '#2D5A27';
    ctx.fillRect(-6, 4, 12, 16);

    // Head
    ctx.fillStyle = '#3D6B32';
    ctx.beginPath();
    ctx.arc(0, -4, 8, 0, Math.PI * 2);
    ctx.fill();

    // Arms (shambling)
    ctx.strokeStyle = '#3D6B32';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-6, 8);
    ctx.lineTo(-12 + Math.cos(armSwing) * 6, 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6, 8);
    ctx.lineTo(12 + Math.cos(armSwing + Math.PI) * 6, 14);
    ctx.stroke();

    // Legs
    ctx.fillStyle = '#1A3D1A';
    const legOffset = Math.sin(walkPhase * 8) * 3;
    ctx.fillRect(-3 + legOffset, 20, 3, 8);
    ctx.fillRect(0 - legOffset, 20, 3, 8);

    // Eyes (glowing red)
    ctx.fillStyle = '#FF0000';
    ctx.shadowColor = '#FF0000';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(-3, -6, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3, -6, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

  } else if (variant === 1) {
    // Fat zombie - slower, bigger
    const scale = size / 10;
    ctx.scale(scale, scale);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 18, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body (wider)
    ctx.fillStyle = '#4A2C2A';
    ctx.fillRect(-10, 4, 20, 18);

    // Head
    ctx.fillStyle = '#5A3C3A';
    ctx.beginPath();
    ctx.arc(0, -2, 10, 0, Math.PI * 2);
    ctx.fill();

    // Arms
    ctx.strokeStyle = '#5A3C3A';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-10, 12);
    ctx.lineTo(-16 + Math.cos(armSwing * 0.7) * 4, 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(10, 12);
    ctx.lineTo(16 + Math.cos(armSwing * 0.7 + Math.PI) * 4, 18);
    ctx.stroke();

    // Legs (stumpy)
    ctx.fillStyle = '#2A1A1A';
    const legOffset = Math.sin(walkPhase * 6) * 2;
    ctx.fillRect(-5 + legOffset, 22, 4, 6);
    ctx.fillRect(1 - legOffset, 22, 4, 6);

    // Eyes
    ctx.fillStyle = '#FF4444';
    ctx.shadowColor = '#FF4444';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(-4, -4, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(4, -4, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

  } else {
    // Fast crawler - smaller, lower to ground
    const scale = size / 14;
    ctx.scale(scale, scale);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 12, 6, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body (elongated)
    ctx.fillStyle = '#3A2A4A';
    ctx.fillRect(-5, 6, 10, 8);

    // Head
    ctx.fillStyle = '#4A3A5A';
    ctx.beginPath();
    ctx.arc(0, 2, 6, 0, Math.PI * 2);
    ctx.fill();

    // Arms (crawling motion)
    ctx.strokeStyle = '#4A3A5A';
    ctx.lineWidth = 3;
    const crawlSwing = armSwing * 2;
    ctx.beginPath();
    ctx.moveTo(-5, 10);
    ctx.lineTo(-10 + Math.cos(crawlSwing) * 8, 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(5, 10);
    ctx.lineTo(10 + Math.cos(crawlSwing + Math.PI) * 8, 16);
    ctx.stroke();

    // No visible legs (crawling)

    // Eyes (yellow)
    ctx.fillStyle = '#FFFF00';
    ctx.shadowColor = '#FFFF00';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(-2.5, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(2.5, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

export function drawPlayerCharacter(ctx: CanvasRenderingContext2D, x: number, y: number, facing: number, time: number, muzzleFlash: boolean = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(facing);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 12, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body (military green)
  ctx.fillStyle = '#4A6741';
  ctx.fillRect(-6, -2, 12, 16);

  // Head
  ctx.fillStyle = '#D4A574'; // skin tone
  ctx.beginPath();
  ctx.arc(0, -12, 6, 0, Math.PI * 2);
  ctx.fill();

  // Helmet
  ctx.fillStyle = '#2A3A2A';
  ctx.beginPath();
  ctx.arc(0, -14, 7, 0, Math.PI);
  ctx.fill();

  // Vest details
  ctx.fillStyle = '#3A5A3A';
  ctx.fillRect(-5, 0, 10, 2);
  ctx.fillRect(-5, 4, 10, 2);
  ctx.fillRect(-5, 8, 10, 2);

  // Arms
  ctx.fillStyle = '#4A6741';
  ctx.fillRect(-8, 2, 4, 8);
  ctx.fillRect(4, 2, 4, 8);

  // Weapon (assault rifle)
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(8, 0, 16, 3);
  ctx.fillRect(20, -1, 4, 5);

  // Weapon details
  ctx.fillStyle = '#333';
  ctx.fillRect(10, 1, 12, 1);
  ctx.fillStyle = '#666';
  ctx.fillRect(8, 0, 2, 3);

  // Muzzle flash
  if (muzzleFlash) {
    ctx.fillStyle = '#FFFF88';
    ctx.shadowColor = '#FFAA00';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(26, 1.5, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFAA00';
    ctx.fillRect(24, 0, 8, 3);
    ctx.shadowBlur = 0;
  }

  // Legs
  ctx.fillStyle = '#3A5A3A';
  const breathing = Math.sin(time * 0.003) * 0.5;
  ctx.fillRect(-4, 14 + breathing, 3, 10);
  ctx.fillRect(1, 14 + breathing, 3, 10);

  // Boots
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(-5, 24 + breathing, 4, 3);
  ctx.fillRect(1, 24 + breathing, 4, 3);

  ctx.restore();
}

export function drawMoonlight(ctx: CanvasRenderingContext2D, W: number, H: number, time: number) {
  ctx.save();

  // Night sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0, '#0A0A2A');
  skyGrad.addColorStop(0.3, '#1A1A3A');
  skyGrad.addColorStop(1, '#2A2A4A');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Stars
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < 50; i++) {
    const starX = (i * 47) % W;
    const starY = (i * 73) % (H * 0.6);
    const twinkle = Math.sin(time * 0.001 + i) * 0.5 + 0.5;
    ctx.globalAlpha = twinkle * 0.8;
    ctx.beginPath();
    ctx.arc(starX, starY, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Moon
  const moonX = W * 0.8;
  const moonY = H * 0.2;
  const moonGlow = ctx.createRadialGradient(moonX, moonY, 20, moonX, moonY, 60);
  moonGlow.addColorStop(0, 'rgba(255,255,200,0.3)');
  moonGlow.addColorStop(1, 'rgba(255,255,200,0)');
  ctx.fillStyle = moonGlow;
  ctx.beginPath();
  ctx.arc(moonX, moonY, 60, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#FFFFCC';
  ctx.beginPath();
  ctx.arc(moonX, moonY, 25, 0, Math.PI * 2);
  ctx.fill();

  // Moon craters
  ctx.fillStyle = 'rgba(200,200,180,0.3)';
  ctx.beginPath();
  ctx.arc(moonX - 8, moonY - 5, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(moonX + 6, moonY + 8, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(moonX - 3, moonY + 10, 2, 0, Math.PI * 2);
  ctx.fill();

  // Drifting clouds
  const cloudOffset = (time * 0.0005) % 1;
  ctx.fillStyle = 'rgba(40,40,80,0.4)';

  for (let i = 0; i < 3; i++) {
    const cloudX = (W * cloudOffset + i * W * 0.4) % (W + 100) - 50;
    const cloudY = H * 0.3 + Math.sin(i * 2 + time * 0.0003) * 20;

    ctx.beginPath();
    ctx.arc(cloudX, cloudY, 30, 0, Math.PI * 2);
    ctx.arc(cloudX + 25, cloudY, 35, 0, Math.PI * 2);
    ctx.arc(cloudX + 50, cloudY, 30, 0, Math.PI * 2);
    ctx.arc(cloudX + 30, cloudY - 20, 25, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawCityscape(ctx: CanvasRenderingContext2D, W: number, H: number, groundY: number) {
  ctx.save();

  // Building silhouettes
  ctx.fillStyle = '#0A0A0A';

  const buildings = [
    { x: 0, w: W * 0.15, h: 80 },
    { x: W * 0.12, w: W * 0.08, h: 120 },
    { x: W * 0.18, w: W * 0.12, h: 60 },
    { x: W * 0.28, w: W * 0.1, h: 140 },
    { x: W * 0.36, w: W * 0.14, h: 90 },
    { x: W * 0.48, w: W * 0.08, h: 110 },
    { x: W * 0.54, w: W * 0.12, h: 70 },
    { x: W * 0.64, w: W * 0.1, h: 100 },
    { x: W * 0.72, w: W * 0.13, h: 130 },
    { x: W * 0.83, w: W * 0.17, h: 85 },
  ];

  buildings.forEach(building => {
    const buildingH = Math.min(building.h, groundY * 0.8);
    ctx.fillRect(building.x, groundY - buildingH, building.w, buildingH);

    // Broken/damaged tops
    ctx.fillStyle = '#1A1A1A';
    const damage = Math.sin(building.x * 0.01) * 10;
    ctx.fillRect(building.x, groundY - buildingH, building.w, Math.max(0, damage));

    // Occasional lit windows
    ctx.fillStyle = '#FF6B6B';
    for (let i = 0; i < 3; i++) {
      if (Math.sin(building.x + i * 100) > 0.7) {
        const windowX = building.x + (i + 0.5) * building.w / 4;
        const windowY = groundY - buildingH + 20 + i * 25;
        ctx.fillRect(windowX - 2, windowY, 4, 6);
      }
    }

    ctx.fillStyle = '#0A0A0A';
  });

  // Foreground ruins/debris
  ctx.fillStyle = '#1A1A1A';
  for (let i = 0; i < 8; i++) {
    const debrisX = (i * 97 + 30) % W;
    const debrisW = 10 + (i * 13) % 20;
    const debrisH = 5 + (i * 7) % 15;
    ctx.fillRect(debrisX, groundY - debrisH, debrisW, debrisH);
  }

  ctx.restore();
}

// ===== RAIN EFFECT =====
export function drawRainEffect(ctx: CanvasRenderingContext2D, W: number, H: number, time: number, intensity: number = 1) {
  ctx.save();
  ctx.strokeStyle = 'rgba(108,92,231,0.15)';
  ctx.lineWidth = 1;
  const count = Math.floor(30 * intensity);
  for (let i = 0; i < count; i++) {
    const x = (i * 73 + time * 0.15) % W;
    const y = (i * 137 + time * 0.4) % H;
    const len = 8 + Math.sin(i) * 4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2, y + len);
    ctx.stroke();
  }
  ctx.restore();
}

// ===== WORD BUBBLE =====

/** 말풍선 배경 상자의 높이 — drawWordBubble의 계산식과 반드시 같아야 한다. */
export function wordBubbleHeight(fontSize: number): number {
  return fontSize + 14;
}

/**
 * 스프라이트를 가리지 않는 말풍선 중심 y를 구한다.
 * 라벨이 몬스터 위에 겹치면 무엇을 쳐야 하는지 알아볼 수 없다
 * (실측: 디펜스 병사 최대 97%, 우주 적기 38%, 좀비 26%가 글자에 가려졌다).
 * 기본은 스프라이트 위쪽이고, 위로 올리면 캔버스 밖으로 나갈 때만 아래로 뒤집는다.
 */
export function wordBubbleY(o: {
  /** 스프라이트 중심 y */
  spriteY: number;
  /** 스프라이트 높이 — 상하 애니메이션(홉·맥동) 진폭까지 포함해서 넘길 것 */
  spriteH: number;
  fontSize: number;
  /** 스프라이트와 말풍선 사이 여백 */
  gap?: number;
  /** 주면 화면 밖으로 나가는지 판정해 반대쪽으로 뒤집는다 */
  canvasH?: number;
  /** 기본 배치를 스프라이트 아래쪽으로 (위에서 내려오는 적 등) */
  below?: boolean;
}): number {
  const { spriteY, spriteH, fontSize, gap = 8, canvasH, below = false } = o;
  const half = wordBubbleHeight(fontSize) / 2;
  const above = spriteY - spriteH / 2 - gap - half;
  const under = spriteY + spriteH / 2 + gap + half;
  if (below) return canvasH != null && under + half > canvasH - 4 ? above : under;
  return above - half < 4 ? under : above;
}

/** 말풍선 배경 상자의 너비 — drawWordBubble의 계산식과 반드시 같아야 한다. */
export function wordBubbleWidth(ctx: CanvasRenderingContext2D, text: string, fontSize: number): number {
  ctx.save();
  ctx.font = `bold ${fontSize}px 'JetBrains Mono', 'Noto Sans KR', monospace`;
  const w = ctx.measureText(text).width + 20;
  ctx.restore();
  return w;
}

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * 이 상자를 가렸을 때의 벌점 배수(기본 3 = 몬스터). 라벨끼리 겹치는 벌점이 1이므로,
   * 1보다 작게 주면 "라벨끼리 겹치느니 차라리 이걸 덮는다"가 된다 — HUD 배경 등.
   */
  weight?: number;
}

export interface LabelRequest extends LabelBox {
  /** 스프라이트 밖으로 비켜 놓은 기본 y (겹침이 없으면 이 자리에 그린다) */
  homeY: number;
  /** 더 밀어낼 기본 방향: -1 위 / +1 아래 */
  dir: -1 | 1;
  /**
   * 직전 프레임에 쓰던 이동량. 점수가 비슷하면 이 자리를 유지해
   * 두 후보 사이를 매 프레임 오가는 떨림을 막는다.
   */
  prefer?: number;
  /** resolveLabels가 채우는 결과 — homeY로부터의 부호 있는 이동량(px) */
  offset: number;
}

/** 라벨이 대상을 100% 가릴 때 감수할 이동 거리(px). 거리 벌점과 같은 단위라 직접 비교된다. */
const COVER_COST = 120;

const overlapArea = (a: LabelBox, b: LabelBox) =>
  Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)) *
  Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));

/**
 * 말풍선이 스프라이트나 다른 말풍선을 덮지 않는 자리를 찾아 y를 밀어낸다.
 * 자기 몸통만 피하게 하면(wordBubbleY) 적이 몰려 있을 때 라벨이 **뒤에 선 적**을
 * 가린다 — 디펜스는 병사들이 줄지어 행진해서 특히 심했다(실측 7마리 중 4마리 가림).
 *
 * requests는 프레임마다 같은 순서로(엔티티 id 순 등) 넘길 것 — 순서가 흔들리면
 * 배치가 프레임마다 뒤바뀌어 라벨이 떨린다.
 */
export function resolveLabels(
  requests: LabelRequest[],
  sprites: LabelBox[],
  opts: {
    canvasH: number;
    canvasW?: number;
    /** 밀어낼 축. 'x'는 산성비처럼 y가 곧 게임 상태(낙하 높이)라 건드리면 안 될 때 쓴다. */
    axis?: 'x' | 'y';
    step?: number;
    maxShift?: number;
    pad?: number;
    /** 라벨끼리 겹침 벌점 배수(기본 1 — 몸통 가림 3보다 가볍다). 라벨이 겹치면 글자를 못 읽으니 3D 판처럼 몸통이 라벨 밑 3D 에 있는 화면은 크게 준다 */
    labelWeight?: number;
  } = { canvasH: Infinity }
): void {
  // maxShift는 "라벨이 몸통에서 떨어질 수 있는 최대 거리"이자 곧 연결선의 최대 길이다.
  // 크게 잡으면 겹침은 줄지만 라벨이 자기 적과 반 화면 떨어져 풍선끈처럼 보인다(실측 230px).
  // 72 = 라벨 5개가 같은 자리에 겹쳐도 서로 완전히 비켜설 수 있는 최소값(±72 = 36px 간격 5칸).
  const { canvasH, canvasW = Infinity, axis = 'y', step = 6, maxShift = 72, pad = 8, labelWeight = 1 } = opts;
  // 몸통 상자에 여유를 준다. 적이 움직이면 최적 자리가 계속 바뀌는데 라벨은 부드럽게
  // 따라가므로(easeLabelShift) 늘 몇 프레임 뒤처진다 — 그 지연분을 여유로 흡수한다.
  const padded = sprites.map((s) => ({ ...s, w: s.w + pad * 2, h: s.h + pad * 2 }));
  const placed: LabelBox[] = [];
  for (const req of requests) {
    let bestOffset = 0;
    let bestScore = Infinity;
    let clean = false;
    for (let dist = 0; dist <= maxShift && !clean; dist += step) {
      // 기본 방향을 먼저 보고, 그래도 자리가 없으면 반대쪽까지 본다.
      for (const dir of dist === 0 ? [req.dir] : [req.dir, -req.dir as -1 | 1]) {
        const moved = (axis === 'y' ? req.homeY : req.x) + dir * dist;
        const halfAlong = axis === 'y' ? req.h / 2 : req.w / 2;
        const limit = axis === 'y' ? canvasH : canvasW;
        if (moved - halfAlong < 2 || moved + halfAlong > limit - 2) continue;
        const probe: LabelBox =
          axis === 'y'
            ? { x: req.x, y: moved, w: req.w, h: req.h }
            : { x: moved, y: req.homeY, w: req.w, h: req.h };
        // 몬스터를 가리는 쪽이 라벨끼리 겹치는 것보다 훨씬 나쁘다.
        let overlap = 0;
        for (const s of padded) overlap += overlapArea(probe, s) * (s.weight ?? 3);
        for (const p of placed) overlap += overlapArea(probe, p) * labelWeight;
        // 겹침은 **면적 비율**로 환산한다(1.0 = 라벨이 통째로 가려짐).
        // 날것의 px²로 두면 살짝 스친 것만으로도 수백 점이 붙어 거리 벌점을 압도했고,
        // 라벨이 허용 최대치까지 도망가 연결선이 풍선끈처럼 길어졌다(실측: 좀비).
        const cover = overlap / (req.w * req.h);
        // 가깝고 기본 방향인 자리를 선호 — 완전히 빈 자리를 찾으면 더 안 본다.
        // 직전 자리에는 이력 보너스를 줘서 후보 사이를 오가는 떨림을 없앤다.
        const held = req.prefer != null && Math.abs(dir * dist - req.prefer) <= step / 2;
        // COVER_COST = "몬스터 하나를 통째로 가리느니 이만큼은 움직인다"는 교환비(px).
        const score = cover * COVER_COST + dist + (dir === req.dir ? 0 : 40) - (held ? 12 : 0);
        if (score < bestScore) {
          bestScore = score;
          bestOffset = dir * dist;
          clean = overlap === 0;
        }
      }
    }
    req.offset = bestOffset;
    req.y = axis === 'y' ? req.homeY + bestOffset : req.homeY;
    // 이미 놓은 라벨도 같은 이유로 여유를 준다(라벨끼리 겹치면 글자를 못 읽는다).
    placed.push({
      x: axis === 'x' ? req.x + bestOffset : req.x,
      y: req.y,
      w: req.w + pad,
      h: req.h + pad,
    });
  }
}

/**
 * 목표 위치로 부드럽게 따라가게 한다. 적이 움직이면 겹침 판정이 켜졌다 꺼졌다 하는데,
 * 그때마다 라벨이 순간이동하면 눈이 아프다.
 */
export function easeLabelShift(prev: number | undefined, target: number, rate = 0.4): number {
  if (prev == null) return target;
  return Math.abs(target - prev) < 0.5 ? target : prev + (target - prev) * rate;
}

/**
 * 말풍선과 스프라이트를 잇는 가는 선. 말풍선을 몸통 밖으로 밀어냈으므로
 * 어떤 적의 단어인지 선으로 묶어 준다(적이 몰려 있을 때 오인 입력 방지).
 */
export function drawBubbleLeader(
  ctx: CanvasRenderingContext2D,
  x: number,
  spriteY: number,
  spriteH: number,
  bubbleY: number,
  fontSize: number,
  color: string = 'rgba(255,255,255,0.25)',
  /** 주면 화면 밖 스프라이트로 향하는 선을 그리지 않는다. */
  canvasH?: number
) {
  // 적은 화면 밖에서 스폰해 걸어 들어온다. 그동안 말풍선만 화면 안으로 끌려 들어오는데,
  // 이때 연결선을 그리면 끝점이 보이지 않아 허공에 매달린 풍선끈이 된다(사용자 제보).
  if (canvasH != null && (spriteY + spriteH / 2 < 0 || spriteY - spriteH / 2 > canvasH)) return;
  const half = wordBubbleHeight(fontSize) / 2;
  const [y1, y2] =
    bubbleY < spriteY
      ? [bubbleY + half, spriteY - spriteH / 2]
      : [spriteY + spriteH / 2, bubbleY - half];
  if (y2 - y1 < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.lineTo(x, y2);
  ctx.stroke();
  ctx.restore();
}

export function drawWordBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, options: {
  targeted?: boolean;
  progress?: number;
  fontSize?: number;
} = {}) {
  const { targeted = false, progress = 0, fontSize = 14 } = options;
  ctx.save();
  ctx.font = `bold ${fontSize}px 'JetBrains Mono', 'Noto Sans KR', monospace`;
  // 크기는 배치 계산과 같은 함수에서 받는다 — 여기서 따로 계산하면 언젠가 어긋난다.
  const bw = wordBubbleWidth(ctx, text, fontSize);
  const bh = wordBubbleHeight(fontSize);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.roundRect(x - bw / 2 + 2, y - bh / 2 + 2, bw, bh, 6);
  ctx.fill();

  // Background
  ctx.fillStyle = targeted ? 'rgba(0,210,211,0.2)' : 'rgba(20,20,60,0.9)';
  ctx.beginPath();
  ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 6);
  ctx.fill();

  // Progress fill
  if (progress > 0) {
    ctx.fillStyle = 'rgba(0,210,211,0.15)';
    ctx.beginPath();
    ctx.roundRect(x - bw / 2, y - bh / 2, bw * progress, bh, 6);
    ctx.fill();
  }

  // Border
  ctx.strokeStyle = targeted ? '#00D2D3' : color;
  ctx.lineWidth = targeted ? 2 : 1.5;
  ctx.beginPath();
  ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 6);
  ctx.stroke();

  // Targeted glow
  if (targeted) {
    ctx.shadowColor = '#00D2D3';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 6);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Text
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);

  ctx.restore();
}

// ===== DETAILED CASTLE DRAWING =====
export function drawCastleDetailed(ctx: CanvasRenderingContext2D, x: number, y: number, hp: number, maxHp: number, time: number) {
  ctx.save();
  ctx.translate(x, y);

  const hpRatio = hp / maxHp;
  const scaleFactor = 1.5; // Make castle larger

  // Main castle wall (stone texture effect)
  const wallGrad = ctx.createLinearGradient(-30 * scaleFactor, -40 * scaleFactor, 30 * scaleFactor, 40 * scaleFactor);
  wallGrad.addColorStop(0, '#5A4FCF');
  wallGrad.addColorStop(0.3, '#4A3FAF');
  wallGrad.addColorStop(0.7, '#3A2F8F');
  wallGrad.addColorStop(1, '#2A1F6F');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(-30 * scaleFactor, -40 * scaleFactor, 60 * scaleFactor, 80 * scaleFactor);

  // Stone blocks texture
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  for (let row = -40 * scaleFactor; row < 40 * scaleFactor; row += 12) {
    for (let col = -30 * scaleFactor; col < 30 * scaleFactor; col += 18) {
      const offset = (Math.floor(row / 12) % 2) * 9;
      ctx.strokeRect(col + offset, row, 18, 12);
    }
  }

  // Left tower (round)
  ctx.fillStyle = wallGrad;
  ctx.beginPath();
  ctx.arc(-25 * scaleFactor, -10 * scaleFactor, 18 * scaleFactor, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-43 * scaleFactor, -70 * scaleFactor, 36 * scaleFactor, 60 * scaleFactor);

  // Right tower (round)
  ctx.beginPath();
  ctx.arc(25 * scaleFactor, -10 * scaleFactor, 18 * scaleFactor, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(7 * scaleFactor, -70 * scaleFactor, 36 * scaleFactor, 60 * scaleFactor);

  // Tower roofs (cone shaped)
  const roofGrad = ctx.createRadialGradient(0, -80 * scaleFactor, 0, 0, -80 * scaleFactor, 25 * scaleFactor);
  roofGrad.addColorStop(0, '#8B7ED8');
  roofGrad.addColorStop(1, '#6C5CE7');
  ctx.fillStyle = roofGrad;
  ctx.beginPath();
  ctx.moveTo(-43 * scaleFactor, -70 * scaleFactor);
  ctx.lineTo(-25 * scaleFactor, -95 * scaleFactor);
  ctx.lineTo(-7 * scaleFactor, -70 * scaleFactor);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(7 * scaleFactor, -70 * scaleFactor);
  ctx.lineTo(25 * scaleFactor, -95 * scaleFactor);
  ctx.lineTo(43 * scaleFactor, -70 * scaleFactor);
  ctx.fill();

  // Battlements on main wall
  ctx.fillStyle = '#6C5CE7';
  for (let i = -25 * scaleFactor; i < 25 * scaleFactor; i += 12 * scaleFactor) {
    ctx.fillRect(i, -75 * scaleFactor, 8 * scaleFactor, 12 * scaleFactor);
  }

  // Main gate (arched)
  ctx.fillStyle = '#1A1A3E';
  ctx.beginPath();
  ctx.arc(0, 30 * scaleFactor, 18 * scaleFactor, Math.PI, 0);
  ctx.lineTo(18 * scaleFactor, 40 * scaleFactor);
  ctx.lineTo(-18 * scaleFactor, 40 * scaleFactor);
  ctx.fill();

  // Gate details (wooden planks)
  ctx.strokeStyle = '#2A1F4F';
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-15 * scaleFactor, 15 * scaleFactor + i * 5);
    ctx.lineTo(15 * scaleFactor, 15 * scaleFactor + i * 5);
    ctx.stroke();
  }

  // Windows with glow
  const windowGlow = hpRatio > 0.3 ?
    `rgba(254,202,87,${0.6 + Math.sin(time * 0.003) * 0.3})` :
    'rgba(255,50,50,0.5)';

  // Main wall windows
  ctx.fillStyle = windowGlow;
  ctx.fillRect(-12 * scaleFactor, -25 * scaleFactor, 8 * scaleFactor, 10 * scaleFactor);
  ctx.fillRect(4 * scaleFactor, -25 * scaleFactor, 8 * scaleFactor, 10 * scaleFactor);
  ctx.fillRect(-12 * scaleFactor, -5 * scaleFactor, 8 * scaleFactor, 10 * scaleFactor);
  ctx.fillRect(4 * scaleFactor, -5 * scaleFactor, 8 * scaleFactor, 10 * scaleFactor);

  // Tower windows
  ctx.fillRect(-30 * scaleFactor, -30 * scaleFactor, 6 * scaleFactor, 8 * scaleFactor);
  ctx.fillRect(24 * scaleFactor, -30 * scaleFactor, 6 * scaleFactor, 8 * scaleFactor);

  // Banner/flag
  ctx.strokeStyle = '#A29BFE';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -75 * scaleFactor);
  ctx.lineTo(0, -110 * scaleFactor);
  ctx.stroke();

  // Animated flag
  ctx.fillStyle = '#8B7ED8';
  ctx.beginPath();
  ctx.moveTo(0, -110 * scaleFactor);
  const flagWave = Math.sin(time * 0.008) * 3;
  ctx.lineTo(20 * scaleFactor + flagWave, -100 * scaleFactor);
  ctx.lineTo(18 * scaleFactor + flagWave * 0.7, -90 * scaleFactor);
  ctx.lineTo(0, -95 * scaleFactor);
  ctx.fill();

  // HP bar (enhanced)
  drawShieldBar(ctx, -40 * scaleFactor, 50 * scaleFactor, hp, maxHp, 80 * scaleFactor);

  // Damage effects
  if (hpRatio < 0.6) {
    ctx.strokeStyle = 'rgba(255,107,107,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-20 * scaleFactor, -15 * scaleFactor);
    ctx.lineTo(-10 * scaleFactor, 5 * scaleFactor);
    ctx.lineTo(-15 * scaleFactor, 20 * scaleFactor);
    ctx.stroke();
  }
  if (hpRatio < 0.3) {
    ctx.beginPath();
    ctx.moveTo(15 * scaleFactor, -30 * scaleFactor);
    ctx.lineTo(8 * scaleFactor, -15 * scaleFactor);
    ctx.lineTo(18 * scaleFactor, 0);
    ctx.stroke();
  }

  ctx.restore();
}

// ===== DETAILED SOLDIER ENEMY DRAWING =====
export function drawSoldierEnemy(ctx: CanvasRenderingContext2D, x: number, y: number, type: number, walkPhase: number, time: number) {
  ctx.save();
  ctx.translate(x, y);

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 15, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Walking bob animation
  const bobOffset = Math.sin(walkPhase) * 1.5;
  ctx.translate(0, bobOffset);

  // Body color based on type
  let bodyColor, armorColor, weaponColor;
  let scale = 1;

  switch (type) {
    case 0: // Swordsman
      bodyColor = '#8B4513';
      armorColor = '#A0A0A0';
      weaponColor = '#C0C0C0';
      break;
    case 1: // Spearman
      bodyColor = '#228B22';
      armorColor = '#808080';
      weaponColor = '#8B4513';
      break;
    case 2: // Knight
      bodyColor = '#4B0082';
      armorColor = '#E5E5E5';
      weaponColor = '#FFD700';
      scale = 1.3; // Bigger
      break;
    default:
      bodyColor = '#654321';
      armorColor = '#696969';
      weaponColor = '#A0A0A0';
  }

  ctx.scale(scale, scale);

  // Head (helmet)
  ctx.fillStyle = armorColor;
  ctx.beginPath();
  ctx.arc(0, -14, 7, 0, Math.PI * 2);
  ctx.fill();

  // Helmet details
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, -14, 7, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();

  // Eye slit
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(-4, -16, 8, 2);

  // Body armor
  ctx.fillStyle = bodyColor;
  ctx.fillRect(-6, -8, 12, 16);

  // Armor plates
  ctx.fillStyle = armorColor;
  ctx.fillRect(-7, -9, 14, 3); // Chest plate
  ctx.fillRect(-6, -3, 12, 2); // Belt

  // Walking leg animation
  const legAngle = Math.sin(walkPhase) * 0.4;

  // Left leg
  ctx.save();
  ctx.translate(-3, 8);
  ctx.rotate(legAngle);
  ctx.fillStyle = bodyColor;
  ctx.fillRect(-2, 0, 4, 10);
  // Boot
  ctx.fillStyle = armorColor;
  ctx.fillRect(-3, 8, 6, 3);
  ctx.restore();

  // Right leg
  ctx.save();
  ctx.translate(3, 8);
  ctx.rotate(-legAngle);
  ctx.fillStyle = bodyColor;
  ctx.fillRect(-2, 0, 4, 10);
  // Boot
  ctx.fillStyle = armorColor;
  ctx.fillRect(-3, 8, 6, 3);
  ctx.restore();

  // Arms and weapons
  const armSwing = Math.sin(walkPhase + Math.PI) * 0.2;

  if (type === 1) { // Spearman - long spear
    ctx.save();
    ctx.translate(6, -2);
    ctx.rotate(armSwing);
    // Spear shaft
    ctx.strokeStyle = weaponColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(20, -8);
    ctx.stroke();
    // Spear head
    ctx.fillStyle = '#C0C0C0';
    ctx.beginPath();
    ctx.moveTo(20, -8);
    ctx.lineTo(26, -10);
    ctx.lineTo(24, -8);
    ctx.lineTo(26, -6);
    ctx.fill();
    ctx.restore();

    // Shield
    ctx.fillStyle = 'rgba(139,69,19,0.8)';
    ctx.beginPath();
    ctx.ellipse(-7, -2, 4, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = armorColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (type === 2) { // Knight - sword and large shield
    // Large shield
    ctx.fillStyle = weaponColor;
    ctx.beginPath();
    ctx.ellipse(-9, 0, 5, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Sword
    ctx.save();
    ctx.translate(8, -2);
    ctx.rotate(armSwing);
    // Blade
    ctx.fillStyle = '#E5E5E5';
    ctx.fillRect(-1, -12, 2, 15);
    // Hilt
    ctx.fillStyle = weaponColor;
    ctx.fillRect(-3, 3, 6, 2);
    ctx.fillRect(-0.5, -2, 1, 5);
    ctx.restore();
  } else { // Swordsman - sword
    ctx.save();
    ctx.translate(7, -2);
    ctx.rotate(armSwing);
    // Blade
    ctx.fillStyle = weaponColor;
    ctx.fillRect(-0.5, -8, 1, 10);
    // Hilt
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(-2, 2, 4, 1);
    ctx.fillRect(-0.5, -1, 1, 3);
    ctx.restore();

    // Small shield
    ctx.fillStyle = 'rgba(160,160,160,0.8)';
    ctx.fillRect(-8, -4, 3, 8);
  }

  // Left arm
  ctx.save();
  ctx.translate(-5, -2);
  ctx.rotate(-armSwing * 0.5);
  ctx.fillStyle = bodyColor;
  ctx.fillRect(-1, 0, 2, 8);
  ctx.restore();

  ctx.restore();
}

// ===== HIGH-QUALITY ENHANCED RENDERER FUNCTIONS =====

export function drawEnhancedZombie(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, variant: number, walkPhase: number, time: number) {
  ctx.save();

  const scale = size / 60; // Base size 60px
  const bodyHeight = 45 * scale;
  const bodyWidth = 25 * scale;

  // Walking animation offset
  const armSwing = Math.sin(walkPhase) * 0.3;

  // Ground shadow with neon glow
  ctx.fillStyle = 'rgba(139, 69, 138, 0.4)'; // Neon purple shadow
  ctx.shadowColor = '#8B458A';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.ellipse(x, y + bodyHeight/2 + 5*scale, bodyWidth*0.8, 5*scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // Variant-specific adjustments
  let bodyScale = 1;
  let colorScheme = { base: '#7FFF7F', mid: '#50C878', dark: '#2E8B57' }; // Green

  if (variant === 1) { // Fat zombie - purple theme
    bodyScale = 1.4;
    colorScheme = { base: '#DDA0DD', mid: '#9370DB', dark: '#4B0082' };
  } else if (variant === 2) { // Crawler - cyan theme
    ctx.scale(1, 0.7); // Squash vertically
    colorScheme = { base: '#E0FFFF', mid: '#00FFFF', dark: '#008B8B' };
  }

  // Body gradient with cyberpunk neon effect
  const bodyGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, bodyWidth);
  bodyGradient.addColorStop(0, colorScheme.base);
  bodyGradient.addColorStop(0.7, colorScheme.mid);
  bodyGradient.addColorStop(1, colorScheme.dark);

  // Main body with glow
  ctx.shadowColor = colorScheme.mid;
  ctx.shadowBlur = 10;
  ctx.fillStyle = bodyGradient;
  ctx.beginPath();
  ctx.ellipse(0, 0, bodyWidth * bodyScale, bodyHeight, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Cyberpunk clothing with neon trim
  ctx.fillStyle = '#2C1810'; // Dark brown base
  ctx.beginPath();
  ctx.rect(-bodyWidth/2, -5, bodyWidth, 15);
  ctx.fill();

  // Glowing neon trim on clothes
  ctx.strokeStyle = '#00FFFF'; // Cyan
  ctx.lineWidth = 2;
  ctx.shadowColor = '#00FFFF';
  ctx.shadowBlur = 8;
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.rect(-bodyWidth/2 + 1, -4, bodyWidth - 2, 13);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  // Animated legs with walking motion
  const legY = bodyHeight/2;
  ctx.fillStyle = colorScheme.mid;

  // Left leg with rotation
  ctx.save();
  ctx.translate(-8, legY);
  ctx.rotate(Math.sin(walkPhase * 2) * 0.3);
  ctx.beginPath();
  ctx.ellipse(0, 5, 4, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Right leg with opposite rotation
  ctx.save();
  ctx.translate(8, legY);
  ctx.rotate(-Math.sin(walkPhase * 2) * 0.3);
  ctx.beginPath();
  ctx.ellipse(0, 5, 4, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Animated arms
  ctx.fillStyle = colorScheme.mid;

  // Left arm with swinging motion
  ctx.save();
  ctx.translate(-bodyWidth/2 - 5, -5);
  ctx.rotate(armSwing);
  ctx.beginPath();
  ctx.ellipse(0, 8, 3, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Right arm with opposite swing
  ctx.save();
  ctx.translate(bodyWidth/2 + 5, -5);
  ctx.rotate(-armSwing);
  ctx.beginPath();
  ctx.ellipse(0, 8, 3, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Head with detailed gradient and glow
  const headGradient = ctx.createRadialGradient(-3, -bodyHeight/2 - 10, 0, 0, -bodyHeight/2 - 8, 12);
  headGradient.addColorStop(0, colorScheme.base);
  headGradient.addColorStop(0.8, colorScheme.mid);
  headGradient.addColorStop(1, colorScheme.dark);

  ctx.shadowColor = colorScheme.mid;
  ctx.shadowBlur = 6;
  ctx.fillStyle = headGradient;
  ctx.beginPath();
  ctx.ellipse(0, -bodyHeight/2 - 8, 12, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Glowing cyberpunk eyes with animation
  const eyeGlow = Math.sin(time * 0.005) * 0.3 + 0.7; // Pulsing effect
  ctx.shadowColor = '#FF1493'; // Deep pink
  ctx.shadowBlur = eyeGlow * 15;
  ctx.fillStyle = '#FF1493';

  ctx.globalAlpha = eyeGlow;
  ctx.beginPath();
  ctx.ellipse(-4, -bodyHeight/2 - 10, 2, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(4, -bodyHeight/2 - 10, 2, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  // Friendly smile (for elementary students)
  ctx.strokeStyle = '#FF69B4'; // Hot pink
  ctx.lineWidth = 2;
  ctx.shadowColor = '#FF69B4';
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.arc(0, -bodyHeight/2 - 5, 4, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Cyberpunk hair with neon highlights
  ctx.fillStyle = colorScheme.dark;
  ctx.beginPath();
  ctx.ellipse(-6, -bodyHeight/2 - 15, 3, 4, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Neon hair streak
  ctx.fillStyle = '#00FFFF';
  ctx.shadowColor = '#00FFFF';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.ellipse(-6, -bodyHeight/2 - 15, 1, 4, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // More hair on the other side
  ctx.fillStyle = colorScheme.dark;
  ctx.beginPath();
  ctx.ellipse(4, -bodyHeight/2 - 16, 2, 3, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // Cute decorative spots (made kid-friendly with bright colors)
  ctx.fillStyle = '#FFB6C1'; // Light pink
  ctx.beginPath();
  ctx.ellipse(-5, 8, 2, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#98FB98'; // Pale green
  ctx.beginPath();
  ctx.ellipse(7, -3, 1.5, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Optional: Add floating particles for extra effect
  if (Math.random() > 0.8) {
    ctx.fillStyle = colorScheme.mid;
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < 3; i++) {
      const px = (Math.random() - 0.5) * bodyWidth * 2;
      const py = (Math.random() - 0.5) * bodyHeight * 1.5;
      ctx.beginPath();
      ctx.ellipse(px, py, 1, 1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
