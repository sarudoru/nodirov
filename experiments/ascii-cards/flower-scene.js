/* Gazania (Poly Haven, CC0) as a source for the ASCII pass.
   Renders in full colour onto black — the pass reads luminance for the glyph
   and the actual RGB for the ink, so the flower keeps its own palette. */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function buildFlower(THREE, canvas, pick = 'flower_gazania_h_LOD0'){
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:false,
                                            preserveDrawingBuffer:true});
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, canvas.width/canvas.height, 0.01, 50);
  scene.add(camera);

  // key on the camera keeps density tracking how squarely a petal faces us;
  // the two rim lights stop the far petals going flat black.
  camera.add(new THREE.PointLight(0xffffff, 14, 0, 1.3));
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const k1 = new THREE.DirectionalLight(0xfff2e0, 3.0); k1.position.set(-3, 4, 2);
  const k2 = new THREE.DirectionalLight(0xdfe8ff, 1.4); k2.position.set( 3,-1,-2);
  scene.add(k1, k2);

  const group = new THREE.Group();
  scene.add(group);
  let ready = false;

  new GLTFLoader().load('./models/flower_gazania/flower_gazania_2k.gltf', g => {
    const m = g.scene;
    // the asset is a ground-cover scatter of eight plants; keep one so a single
    // flower fills the card instead of a strip of tiny ones
    m.traverse(o => { if(o.isMesh && o.name !== pick) o.visible = false; });
    m.traverse(o => { if(o.isMesh && o.visible){
      o.material.side = THREE.DoubleSide;
      if(o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
      o.material.roughness = 0.85;
      o.material.metalness = 0.0;
      o.material.emissive = new THREE.Color(0x000000);
    }});

    // normalise on the kept plant only
    const keep = m.getObjectByName(pick) || m;
    const box = new THREE.Box3().setFromObject(keep);
    const size = box.getSize(new THREE.Vector3());
    const mid  = box.getCenter(new THREE.Vector3());
    const s = 2.0 / Math.max(size.x, size.y, size.z);
    m.position.sub(mid).multiplyScalar(s);
    m.scale.setScalar(s);
    group.add(m);

    camera.position.set(0, 0.28, 2.85);
    camera.lookAt(0, 0, 0);
    ready = true;
    window.dispatchEvent(new CustomEvent('flower-ready', {detail:{
      size: size.toArray().map(v=>+v.toFixed(3)),
      meshes: (()=>{let n=0;m.traverse(o=>{if(o.isMesh)n++});return n;})(),
    }}));
  }, undefined, e => console.error('gltf load failed', e));

  return {
    render(t){
      if(!ready) return false;
      group.rotation.y = Math.sin(t*0.11)*0.55;
      group.rotation.x = -0.18 + Math.sin(t*0.07)*0.10;
      renderer.render(scene, camera);
      return true;
    },
    isReady: () => ready,
    scene, camera, renderer, group,
  };
}
