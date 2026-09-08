/*
   Hyllian's xBR-lv2 Shader

   Copyright (C) 2011-2016 Hyllian - sergiogdb@gmail.com

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in
   all copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   THE SOFTWARE.

   Incorporates some of the ideas from SABR shader. Thanks to Joshua Street.
*/

/*
 * Level 2 means edges are detected in two directions rather than one, which keeps the diagonals in
 * the interface's pixel art smooth instead of stepped when the client is stretched.
 *
 * The desktop version precomputes its neighbour coordinates in the vertex shader and passes them
 * through a struct. The interface here is one full-screen triangle, so they are computed per pixel
 * instead — the same arithmetic, in the stage that has room for it.
 */

#define XBR_EQ_THRESHOLD 9.0
#define XBR_LV2_COEFFICIENT 2.0
#define XBR_Y_WEIGHT 50.0

const vec4 Ao = vec4(1.0, -1.0, -1.0, 1.0);
const vec4 Bo = vec4(1.0, 1.0, -1.0, -1.0);
const vec4 Co = vec4(1.5, 0.5, -0.5, 0.5);
const vec4 Ax = vec4(1.0, -1.0, -1.0, 1.0);
const vec4 Bx = vec4(0.5, 2.0, -0.5, -2.0);
const vec4 Cx = vec4(1.0, 1.0, -0.5, 0.0);
const vec4 Ay = vec4(1.0, -1.0, -1.0, 1.0);
const vec4 By = vec4(2.0, 0.5, -2.0, -0.5);
const vec4 Cy = vec4(2.0, 0.0, -1.0, 0.5);
const vec4 Ci = vec4(0.25, 0.25, 0.25, 0.25);

// rec.709 luma weights
const vec3 xbrLuma = vec3(0.2126, 0.7152, 0.0722);

vec4 xbrDiffAbs(vec4 a, vec4 b) { return abs(a - b); }
vec4 xbrDiff(vec4 a, vec4 b) { return vec4(notEqual(a, b)); }
vec4 xbrEq(vec4 a, vec4 b) { return step(xbrDiffAbs(a, b), vec4(XBR_EQ_THRESHOLD)); }
vec4 xbrNeq(vec4 a, vec4 b) { return vec4(1.0) - xbrEq(a, b); }

float xbrColourDistance(vec3 a, vec3 b) {
    vec3 d = abs(a - b);

    return d.r + d.g + d.b;
}

vec4 textureXBR(sampler2D image, vec2 uv, ivec2 source, float scale) {
    vec2 texel = 1.0 / vec2(source);
    float dx = texel.x;
    float dy = texel.y;

    vec4 delta = vec4(1.0 / scale);
    vec4 deltaL = vec4(0.5 / scale, 1.0 / scale, 0.5 / scale, 1.0 / scale);
    vec4 deltaU = deltaL.yxwz;

    vec2 fp = fract(uv * vec2(source));

    //    A1 B1 C1
    // A0  A  B  C C4
    // D0  D  E  F F4
    // G0  G  H  I I4
    //    G5 H5 I5
    vec4 A1 = texture(image, uv + vec2(-dx, -2.0 * dy));
    vec4 B1 = texture(image, uv + vec2(0.0, -2.0 * dy));
    vec4 C1 = texture(image, uv + vec2(dx, -2.0 * dy));
    vec4 A = texture(image, uv + vec2(-dx, -dy));
    vec4 B = texture(image, uv + vec2(0.0, -dy));
    vec4 C = texture(image, uv + vec2(dx, -dy));
    vec4 D = texture(image, uv + vec2(-dx, 0.0));
    vec4 E = texture(image, uv);
    vec4 F = texture(image, uv + vec2(dx, 0.0));
    vec4 G = texture(image, uv + vec2(-dx, dy));
    vec4 H = texture(image, uv + vec2(0.0, dy));
    vec4 I = texture(image, uv + vec2(dx, dy));
    vec4 G5 = texture(image, uv + vec2(-dx, 2.0 * dy));
    vec4 H5 = texture(image, uv + vec2(0.0, 2.0 * dy));
    vec4 I5 = texture(image, uv + vec2(dx, 2.0 * dy));
    vec4 A0 = texture(image, uv + vec2(-2.0 * dx, -dy));
    vec4 D0 = texture(image, uv + vec2(-2.0 * dx, 0.0));
    vec4 G0 = texture(image, uv + vec2(-2.0 * dx, dy));
    vec4 C4 = texture(image, uv + vec2(2.0 * dx, -dy));
    vec4 F4 = texture(image, uv + vec2(2.0 * dx, 0.0));
    vec4 I4 = texture(image, uv + vec2(2.0 * dx, dy));

    vec3 weight = XBR_Y_WEIGHT * xbrLuma;

    vec4 b = vec4(dot(B.rgb, weight), dot(D.rgb, weight), dot(H.rgb, weight), dot(F.rgb, weight));
    vec4 c = vec4(dot(C.rgb, weight), dot(A.rgb, weight), dot(G.rgb, weight), dot(I.rgb, weight));
    vec4 d = b.yzwx;
    vec4 e = vec4(dot(E.rgb, weight));
    vec4 f = b.wxyz;
    vec4 g = c.zwxy;
    vec4 h = b.zwxy;
    vec4 i = c.wxyz;

    vec4 i4 = vec4(dot(I4.rgb, weight), dot(C1.rgb, weight), dot(A0.rgb, weight), dot(G5.rgb, weight));
    vec4 i5 = vec4(dot(I5.rgb, weight), dot(C4.rgb, weight), dot(A1.rgb, weight), dot(G0.rgb, weight));
    vec4 h5 = vec4(dot(H5.rgb, weight), dot(F4.rgb, weight), dot(B1.rgb, weight), dot(D0.rgb, weight));
    // The original leaves this one unassigned, which reads whatever the register held. It is the same
    // four samples as h5 rotated by one, which is what every other term of this shader does.
    vec4 f4 = h5.yzwx;

    // These inequations define the line below which interpolation occurs.
    vec4 fx = Ao * fp.y + Bo * fp.x;
    vec4 fxL = Ax * fp.y + Bx * fp.x;
    vec4 fxU = Ay * fp.y + By * fp.x;

    // Corner detection, and again in the other direction.
    vec4 irlv0 = xbrDiff(e, f) * xbrDiff(e, h);
    vec4 irlv1 = irlv0 * (xbrNeq(f, b) * xbrNeq(f, c) + xbrNeq(h, d) * xbrNeq(h, g)
        + xbrEq(e, i) * (xbrNeq(f, f4) * xbrNeq(f, i4) + xbrNeq(h, h5) * xbrNeq(h, i5))
        + xbrEq(e, g) + xbrEq(e, c));

    vec4 irlv2l = xbrDiff(e, g) * xbrDiff(d, g);
    vec4 irlv2u = xbrDiff(e, c) * xbrDiff(b, c);

    vec4 fx45i = clamp((fx + delta - Co - Ci) / (2.0 * delta), 0.0, 1.0);
    vec4 fx45 = clamp((fx + delta - Co) / (2.0 * delta), 0.0, 1.0);
    vec4 fx30 = clamp((fxL + deltaL - Cx) / (2.0 * deltaL), 0.0, 1.0);
    vec4 fx60 = clamp((fxU + deltaU - Cy) / (2.0 * deltaU), 0.0, 1.0);

    vec4 wd1 = xbrDiffAbs(e, c) + xbrDiffAbs(e, g) + xbrDiffAbs(i, f4) + xbrDiffAbs(i, h5)
        + xbrDiffAbs(b, d) + xbrDiffAbs(i4, i5) + 2.0 * xbrDiffAbs(h, f);
    vec4 wd2 = xbrDiffAbs(h, d) + xbrDiffAbs(h, i5) + xbrDiffAbs(f, b) + xbrDiffAbs(f, i4)
        + xbrDiffAbs(g, h5) + xbrDiffAbs(c, f4) + 2.0 * xbrDiffAbs(e, i);

    vec4 edri = step(wd1, wd2) * irlv0;
    vec4 edr = step(wd1 + vec4(0.1), wd2) * step(vec4(0.5), irlv1);
    vec4 edrL = step(XBR_LV2_COEFFICIENT * xbrDiffAbs(f, g), xbrDiffAbs(h, c)) * irlv2l * edr;
    vec4 edrU = step(XBR_LV2_COEFFICIENT * xbrDiffAbs(h, c), xbrDiffAbs(f, g)) * irlv2u * edr;

    fx45 = edr * fx45;
    fx30 = edrL * fx30;
    fx60 = edrU * fx60;
    fx45i = edri * fx45i;

    vec4 px = step(xbrDiffAbs(e, f), xbrDiffAbs(e, h));
    vec4 maxima = max(max(fx30, fx60), max(fx45, fx45i));

    vec4 res1 = E;
    res1 = mix(res1, mix(H, F, px.x), maxima.x);
    res1 = mix(res1, mix(B, D, px.z), maxima.z);

    vec4 res2 = E;
    res2 = mix(res2, mix(F, B, px.y), maxima.y);
    res2 = mix(res2, mix(D, H, px.w), maxima.w);

    return mix(res1, res2, step(xbrColourDistance(E.rgb, res1.rgb), xbrColourDistance(E.rgb, res2.rgb)));
}
