import * as THREE from '../../vendor/three.module.js';

const shared = {
  tire: new THREE.MeshStandardMaterial({ color: 0x101419, roughness: 0.92 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x17202a, roughness: 0.45, metalness: 0.5 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd0dae3, roughness: 0.19, metalness: 0.9 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x213c50, roughness: 0.12, metalness: 0.6, clearcoat: 1 }),
};
const dimensions = {
  compact: [1.98, 3.65, 1.68], sedan: [2.08, 4.5, 1.59], suv: [2.34, 4.8, 2.08],
  sport: [2.20, 4.35, 1.28], super: [2.36, 4.70, 1.19], hyper: [2.44, 4.9, 1.12],
};

function box(group, w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

// Extruded side silhouettes give the cars sloped hoods, cabins and distinct profiles.
function silhouette(group, points, width, material, bevel = 0.05) {
  const shape = new THREE.Shape();
  shape.moveTo(...points[0]);
  points.slice(1).forEach(p => shape.lineTo(...p));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1 });
  geometry.rotateY(Math.PI / 2);
  geometry.translate(-width / 2, 0, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export function createVehicle(config, npc = false) {
  const group = new THREE.Group();
  const type = config.type || 'sedan';
  const [width, length, roofHeight] = dimensions[type] || dimensions.sedan;
  const sporty = ['sport', 'super', 'hyper'].includes(type);
  const bodyTop = type === 'suv' ? 1.2 : sporty ? 0.91 : 1.0;
  const paint = new THREE.MeshPhysicalMaterial({ color: config.color || '#16b8ae', metalness: 0.55, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.16 });
  const headLamp = new THREE.MeshStandardMaterial({ color: 0xd9f4ff, emissive: 0xcdeeff, emissiveIntensity: 1.8 });
  const tailLamp = new THREE.MeshStandardMaterial({ color: 0xff343c, emissive: 0xf62135, emissiveIntensity: 0.65 });
  const signalLeft = new THREE.MeshStandardMaterial({ color: 0xf38a10, emissive: 0xff951a, emissiveIntensity: 0.05 });
  const signalRight = signalLeft.clone();
  const half = length / 2;
  silhouette(group, [[-half, .6], [-half, bodyTop], [-half + .5, bodyTop + .05], [half - .45, bodyTop], [half, .77], [half, .6]], width * .94, paint, .075);
  const cabinFront = sporty ? .65 : type === 'compact' ? .85 : .95;
  const cabinBack = type === 'suv' || type === 'compact' ? -half + .30 : -.85;
  silhouette(group, [[cabinBack - .25, bodyTop], [cabinBack + .1, roofHeight - .12], [cabinFront - .4, roofHeight], [cabinFront + .5, bodyTop]], width * .77, shared.glass, .025);
  box(group, width * .74, .07, Math.abs(cabinBack - cabinFront) * .62, paint, 0, roofHeight, -.10);
  for (const side of [-1, 1]) {
    box(group, .06, .09, length * .68, shared.trim, side * width * .48, .62, 0);
    box(group, .075, roofHeight - bodyTop, .08, paint, side * width * .392, (roofHeight + bodyTop) / 2, -.10);
    box(group, .26, .15, .33, paint, side * (width / 2 + .1), bodyTop + .2, -.65);
    box(group, width * .25, .085, .05, headLamp, side * width * .31, .86, -half - .06);
    box(group, width * .30, .10, .05, tailLamp, side * width * .3, bodyTop - .09, half + .07);
    for (const z of [-half - .07, half + .07]) box(group, .15, .10, .055, side < 0 ? signalLeft : signalRight, side * width * .44, .80, z);
  }
  box(group, width * .80, .15, .12, shared.trim, 0, .67, -half - .07);
  box(group, width * .42, .19, .035, shared.trim, 0, .82, -half - .14);
  box(group, width * .82, .13, .16, shared.trim, 0, .63, half + .05);
  box(group, .65, .12, .035, shared.chrome, 0, .82, half + .13);
  if (sporty) {
    const wingY = type === 'hyper' ? 1.29 : bodyTop + .33;
    for (const x of [-.63, .63]) box(group, .06, .28, .09, shared.trim, x, wingY - .14, half - .25);
    box(group, width * .83, .09, .4, shared.trim, 0, wingY, half - .22);
    const stripe = new THREE.MeshStandardMaterial({ color: 0xf1ede3, roughness: .34, metalness: .3 });
    for (const x of [-.19,.19]) box(group, .17, .01, .88, stripe, x, bodyTop + .051, -half + .63);
  }
  if (type === 'suv') {
    for (const x of [-.76,.76]) box(group, .09, .07, 2.5, shared.chrome, x, roofHeight + .1, .25);
    box(group, 1.5, .08, .12, shared.chrome, 0, roofHeight + .11, .6);
  }
  const wheelRadius = type === 'suv' ? .49 : sporty ? .40 : .42;
  const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, .31, npc ? 12 : 20);
  wheelGeometry.rotateZ(Math.PI / 2);
  const rimGeometry = new THREE.CylinderGeometry(wheelRadius * .64, wheelRadius * .64, .325, 12);
  rimGeometry.rotateZ(Math.PI / 2);
  const wheels = [];
  const frontPivots = [];
  for (const x of [-width / 2, width / 2]) {
    for (const z of [-length * .31, length * .31]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, wheelRadius + .13, z);
      const wheel = new THREE.Group();
      wheel.add(new THREE.Mesh(wheelGeometry, shared.tire));
      wheel.add(new THREE.Mesh(rimGeometry, shared.chrome));
      for (let i = 0; i < 5; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(.335, .065, wheelRadius * 1.02), shared.trim);
        spoke.rotation.x = i * Math.PI / 5;
        wheel.add(spoke);
      }
      pivot.add(wheel);
      group.add(pivot);
      wheels.push(wheel);
      if (z < 0) frontPivots.push(pivot);
    }
  }
  const headlights = [];
  if (!npc) {
    const beam = new THREE.SpotLight(0xe1f2ff, 2.5, 38, .48, .7, 1.4);
    beam.position.set(0, .85, -half);
    const target = new THREE.Object3D();
    target.position.set(0, .15, -half - 25);
    beam.target = target;
    group.add(target, beam);
    headlights.push(beam);
  }
  group.userData = { wheels, frontPivots, headLamp, tailLamp, signalLeft, signalRight, headlights, length, width, config };
  return group;
}

export function updateVehicle(group, state, keys, dt, blink, lights) {
  group.position.set(state.x, .03, state.z);
  group.rotation.y = state.heading + state.driftAngle;
  group.rotation.z = THREE.MathUtils.damp(group.rotation.z, -state.steering * Math.min(Math.abs(state.speed) / 20, 1) * .065, 7, dt);
  group.rotation.x = THREE.MathUtils.damp(group.rotation.x, keys.down ? .025 : keys.up ? -.015 : 0, 7, dt);
  for (const pivot of group.userData.frontPivots) pivot.rotation.y = state.steering * .75;
  for (const wheel of group.userData.wheels) wheel.rotation.x = state.wheelSpin;
  group.userData.tailLamp.emissiveIntensity = keys.down || keys.handbrake ? 3 : .7;
  group.userData.headLamp.emissiveIntensity = lights ? 2.5 : .12;
  group.userData.headlights.forEach(light => light.visible = lights);
  group.userData.signalLeft.emissiveIntensity = state.signal === 'left' && blink ? 4 : .03;
  group.userData.signalRight.emissiveIntensity = state.signal === 'right' && blink ? 4 : .03;
}

export function disposeVehicle(group) {
  const geometries = new Set();
  const materials = new Set();
  const sharedMaterials = new Set(Object.values(shared));
  group.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    if (child.material && !sharedMaterials.has(child.material)) materials.add(child.material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
