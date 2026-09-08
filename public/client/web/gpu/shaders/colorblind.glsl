/*
 * Colourblindness correction.
 *
 * Algorithm from "Analysis of Color Blindness" by Onur Fidaner, Poliang Lin and Nevran Ozguven.
 * Converts to the LMS cone space, collapses the cone the eye is missing, and shifts the difference
 * into cones it still has.
 *
 * The mode is a parameter rather than a compile-time switch, as it is in the desktop renderer, so one
 * shader covers all of them and the scene and the interface can share this file.
 */
const mat3 rgb2lms = mat3(vec3(17.8824, 43.5161, 4.11935), vec3(3.45565, 27.1554, 3.86714), vec3(0.0299566, 0.184309, 1.46709));
const mat3 lms2lmsp = mat3(vec3(0.0, 2.02344, -2.52581), vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0));
const mat3 lms2lmsd = mat3(vec3(1.0, 0.0, 0.0), vec3(0.494207, 0.0, 1.24827), vec3(0.0, 0.0, 1.0));
const mat3 lms2lmst = mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(-0.395913, 0.801109, 0.0));
const mat3 corrections = mat3(vec3(0.0, 0.0, 0.0), vec3(0.7, 1.0, 0.0), vec3(0.7, 0.0, 1.0));

vec3 colourblind(vec3 colour, int mode, float intensity) {
    vec3 lms = colour * rgb2lms;

    if (mode == 1) lms = lms * lms2lmsp;
    else if (mode == 2) lms = lms * lms2lmsd;
    else lms = lms * lms2lmst;

    // What the eye cannot separate, shifted into what it can.
    vec3 error = colour - lms * inverse(rgb2lms);

    return colour + error * corrections * clamp(intensity / 100.0, 0.0, 1.0);
}
