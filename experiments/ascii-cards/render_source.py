"""Bake the two source animations to mp4. These are the 'video' the ASCII pass samples.

Nothing is downloaded: each clip is a raymarched SDF rendered to grayscale frames
and piped straight into ffmpeg. Rotation completes exactly 2*pi over the clip so
the loop is seamless.
"""
import subprocess, sys, math
import numpy as np

W, H, N = 176, 198, 32        # ~2.5x the ASCII grid; the pass box-filters anyway
TW, TH = 176, 198          # atlas tile size == render size, no rescale
AC, AR = 8, 4              # atlas layout, AC*AR must be >= N

def smin(a, b, k):
    h = np.clip(k - np.abs(a - b), 0, None) / k
    return np.minimum(a, b) - h * h * k * 0.25

def rotY(P, a):
    c, s = math.cos(a), math.sin(a)
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    return np.stack([x * c + z * s, y, -x * s + z * c], -1)

def rotX(P, a):
    c, s = math.cos(a), math.sin(a)
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    return np.stack([x, y * c + z * s, -y * s + z * c], -1)

def sph(P, cx, cy, cz, r):
    return np.linalg.norm(P - np.array([cx, cy, cz], np.float32), axis=-1) - r

# --- scene A: crumpled solid (left card) ---------------------------------
def rock(P, t):
    Q = rotX(rotY(P, t), 0.35 * math.sin(t) + 0.30)
    x, y, z = Q[..., 0], Q[..., 1], Q[..., 2]
    d = np.linalg.norm(Q, axis=-1) - 0.78
    d += 0.22 * np.sin(2.4 * x + 0.7) * np.sin(2.4 * y) * np.sin(2.4 * z)  # big facets
    d += 0.09 * np.sin(5.4 * x) * np.sin(5.4 * z + 2.0) * np.sin(5.4 * y)  # break-up
    d += 0.03 * np.sin(13.0 * y + 1.4)                                     # grain
    return d * 0.45                                                        # lipschitz guard

# --- scene B: cloud body with a rising column (right card) ---------------
def cloud(P, t):
    """Oblate lumpy disc with a thin column floating clear above it.

    The body is built in a vertically squashed space so it stays WIDE from every
    yaw angle - a cluster of round spheres would read as narrow at 90 degrees.
    """
    Q = rotX(rotY(P, t), 0.16 * math.sin(t * 0.8) + 0.08)
    FLAT = 1.28
    S = Q * np.array([1.0, FLAT, 1.0], np.float32)

    body = sph(S, -0.78,  0.00,  0.16, 0.42)
    body = smin(body, sph(S, -0.26,  0.04, -0.32, 0.48), 0.45)
    body = smin(body, sph(S,  0.06, -0.02,  0.02, 0.53), 0.45)
    body = smin(body, sph(S,  0.42,  0.05,  0.28, 0.46), 0.45)
    body = smin(body, sph(S,  0.80, -0.03, -0.12, 0.40), 0.45)
    body = body / FLAT

    y = Q[..., 1]
    rad = 0.115 - 0.055 * np.clip((y - 0.85) / 0.95, 0, 1)
    col = np.sqrt((Q[..., 0] - 0.12) ** 2 + Q[..., 2] ** 2) - rad
    col = np.maximum(col, np.abs(y - 1.18) - 0.50)     # detached: clear air below
    return np.minimum(body, col)

def render(scene, path, fov, look=0.0):
    px, py = np.meshgrid(np.linspace(-1, 1, W, dtype=np.float32),
                         np.linspace(1, -1, H, dtype=np.float32))
    ar = W / H
    dx, dy, dz = px * ar * fov, py * fov, np.full_like(px, -1.0)
    inv = 1.0 / np.sqrt(dx * dx + dy * dy + 1.0)
    D = np.stack([dx * inv, dy * inv, dz * inv], -1).reshape(-1, 3).astype(np.float32)
    O = np.array([0.0, look, 3.0], np.float32)

    raw = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray",
           "-s", f"{W}x{H}", "-r", "16", "-i", "-"]
    # human-viewable clip
    ff = subprocess.Popen(raw + ["-c:v", "libx264", "-preset", "slow", "-crf", "18",
                                 "-pix_fmt", "yuv420p", "-movflags", "+faststart", path],
                          stdin=subprocess.PIPE)
    # the same clip pre-decoded into one sprite sheet: what the page actually loads
    at = subprocess.Popen(raw + ["-vf", f"scale={TW}:{TH},tile={AC}x{AR}",
                                 "-frames:v", "1", path.replace(".mp4", ".png")],
                          stdin=subprocess.PIPE)

    frames = []
    for f in range(N):
        t = 2 * math.pi * f / N
        d = np.zeros(D.shape[0], np.float32)
        steps = np.zeros(D.shape[0], np.float32)
        alive = np.ones(D.shape[0], bool)
        for _ in range(44):
            P = O + D * d[:, None]
            h = scene(P, t)
            alive &= (h > 0.0015) & (d < 7.0)
            if not alive.any():
                break
            d = np.where(alive, d + h * 0.85, d)
            steps += alive
        hit = d < 7.0

        e = 0.012
        P = O + D * d[:, None]
        def sd(off):
            return scene(P + np.array(off), t)
        nx = sd((e, 0, 0)) - sd((-e, 0, 0))
        ny = sd((0, e, 0)) - sd((0, -e, 0))
        nz = sd((0, 0, e)) - sd((0, 0, -e))
        nl = 1.0 / np.maximum(np.sqrt(nx * nx + ny * ny + nz * nz), 1e-6)
        nx, ny, nz = nx * nl, ny * nl, nz * nl

        L = np.array([-0.42, 0.70, 0.58]); L = L / np.linalg.norm(L)
        diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
        # facing term: 1 dead-on, 0 at the silhouette. This is what makes the
        # glyphs dense in the middle of the form and dissolve at its edge.
        face = np.clip(-(nx * D[:, 0] + ny * D[:, 1] + nz * D[:, 2]), 0, 1)
        ao = np.clip(1.0 - steps / 26.0, 0.30, 1.0)
        lum = (0.30 + 0.70 * diff) * np.power(face, 0.38) * ao * 1.28
        lum = np.where(hit, np.clip(lum, 0, 1), 0.0)

        frames.append(lum.reshape(H, W))
        print(f"\r{path}  {f+1}/{N}", end="", flush=True)

    # normalise the whole clip so its brightest surface lands at pure white:
    # the ASCII pass wants the full 0..1 range, whatever the shape happens to be
    stack = np.stack(frames)
    peak = np.percentile(stack[stack > 0.02], 99.5)
    for fr in stack:
        buf = (np.clip(fr / peak, 0, 1) * 255).astype(np.uint8).tobytes()
        ff.stdin.write(buf); at.stdin.write(buf)
    ff.stdin.close(); ff.wait()
    at.stdin.close(); at.wait()
    print(f"  peak={peak:.3f}")

if "b" not in sys.argv: render(rock,  "src-a.mp4", 0.385)
if "a" not in sys.argv: render(cloud, "src-b.mp4", 0.520, look=0.56)
