import { useEffect, useRef } from 'react';

/**
 * Full-viewport animated WebGL background rendered behind the whole app.
 *
 * Design goals:
 *  - Sits at z-0 with pointer-events disabled; UI panels live at z-10 above it,
 *    so the shader only shows through transparent areas (mainly the chat area).
 *  - Mouse-reactive glow, kept intentionally dark so foreground text stays readable.
 *    Touch input is ignored (see onMove/onDown's pointerType guard) — on mobile
 *    every tap on ordinary UI (buttons, list rows) is a pointerdown on window,
 *    which used to snap the palette to a new hue and flash a pulse on every
 *    scroll/tap, reading as jittery flicker rather than reactive ambience.
 *  - Ambient palette drift always runs so the background keeps slowly cycling
 *    colour on its own instead of sitting static until a (mouse) click.
 *  - Cheap: capped device-pixel-ratio, pauses when the tab is hidden, and honours
 *    prefers-reduced-motion by freezing on a single frame.
 */

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';

const COMMON = `precision highp float;
uniform vec2 u_res;uniform float u_time;uniform vec4 u_mouse;uniform float u_pal;
// Rotate colour around the grey axis — each click shifts the whole palette.
vec3 hueShift(vec3 c,float a){vec3 k=vec3(0.57735);float ca=cos(a),sa=sin(a);
  return c*ca+cross(k,c)*sa+k*dot(k,c)*(1.0-ca);}
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  float a=hash(i),b=hash(i+vec2(1.0,0.0)),c=hash(i+vec2(0.0,1.0)),d=hash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*1.9+vec2(1.3,2.1);a*=0.5;}return v;}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
vec3 pal(float t,vec3 a,vec3 b,vec3 c,vec3 d){return a+b*cos(6.28318*(c*t+d));}
`;

// Fragment shaders tuned darker than the standalone wallpapers so the UI keeps
// its contrast. Warm-orange accents echo the app's brand colour.
const SHADERS: Record<string, string> = {
  // Theme 0 — "По умолчанию": warm nebula marble, brand-orange embers.
  default: `${COMMON}
  void main(){
    vec2 R=u_res;vec2 uv=(gl_FragCoord.xy-0.5*R)/R.y;vec2 m=(u_mouse.xy-0.5*R)/R.y;
    float t=u_time*0.09;
    vec2 p=uv*1.6;
    float mr=length(uv-m);
    p+=(uv-m)*0.5*exp(-mr*1.5)*(1.0+2.5*u_mouse.z);
    p*=rot(0.12*sin(t));
    vec2 w1=vec2(fbm(p+t),fbm(p+vec2(5.2,1.3)-t));
    vec2 w2=vec2(fbm(p+2.0*w1+vec2(1.7,9.2)+0.2*t),fbm(p+2.0*w1+vec2(8.3,2.8)));
    float f=fbm(p+2.6*w2);
    float warp=length(w2);
    vec3 hue=pal(f*0.75+warp*0.4+0.08*t,vec3(0.22,0.22,0.32),vec3(0.5,0.35,0.46),vec3(0.8,0.7,0.7),vec3(0.15,0.35,0.62));
    vec3 col=vec3(0.015,0.02,0.04);
    float density=smoothstep(0.30,0.85,f);
    col+=hue*density*0.95;
    float fil=pow(abs(sin(f*6.2831+t*2.0)),12.0);
    col+=hue*fil*(0.7+0.5*sin(t*3.0));
    float ember=pow(max(f-0.30,0.0),2.5)*smoothstep(0.42,0.72,fbm(p*0.7+vec2(t*0.6,-t*0.4)));
    col+=vec3(1.0,0.45,0.15)*ember*1.2;
    float len=length(uv);
    col*=mix(0.32,1.0,smoothstep(0.10,0.95,len));
    col+=vec3(1.0,0.55,0.25)*u_mouse.z*exp(-mr*2.5)*0.7;
    col=hueShift(col,u_pal);
    col=pow(col,vec3(1.05));
    gl_FragColor=vec4(col,1.0);
  }`,
};

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[ShaderBackground] shader compile failed:', gl.getShaderInfoLog(sh));
  }
  return sh;
}

export default function ShaderBackground({ variant = 'default' }: { variant?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = (canvas.getContext('webgl', { antialias: true, alpha: false }) ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return;

    const frag = SHADERS[variant] || SHADERS.default;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[ShaderBackground] link failed:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');
    const uPal = gl.getUniformLocation(prog, 'u_pal');

    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    let mx = canvas.width * 0.5;
    let my = canvas.height * 0.6;
    let tx = mx;
    let ty = my;
    let pulse = 0;
    // Palette angle in radians; every click sweeps the whole scene to a new
    // colour family (~93° per click walks the wheel without repeating soon).
    let palette = 0;
    let paletteTarget = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      tx = e.clientX * dpr;
      ty = (window.innerHeight - e.clientY) * dpr;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      tx = e.clientX * dpr;
      ty = (window.innerHeight - e.clientY) * dpr;
      pulse = 1.0;
      paletteTarget += 1.618;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });

    const reduce =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const start = performance.now();
    let raf = 0;
    let running = true;
    const draw = (now: number) => {
      mx += (tx - mx) * 0.07;
      my += (ty - my) * 0.07;
      pulse *= 0.93;
      // Ambient auto-drift: the palette always keeps sweeping slowly on its
      // own (full hue cycle in ~22s), on top of whatever a mouse click adds.
      if (!reduce) paletteTarget += 0.0048;
      palette += (paletteTarget - palette) * 0.05;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, reduce ? 0 : (now - start) / 1000);
      gl.uniform4f(uMouse, mx, my, pulse, 0);
      gl.uniform1f(uPal, palette);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (reduce) return; // single frame, then stop
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running && !reduce) {
        running = true;
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.removeEventListener('visibilitychange', onVisibility);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    };
  }, [variant]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
