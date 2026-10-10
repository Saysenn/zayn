// ***************************************************
// * COMMAND CENTER V2 SHADERS: the orb's volume, the rings, the stars
// ***************************************************

// ---- the orb ----------------------------------------------------------------
// The sphere is a window. Each pixel casts a ray from the camera into it and
// marches through the volume inside, adding up light: clouds (nebula),
// points of light (stars) or banded flowing water (tide). The glass is the
// rim (fresnel) and one soft highlight. The far side is where the ray leaves.

export const ORB_VERTEX = /* glsl */`
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const ORB_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec3 vWorld;
  varying vec3 vNormal;
  uniform float uTime, uEnergy, uLevel, uFlare, uRipple, uStyle, uError, uRadius;
  uniform vec3 uColorA, uColorB, uCenter;

  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 3.1; a *= 0.5; } return v; }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

  // what the volume holds at p (p in the unit ball), as light and colour mix
  vec4 sampleVolume(vec3 p, float t) {
    float r = length(p);
    float edge = smoothstep(1.0, 0.55, r);
    if (uStyle < 0.5) {
      // NEBULA: clouds folding over themselves
      vec3 q = p * 1.7;
      q.xz *= rot(t * 0.12 + r * 1.4 * (0.6 + uEnergy));
      q.xy *= rot(t * 0.07);
      float d = fbm(q + vec3(0.0, t * 0.08, 0.0) + fbm(q * 1.3 - t * 0.05) * 1.6);
      d = smoothstep(0.42, 0.95, d) * edge;
      float m = fbm(q * 0.8 + 5.0);
      return vec4(vec3(d * (0.9 + uEnergy)), m);
    } else if (uStyle < 1.5) {
      // STARS: a small galaxy of points drifting in dust
      vec3 q = p * 7.0;
      q.xz *= rot(t * 0.05 * (1.0 + uEnergy * 2.0));
      vec3 cell = floor(q); vec3 f = fract(q) - 0.5;
      float h = hash(cell);
      float star = step(0.86, h) * smoothstep(0.3, 0.0, length(f + (vec3(hash(cell + 1.7), hash(cell + 3.1), hash(cell + 5.3)) - 0.5) * 0.4));
      star *= 0.6 + 0.4 * sin(t * 3.0 + h * 60.0);
      float dust = smoothstep(0.55, 0.9, fbm(p * 2.2 + t * 0.03)) * 0.35;
      return vec4(vec3((star * 5.0 + dust * 1.6) * edge), h);
    }
    // TIDE: water turning on itself, bright where the currents meet
    vec3 q = p * 2.0;
    float swirl = r * 3.0 - t * (0.4 + uEnergy * 0.9);
    q.xz *= rot(swirl);
    float w = fbm(q + vec3(t * 0.15, 0.0, 0.0));
    float bands = abs(sin(w * 14.0 + t * 0.8));
    float caustic = smoothstep(0.12, 0.0, bands) * 1.6 + smoothstep(0.5, 0.95, w) * 0.5;
    return vec4(vec3(caustic * edge), 0.35 + q.y * 0.25);
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - cameraPosition);
    // modelMatrix is vertex-only: her centre and world radius come as uniforms
    vec3 c = uCenter;
    float R = uRadius;
    // where the ray leaves the sphere
    vec3 oc = ro - c;
    float b = dot(oc, rd);
    float h = b * b - (dot(oc, oc) - R * R);
    float tExit = -b + sqrt(max(h, 0.0));
    float tEnter = length(vWorld - ro);
    float len = max(tExit - tEnter, 0.0);

    float t = uTime;
    vec3 acc = vec3(0.0);
    float alpha = 0.0;
    const int STEPS = 40;
    float step = len / float(STEPS);
    for (int i = 0; i < STEPS; i++) {
      vec3 pw = vWorld + rd * (step * (float(i) + 0.5));
      vec3 p = (pw - c) / R;
      vec4 s = sampleVolume(p, t);
      float dens = s.r * step * 1.6;
      vec3 col = mix(uColorA, uColorB, clamp(s.a, 0.0, 1.0));
      col = mix(col, vec3(1.0), smoothstep(0.6, 1.4, s.r) * 0.5);
      acc += col * dens * (1.0 - alpha);
      alpha += dens * 0.35 * (1.0 - alpha);
      if (alpha > 0.96) break;
    }

    // the glass: a rim of light, a highlight, and the voice / ripple shells
    float fres = pow(1.0 - max(dot(normalize(vNormal), -rd), 0.0), 2.6);
    vec3 rim = mix(uColorB, vec3(1.0), 0.25) * fres * (1.1 + uEnergy * 0.8 + uFlare * 1.5 + uLevel * 1.2);
    vec3 L = normalize(vec3(-0.5, 0.7, 0.6));
    float spec = pow(max(dot(reflect(rd, normalize(vNormal)), L), 0.0), 64.0) * 0.55;
    float ripple = 0.0;
    if (uRipple > 0.0) ripple = smoothstep(0.06, 0.0, abs(fres - fract(uRipple))) * 0.8;
    vec3 col = acc * (1.0 + uLevel * 1.4 + uFlare * 1.2) + rim + spec + uColorA * ripple;
    col = mix(col, vec3(1.0, 0.25, 0.2) * (length(col) + 0.2), uError * 0.6);
    // deep glass: a faint body even where the volume is empty
    col += uColorB * 0.035;
    gl_FragColor = vec4(col, clamp(0.25 + alpha + fres * 0.6 + spec, 0.0, 1.0));
  }
`;

// ---- the rings --------------------------------------------------------------
// NEBULA / STARS: segmented orbits of light. TIDE (his call 2026-10-10:
// "match the tide inside … elasticity … atoms"): the same rings turn into
// elastic filaments that ripple and lift out of their plane, in strands,
// with bright electrons running round them. uWave eases 0 → 1 between them.
export const RING_VERTEX = /* glsl */`
  uniform float uTime, uWave, uPhase, uK, uRadius;
  varying vec2 vPos;
  void main() {
    vec3 p = position;
    float a = atan(p.y, p.x);
    float r = length(p.xy);
    float wob = sin(a * uK + uTime * 0.9 + uPhase) * 0.11
              + sin(a * (uK + 3.0) - uTime * 1.4 + uPhase * 1.7) * 0.045;
    p.xy = (p.xy / max(r, 1e-4)) * (r + wob * uWave * uRadius * 0.32);
    p.z += sin(a * 2.0 + uTime * 0.55 + uPhase) * 0.28 * uWave;
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
export const RING_FRAGMENT = /* glsl */`
  varying vec2 vPos;
  uniform float uTime, uSegs, uDash, uEnergy, uFlare, uRadius, uWave, uPhase, uStrand;
  uniform vec3 uColor;
  void main() {
    float a = atan(vPos.y, vPos.x) / 6.2831853 + 0.5;
    float seg = fract(a * uSegs);
    float dash = smoothstep(uDash, uDash - 0.04, seg) * smoothstep(0.0, 0.04, seg);
    // a bright head travelling round the orbit
    float head = pow(fract(a - uTime * 0.08 * (1.0 + uEnergy)), 18.0) * 2.0;
    // TIDE: one continuous filament, light flowing along it in bands, and electrons
    float flow = 0.25 + 0.75 * pow(abs(sin((a * 3.0 - uTime * 0.35 + uPhase) * 3.14159)), 5.0);
    float electrons = 0.0;
    for (int i = 0; i < 3; i++) {
      float e = fract(a - uTime * (0.11 + 0.04 * float(i)) * (1.0 + uEnergy) + float(i) / 3.0 + uPhase * 0.1);
      electrons += pow(max(1.0 - abs(e - 0.5) * 60.0, 0.0), 2.0) * 3.0;
    }
    float on = mix(dash * (0.35 + uEnergy * 0.4) + head, flow * (0.45 + uEnergy * 0.5) + electrons, uWave);
    float across = 1.0 - abs(length(vPos) - uRadius) * 40.0;
    float g = (on + uFlare * 0.5) * clamp(across, 0.2, 1.0) * mix(1.0, uWave, uStrand);
    gl_FragColor = vec4(uColor * g, g);
  }
`;

// ---- the stars --------------------------------------------------------------
export const STAR_VERTEX = /* glsl */`
  attribute float aSeed;
  uniform float uTime, uSize;
  varying float vTw;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vTw = 0.55 + 0.45 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 60.0);
    gl_PointSize = uSize * (0.6 + aSeed) * (24.0 / max(-mv.z, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;
export const STAR_FRAGMENT = /* glsl */`
  varying float vTw;
  uniform vec3 uColor;
  uniform float uTint;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float g = smoothstep(0.5, 0.0, d) * vTw;
    vec3 c = mix(vec3(0.85, 0.9, 1.0), uColor, uTint);
    gl_FragColor = vec4(c * g, g);
  }
`;
