#version 300 es

/*
 * The scene vertex shader.
 *
 * A port of the desktop renderer's vert.glsl. Positions arrive in scene-local units and are projected
 * with the client's own reversed-Z matrix; colours arrive as the client's packed alpha, depth bias and
 * HSL, and are converted here rather than per pixel so the shading across a tile interpolates as a
 * colour rather than as a bit field.
 *
 * One thing the desktop version has that GLSL ES cannot express is `noperspective` on the interpolated
 * HSL. Centroid sampling is the half of it that does exist and is what is used instead.
 */

precision highp float;
precision highp int;

#define TILE_SIZE 128.0
// The smallest unit of a texture that can move per tick. Textures are all 128x128, so this is a pixel.
#define TEXTURE_ANIM_UNIT (1.0 / 128.0)
#define FOG_CORNER_ROUNDING 1.5
#define FOG_CORNER_ROUNDING_SQUARED (FOG_CORNER_ROUNDING * FOG_CORNER_ROUNDING)

layout(location = 0) in vec3 aPosition;
layout(location = 1) in int aColour;
layout(location = 2) in int aTexture;
layout(location = 3) in vec2 aUv;

uniform mat4 uProjection;
uniform float uCameraX;
uniform float uCameraZ;
uniform int uDrawDistance;
uniform int uFogDepth;
uniform int uUseFog;
uniform int uExpandedChunks;
uniform int uTick;
uniform ivec4 uTint;
uniform highp sampler2D uTextureAnim;

out vec4 fColour;
centroid out float fHsl;
flat out int fTextureId;
out vec2 fUv;
out float fFog;

#include "hsl_to_rgb.glsl"

float fogFactorLinear(float dist, float start, float end) {
    return 1.0 - clamp((dist - start) / (end - start), 0.0, 1.0);
}

void main() {
    float alpha = float((aColour >> 24) & 0xFF) / 255.0;
    int bias = (aColour >> 16) & 0xFF;

    vec3 hsl = vec3(float((aColour >> 10) & 63), float((aColour >> 7) & 7), float(aColour & 127));

    // The scene's own tint: the client washes everything towards a colour for some areas and cut
    // scenes. Applied here so it costs nothing when the amount is zero, which is nearly always.
    hsl += (vec3(uTint.xyz) - hsl) * float(uTint.w) / 128.0;

    vec4 world = vec4(aPosition, 1.0);
    vec4 screen = uProjection * world;

    // The client's own depth nudge, for faces it wants resolved in a particular order.
    screen.z += float(bias) / 128.0;

    gl_Position = screen;
    fColour = vec4(hslToRgb(hsl), 1.0 - alpha);
    fTextureId = aTexture;
    fUv = aUv;

    // A textured face keeps its packed value, which for those is a plain lightness the tint does not
    // touch; an untextured one carries the tinted colour forward so the banding path sees it too.
    fHsl = aTexture > 0
        ? float(aColour & 0xFFFF)
        : float(((int(hsl.x) & 63) << 10) | ((int(hsl.y) & 7) << 7) | (int(hsl.z) & 127));

    if (aTexture > 0) {
        // Water and lava are still images the client scrolls a pixel at a time; the direction and
        // speed come from the cache, one texel per texture.
        vec2 animation = texelFetch(uTextureAnim, ivec2(aTexture - 1, 0), 0).rg;

        fUv += float(uTick) * animation * TEXTURE_ANIM_UNIT;
    }

    // Fog thickens towards the edge of what is loaded, so the world ends in haze rather than in a
    // straight line of nothing. The corner rounding stops it forming a visible square.
    float edgeMin = float(-uExpandedChunks * 8 + 1) * TILE_SIZE;
    float edgeMax = float(104 + uExpandedChunks * 8 - 1) * TILE_SIZE;

    float west = max(edgeMin, uCameraX - float(uDrawDistance));
    float east = min(edgeMax, uCameraX + float(uDrawDistance));
    float south = max(edgeMin, uCameraZ - float(uDrawDistance));
    float north = min(edgeMax, uCameraZ + float(uDrawDistance));

    float xDist = min(world.x - west, east - world.x);
    float zDist = min(world.z - south, north - world.z);
    float nearest = min(xDist, zDist);
    float second = max(xDist, zDist);
    float distance = nearest - FOG_CORNER_ROUNDING * TILE_SIZE *
        max(0.0, (nearest + FOG_CORNER_ROUNDING_SQUARED) / (second + FOG_CORNER_ROUNDING_SQUARED));

    fFog = fogFactorLinear(distance, 0.0, float(uFogDepth) * TILE_SIZE) * float(uUseFog);
}
