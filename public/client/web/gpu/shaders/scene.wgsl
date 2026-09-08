// The scene shader, both stages. See vert.glsl and frag.glsl for what each of them does; this is the
// same shader for the WebGPU backend, which takes one module with both entry points rather than two.

struct SceneUniforms {
    projection: mat4x4f,
    cameraX: f32,
    cameraZ: f32,
    drawDistance: f32,
    expandedChunks: f32,
    tick: f32,
    brightness: f32,
    fogDepth: f32,
    useFog: f32,
    smoothBanding: f32,
    textureLightMode: f32,
    colourblindMode: f32,
    colourblindIntensity: f32,
    fogColour: vec4f,
    tint: vec4f,
};

@group(0) @binding(0) var<uniform> scene: SceneUniforms;
@group(0) @binding(1) var textureSampler: sampler;
@group(0) @binding(2) var textures: texture_2d_array<f32>;
@group(0) @binding(3) var animations: texture_2d<f32>;

const TILE_SIZE: f32 = 128.0;
// The smallest unit of a texture that can move per tick. Textures are all 128x128, so this is a pixel.
const TEXTURE_ANIM_UNIT: f32 = 0.0078125;
const FOG_CORNER_ROUNDING: f32 = 1.5;
const FOG_CORNER_ROUNDING_SQUARED: f32 = 2.25;

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) colour: vec4f,
    @location(1) uv: vec2f,
    @location(2) @interpolate(flat) layer: i32,
    // The desktop renderer asks for this without perspective correction, which WGSL cannot express.
    // Centroid sampling is the half of it that does exist.
    @location(3) @interpolate(perspective, centroid) hsl: f32,
    @location(4) fog: f32,
};

#include "hsl_to_rgb.wgsl"
#include "colorblind.wgsl"

fn fogFactorLinear(dist: f32, start: f32, end: f32) -> f32 {
    return 1.0 - clamp((dist - start) / (end - start), 0.0, 1.0);
}

@vertex
fn vs(@location(0) position: vec3f, @location(1) colour: u32, @location(2) texture: i32, @location(3) uv: vec2f) -> VertexOut {
    var out: VertexOut;

    let alpha = f32((colour >> 24u) & 0xFFu) / 255.0;
    let bias = f32((colour >> 16u) & 0xFFu);

    var hsl = vec3f(f32((colour >> 10u) & 63u), f32((colour >> 7u) & 7u), f32(colour & 127u));

    // The scene's own tint: the client washes everything towards a colour for some areas and cut
    // scenes. Applied here so it costs nothing when the amount is zero, which is nearly always.
    hsl = hsl + (scene.tint.xyz - hsl) * scene.tint.w / 128.0;

    let world = vec4f(position, 1.0);
    var screen = scene.projection * world;

    // The client's own depth nudge, for faces it wants resolved in a particular order.
    screen.z = screen.z + bias / 128.0;

    out.position = screen;
    out.colour = vec4f(hslToRgb(hsl), 1.0 - alpha);
    out.layer = texture - 1;
    out.uv = uv;

    // A textured face keeps its packed value, which for those is a plain lightness the tint does not
    // touch; an untextured one carries the tinted colour forward so the banding path sees it too.
    if (texture > 0) {
        out.hsl = f32(colour & 0xFFFFu);

        // Water and lava are still images the client scrolls a pixel at a time; the direction and
        // speed come from the cache, one texel per texture.
        let animation = textureLoad(animations, vec2i(texture - 1, 0), 0).rg;

        out.uv = out.uv + scene.tick * animation * TEXTURE_ANIM_UNIT;
    } else {
        out.hsl = f32(((i32(hsl.x) & 63) << 10) | ((i32(hsl.y) & 7) << 7) | (i32(hsl.z) & 127));
    }

    // Fog thickens towards the edge of what is loaded, so the world ends in haze rather than in a
    // straight line of nothing. The corner rounding stops it forming a visible square.
    let edgeMin = (-scene.expandedChunks * 8.0 + 1.0) * TILE_SIZE;
    let edgeMax = (104.0 + scene.expandedChunks * 8.0 - 1.0) * TILE_SIZE;

    let west = max(edgeMin, scene.cameraX - scene.drawDistance);
    let east = min(edgeMax, scene.cameraX + scene.drawDistance);
    let south = max(edgeMin, scene.cameraZ - scene.drawDistance);
    let north = min(edgeMax, scene.cameraZ + scene.drawDistance);

    let xDist = min(world.x - west, east - world.x);
    let zDist = min(world.z - south, north - world.z);
    let nearest = min(xDist, zDist);
    let second = max(xDist, zDist);
    let distance = nearest - FOG_CORNER_ROUNDING * TILE_SIZE *
        max(0.0, (nearest + FOG_CORNER_ROUNDING_SQUARED) / (second + FOG_CORNER_ROUNDING_SQUARED));

    out.fog = fogFactorLinear(distance, 0.0, scene.fogDepth * TILE_SIZE) * scene.useFog;

    return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    // Sampled before the branch, not inside it: a texture read has to happen where every pixel in the
    // group agrees it happens, and whether a face is textured varies between them.
    let layer = max(in.layer, 0);
    let texel = textureSample(textures, textureSampler, in.uv, layer);
    let base = textureSampleLevel(textures, textureSampler, in.uv, layer, 0.0);

    var c: vec4f;

    if (in.layer >= 0) {
        // The client marks a texture's transparent parts by leaving them black rather than by an
        // alpha channel. Tested against the full-size level so a mipmap cannot blur the cutout.
        if (base.a < 1.0) {
            discard;
        }

        let lit = pow(vec4f(texel.rgb, 1.0), vec4f(scene.brightness, scene.brightness, scene.brightness, 1.0));

        let light = in.hsl / 127.0;
        let lighting = (1.0 - scene.textureLightMode) * vec3f(light) + scene.textureLightMode * in.colour.rgb;

        c = lit * vec4f(lighting, in.colour.a);
    } else {
        // Banding is the client's look, not a defect: converting the interpolated HSL gives the
        // original's steps, and interpolating the converted RGB smooths them away.
        let packed = i32(in.hsl);
        let hsl = vec3f(f32((packed >> 10) & 63), f32((packed >> 7) & 7), f32(packed & 127));

        c = vec4f(mix(in.colour.rgb, hslToRgb(hsl), scene.smoothBanding), in.colour.a);
    }

    if (scene.colourblindMode > 0.0) {
        c = vec4f(colourblind(c.rgb, scene.colourblindMode, scene.colourblindIntensity), c.a);
    }

    return vec4f(mix(c.rgb, scene.fogColour.rgb, in.fog), c.a);
}
