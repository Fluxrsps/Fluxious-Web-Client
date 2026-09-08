#version 300 es

/*
 * The interface vertex shader.
 *
 * One triangle covering the viewport, built from the vertex id alone — no buffers, no attributes. The
 * desktop renderer draws a quad from a small vertex array; a single oversized triangle is cheaper and
 * avoids the seam a two-triangle quad can show along its diagonal.
 */

out vec2 vUv;

void main() {
    vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));

    vUv = vec2(position.x, 1.0 - position.y);
    gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}
