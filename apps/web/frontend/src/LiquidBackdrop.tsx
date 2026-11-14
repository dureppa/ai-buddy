import { useEffect, useRef, type RefObject } from 'react';

const ink = `
precision mediump float;
uniform vec2 uSize;
uniform float uTime;
uniform float uRadius;
uniform float uActivity;
uniform vec4 uWake[8];
uniform vec3 uRipple;
uniform vec3 uLight;

float spot(vec2 point, vec2 center, vec2 shape) {
  vec2 offset = (point - center) / shape;
  return exp(-dot(offset, offset) * 1.9);
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) / uSize;
  vec2 aspect = vec2(uSize.x / uSize.y, 1.0);
  vec2 displacement = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 wake = uWake[i];
    vec2 delta = (uv - wake.xy) * aspect / uRadius;
    float influence = exp(-dot(delta, delta) * 2.6);
    displacement += wake.zw * influence;
  }

  vec2 fromClick = (uv - uRipple.xy) * aspect;
  float distanceFromClick = length(fromClick);
  float age = uRipple.z;
  float front = distanceFromClick - age * 0.48;
  float spread = front / (0.13 + 0.09 * age);
  float pulse = exp(-spread * spread) * (1.0 - age) * smoothstep(0.0, 0.19, age);
  displacement += fromClick / max(distanceFromClick, 0.09) * pulse * 0.21;
  vec2 flow = clamp(displacement, -0.28, 0.28) * uActivity;
  vec2 p = uv - flow / aspect;
  p.x += sin(p.y * 4.2 + uTime * 0.43) * 0.052;
  p.y += cos(p.x * 4.4 - uTime * 0.36) * 0.05;

  vec2 green = vec2(0.10 + sin(uTime) * 0.09, 0.28 + cos(uTime * 0.7) * 0.15);
  vec2 lilac = vec2(0.90 + cos(uTime * 0.78) * 0.09, 0.72 + sin(uTime * 0.9) * 0.16);
  float moss = spot(p, green, vec2(0.47, 0.56));
  moss += 0.83 * spot(p, vec2(0.19 + sin(uTime * 0.8) * 0.11, 0.94), vec2(0.34, 0.31));
  float violet = spot(p, lilac, vec2(0.50, 0.58));
  violet += 0.77 * spot(p, vec2(0.83, 0.09 + cos(uTime) * 0.1), vec2(0.32, 0.34));

  vec3 base = vec3(0.987, 0.989, 0.978);
  vec3 tint = mix(vec3(0.62, 0.85, 0.54), vec3(0.74, 0.62, 0.90), violet / max(moss + violet, 0.001));
  float glow = spot(p, uLight.xy, vec2(0.32, 0.42)) * uLight.z;
  // Modulate the sampled color softly where the existing field is moving fastest.
  float stretch = min(length(flow) * 0.42, 0.095);
  float color = clamp((moss + violet) * 0.68 + glow + stretch, 0.0, 0.79);
  gl_FragColor = vec4(mix(base, tint, color), 1.0);
}
`;

function createProgram(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  if (!program || !vertex || !fragment) return null;
  gl.shaderSource(vertex, 'attribute vec2 point; void main() { gl_Position = vec4(point, 0.0, 1.0); }');
  gl.shaderSource(fragment, ink);
  gl.compileShader(vertex);
  gl.compileShader(fragment);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

type Point = { x: number; y: number };
type Wake = Point & { vx: number; vy: number; time: number };

export function LiquidBackdrop({ screen }: { screen: RefObject<HTMLElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const surface = screen.current;
    if (!element || !surface) return;

    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const light = matchMedia('(pointer: coarse), (max-width: 640px)');
    const gl = element.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return;
    const program = createProgram(gl);
    const vertices = gl.createBuffer();
    if (!program || !vertices) return;

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'point');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const size = gl.getUniformLocation(program, 'uSize');
    const time = gl.getUniformLocation(program, 'uTime');
    const radius = gl.getUniformLocation(program, 'uRadius');
    const activityUniform = gl.getUniformLocation(program, 'uActivity');
    const wakeUniform = gl.getUniformLocation(program, 'uWake[0]');
    const rippleUniform = gl.getUniformLocation(program, 'uRipple');
    const lightUniform = gl.getUniformLocation(program, 'uLight');

    const wake: Wake[] = [];
    const packedWake = new Float32Array(32);
    let lastPointer: (Point & { time: number }) | null = null;
    let velocity = { x: 0, y: 0 };
    let lastStamp = -Infinity;
    let ripple: (Point & { time: number }) | null = null;
    let selected: (Point & { time: number }) | null = null;
    let hovered: Point | null = null;
    const glow = { x: 0.68, y: 0.48, intensity: 0 };
    let activity = 1;
    let frame = 0;
    let previousFrame = 0;
    let elapsedTime = 0;

    const pointerPosition = (x: number, y: number) => ({ x: x / innerWidth, y: y / innerHeight });

    function move(event: PointerEvent) {
      if (reduced.matches || event.pointerType !== 'mouse') return;
      const now = performance.now();
      const point = pointerPosition(event.clientX, event.clientY);
      const previous = lastPointer;
      lastPointer = { ...point, time: now };
      if (!previous || now - previous.time > 280) {
        velocity = { x: 0, y: 0 };
        return;
      }
      const interval = Math.max(8, now - previous.time);
      const dx = ((point.x - previous.x) * innerWidth) / interval;
      const dy = ((point.y - previous.y) * innerHeight) / interval;
      const weight = 1 - Math.exp(-interval / 48);
      velocity.x += (dx - velocity.x) * weight;
      velocity.y += (dy - velocity.y) * weight;
      const speed = Math.hypot(velocity.x, velocity.y);
      if (now - lastStamp < 58 || speed < 0.018) return;
      const strength = Math.min(0.19, Math.sqrt(speed) * 0.17) / speed;
      wake.unshift({ ...point, time: now, vx: velocity.x * strength, vy: velocity.y * strength });
      if (wake.length > 8) wake.pop();
      lastStamp = now;
    }

    function leave() {
      lastPointer = null;
      velocity = { x: 0, y: 0 };
    }

    function tap(event: MouseEvent) {
      if (event.target !== surface || reduced.matches || (ripple && performance.now() - ripple.time < 720)) return;
      ripple = { ...pointerPosition(event.clientX, event.clientY), time: performance.now() };
    }

    function highlight(event: Event) {
      const detail = (event as CustomEvent<(Point & { selected?: boolean }) | null>).detail;
      if (detail?.selected) {
        hovered = null;
        selected = { ...pointerPosition(detail.x, detail.y), time: performance.now() };
      } else {
        hovered = detail && pointerPosition(detail.x, detail.y);
      }
    }

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = previousFrame ? now - previousFrame : 16;
      if (light.matches && previousFrame && dt < 30) return;
      previousFrame = now;
      elapsedTime += Math.min(dt, 50);
      const ease = 1 - Math.exp(-dt / 240);

      packedWake.fill(0);
      for (const [index, stamp] of wake.entries()) {
        const age = Math.min(1, Math.max(0, (now - stamp.time) / 1800));
        const fade = (1 - age) ** 1.45 * Math.min(1, age * 17);
        const drift = 0.32 * (1 - Math.exp(-age * 3));
        packedWake.set(
          [
            stamp.x + (stamp.vx * drift * innerHeight) / innerWidth,
            stamp.y + stamp.vy * drift,
            stamp.vx * fade,
            stamp.vy * fade,
          ],
          index * 4,
        );
      }

      const selectionAge = selected ? Math.max(0, (now - selected.time) / 1450) : 1;
      const selection = selectionAge < 1 ? selected : null;
      const target = selection ?? hovered ?? glow;
      const intensity = selection ? 0.26 * Math.sin(Math.PI * selectionAge) : hovered ? 0.15 : 0;
      glow.x += (target.x - glow.x) * ease;
      glow.y += (target.y - glow.y) * ease;
      glow.intensity += (intensity - glow.intensity) * ease;
      activity += ((surface.dataset.moving ? 0.23 : 1) - activity) * ease;

      gl.uniform1f(time, elapsedTime / 10000);
      gl.uniform1f(activityUniform, activity);
      gl.uniform4fv(wakeUniform, packedWake);
      gl.uniform3f(
        rippleUniform,
        ripple?.x ?? 0,
        ripple?.y ?? 0,
        ripple ? Math.min(1, Math.max(0, (now - ripple.time) / 2050)) : 1,
      );
      gl.uniform3f(lightUniform, glow.x, glow.y, glow.intensity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!element.dataset.ready) element.dataset.ready = 'true';
    };

    const reset = () => {
      cancelAnimationFrame(frame);
      element.removeAttribute('data-ready');
      if (document.hidden || reduced.matches || gl.isContextLost()) return;
      const limit = light.matches ? 380 : 760;
      const scale = Math.min(0.66, limit / Math.max(innerWidth, innerHeight));
      element.width = Math.max(1, Math.round(innerWidth * scale));
      element.height = Math.max(1, Math.round(innerHeight * scale));
      gl.viewport(0, 0, element.width, element.height);
      gl.uniform2f(size, element.width, element.height);
      gl.uniform1f(radius, Math.min(250 / innerHeight, 0.64));
      wake.length = 0;
      previousFrame = 0;
      leave();
      frame = requestAnimationFrame(draw);
    };

    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerleave', leave);
    surface.addEventListener('click', tap);
    surface.addEventListener('product-light', highlight);
    window.addEventListener('resize', reset);
    document.addEventListener('visibilitychange', reset);
    element.addEventListener('webglcontextlost', reset);
    reduced.addEventListener('change', reset);
    light.addEventListener('change', reset);
    reset();
    return () => {
      cancelAnimationFrame(frame);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerleave', leave);
      surface.removeEventListener('click', tap);
      surface.removeEventListener('product-light', highlight);
      window.removeEventListener('resize', reset);
      document.removeEventListener('visibilitychange', reset);
      element.removeEventListener('webglcontextlost', reset);
      reduced.removeEventListener('change', reset);
      light.removeEventListener('change', reset);
      gl.deleteBuffer(vertices);
      gl.deleteProgram(program);
    };
  }, [screen]);

  return <canvas className="start-liquid" ref={canvas} aria-hidden="true" />;
}
