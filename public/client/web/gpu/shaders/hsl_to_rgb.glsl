/*
 * The client's HSL, unpacked and converted the way it converts it.
 *
 * Not a general HSL: hue is 6 bits, saturation 3, lightness 7, and the ranges are the client's.
 * Ported from the desktop renderer's hsl_to_rgb.glsl so a tile is the colour it has always been.
 */
vec3 hslToRgb(vec3 hsl) {
    float hue = hsl.x / 64.0 + 0.0078125;
    float sat = hsl.y / 8.0 + 0.0625;
    float lum = hsl.z;

    float light = lum / 128.0;
    float upper = light < 0.5 ? light * (1.0 + sat) : light + sat - light * sat;
    float lower = 2.0 * light - upper;

    float hueR = hue + 0.3333333333333333;
    if (hueR > 1.0) hueR -= 1.0;

    float hueB = hue - 0.3333333333333333;
    if (hueB < 0.0) hueB += 1.0;

    vec3 rgb;
    rgb.r = 6.0 * hueR < 1.0 ? lower + (upper - lower) * 6.0 * hueR
          : 2.0 * hueR < 1.0 ? upper
          : 3.0 * hueR < 2.0 ? lower + (upper - lower) * (0.6666666666666666 - hueR) * 6.0
          : lower;
    rgb.g = 6.0 * hue < 1.0 ? lower + (upper - lower) * 6.0 * hue
          : 2.0 * hue < 1.0 ? upper
          : 3.0 * hue < 2.0 ? lower + (upper - lower) * (0.6666666666666666 - hue) * 6.0
          : lower;
    rgb.b = 6.0 * hueB < 1.0 ? lower + (upper - lower) * 6.0 * hueB
          : 2.0 * hueB < 1.0 ? upper
          : 3.0 * hueB < 2.0 ? lower + (upper - lower) * (0.6666666666666666 - hueB) * 6.0
          : lower;

    return rgb;
}
