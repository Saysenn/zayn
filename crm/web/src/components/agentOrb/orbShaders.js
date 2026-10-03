/**
 * Diane's shaders.
 *
 * All displacement happens on the GPU, not in JS. That isn't a
 * micro-optimisation: the previous orb moved all 3,200 particles in a
 * per-frame JavaScript loop, and the particle counts this design needs
 * (30k-50k) would be ~2.4 million operations a second on the main thread.
 * Moving the maths into the vertex shader is what makes the density
 * possible at all.
 */

export const PARTICLE_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uScale;        // canvas height / reference height
  uniform float uAmbient;      // idle breathing amplitude
  uniform float uReactive;     // voice / thinking / pointer amplitude
  uniform float uDance;        // travelling-wave envelope
  uniform float uExplode;      // outward burst distance
  uniform float uFormIn;       // sign-in assembly distance
  // A RESTING scatter, and that is what makes it different from the two
  // above: both of those decay to zero, so nothing could hold the field
  // open. The briefing screen renders her full bleed and wants dust, not
  // a ball. See ParticleOrb's spread prop.
  uniform float uSpread;       // held-open scatter distance
  uniform float uBreath;       // whole-orb breathing scale

  attribute float aSize;
  attribute float aBrightness;
  attribute float aPhase;
  attribute vec3 aDrift;       // per-particle random direction, for burst/assembly

  varying float vBrightness;
  varying float vDepth;

  void main() {
    vec3 pos = position;
    float radius = length(pos);
    vec3 outward = radius > 0.0001 ? pos / radius : vec3(0.0, 1.0, 0.0);

    // Layered motion, not one rotation: a slow global swell, a faster
    // reactive component, and a wave that travels by height during a
    // dance. Each particle's own phase keeps them from moving in lockstep.
    float swell = uAmbient * sin(uTime * 1.3 + aPhase);
    float react = uReactive * sin(uTime * 6.0 + aPhase * 3.0);
    float wave  = uDance * 0.4 * sin(uTime * 9.0 - pos.y * 4.0 + aPhase);

    pos += outward * (swell + react + wave);
    pos += aDrift * (uExplode + uFormIn + uSpread);
    pos *= uBreath;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);

    // Depth drives both size and brightness in the fragment stage, which
    // is what gives the sphere a readable inside rather than a flat disc.
    vDepth = clamp((-mv.z - 2.0) / 6.0, 0.0, 1.0);
    vBrightness = aBrightness;

    // Perspective attenuation — particles at the back genuinely render
    // smaller instead of every point being the same screen size.
    //
    // Two things this has to get right, and an earlier version got each
    // one wrong in turn:
    //
    //  - The base constant used to be 300, which at a camera distance of
    //    7.4 made a bright particle ~360 device pixels ACROSS. Additively
    //    blended, thousands of them all overlapping, that was millions of
    //    fragments a frame for an orb a few hundred pixels wide — and the
    //    explode burst, which spreads them over even more screen, was the
    //    worst case of all. That was the stutter.
    //
    //  - But a fixed size is wrong too: the overlay grows this canvas from
    //    a ~300px box to most of a 1500px screen, and a 3px particle in a
    //    1500px frame is invisible dust. uScale ties the size to the
    //    canvas, so the orb looks the same at every size it's rendered at
    //    rather than dissolving as it gets bigger.
    //
    // The clamp is a hard ceiling for particles that drift near the camera
    // during a burst, so no single frame can blow up the fill cost.
    gl_PointSize = clamp(aSize * uPixelRatio * uScale * (9.0 / -mv.z), 1.0, 26.0);
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * Diane's core — a small glowing sphere at the centre of the field.
 *
 * A gradient rather than a solid ball: white-hot at the very middle,
 * through the mode colour, out to nothing well before its own edge. That
 * soft boundary is the whole trick — a hard-edged sphere in there would
 * read as a marble sitting inside a cloud, where this reads as the thing
 * the cloud is orbiting.
 *
 * Drawn on a flat quad that always faces the camera, so there's no
 * geometry to light and nothing that can look wrong from an angle.
 */
export const CORE_VERTEX = /* glsl */ `
  uniform float uSize;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // Billboarded: the view matrix's rotation is stripped out, so the quad
    // stays square-on to the camera however the orb turns.
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += (uv - 0.5) * uSize;
    gl_Position = projectionMatrix * mv;
  }
`;

export const CORE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;

  void main() {
    float d = length(vUv - 0.5) * 2.0;
    if (d > 1.0) discard;

    // Three bands: a tight white-hot centre, a broad coloured bloom, and a
    // long tail that reaches zero at the edge so nothing clips.
    float hot   = pow(max(0.0, 1.0 - d * 3.4), 3.0);
    float bloom = pow(max(0.0, 1.0 - d * 1.5), 2.2);
    float halo  = pow(max(0.0, 1.0 - d), 3.5);

    vec3 rgb = mix(uColor, vec3(1.0), clamp(hot, 0.0, 1.0));
    float alpha = (hot * 0.9 + bloom * 0.5 + halo * 0.35) * uIntensity;

    gl_FragColor = vec4(rgb, clamp(alpha, 0.0, 1.0));
  }
`;

export const PARTICLE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;

  varying float vBrightness;
  varying float vDepth;

  void main() {
    // Soft round sprite, computed rather than sampled from a texture —
    // one less asset and no texture fetch per fragment.
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float falloff = smoothstep(0.5, 0.0, d);
    falloff *= falloff;

    // Particles further back dim, so the centre of the sphere reads as
    // depth rather than as a bright core. Kept shallow: at 0.35 this was
    // multiplying an already-dim majority down into nothing, and the orb
    // lost its whole back half rather than gaining depth.
    float depthFade = mix(0.62, 1.0, 1.0 - vDepth);

    gl_FragColor = vec4(uColor * vBrightness, falloff * vBrightness * depthFade * uOpacity);
  }
`;
