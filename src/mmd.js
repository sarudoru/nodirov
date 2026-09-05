// A live 3D feed for the screen: an MMD model dancing a VMD motion,
// rendered by three.js into an offscreen canvas that the glyph renderer
// samples like any other footage. The difference from video is the camera:
// it is ours. Drag to orbit the dancer; leave it and it circles slowly.
//
// Physics is off (no Ammo.js): skirts and hair follow the bones rigidly,
// which the character grid cannot tell apart from simulated cloth anyway.

import * as THREE from "three";
import { MMDLoader } from "three/addons/loaders/MMDLoader.js";
import { MMDAnimationHelper } from "three/addons/animation/MMDAnimationHelper.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export const MODELS = {
  gura: { url: "assets/mmd/gura/GawrGura.pmx" },
  miku: { url: "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/mmd/miku/miku_v2.pmd" },
};

export const MOTIONS = {
  wavefile: { url: "assets/mmd/motion/wavefile_v2.vmd", audio: "assets/mmd/motion/wavefile_short.mp3" },
};

export async function createMmdFeed({ model = "gura", motion = "wavefile", orbitTarget, width = 640, height = 360 } = {}) {
  const spec = MODELS[model] ?? MODELS.gura;
  const move = MOTIONS[motion] ?? MOTIONS.wavefile;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // Lighting for a character grid: strong key from the camera side, a
  // fill from above, and a rim from behind so the silhouette carries even
  // where the costume is dark.
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(8, 18, 24);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.9);
  rim.position.set(-10, 16, -20);
  scene.add(rim);

  const loader = new MMDLoader();
  const helper = new MMDAnimationHelper({ afterglow: 2.0 });
  const { mesh, animation } = await new Promise((resolve, reject) => {
    loader.loadWithAnimation(spec.url, move.url, resolve, undefined, reject);
  });
  helper.add(mesh, { animation, physics: false });
  scene.add(mesh);

  // Frame from the model's real size, not a guess: the dancer stands in the
  // rest pose at load, so its bounding box is the height to fill.
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const size = box.max.y - box.min.y;
  const focus = new THREE.Vector3(0, box.min.y + size * 0.5, 0);
  const camera = new THREE.PerspectiveCamera(30, width / height, 1, size * 40);
  // distance at which the standing figure fills the frame height, plus room
  // for the arms and the steps of the dance
  const fit = (size / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, focus.y + size * 0.05, fit * 1.18);
  camera.lookAt(focus);

  // Orbit on whatever element the page hands us (the visible glyph canvas),
  // so dragging the picture turns the dancer.
  const controls = new OrbitControls(camera, orbitTarget ?? canvas);
  controls.target.copy(focus);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.8;
  controls.minDistance = fit * 0.5;
  controls.maxDistance = fit * 3;
  controls.update();
  const mixer = helper.objects.get(mesh).mixer;
  const duration = animation.duration;

  const audio = new Audio(move.audio);
  audio.loop = true;
  audio.preload = "auto";
  let sound = false;

  let last = 0;
  let paused = false;

  function render(now) {
    const delta = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (!paused) {
      helper.update(delta);
      // the motion loops; keep the mixer and the song circling together
      if (mixer.time >= duration) {
        mixer.setTime(mixer.time % duration);
        if (sound) audio.currentTime = mixer.time;
      }
    }
    controls.update();
    renderer.render(scene, camera);
  }

  return {
    canvas,
    render,
    duration: () => duration,
    time: () => mixer.time % duration,
    seek(seconds) {
      mixer.setTime(seconds);
      if (sound) audio.currentTime = seconds;
    },
    playPause() {
      paused = !paused;
      if (sound) (paused ? audio.pause() : audio.play().catch(() => {}));
      return paused;
    },
    setSound(on) {
      sound = on;
      if (on) {
        audio.currentTime = mixer.time % duration;
        audio.play().catch(() => { sound = false; });
      } else {
        audio.pause();
      }
      return sound;
    },
    setOrbit(on) { controls.autoRotate = !!on; },
    dispose() {
      controls.dispose();
      renderer.dispose();
      audio.pause();
    },
  };
}
