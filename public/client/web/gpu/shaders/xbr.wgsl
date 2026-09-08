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

// The WGSL translation of xbr.glsl; the two are the same shader and should be changed together.
// Samples through the interface texture and sampler declared by ui.wgsl.

const XBR_EQ_THRESHOLD: f32 = 9.0;
const XBR_LV2_COEFFICIENT: f32 = 2.0;
const XBR_Y_WEIGHT: f32 = 50.0;

const xbrAo = vec4f(1.0, -1.0, -1.0, 1.0);
const xbrBo = vec4f(1.0, 1.0, -1.0, -1.0);
const xbrCo = vec4f(1.5, 0.5, -0.5, 0.5);
const xbrAx = vec4f(1.0, -1.0, -1.0, 1.0);
const xbrBx = vec4f(0.5, 2.0, -0.5, -2.0);
const xbrCx = vec4f(1.0, 1.0, -0.5, 0.0);
const xbrAy = vec4f(1.0, -1.0, -1.0, 1.0);
const xbrBy = vec4f(2.0, 0.5, -2.0, -0.5);
const xbrCy = vec4f(2.0, 0.0, -1.0, 0.5);
const xbrCi = vec4f(0.25, 0.25, 0.25, 0.25);

// rec.709 luma weights
const xbrLuma = vec3f(0.2126, 0.7152, 0.0722);

fn xbrDiffAbs(a: vec4f, b: vec4f) -> vec4f { return abs(a - b); }
fn xbrDiff(a: vec4f, b: vec4f) -> vec4f { return select(vec4f(0.0), vec4f(1.0), a != b); }
fn xbrEq(a: vec4f, b: vec4f) -> vec4f { return step(xbrDiffAbs(a, b), vec4f(XBR_EQ_THRESHOLD)); }
fn xbrNeq(a: vec4f, b: vec4f) -> vec4f { return vec4f(1.0) - xbrEq(a, b); }

fn xbrColourDistance(a: vec3f, b: vec3f) -> f32 {
    let d = abs(a - b);

    return d.r + d.g + d.b;
}

fn xbrFetch(uv: vec2f, offset: vec2f, texel: vec2f) -> vec4f {
    return textureSampleLevel(uiTexture, uiSampler, uv + offset * texel, 0.0);
}

fn textureXBR(uv: vec2f, scale: f32) -> vec4f {
    let source = ui.sourceDimensions;
    let texel = 1.0 / source;

    let delta = vec4f(1.0 / scale);
    let deltaL = vec4f(0.5 / scale, 1.0 / scale, 0.5 / scale, 1.0 / scale);
    let deltaU = deltaL.yxwz;

    let fp = fract(uv * source);

    //    A1 B1 C1
    // A0  A  B  C C4
    // D0  D  E  F F4
    // G0  G  H  I I4
    //    G5 H5 I5
    let A1 = xbrFetch(uv, vec2f(-1.0, -2.0), texel);
    let B1 = xbrFetch(uv, vec2f(0.0, -2.0), texel);
    let C1 = xbrFetch(uv, vec2f(1.0, -2.0), texel);
    let A = xbrFetch(uv, vec2f(-1.0, -1.0), texel);
    let B = xbrFetch(uv, vec2f(0.0, -1.0), texel);
    let C = xbrFetch(uv, vec2f(1.0, -1.0), texel);
    let D = xbrFetch(uv, vec2f(-1.0, 0.0), texel);
    let E = xbrFetch(uv, vec2f(0.0, 0.0), texel);
    let F = xbrFetch(uv, vec2f(1.0, 0.0), texel);
    let G = xbrFetch(uv, vec2f(-1.0, 1.0), texel);
    let H = xbrFetch(uv, vec2f(0.0, 1.0), texel);
    let I = xbrFetch(uv, vec2f(1.0, 1.0), texel);
    let G5 = xbrFetch(uv, vec2f(-1.0, 2.0), texel);
    let H5 = xbrFetch(uv, vec2f(0.0, 2.0), texel);
    let I5 = xbrFetch(uv, vec2f(1.0, 2.0), texel);
    let A0 = xbrFetch(uv, vec2f(-2.0, -1.0), texel);
    let D0 = xbrFetch(uv, vec2f(-2.0, 0.0), texel);
    let G0 = xbrFetch(uv, vec2f(-2.0, 1.0), texel);
    let C4 = xbrFetch(uv, vec2f(2.0, -1.0), texel);
    let F4 = xbrFetch(uv, vec2f(2.0, 0.0), texel);
    let I4 = xbrFetch(uv, vec2f(2.0, 1.0), texel);

    let weight = XBR_Y_WEIGHT * xbrLuma;

    let b = vec4f(dot(B.rgb, weight), dot(D.rgb, weight), dot(H.rgb, weight), dot(F.rgb, weight));
    let c = vec4f(dot(C.rgb, weight), dot(A.rgb, weight), dot(G.rgb, weight), dot(I.rgb, weight));
    let d = b.yzwx;
    let e = vec4f(dot(E.rgb, weight));
    let f = b.wxyz;
    let g = c.zwxy;
    let h = b.zwxy;
    let i = c.wxyz;

    let i4 = vec4f(dot(I4.rgb, weight), dot(C1.rgb, weight), dot(A0.rgb, weight), dot(G5.rgb, weight));
    let i5 = vec4f(dot(I5.rgb, weight), dot(C4.rgb, weight), dot(A1.rgb, weight), dot(G0.rgb, weight));
    let h5 = vec4f(dot(H5.rgb, weight), dot(F4.rgb, weight), dot(B1.rgb, weight), dot(D0.rgb, weight));
    // The original leaves this one unassigned, which reads whatever the register held. It is the same
    // four samples as h5 rotated by one, which is what every other term of this shader does.
    let f4 = h5.yzwx;

    // These inequations define the line below which interpolation occurs.
    let fx = xbrAo * fp.y + xbrBo * fp.x;
    let fxL = xbrAx * fp.y + xbrBx * fp.x;
    let fxU = xbrAy * fp.y + xbrBy * fp.x;

    // Corner detection, and again in the other direction.
    let irlv0 = xbrDiff(e, f) * xbrDiff(e, h);
    let irlv1 = irlv0 * (xbrNeq(f, b) * xbrNeq(f, c) + xbrNeq(h, d) * xbrNeq(h, g)
        + xbrEq(e, i) * (xbrNeq(f, f4) * xbrNeq(f, i4) + xbrNeq(h, h5) * xbrNeq(h, i5))
        + xbrEq(e, g) + xbrEq(e, c));

    let irlv2l = xbrDiff(e, g) * xbrDiff(d, g);
    let irlv2u = xbrDiff(e, c) * xbrDiff(b, c);

    var fx45i = clamp((fx + delta - xbrCo - xbrCi) / (2.0 * delta), vec4f(0.0), vec4f(1.0));
    var fx45 = clamp((fx + delta - xbrCo) / (2.0 * delta), vec4f(0.0), vec4f(1.0));
    var fx30 = clamp((fxL + deltaL - xbrCx) / (2.0 * deltaL), vec4f(0.0), vec4f(1.0));
    var fx60 = clamp((fxU + deltaU - xbrCy) / (2.0 * deltaU), vec4f(0.0), vec4f(1.0));

    let wd1 = xbrDiffAbs(e, c) + xbrDiffAbs(e, g) + xbrDiffAbs(i, f4) + xbrDiffAbs(i, h5)
        + xbrDiffAbs(b, d) + xbrDiffAbs(i4, i5) + 2.0 * xbrDiffAbs(h, f);
    let wd2 = xbrDiffAbs(h, d) + xbrDiffAbs(h, i5) + xbrDiffAbs(f, b) + xbrDiffAbs(f, i4)
        + xbrDiffAbs(g, h5) + xbrDiffAbs(c, f4) + 2.0 * xbrDiffAbs(e, i);

    let edri = step(wd1, wd2) * irlv0;
    let edr = step(wd1 + vec4f(0.1), wd2) * step(vec4f(0.5), irlv1);
    let edrL = step(XBR_LV2_COEFFICIENT * xbrDiffAbs(f, g), xbrDiffAbs(h, c)) * irlv2l * edr;
    let edrU = step(XBR_LV2_COEFFICIENT * xbrDiffAbs(h, c), xbrDiffAbs(f, g)) * irlv2u * edr;

    fx45 = edr * fx45;
    fx30 = edrL * fx30;
    fx60 = edrU * fx60;
    fx45i = edri * fx45i;

    let px = step(xbrDiffAbs(e, f), xbrDiffAbs(e, h));
    let maxima = max(max(fx30, fx60), max(fx45, fx45i));

    var res1 = E;
    res1 = mix(res1, mix(H, F, vec4f(px.x)), vec4f(maxima.x));
    res1 = mix(res1, mix(B, D, vec4f(px.z)), vec4f(maxima.z));

    var res2 = E;
    res2 = mix(res2, mix(F, B, vec4f(px.y)), vec4f(maxima.y));
    res2 = mix(res2, mix(D, H, vec4f(px.w)), vec4f(maxima.w));

    return mix(res1, res2, vec4f(step(xbrColourDistance(E.rgb, res1.rgb), xbrColourDistance(E.rgb, res2.rgb))));
}
