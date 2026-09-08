/*
 * Bicubic sampling, from the desktop renderer's scale/bicubic.glsl.
 *
 * A generalized cubic filter weights a 4x4 neighbourhood by distance. Catmull-Rom (b = 0, c = 0.5)
 * sharpens and needs clamping to the neighbourhood's own range or it rings; Mitchell (b = c = 1/3) is
 * gentler and does not.
 */

#define CR_AR_STRENGTH 0.9

float catmullRom(float x) {
    float t = abs(x);
    float t2 = t * t;
    float t3 = t2 * t;

    if (t < 1.0) return 1.5 * t3 - 2.5 * t2 + 1.0;
    if (t < 2.0) return -0.5 * t3 + 2.5 * t2 - 4.0 * t + 2.0;

    return 0.0;
}

float mitchell(float x) {
    float t = abs(x);
    float t2 = t * t;
    float t3 = t2 * t;

    if (t < 1.0) return 7.0 / 6.0 * t3 - 2.0 * t2 + 8.0 / 9.0;
    if (t < 2.0) return -7.0 / 18.0 * t3 + 2.0 * t2 - 10.0 / 3.0 * t + 16.0 / 9.0;

    return 0.0;
}

vec4 textureCubic(sampler2D image, vec2 uv, bool catrom) {
    vec2 size = vec2(textureSize(image, 0));
    vec2 texel = 1.0 / size;
    vec2 fractional = fract(uv * size - 0.5);

    uv -= fractional * texel;

    vec4 sum = vec4(0.0);
    vec4 denominator = vec4(0.0);
    vec4 lowest = vec4(1.0);
    vec4 highest = vec4(0.0);

    for (int m = -1; m <= 2; m++) {
        for (int n = -1; n <= 2; n++) {
            vec4 sampled = texture(image, uv + vec2(float(m), float(n)) * texel);

            lowest = min(lowest, sampled);
            highest = max(highest, sampled);

            float distance = length(vec2(float(m), float(n)) - fractional);
            float weight = catrom ? catmullRom(distance) : mitchell(distance);

            sum += sampled * weight;
            denominator += weight;
        }
    }

    vec4 c = sum / denominator;

    if (catrom) {
        // Anti-ringing: a sharpening filter can overshoot past any colour actually present.
        c = mix(c, clamp(c, lowest, highest), CR_AR_STRENGTH);
    }

    return c;
}
