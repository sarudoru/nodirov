// The renderer paints the whole grid in one pass on the GPU.
//
// Every cell is a small flap mechanism with two faces: the glyph it shows
// (X) and the glyph it is turning to (Y), a phase between them, and how the
// turn looks. The fragment shader finds which cell a device pixel belongs to
// and reads that pixel out of the atlas, so a resting glyph is copied one to
// one and stays exactly as sharp as browser text.
//
// Turns:
//   flap   split-flap: the upper half folds down over its hinge; the new
//          face's upper half is behind it, its lower half on the flap's back
//   drum   the cell is a small wheel; faces roll over its top edge
//   fade   a plain cross-fade, for the lattice's quiet changes
//
// Without WebGL2 the same state is painted with Canvas 2D (turns become
// cross-fades there).

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uGlyph;   // x: face X, y: face Y, z: flags
uniform sampler2D uInk;      // x: ink X, y: ink Y, z: phase, w: underline
uniform sampler2D uAtlas;
uniform ivec2 uCell;
uniform ivec2 uGrid;
uniform ivec2 uOrigin;
uniform int uHeight;
uniform int uPerRow;
uniform int uDpr;
uniform int uUnderY;
uniform int uTurn;           // 0 flap, 1 drum
uniform float uShade;
uniform vec3 uPaper;
uniform vec3 uInkColor;
uniform vec3 uAccent;
out vec4 outColor;

const float PI = 3.14159265;

ivec2 slotOf(uint glyph) {
  int g = int(glyph);
  return ivec2(g % uPerRow, g / uPerRow) * uCell;
}

float cover(uint glyph, ivec2 inner) {
  if (glyph == 0u) return 0.0;
  return texelFetch(uAtlas, slotOf(glyph) + inner, 0).r;
}

// Coverage at a fractional source row, linearly filtered, for faces that are
// being foreshortened.
float coverAt(uint glyph, int x, float y) {
  if (glyph == 0u) return 0.0;
  float fy = y - 0.5;
  if (fy < -0.5 || fy > float(uCell.y) - 0.5) return 0.0;
  int y0 = int(floor(fy));
  float t = fy - float(y0);
  ivec2 slot = slotOf(glyph);
  float a = y0 >= 0 ? texelFetch(uAtlas, slot + ivec2(x, y0), 0).r : 0.0;
  float b = y0 + 1 < uCell.y ? texelFetch(uAtlas, slot + ivec2(x, y0 + 1), 0).r : 0.0;
  return mix(a, b, t);
}

// Coverage at a fractional position, bilinearly filtered, for a flap seen
// in perspective.
float coverAt2(uint glyph, float x, float y) {
  if (glyph == 0u) return 0.0;
  float fx = x - 0.5;
  float fy = y - 0.5;
  int x0 = int(floor(fx));
  int y0 = int(floor(fy));
  float tx = fx - float(x0);
  float ty = fy - float(y0);
  ivec2 slot = slotOf(glyph);
  float s00 = 0.0, s10 = 0.0, s01 = 0.0, s11 = 0.0;
  bool xa = x0 >= 0 && x0 < uCell.x, xb = x0 + 1 >= 0 && x0 + 1 < uCell.x;
  bool ya = y0 >= 0 && y0 < uCell.y, yb = y0 + 1 >= 0 && y0 + 1 < uCell.y;
  if (xa && ya) s00 = texelFetch(uAtlas, slot + ivec2(x0, y0), 0).r;
  if (xb && ya) s10 = texelFetch(uAtlas, slot + ivec2(x0 + 1, y0), 0).r;
  if (xa && yb) s01 = texelFetch(uAtlas, slot + ivec2(x0, y0 + 1), 0).r;
  if (xb && yb) s11 = texelFetch(uAtlas, slot + ivec2(x0 + 1, y0 + 1), 0).r;
  return mix(mix(s00, s10, tx), mix(s01, s11, tx), ty);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  px.y = uHeight - 1 - px.y;
  ivec2 local = px - uOrigin;
  vec3 color = uPaper;
  if (local.x >= 0 && local.y >= 0) {
    ivec2 cell = local / uCell;
    if (cell.x < uGrid.x && cell.y < uGrid.y) {
      ivec2 inner = local - cell * uCell;
      uvec4 g = texelFetch(uGlyph, cell, 0);
      vec4 a = texelFetch(uInk, cell, 0);
      uint X = g.x;
      uint Y = g.y;
      float phase = a.z;
      bool fade = (g.z & 4u) != 0u;
      vec3 colorX = (g.z & 1u) != 0u ? uAccent : uInkColor;
      vec3 colorY = (g.z & 8u) != 0u ? uAccent : uInkColor;
      float cx = 0.0;
      float cy = 0.0;

      if (phase <= 0.0 || Y == X && a.x == a.y) {
        cx = cover(X, inner) * a.x;
      } else if (phase >= 1.0) {
        cy = cover(Y, inner) * a.y;
      } else if (fade) {
        cx = cover(X, inner) * a.x * (1.0 - phase);
        cy = cover(Y, inner) * a.y * phase;
      } else if (uTurn == 0) {
        float H = float(uCell.y);
        float mid = floor(H * 0.5);
        float y = float(inner.y) + 0.5;
        float c = cos(phase * PI);
        float sn = sin(phase * PI);
        // the fold dims as it turns edge-on
        float lit = mix(1.0, abs(c), uShade);
        // the flap's free edge swings toward the viewer, so it reads a
        // little wider than its hinge
        float cxm = float(uCell.x) * 0.5;
        float x = float(inner.x) + 0.5;
        if (y < mid) {
          float h = c * mid;
          if (phase < 0.5 && y >= mid - h) {
            float src = mid - (mid - y) / max(c, 0.001);
            float grow = 1.0 + 0.16 * sn * (mid - src) / mid;
            cx = coverAt2(X, cxm + (x - cxm) / grow, src) * a.x * lit;
          } else {
            cy = cover(Y, inner) * a.y;
          }
        } else {
          float h = -c * mid;
          if (phase > 0.5 && y < mid + h) {
            float src = mid + (y - mid) / max(-c, 0.001);
            float grow = 1.0 + 0.16 * sn * (src - mid) / mid;
            cy = coverAt2(Y, cxm + (x - cxm) / grow, src) * a.y * lit;
          } else {
            cx = cover(X, inner) * a.x;
          }
        }
        // the split between the halves shows while the flap is moving
        if (inner.y == int(mid) - 1) { cx *= 0.25; cy *= 0.25; }
      } else {
        // drum: the strip rolls up through the window; faces bow at the edges
        float H = float(uCell.y);
        float yn = (float(inner.y) + 0.5) / H - 0.5;          // -0.5..0.5
        float bow = sin(phase * PI);
        // screen = mix(d, sin(d*pi)/pi*... ) solved for d by two Newton steps
        float d = yn;
        for (int k = 0; k < 3; k++) {
          float f = mix(d, 0.5 * sin(d * PI), bow) - yn;
          float df = mix(1.0, 0.5 * PI * cos(d * PI), bow);
          d -= f / max(df, 0.2);
        }
        float s = d + phase;                                  // strip position
        float lit = mix(1.0, cos(d * PI), uShade * bow);
        if (s < 0.5) cx = coverAt(X, inner.x, (s + 0.5) * H) * a.x * lit;
        else cy = coverAt(Y, inner.x, (s - 0.5) * H) * a.y * lit;
      }

      color = mix(color, colorX, clamp(cx, 0.0, 1.0));
      color = mix(color, colorY, clamp(cy, 0.0, 1.0));
      if (a.w > 0.0 && inner.y >= uUnderY && inner.y < uUnderY + uDpr) {
        color = mix(color, colorX, a.w);
      }
      if ((g.z & 2u) != 0u && inner.x < 2 * uDpr &&
          inner.y >= 2 * uDpr && inner.y < uCell.y - 2 * uDpr) {
        color = uInkColor;
      }
    }
  }
  outColor = vec4(color, 1.0);
}`;

function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function createGL(canvas) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  function shader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const u = {};
  for (const name of ["uGlyph", "uInk", "uAtlas", "uCell", "uGrid", "uOrigin", "uHeight", "uPerRow",
    "uDpr", "uUnderY", "uTurn", "uShade", "uPaper", "uInkColor", "uAccent"]) {
    u[name] = gl.getUniformLocation(program, name);
  }
  gl.bindVertexArray(gl.createVertexArray());

  const texture = (unit) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  texture(0);
  texture(1);
  texture(2);
  gl.uniform1i(u.uGlyph, 0);
  gl.uniform1i(u.uInk, 1);
  gl.uniform1i(u.uAtlas, 2);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  let cols = 0;
  let rows = 0;

  return {
    kind: "webgl2",
    configure({ cols: c, rows: r, cellWd, cellHd, originX, perRow, dpr, underY }) {
      cols = c;
      rows = r;
      gl.activeTexture(gl.TEXTURE0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16UI, cols, rows, 0, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, null);
      gl.activeTexture(gl.TEXTURE1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.uniform2i(u.uCell, cellWd, cellHd);
      gl.uniform2i(u.uGrid, cols, rows);
      gl.uniform2i(u.uOrigin, originX, 0);
      gl.uniform1i(u.uPerRow, perRow);
      gl.uniform1i(u.uDpr, Math.max(1, Math.round(dpr)));
      gl.uniform1i(u.uUnderY, underY);
    },
    style({ paper, ink, accent, turn, shade }) {
      gl.uniform3fv(u.uPaper, hexToRgb(paper));
      gl.uniform3fv(u.uInkColor, hexToRgb(ink));
      gl.uniform3fv(u.uAccent, hexToRgb(accent));
      gl.uniform1i(u.uTurn, turn === "drum" ? 1 : 0);
      gl.uniform1f(u.uShade, shade);
    },
    atlas(atlas) {
      const state = atlas.takeDirty();
      if (!state.dirty) return;
      gl.activeTexture(gl.TEXTURE2);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, atlas.canvas);
    },
    draw(glyphs, inks) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1i(u.uHeight, gl.drawingBufferHeight);
      gl.activeTexture(gl.TEXTURE0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, glyphs);
      gl.activeTexture(gl.TEXTURE1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, inks);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

// The same state with Canvas 2D: tinted copies of the atlas, one drawImage
// per visible face. Turns are cross-fades here.
function create2D(canvas) {
  const context = canvas.getContext("2d", { alpha: false });
  let grid = null;
  let look = { paper: "#fff", ink: "#000", accent: "#f00" };
  let tints = null;

  function tint(source, hex) {
    const out = document.createElement("canvas");
    out.width = source.width;
    out.height = source.height;
    const img = source.getContext("2d").getImageData(0, 0, source.width, source.height);
    const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v * 255));
    for (let k = 0; k < img.data.length; k += 4) {
      img.data[k + 3] = img.data[k];
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
    }
    out.getContext("2d").putImageData(img, 0, 0);
    return out;
  }

  return {
    kind: "2d",
    configure(next) { grid = next; },
    style(next) {
      look = next;
      tints = null;
    },
    atlas(atlas) {
      const state = atlas.takeDirty();
      if (state.dirty || !tints) tints = { ink: tint(atlas.canvas, look.ink), accent: tint(atlas.canvas, look.accent) };
    },
    draw(glyphs, inks) {
      const { cols, rows, cellWd, cellHd, originX, perRow, dpr, underY } = grid;
      context.globalAlpha = 1;
      context.fillStyle = look.paper;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const blit = (sheet, glyph, x, y, alpha) => {
        if (!glyph || alpha <= 0.004) return;
        context.globalAlpha = Math.min(1, alpha);
        context.drawImage(sheet, (glyph % perRow) * cellWd, Math.floor(glyph / perRow) * cellHd,
          cellWd, cellHd, x, y, cellWd, cellHd);
      };
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const o = (r * cols + c) * 4;
          const x = originX + c * cellWd;
          const y = r * cellHd;
          const phase = inks[o + 2] / 255;
          const flags = glyphs[o + 2];
          blit(flags & 1 ? tints.accent : tints.ink, glyphs[o], x, y, (inks[o] / 255) * (1 - phase));
          blit(flags & 8 ? tints.accent : tints.ink, glyphs[o + 1], x, y, (inks[o + 1] / 255) * phase);
          const under = inks[o + 3] / 255;
          if (under > 0.004) {
            context.globalAlpha = under;
            context.fillStyle = flags & 1 ? look.accent : look.ink;
            context.fillRect(x, y + underY, cellWd, Math.max(1, Math.round(dpr)));
          }
          if (flags & 2) {
            context.globalAlpha = 1;
            context.fillStyle = look.ink;
            context.fillRect(x, y + 2 * dpr, 2 * dpr, cellHd - 4 * dpr);
          }
        }
      }
    },
  };
}

export function createRenderer(canvas) {
  if (!new URLSearchParams(location.search).has("canvas2d")) {
    try {
      const gl = createGL(canvas);
      if (gl) return { ...gl, canvas };
    } catch (error) {
      console.warn("WebGL2 renderer unavailable, painting with Canvas 2D.", error);
      // a canvas that has handed out a WebGL context cannot give a 2D one
      const fresh = canvas.cloneNode(false);
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
  }
  return { ...create2D(canvas), canvas };
}
