/*
 * Written in 2025 by Casey Zwicker <caseypzwicker@gmail.com>
 * To the extent possible under law, the author(s) have dedicated all copyright and related and
 * neighboring rights to this software to the public domain worldwide. This software is distributed
 * without any warranty. You should have received a copy of the CC0 Public Domain Dedication along
 * with this software. If not, see <http://creativecommons.org/publicdomain/zero/1.0/>.
 */

/*
 * Anti-aliased UI scaling that respects pixel sharpness. Nearest inside a texel and linear across its
 * edge, so the interface stays as crisp as the client drew it without the staircase that pure nearest
 * leaves on a non-integer scale.
 *
 * Approach taken from https://colececil.dev/blog/2017/scaling-pixel-art-without-destroying-it/
 */
vec4 textureHybrid(sampler2D image, vec2 uv, vec2 source, vec2 target) {
    uv *= source;

    vec2 within = fract(uv);
    vec2 perTexel = target / source;
    vec2 amount = min(within * perTexel, 0.5) - min((1.0 - within) * perTexel, 0.5);

    return texture(image, (floor(uv) + 0.5 + amount) / source);
}
