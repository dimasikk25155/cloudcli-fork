import { useEffect, useRef } from 'react';

/**
 * "Aether" theme background — a real-time GPU fluid simulation (vorticity
 * confinement, Jacobi pressure solve, HDR dye, multi-scale bloom, procedural
 * starfield). Ported from a standalone WebGL demo the user found; this is
 * the canvas-only engine with all page chrome (title splash, hint bar,
 * toast, keyboard shortcuts, fullscreen toggle) stripped out, since here it
 * only needs to run as a silent backdrop behind the app UI — the original's
 * global keydown handlers (Space/P/B/S/C/Q/F/H) would otherwise fight with
 * typing in the chat input.
 *
 * Mouse-reactive stirring and idle ambient motion ("ghost" pointers) are
 * kept, matching the reactive feel of the other theme backgrounds. Touch
 * input is ignored entirely (see the pointerType guard in onPointerDown/
 * onPointerMove) — on mobile every tap on ordinary UI (buttons, list rows)
 * fires a pointerdown on window, which used to burst a splash of colour at
 * that spot on every scroll/tap, reading as flicker rather than ambience.
 * Ignoring touch lets the idle ghost drift (below) run continuously instead,
 * so the fluid keeps flowing on its own regardless of how often you tap.
 */

const baseVertexSource = `
precision highp float;
attribute vec2 aPosition;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;
void main () {
    vUv = aPosition * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const copySource = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
void main () {
    gl_FragColor = texture2D(uTexture, vUv);
}
`;

const clearSource = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
void main () {
    gl_FragColor = value * texture2D(uTexture, vUv);
}
`;

const splatSource = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
void main () {
    vec2 p = vUv - point.xy;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
}
`;

const advectionSource = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform vec2 dyeTexelSize;
uniform float dt;
uniform float dissipation;

vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
    vec2 st = uv / tsize - 0.5;
    vec2 iuv = floor(st);
    vec2 fuv = fract(st);
    vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
    vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
    vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
    vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}

void main () {
#ifdef MANUAL_FILTERING
    vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
    vec4 result = bilerp(uSource, coord, dyeTexelSize);
#else
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
    vec4 result = texture2D(uSource, coord);
#endif
    float decay = 1.0 + dissipation * dt;
    gl_FragColor = result / decay;
}
`;

const divergenceSource = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;
void main () {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;
    vec2 C = texture2D(uVelocity, vUv).xy;
    if (vL.x < 0.0) { L = -C.x; }
    if (vR.x > 1.0) { R = -C.x; }
    if (vT.y > 1.0) { T = -C.y; }
    if (vB.y < 0.0) { B = -C.y; }
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

const curlSource = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;
void main () {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`;

const vorticitySource = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
void main () {
    float L = texture2D(uCurl, vL).x;
    float R = texture2D(uCurl, vR).x;
    float T = texture2D(uCurl, vT).x;
    float B = texture2D(uCurl, vB).x;
    float C = texture2D(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity += force * dt;
    velocity = min(max(velocity, -1000.0), 1000.0);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

const pressureSource = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

const gradientSubtractSource = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

const bloomPrefilterSource = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform vec3 curve;
uniform float threshold;
void main () {
    vec3 c = texture2D(uTexture, vUv).rgb;
    float br = max(c.r, max(c.g, c.b));
    float rq = clamp(br - curve.x, 0.0, curve.y);
    rq = curve.z * rq * rq;
    c *= max(rq, br - threshold) / max(br, 0.0001);
    gl_FragColor = vec4(c, 0.0);
}
`;

const bloomBlurSource = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
void main () {
    vec4 sum = vec4(0.0);
    sum += texture2D(uTexture, vL);
    sum += texture2D(uTexture, vR);
    sum += texture2D(uTexture, vT);
    sum += texture2D(uTexture, vB);
    sum *= 0.25;
    gl_FragColor = sum;
}
`;

const bloomFinalSource = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
uniform float intensity;
void main () {
    vec4 sum = vec4(0.0);
    sum += texture2D(uTexture, vL);
    sum += texture2D(uTexture, vR);
    sum += texture2D(uTexture, vT);
    sum += texture2D(uTexture, vB);
    sum *= 0.25;
    gl_FragColor = sum * intensity;
}
`;

const displaySource = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
uniform sampler2D uBloom;
uniform vec2 texelSize;
uniform float uTime;
uniform float uAspect;
uniform vec3 uTint;
uniform float uCA;

float hash12 (vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float starLayer (vec2 uv, float t) {
    vec2 id = floor(uv);
    vec2 f = fract(uv) - 0.5;
    float h = hash12(id);
    vec2 off = vec2(hash12(id + 17.31), hash12(id + 47.77)) - 0.5;
    float d = length(f - off * 0.7);
    float star = smoothstep(0.10, 0.0, d);
    float tw = 0.6 + 0.4 * sin(t * (0.8 + h * 2.5) + h * 41.0);
    return star * tw * step(0.80, h) * (h - 0.80) * 5.0;
}

vec3 linearToGamma (vec3 color) {
    color = max(color, vec3(0.0));
    return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0.0));
}

void main () {
    vec2 dir = vUv - vec2(0.5);
    float r2 = dot(dir, dir);

    vec2 caOff = dir * (uCA * 0.014 * r2);
    vec3 c;
    c.r = texture2D(uTexture, vUv + caOff).r;
    c.g = texture2D(uTexture, vUv).g;
    c.b = texture2D(uTexture, vUv - caOff).b;

#ifdef SHADING
    vec3 lc = texture2D(uTexture, vL).rgb;
    vec3 rc = texture2D(uTexture, vR).rgb;
    vec3 tc = texture2D(uTexture, vT).rgb;
    vec3 bc = texture2D(uTexture, vB).rgb;
    float dx = length(rc) - length(lc);
    float dy = length(tc) - length(bc);
    vec3 n = normalize(vec3(dx, dy, length(texelSize)));
    vec3 l = vec3(0.0, 0.0, 1.0);
    float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
    c *= diffuse;
#endif

#ifdef BLOOM
    vec3 bloom = texture2D(uBloom, vUv).rgb;
    bloom = linearToGamma(bloom);
    c += bloom;
#endif

    float lum = max(c.r, max(c.g, c.b));

    vec2 suv = vec2(vUv.x * uAspect, vUv.y);
    float stars = starLayer(suv * 21.0, uTime);
    stars += starLayer(suv * 43.0 + 7.31, uTime * 1.37) * 0.55;
    vec3 bg = uTint * (1.45 - smoothstep(0.0, 0.55, r2));
    bg += vec3(0.75, 0.85, 1.0) * (stars * 0.55);
    c += bg * smoothstep(0.45, 0.0, lum);

    float vig = 1.0 - 0.38 * smoothstep(0.12, 0.62, r2);
    c *= vig;

    c += vec3(hash12(gl_FragCoord.xy + vec2(fract(uTime) * 61.7)) - 0.5) / 255.0;

    gl_FragColor = vec4(c, 1.0);
}
`;

const QUALITY = [
  { name: 'Cinema', dye: 1440, sim: 192 },
  { name: 'Lush', dye: 1024, sim: 144 },
  { name: 'Swift', dye: 720, sim: 128 },
  { name: 'Eco', dye: 512, sim: 96 },
];

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

// Brand-orange embers on dark, matching the warm accent used across the app
// rather than the demo's default rainbow-cycling palette.
const PALETTE_TINT = [0.035, 0.011, 0.006];
function paletteColor(t: number): [number, number, number] {
  t = ((t % 1) + 1) % 1;
  const a = [0.55, 0.26, 0.11];
  const b = [0.45, 0.3, 0.16];
  const c = [1.0, 1.0, 1.0];
  const d = [0.0, 0.14, 0.29];
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = clamp01(a[i] + b[i] * Math.cos(6.28318530718 * (c[i] * t + d[i])));
  }
  return out;
}
function scaleColor(c: [number, number, number], s: number): [number, number, number] {
  return [c[0] * s, c[1] * s, c[2] * s];
}

export default function AetherShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    let gl: any = null;
    let ext: any = null;
    let bloomAvailable = true;
    let blit: any = null;

    const config = {
      SIM_RESOLUTION: 144,
      DYE_RESOLUTION: 1024,
      DENSITY_DISSIPATION: 1.1,
      VELOCITY_DISSIPATION: 0.25,
      PRESSURE: 0.8,
      PRESSURE_ITERATIONS: 22,
      CURL: 26,
      SPLAT_RADIUS: 0.25,
      SPLAT_FORCE: 6000,
      SHADING: true,
      BLOOM: true,
      BLOOM_ITERATIONS: 8,
      BLOOM_RESOLUTION: 256,
      BLOOM_INTENSITY: 0.7,
      BLOOM_THRESHOLD: 0.6,
      BLOOM_SOFT_KNEE: 0.7,
      ABERRATION: true,
    };
    let qualityIndex = 1;

    let dye: any = null;
    let velocity: any = null;
    let divergence: any = null;
    let curl: any = null;
    let pressure: any = null;
    let bloom: any = null;
    let bloomFramebuffers: any[] = [];

    let baseVertexShader: any = null;
    let copyProgram: any, clearProgram: any, splatProgram: any, advectionProgram: any;
    let divergenceProgram: any, curlProgram: any, vorticityProgram: any, pressureProgram: any, gradientSubtractProgram: any;
    let bloomPrefilterProgram: any, bloomBlurProgram: any, bloomFinalProgram: any;
    let displayCache: Record<string, any> = {};

    let simTime = 0;
    let lastInteraction = -10;
    let idleK = 0;

    const reducedMotion =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ghosts = Array.from({ length: 3 }, () => ({
      f1: 0.05 + Math.random() * 0.16,
      f2: 0.05 + Math.random() * 0.16,
      f3: 0.05 + Math.random() * 0.16,
      f4: 0.05 + Math.random() * 0.16,
      p1: Math.random() * 6.283,
      p2: Math.random() * 6.283,
      p3: Math.random() * 6.283,
      p4: Math.random() * 6.283,
      hue: Math.random(),
      x: 0.5,
      y: 0.5,
      hasPrev: false,
    }));

    function scaleByPixelRatio(input: number) {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      return Math.floor(input * pixelRatio);
    }

    function resizeCanvas() {
      const w = scaleByPixelRatio(canvas!.clientWidth || window.innerWidth);
      const h = scaleByPixelRatio(canvas!.clientHeight || window.innerHeight);
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
        return true;
      }
      return false;
    }

    function getWebGLContext() {
      const params = {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance' as WebGLPowerPreference,
      };
      let context: any = canvas!.getContext('webgl2', params);
      const isWebGL2 = !!context;
      if (!isWebGL2) {
        context = canvas!.getContext('webgl', params) || canvas!.getContext('experimental-webgl', params);
      }
      if (!context) return null;

      if (isWebGL2) {
        context.getExtension('EXT_color_buffer_float');
        context.getExtension('EXT_color_buffer_half_float');
      }

      function formatsFor(type: any) {
        let rgba, rg, r;
        if (isWebGL2) {
          const half = type === context.HALF_FLOAT;
          const RGBA_IF = half ? context.RGBA16F : context.RGBA32F;
          const RG_IF = half ? context.RG16F : context.RG32F;
          const R_IF = half ? context.R16F : context.R32F;
          rgba = supportRenderTextureFormatWith(context, RGBA_IF, context.RGBA, type)
            ? { internalFormat: RGBA_IF, format: context.RGBA }
            : null;
          if (!rgba) return null;
          rg = supportRenderTextureFormatWith(context, RG_IF, context.RG, type)
            ? { internalFormat: RG_IF, format: context.RG }
            : rgba;
          r = supportRenderTextureFormatWith(context, R_IF, context.RED, type)
            ? { internalFormat: R_IF, format: context.RED }
            : rgba;
        } else {
          rgba = supportRenderTextureFormatWith(context, context.RGBA, context.RGBA, type)
            ? { internalFormat: context.RGBA, format: context.RGBA }
            : null;
          if (!rgba) return null;
          rg = rgba;
          r = rgba;
        }
        return { rgba, rg, r };
      }

      function supportRenderTextureFormatWith(g: any, internalFormat: any, format: any, type: any) {
        const texture = g.createTexture();
        g.activeTexture(g.TEXTURE0);
        g.bindTexture(g.TEXTURE_2D, texture);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        g.texImage2D(g.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
        const fbo = g.createFramebuffer();
        g.bindFramebuffer(g.FRAMEBUFFER, fbo);
        g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0);
        const ok = g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE;
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        g.deleteFramebuffer(fbo);
        g.deleteTexture(texture);
        return ok;
      }

      let texType: any = null;
      let fmts: any = null;
      let supportLinearFiltering = false;

      if (isWebGL2) {
        fmts = formatsFor(context.HALF_FLOAT);
        if (fmts) {
          texType = context.HALF_FLOAT;
          supportLinearFiltering = true;
        } else {
          fmts = formatsFor(context.FLOAT);
          if (fmts) {
            texType = context.FLOAT;
            supportLinearFiltering = !!context.getExtension('OES_texture_float_linear');
          }
        }
      } else {
        const hf = context.getExtension('OES_texture_half_float');
        if (hf) {
          fmts = formatsFor(hf.HALF_FLOAT_OES);
          if (fmts) {
            texType = hf.HALF_FLOAT_OES;
            supportLinearFiltering = !!context.getExtension('OES_texture_half_float_linear');
          }
        }
        if (!fmts && context.getExtension('OES_texture_float')) {
          fmts = formatsFor(context.FLOAT);
          if (fmts) {
            texType = context.FLOAT;
            supportLinearFiltering = !!context.getExtension('OES_texture_float_linear');
          }
        }
      }

      if (!fmts) return { gl: context, unsupported: true };

      context.clearColor(0.0, 0.0, 0.0, 1.0);

      return {
        gl: context,
        ext: {
          formatRGBA: fmts.rgba,
          formatRG: fmts.rg,
          formatR: fmts.r,
          halfFloatTexType: texType,
          supportLinearFiltering,
        },
      };
    }

    function compileShader(type: any, source: string, keywords?: string[]) {
      if (keywords && keywords.length) {
        source = keywords.map((k) => '#define ' + k + '\n').join('') + source;
      }
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('[AetherShaderBackground] shader compile failed:', gl.getShaderInfoLog(shader));
      }
      return shader;
    }

    function createProgram(vertexShader: any, fragmentShader: any) {
      const program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.bindAttribLocation(program, 0, 'aPosition');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('[AetherShaderBackground] program link failed:', gl.getProgramInfoLog(program));
      }
      return program;
    }

    function getUniforms(program: any) {
      const uniforms: Record<string, any> = {};
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i++) {
        const name = gl.getActiveUniform(program, i).name;
        uniforms[name] = gl.getUniformLocation(program, name);
      }
      return uniforms;
    }

    function makeProgram(vertexShader: any, fragmentShader: any) {
      const program = createProgram(vertexShader, fragmentShader);
      return { program, uniforms: getUniforms(program), bind: () => gl.useProgram(program) };
    }

    function setupBlit() {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(0);
      blit = (target: any, clear?: boolean) => {
        if (target == null) {
          gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } else {
          gl.viewport(0, 0, target.width, target.height);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        if (clear) {
          gl.clearColor(0.0, 0.0, 0.0, 1.0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      };
    }

    function createFBO(w: number, h: number, internalFormat: any, format: any, type: any, param: any) {
      gl.activeTexture(gl.TEXTURE0);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);

      return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX: 1.0 / w,
        texelSizeY: 1.0 / h,
        attach(id: number) {
          gl.activeTexture(gl.TEXTURE0 + id);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          return id;
        },
      };
    }

    function destroyFBO(f: any) {
      if (!f) return;
      gl.deleteTexture(f.texture);
      gl.deleteFramebuffer(f.fbo);
    }

    function createDoubleFBO(w: number, h: number, internalFormat: any, format: any, type: any, param: any) {
      let fbo1 = createFBO(w, h, internalFormat, format, type, param);
      let fbo2 = createFBO(w, h, internalFormat, format, type, param);
      return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read() {
          return fbo1;
        },
        set read(value) {
          fbo1 = value;
        },
        get write() {
          return fbo2;
        },
        set write(value) {
          fbo2 = value;
        },
        swap() {
          const temp = fbo1;
          fbo1 = fbo2;
          fbo2 = temp;
        },
      };
    }

    function destroyDoubleFBO(f: any) {
      if (!f) return;
      destroyFBO(f.read);
      destroyFBO(f.write);
    }

    function resizeFBO(target: any, w: number, h: number, internalFormat: any, format: any, type: any, param: any) {
      const newFBO = createFBO(w, h, internalFormat, format, type, param);
      copyProgram.bind();
      gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
      blit(newFBO);
      destroyFBO(target);
      return newFBO;
    }

    function resizeDoubleFBO(target: any, w: number, h: number, internalFormat: any, format: any, type: any, param: any) {
      if (target.width === w && target.height === h) return target;
      target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
      destroyFBO(target.write);
      target.write = createFBO(w, h, internalFormat, format, type, param);
      target.width = w;
      target.height = h;
      target.texelSizeX = 1.0 / w;
      target.texelSizeY = 1.0 / h;
      return target;
    }

    function getResolution(resolution: number) {
      let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
      if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
      const min = Math.round(resolution);
      const max = Math.round(resolution * aspectRatio);
      if (gl.drawingBufferWidth > gl.drawingBufferHeight) return { width: max, height: min };
      return { width: min, height: max };
    }

    function initFramebuffers() {
      const simRes = getResolution(config.SIM_RESOLUTION);
      const dyeRes = getResolution(config.DYE_RESOLUTION);
      const texType = ext.halfFloatTexType;
      const rgba = ext.formatRGBA;
      const rg = ext.formatRG;
      const r = ext.formatR;
      const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

      gl.disable(gl.BLEND);

      if (dye == null) dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
      else dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);

      if (velocity == null) velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
      else velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);

      destroyFBO(divergence);
      divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
      destroyFBO(curl);
      curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
      destroyDoubleFBO(pressure);
      pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);

      initBloomFramebuffers();
    }

    function initBloomFramebuffers() {
      destroyFBO(bloom);
      bloom = null;
      for (let i = 0; i < bloomFramebuffers.length; i++) destroyFBO(bloomFramebuffers[i]);
      bloomFramebuffers = [];
      if (!bloomAvailable) return;

      const res = getResolution(config.BLOOM_RESOLUTION);
      const rgba = ext.formatRGBA;
      const texType = ext.halfFloatTexType;

      bloom = createFBO(res.width, res.height, rgba.internalFormat, rgba.format, texType, gl.LINEAR);
      for (let i = 0; i < config.BLOOM_ITERATIONS; i++) {
        const width = res.width >> (i + 1);
        const height = res.height >> (i + 1);
        if (width < 2 || height < 2) break;
        bloomFramebuffers.push(createFBO(width, height, rgba.internalFormat, rgba.format, texType, gl.LINEAR));
      }
    }

    function compileAllPrograms() {
      setupBlit();
      baseVertexShader = compileShader(gl.VERTEX_SHADER, baseVertexSource);
      copyProgram = makeProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, copySource));
      clearProgram = makeProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, clearSource));
      splatProgram = makeProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, splatSource));
      advectionProgram = makeProgram(
        baseVertexShader,
        compileShader(gl.FRAGMENT_SHADER, advectionSource, ext.supportLinearFiltering ? undefined : ['MANUAL_FILTERING'])
      );
      divergenceProgram = makeProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, divergenceSource));
      curlProgram = makeProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, curlSource));
      vorticityProgram = makeProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, vorticitySource));
      pressureProgram = makeProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, pressureSource));
      gradientSubtractProgram = makeProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, gradientSubtractSource));
      bloomPrefilterProgram = makeProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, bloomPrefilterSource));
      bloomBlurProgram = makeProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, bloomBlurSource));
      bloomFinalProgram = makeProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, bloomFinalSource));
      displayCache = {};
    }

    function getDisplayProgram() {
      const key = (config.SHADING ? 1 : 0) | (config.BLOOM ? 2 : 0);
      let prog = displayCache[key];
      if (!prog) {
        const kw: string[] = [];
        if (config.SHADING) kw.push('SHADING');
        if (config.BLOOM) kw.push('BLOOM');
        prog = makeProgram(baseVertexShader, compileShader(gl.FRAGMENT_SHADER, displaySource, kw));
        displayCache[key] = prog;
      }
      return prog;
    }

    function step(dt: number) {
      gl.disable(gl.BLEND);

      curlProgram.bind();
      gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
      blit(curl);

      vorticityProgram.bind();
      gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
      gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
      gl.uniform1f(vorticityProgram.uniforms.dt, dt);
      blit(velocity.write);
      velocity.swap();

      divergenceProgram.bind();
      gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
      blit(divergence);

      clearProgram.bind();
      gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
      gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
      blit(pressure.write);
      pressure.swap();

      pressureProgram.bind();
      gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
      for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
        blit(pressure.write);
        pressure.swap();
      }

      gradientSubtractProgram.bind();
      gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
      gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
      blit(velocity.write);
      velocity.swap();

      advectionProgram.bind();
      gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      if (!ext.supportLinearFiltering) {
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
      }
      const velocityId = velocity.read.attach(0);
      gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
      gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
      gl.uniform1f(advectionProgram.uniforms.dt, dt);
      gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
      blit(velocity.write);
      velocity.swap();

      if (!ext.supportLinearFiltering) {
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
      }
      gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
      gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
      blit(dye.write);
      dye.swap();
    }

    function applyBloom(source: any, destination: any) {
      if (!destination || bloomFramebuffers.length < 2) return;

      let last = destination;
      gl.disable(gl.BLEND);

      bloomPrefilterProgram.bind();
      const knee = config.BLOOM_THRESHOLD * config.BLOOM_SOFT_KNEE + 0.0001;
      const curve0 = config.BLOOM_THRESHOLD - knee;
      const curve1 = knee * 2.0;
      const curve2 = 0.25 / knee;
      gl.uniform3f(bloomPrefilterProgram.uniforms.curve, curve0, curve1, curve2);
      gl.uniform1f(bloomPrefilterProgram.uniforms.threshold, config.BLOOM_THRESHOLD);
      gl.uniform1i(bloomPrefilterProgram.uniforms.uTexture, source.attach(0));
      blit(last);

      bloomBlurProgram.bind();
      for (let i = 0; i < bloomFramebuffers.length; i++) {
        const dest = bloomFramebuffers[i];
        gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0));
        blit(dest);
        last = dest;
      }

      gl.blendFunc(gl.ONE, gl.ONE);
      gl.enable(gl.BLEND);
      for (let i = bloomFramebuffers.length - 2; i >= 0; i--) {
        const baseTex = bloomFramebuffers[i];
        gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0));
        blit(baseTex);
        last = baseTex;
      }
      gl.disable(gl.BLEND);

      bloomFinalProgram.bind();
      gl.uniform2f(bloomFinalProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
      gl.uniform1i(bloomFinalProgram.uniforms.uTexture, last.attach(0));
      gl.uniform1f(bloomFinalProgram.uniforms.intensity, config.BLOOM_INTENSITY);
      blit(destination);
    }

    function drawDisplay(target: any) {
      const width = target == null ? gl.drawingBufferWidth : target.width;
      const height = target == null ? gl.drawingBufferHeight : target.height;
      const prog = getDisplayProgram();
      prog.bind();
      gl.uniform2f(prog.uniforms.texelSize, 1.0 / width, 1.0 / height);
      gl.uniform1i(prog.uniforms.uTexture, dye.read.attach(0));
      if (config.BLOOM && bloom) gl.uniform1i(prog.uniforms.uBloom, bloom.attach(1));
      gl.uniform1f(prog.uniforms.uTime, simTime % 3600.0);
      gl.uniform1f(prog.uniforms.uAspect, width / height);
      gl.uniform3f(prog.uniforms.uTint, PALETTE_TINT[0], PALETTE_TINT[1], PALETTE_TINT[2]);
      gl.uniform1f(prog.uniforms.uCA, config.ABERRATION ? 1.0 : 0.0);
      blit(target);
    }

    function render() {
      if (config.BLOOM) applyBloom(dye.read, bloom);
      gl.disable(gl.BLEND);
      drawDisplay(null);
    }

    function correctRadius(radius: number) {
      const aspectRatio = canvas!.width / canvas!.height;
      if (aspectRatio > 1) radius *= aspectRatio;
      return radius;
    }

    function splat(x: number, y: number, dx: number, dy: number, color: [number, number, number], radiusScale = 1.0) {
      gl.disable(gl.BLEND);

      splatProgram.bind();
      gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
      gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas!.width / canvas!.height);
      gl.uniform2f(splatProgram.uniforms.point, x, y);
      gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
      gl.uniform1f(splatProgram.uniforms.radius, correctRadius((config.SPLAT_RADIUS / 100.0) * radiusScale));
      blit(velocity.write);
      velocity.swap();

      gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
      gl.uniform3f(splatProgram.uniforms.color, color[0], color[1], color[2]);
      blit(dye.write);
      dye.swap();
    }

    function burst(x: number, y: number, power: number, count: number) {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2.0 + (Math.random() - 0.5) * 0.6;
        const speed = (500 + Math.random() * 700) * power;
        const col = scaleColor(paletteColor(Math.random() * 0.4 + simTime * 0.05 + 0.03 * i), 0.2 + Math.random() * 0.18);
        splat(x, y, Math.cos(a) * speed, Math.sin(a) * speed, col, 0.7 + Math.random() * 0.8);
      }
    }

    function introSplats() {
      for (let i = 0; i < 16; i++) {
        const col = scaleColor(paletteColor(Math.random()), 0.25 + Math.random() * 0.3);
        splat(
          0.15 + Math.random() * 0.7,
          0.15 + Math.random() * 0.7,
          (Math.random() - 0.5) * 1600,
          (Math.random() - 0.5) * 1600,
          col,
          1.0 + Math.random()
        );
      }
    }

    function noteInteraction() {
      lastInteraction = simTime;
    }

    function updateIdle(dt: number) {
      const target = reducedMotion || simTime - lastInteraction < 2.5 ? 0 : 1;
      idleK += (target - idleK) * (1 - Math.exp(-dt * 1.5));
    }

    function updateGhosts() {
      if (reducedMotion) return;
      for (let i = 0; i < ghosts.length; i++) {
        const g = ghosts[i];
        const t = simTime;
        const x = 0.5 + 0.36 * Math.sin(t * g.f1 + g.p1) * Math.cos(t * g.f2 + g.p2);
        const y = 0.5 + 0.34 * Math.sin(t * g.f3 + g.p3) * Math.cos(t * g.f4 + g.p4);
        if (g.hasPrev && idleK > 0.02) {
          const dx = x - g.x;
          const dy = y - g.y;
          if (Math.abs(dx) + Math.abs(dy) > 0.00001) {
            // Idle drift is now the primary mobile experience (touch never
            // triggers noteInteraction), so it cycles hue noticeably faster
            // than before (~18s per revolution vs. the original ~45s).
            const col = scaleColor(paletteColor(t * 0.055 + g.hue), 0.1 * idleK);
            splat(x, y, dx * 9000 * idleK, dy * 9000 * idleK, col, 0.55);
          }
        }
        g.x = x;
        g.y = y;
        g.hasPrev = true;
      }
    }

    const pointers = new Map<number, any>();

    function pointerFromEvent(e: PointerEvent) {
      let p = pointers.get(e.pointerId);
      if (!p) {
        p = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, moved: false, down: false, inited: false, seed: Math.random() };
        pointers.set(e.pointerId, p);
      }
      const rect = canvas!.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1.0 - (e.clientY - rect.top) / rect.height;
      if (!p.inited) {
        p.px = x;
        p.py = y;
        p.inited = true;
      } else {
        p.px = p.x;
        p.py = p.y;
      }
      p.x = x;
      p.y = y;
      return p;
    }

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType === 'touch') return;
      const p = pointerFromEvent(e);
      p.down = true;
      p.moved = false;
      if (velocity) burst(p.x, p.y, 0.75, 9);
      noteInteraction();
    }

    function onPointerMove(e: PointerEvent) {
      if (e.pointerType === 'touch') return;
      const p = pointerFromEvent(e);
      p.moved = true;
      noteInteraction();
    }

    function releasePointer(e: PointerEvent) {
      const p = pointers.get(e.pointerId);
      if (p) p.down = false;
      if (e.pointerType !== 'mouse') pointers.delete(e.pointerId);
    }

    function correctDeltaX(delta: number) {
      const aspectRatio = canvas!.width / canvas!.height;
      if (aspectRatio < 1) delta *= aspectRatio;
      return delta;
    }
    function correctDeltaY(delta: number) {
      const aspectRatio = canvas!.width / canvas!.height;
      if (aspectRatio > 1) delta /= aspectRatio;
      return delta;
    }

    function applyPointerSplats() {
      pointers.forEach((p) => {
        if (!p.moved) return;
        p.moved = false;
        const dx = correctDeltaX(p.x - p.px) * config.SPLAT_FORCE;
        const dy = correctDeltaY(p.y - p.py) * config.SPLAT_FORCE;
        const k = p.down ? 1.0 : 0.42;
        const col = scaleColor(paletteColor(simTime * 0.1 + p.seed), p.down ? 0.22 : 0.12);
        splat(p.x, p.y, dx * k, dy * k, col, p.down ? 1.0 : 0.62);
      });
    }

    function applyQuality(idx: number) {
      qualityIndex = Math.max(0, Math.min(idx, QUALITY.length - 1));
      const q = QUALITY[qualityIndex];
      config.DYE_RESOLUTION = q.dye;
      config.SIM_RESOLUTION = q.sim;
      initFramebuffers();
    }

    let perfEma = 16.7;
    let perfWarmup = 180;
    let perfAutoDrops = 0;
    let perfLastDrop = 0;
    let perfSkipUntil = 0;

    function onVisibilityChange() {
      if (!document.hidden) {
        lastTime = performance.now();
        perfSkipUntil = performance.now() + 1000;
      }
    }

    function perfCheck(now: number, rawDt: number) {
      if (now < perfSkipUntil) return;
      if (perfWarmup > 0) {
        perfWarmup--;
        return;
      }
      perfEma = perfEma * 0.96 + Math.min(rawDt * 1000, 100) * 0.04;
      if (perfEma > 34 && qualityIndex < QUALITY.length - 1 && perfAutoDrops < 2 && now - perfLastDrop > 4000) {
        perfAutoDrops++;
        perfLastDrop = now;
        perfEma = 16.7;
        applyQuality(qualityIndex + 1);
      }
    }

    let lastTime = performance.now();

    function frame(now: number) {
      rafId = requestAnimationFrame(frame);
      let rawDt = (now - lastTime) / 1000;
      lastTime = now;
      if (!(rawDt >= 0)) rawDt = 0;
      const dt = Math.min(rawDt, 0.033);
      simTime += dt;

      if (resizeCanvas()) initFramebuffers();
      updateIdle(dt);
      updateGhosts();
      applyPointerSplats();
      step(dt);
      render();
      perfCheck(now, rawDt);
    }

    function onResize() {
      if (resizeCanvas()) initFramebuffers();
    }

    function bootGL() {
      const ctx = getWebGLContext();
      if (!ctx || (ctx as any).unsupported) return;
      gl = (ctx as any).gl;
      ext = (ctx as any).ext;

      bloomAvailable = ext.supportLinearFiltering;
      if (!bloomAvailable) config.BLOOM = false;

      resizeCanvas();
      compileAllPrograms();
      initFramebuffers();
      introSplats();

      lastTime = performance.now();
      perfWarmup = 180;
      rafId = requestAnimationFrame(frame);
    }

    function onContextLost(e: Event) {
      e.preventDefault();
      cancelAnimationFrame(rafId);
    }
    function onContextRestored() {
      try {
        bootGL();
      } catch (err) {
        console.warn('[AetherShaderBackground] failed to recover WebGL context:', err);
      }
    }

    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    window.addEventListener('resize', onResize);
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    document.addEventListener('visibilitychange', onVisibilityChange);

    try {
      bootGL();
    } catch (err) {
      console.warn('[AetherShaderBackground] failed to start:', err);
    }

    return () => {
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('pointercancel', releasePointer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (gl) {
        const loseCtx = gl.getExtension('WEBGL_lose_context');
        if (loseCtx) loseCtx.loseContext();
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
