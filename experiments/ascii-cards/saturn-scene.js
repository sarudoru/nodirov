/* Saturn as a source for the ASCII pass.
   Renders to an opaque black canvas: brightness is the only channel that
   matters downstream, so the pass never has to know what it is looking at. */
export function buildSaturn(THREE, canvas){
  // preserveDrawingBuffer: the ASCII pass reads this canvas with drawImage on a
// later tick, by which time an unpreserved buffer has already been cleared.
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:false,
                                            preserveDrawingBuffer:true});
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.setClearColor(0x000000, 1);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, canvas.width/canvas.height, 0.1, 100);
  camera.position.set(0, 0, 9.4);
  camera.lookAt(0, -0.45, 0);   // subject sits high in the card, as in the reference

  // key light on the camera, so brightness tracks how squarely a surface faces us
  camera.add(new THREE.PointLight(0xffffff, 30, 0, 1.5));
  scene.add(camera);
  scene.add(new THREE.AmbientLight(0xffffff, 0.04));
  const key = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(-4, 2.5, 3); scene.add(key);

  const bandTex = () => {
    const c = document.createElement('canvas'); c.width = 8; c.height = 256;
    const x = c.getContext('2d');
    for(let y=0;y<256;y++){
      const t = y/255, lat = Math.abs(t-0.5)*2;
      let v = 0.72 + 0.20*Math.sin(t*Math.PI*17) + 0.10*Math.sin(t*Math.PI*41+1.2);
      v *= 1 - 0.30*lat*lat;
      const g = Math.max(0, Math.min(255, v*255))|0;
      x.fillStyle = `rgb(${g},${g},${g})`; x.fillRect(0,y,8,1);
    }
    return new THREE.CanvasTexture(c);
  };

  const ringTex = () => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 8;
    const x = c.getContext('2d');
    for(let i=0;i<512;i++){
      const r = i/511;
      let a = 0.42 + 0.50*Math.sin(r*Math.PI*26) * (0.55+0.45*Math.sin(r*Math.PI*7));
      if(r > 0.60 && r < 0.68) a *= 0.10;          // Cassini division
      if(r < 0.06 || r > 0.98) a = 0;
      a *= Math.min(1, (1-r)*6) * 0.88;
      const g = Math.max(0, Math.min(255, a*255))|0;
      x.fillStyle = `rgb(${g},${g},${g})`; x.fillRect(i,0,1,8);
    }
    return new THREE.CanvasTexture(c);
  };

  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 96, 64),
    new THREE.MeshStandardMaterial({map:bandTex(), roughness:1, metalness:0}));
  planet.scale.y = 0.90;

  const rt = ringTex();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.32, 2.22, 256, 1),
    new THREE.MeshBasicMaterial({map:rt, alphaMap:rt, transparent:true,
                                 side:THREE.DoubleSide, depthWrite:false}));
  ring.rotation.x = Math.PI/2;

  const saturn = new THREE.Group();
  saturn.add(planet); saturn.add(ring);
  saturn.rotation.z = 26.7 * Math.PI/180;          // real axial tilt
  scene.add(saturn);

  return {
    render(t){
      planet.rotation.y = t*0.10;
      saturn.rotation.x = 0.38 + Math.sin(t*0.08)*0.09;
      renderer.render(scene, camera);
    },
    scene, camera, renderer, saturn,
  };
}
