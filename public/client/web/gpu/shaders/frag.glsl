#version 300 es

/*
 * The scene fragment shader, ported from the desktop renderer's frag.glsl.
 *
 * Two paths. A textured face samples the texture array and multiplies by a plain 7-bit lightness — a
 * textured triangle carries lightness rather than colour — unless bright textures are on, in which
 * case the face's own colour lights it instead. An untextured face picks between the interpolated RGB
 * and the conversion of the interpolated HSL, which is what the banding setting chooses between.
 */

precision highp float;
precision highp int;

uniform highp sampler2DArray uTextures;
uniform float uBrightness;
uniform float uSmoothBanding;
uniform float uTextureLightMode;
uniform vec4 uFogColour;
uniform int uColourblindMode;
uniform float uColourblindIntensity;

in vec4 fColour;
centroid in float fHsl;
flat in int fTextureId;
in vec2 fUv;
in float fFog;

out vec4 fragColor;

#include "hsl_to_rgb.glsl"
#include "colorblind.glsl"

void main() {
    vec4 c;

    if (fTextureId > 0) {
        float layer = float(fTextureId - 1);
        vec4 texel = texture(uTextures, vec3(fUv, layer));

        // The client marks a texture's transparent parts by leaving them black rather than by an
        // alpha channel. Tested against the full-size level so a mipmap cannot blur the cutout.
        if (textureLod(uTextures, vec3(fUv, layer), 0.0).a < 1.0) {
            discard;
        }

        texel = pow(vec4(texel.rgb, 1.0), vec4(uBrightness, uBrightness, uBrightness, 1.0));

        float light = fHsl / 127.0;
        vec3 lighting = (1.0 - uTextureLightMode) * vec3(light) + uTextureLightMode * fColour.rgb;

        c = texel * vec4(lighting, fColour.a);
    } else {
        // Banding is the client's look, not a defect: converting the interpolated HSL gives the
        // original's steps, and interpolating the converted RGB smooths them away.
        vec3 hsl = vec3(float((int(fHsl) >> 10) & 63), float((int(fHsl) >> 7) & 7), float(int(fHsl) & 127));

        c = vec4(mix(fColour.rgb, hslToRgb(hsl), uSmoothBanding), fColour.a);
    }

    if (uColourblindMode > 0) {
        c.rgb = colourblind(c.rgb, uColourblindMode, uColourblindIntensity);
    }

    fragColor = vec4(mix(c.rgb, uFogColour.rgb, fFog), c.a);
}
