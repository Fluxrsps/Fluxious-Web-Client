#version 300 es

/*
 * The interface fragment shader, ported from the desktop renderer's fragui.glsl.
 *
 * It does one more thing than the desktop version: it composites the world under the interface. On
 * desktop the scene is already in the framebuffer by the time this runs, and the interface blends over
 * it. Here the scene is rendered to its own target, so both are sampled and combined in one pass.
 *
 * The sampling mode is a uniform rather than a compile-time switch, so switching it costs no relink.
 */

precision highp float;

#define SAMPLING_NEAREST 0
#define SAMPLING_LINEAR 1
#define SAMPLING_MITCHELL 2
#define SAMPLING_CATROM 3
#define SAMPLING_XBR 4
#define SAMPLING_HYBRID 5

uniform sampler2D uUi;
uniform sampler2D uScene;
uniform float uHasScene;
uniform int uSampling;
uniform ivec2 uSourceDimensions;
uniform ivec2 uTargetDimensions;
uniform vec4 uOverlay;
uniform int uUiColourblindMode;
uniform float uUiColourblindIntensity;

in vec2 vUv;
out vec4 fragColor;

#include "colorblind.glsl"
#include "bicubic.glsl"
#include "hybrid.glsl"
#include "xbr.glsl"

vec4 sampleUi(vec2 uv) {
    if (uSampling == SAMPLING_MITCHELL) return textureCubic(uUi, uv, false);
    if (uSampling == SAMPLING_CATROM) return textureCubic(uUi, uv, true);
    if (uSampling == SAMPLING_HYBRID) return textureHybrid(uUi, uv, vec2(uSourceDimensions), vec2(uTargetDimensions));
    if (uSampling == SAMPLING_XBR) return textureXBR(uUi, uv, uSourceDimensions,
        ceil(float(uTargetDimensions.x) / float(uSourceDimensions.x)));

    // NEAREST and LINEAR use the texture's own filter, set alongside this.
    return texture(uUi, uv);
}

vec4 alphaBlend(vec4 src, vec4 dst) {
    return vec4(src.rgb + dst.rgb * (1.0 - src.a), src.a + dst.a * (1.0 - src.a));
}

void main() {
    // Uploaded as RGBA but laid out BGRA, so read it back in the order the client wrote it.
    vec4 ui = sampleUi(vUv).bgra;
    // The render target is bottom-up; the interface texture is top-down. Only one of them can use
    // the quad UV as it comes.
    vec3 scene = texture(uScene, vec2(vUv.x, 1.0 - vUv.y)).rgb;

    // The overlay is what the client wants laid over everything: the red of a hit, a fade to black.
    ui = alphaBlend(ui, uOverlay);

    // The client's alpha is a hole for the scene to show through. With no scene rendered there is
    // nothing behind it, and the client leaves its opaque pixels at zero alpha.
    float alpha = mix(1.0, ui.a, uHasScene);
    vec3 c = mix(scene * uHasScene, ui.rgb, alpha);

    if (uUiColourblindMode > 0) {
        c = colourblind(c, uUiColourblindMode, uUiColourblindIntensity);
    }

    fragColor = vec4(c, 1.0);
}
