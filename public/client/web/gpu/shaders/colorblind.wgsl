// Colourblindness correction; see colorblind.glsl for what it does and where it comes from.
// WGSL has no matrix inverse, so the inverse of the RGB-to-LMS matrix is written out.

const rgb2lms = mat3x3f(vec3f(17.8824, 43.5161, 4.11935), vec3f(3.45565, 27.1554, 3.86714), vec3f(0.0299566, 0.184309, 1.46709));
const lms2rgb = mat3x3f(vec3f(0.080944, -0.130504, 0.116721), vec3f(-0.0102485, 0.0540194, -0.113615), vec3f(-0.000365294, -0.00412163, 0.693513));
const lms2lmsp = mat3x3f(vec3f(0.0, 2.02344, -2.52581), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0));
const lms2lmsd = mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.494207, 0.0, 1.24827), vec3f(0.0, 0.0, 1.0));
const lms2lmst = mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(-0.395913, 0.801109, 0.0));
const corrections = mat3x3f(vec3f(0.0, 0.0, 0.0), vec3f(0.7, 1.0, 0.0), vec3f(0.7, 0.0, 1.0));

fn colourblind(colour: vec3f, mode: f32, intensity: f32) -> vec3f {
    var lms = colour * rgb2lms;

    if (mode < 1.5) { lms = lms * lms2lmsp; }
    else if (mode < 2.5) { lms = lms * lms2lmsd; }
    else { lms = lms * lms2lmst; }

    // What the eye cannot separate, shifted into what it can.
    let error = colour - lms * lms2rgb;

    return colour + error * corrections * clamp(intensity / 100.0, 0.0, 1.0);
}
