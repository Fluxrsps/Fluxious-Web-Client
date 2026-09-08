// The interface shader, both stages. See vertui.glsl and fragui.glsl; this is the same shader for the
// WebGPU backend, which takes one module with both entry points rather than two.
//
// One difference from the WebGL2 pair: there is no second texture for the world. WebGPU renders the
// scene into the swapchain image directly, so this pass loads what is already there and blends over
// it rather than sampling it.

struct UiUniforms {
    sourceDimensions: vec2f,
    targetDimensions: vec2f,
    overlay: vec4f,
    sampling: f32,
    forceOpaque: f32,
    colourblindMode: f32,
    colourblindIntensity: f32,
};

@group(0) @binding(0) var uiSampler: sampler;
@group(0) @binding(1) var uiTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> ui: UiUniforms;

const SAMPLING_NEAREST: f32 = 0.0;
const SAMPLING_LINEAR: f32 = 1.0;
const SAMPLING_MITCHELL: f32 = 2.0;
const SAMPLING_CATROM: f32 = 3.0;
const SAMPLING_XBR: f32 = 4.0;
const SAMPLING_HYBRID: f32 = 5.0;

const CR_AR_STRENGTH: f32 = 0.9;

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

// One triangle covering the viewport: cheaper than a quad and avoids the seam a two-triangle quad
// can show along its diagonal.
@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
    var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    var uvs = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));

    var out: VertexOut;
    out.position = vec4f(positions[index], 0.0, 1.0);
    out.uv = uvs[index];

    return out;
}

#include "colorblind.wgsl"

// Bicubic sampling; see bicubic.glsl.
fn catmullRom(x: f32) -> f32 {
    let t = abs(x);
    let t2 = t * t;
    let t3 = t2 * t;

    if (t < 1.0) { return 1.5 * t3 - 2.5 * t2 + 1.0; }
    if (t < 2.0) { return -0.5 * t3 + 2.5 * t2 - 4.0 * t + 2.0; }

    return 0.0;
}

fn mitchell(x: f32) -> f32 {
    let t = abs(x);
    let t2 = t * t;
    let t3 = t2 * t;

    if (t < 1.0) { return 7.0 / 6.0 * t3 - 2.0 * t2 + 8.0 / 9.0; }
    if (t < 2.0) { return -7.0 / 18.0 * t3 + 2.0 * t2 - 10.0 / 3.0 * t + 16.0 / 9.0; }

    return 0.0;
}

fn textureCubic(uv: vec2f, catrom: bool) -> vec4f {
    let size = ui.sourceDimensions;
    let texel = 1.0 / size;
    let fractional = fract(uv * size - 0.5);
    let base = uv - fractional * texel;

    var sum = vec4f(0.0);
    var denominator = 0.0;
    var lowest = vec4f(1.0);
    var highest = vec4f(0.0);

    for (var m = -1; m <= 2; m = m + 1) {
        for (var n = -1; n <= 2; n = n + 1) {
            let offset = vec2f(f32(m), f32(n));
            let sampled = textureSampleLevel(uiTexture, uiSampler, base + offset * texel, 0.0);

            lowest = min(lowest, sampled);
            highest = max(highest, sampled);

            let d = length(offset - fractional);
            var weight = mitchell(d);

            if (catrom) { weight = catmullRom(d); }

            sum = sum + sampled * weight;
            denominator = denominator + weight;
        }
    }

    var c = sum / denominator;

    if (catrom) {
        // Anti-ringing: a sharpening filter can overshoot past any colour actually present.
        c = mix(c, clamp(c, lowest, highest), CR_AR_STRENGTH);
    }

    return c;
}

// Hybrid scaling; see hybrid.glsl.
fn textureHybrid(uv: vec2f) -> vec4f {
    let source = ui.sourceDimensions;
    let scaled = uv * source;
    let within = fract(scaled);
    let perTexel = ui.targetDimensions / source;
    let amount = min(within * perTexel, vec2f(0.5)) - min((vec2f(1.0) - within) * perTexel, vec2f(0.5));

    return textureSampleLevel(uiTexture, uiSampler, (floor(scaled) + 0.5 + amount) / source, 0.0);
}

#include "xbr.wgsl"

fn sampleUi(uv: vec2f) -> vec4f {
    if (ui.sampling == SAMPLING_MITCHELL) { return textureCubic(uv, false); }
    if (ui.sampling == SAMPLING_CATROM) { return textureCubic(uv, true); }
    if (ui.sampling == SAMPLING_HYBRID) { return textureHybrid(uv); }
    if (ui.sampling == SAMPLING_XBR) {
        return textureXBR(uv, ceil(ui.targetDimensions.x / ui.sourceDimensions.x));
    }

    // NEAREST and LINEAR use the sampler's own filter, chosen alongside this.
    return textureSampleLevel(uiTexture, uiSampler, uv, 0.0);
}

fn alphaBlend(src: vec4f, dst: vec4f) -> vec4f {
    return vec4f(src.rgb + dst.rgb * (1.0 - src.a), src.a + dst.a * (1.0 - src.a));
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    // The overlay is what the client wants laid over everything: the red of a hit, a fade to black.
    var colour = alphaBlend(sampleUi(in.uv), ui.overlay);

    // With a scene underneath, the client's alpha is what lets it through. Without one there is
    // nothing to compose against, and the client leaves opaque pixels at zero alpha.
    colour.a = max(colour.a, ui.forceOpaque);

    if (ui.colourblindMode > 0.0) {
        colour = vec4f(colourblind(colour.rgb, ui.colourblindMode, ui.colourblindIntensity), colour.a);
    }

    return colour;
}
