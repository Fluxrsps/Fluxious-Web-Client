// The client's HSL, unpacked and converted the way it converts it. See hsl_to_rgb.glsl; this is the
// same function, and the two are kept together so a change to one is an obvious change to the other.

fn hslChannel(h: f32, lower: f32, upper: f32) -> f32 {
    if (6.0 * h < 1.0) { return lower + (upper - lower) * 6.0 * h; }
    if (2.0 * h < 1.0) { return upper; }
    if (3.0 * h < 2.0) { return lower + (upper - lower) * (0.6666666666666666 - h) * 6.0; }
    return lower;
}

fn hslToRgb(hsl: vec3f) -> vec3f {
    let hue = hsl.x / 64.0 + 0.0078125;
    let sat = hsl.y / 8.0 + 0.0625;
    let lum = hsl.z;

    let light = lum / 128.0;
    var upper = light + sat - light * sat;
    if (light < 0.5) { upper = light * (1.0 + sat); }
    let lower = 2.0 * light - upper;

    var hueR = hue + 0.3333333333333333;
    if (hueR > 1.0) { hueR = hueR - 1.0; }

    var hueB = hue - 0.3333333333333333;
    if (hueB < 0.0) { hueB = hueB + 1.0; }

    return vec3f(hslChannel(hueR, lower, upper), hslChannel(hue, lower, upper), hslChannel(hueB, lower, upper));
}
