import * as THREE from '../../vendor/three.module.js';
import { CITY_HALF, STREET_POSITIONS, ROAD_WIDTH } from './world.js';

export function createTraffic(scene, player, getLevel, { lowQuality = false } = {}) {
  const material = options => lowQuality
    ? new THREE.MeshLambertMaterial(Object.fromEntries(Object.entries(options).filter(([key]) => ['color', 'emissive', 'emissiveIntensity'].includes(key))))
    : new THREE.MeshStandardMaterial(options);
  const cars = [];
  let time = 0;
  const off = 0x29333b;
  const colors = [0xf16d76, 0xf6b952, 0x83d8b5, 0x9387dd, 0x52bacb, 0xe5dfd3];
  const tireMaterial = material({ color: 0x151a20, roughness: .9 });
  const glassMaterial = material({ color: 0x274555, metalness: .5, roughness: .2 });
  const bodyGeometry = new THREE.BoxGeometry(1.95, .56, 3.9);
  const cabinGeometry = new THREE.BoxGeometry(1.58, .63, 1.8);
  const wheelGeometry = new THREE.CylinderGeometry(.38,.38,.28,10);
  wheelGeometry.rotateZ(Math.PI/2);
  const lightGeometry = new THREE.BoxGeometry(1.6,.10,.06);
  const rearMaterial = material({ color: 0xff3a48, emissive: 0xff3344, emissiveIntensity: .6 });
  const frontMaterial = material({ color: 0xedf6ff, emissive: 0xd3efff, emissiveIntensity: 1.3 });

  function mesh(geometry, material, x,y,z, group) {
    const item = new THREE.Mesh(geometry,material);
    item.position.set(x,y,z);
    item.castShadow = true;
    group.add(item);
    return item;
  }
  function spawn(index = cars.length) {
    const group = new THREE.Group();
    const paint = material({ color: colors[index % colors.length], metalness: .45, roughness: .3 });
    mesh(bodyGeometry,paint,0,.83,0,group);
    mesh(cabinGeometry,glassMaterial,0,1.4,-.07,group);
    for (const x of [-.97,.97]) for (const z of [-1.25,1.25]) mesh(wheelGeometry,tireMaterial,x,.48,z,group);
    mesh(lightGeometry,rearMaterial,0,.88,1.97,group);
    mesh(lightGeometry,frontMaterial,0,.88,-1.97,group);
    scene.add(group);
    const axis = index % 2 ? 'x' : 'z';
    const direction = index % 4 < 2 ? 1 : -1;
    const street = STREET_POSITIONS[(index * 5 + 3) % STREET_POSITIONS.length];
    const npc = { group, axis, direction, street, laneOffset: direction * (axis === 'z' ? -3.5 : 3.5), position: -CITY_HALF + 30 + (index * 83) % (CITY_HALF*2-60), speed: 0, desiredSpeed: 10 + index % 6 };
    cars.push(npc);
    place(npc);
  }
  function place(car) {
    if (car.axis === 'z') {
      car.group.position.set(car.street + car.laneOffset,.04,car.position);
      car.group.rotation.y = car.direction > 0 ? Math.PI : 0;
    } else {
      car.group.position.set(car.position,.04,car.street + car.laneOffset);
      car.group.rotation.y = car.direction > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    car.group.visible = Math.hypot(player.x-car.group.position.x,player.z-car.group.position.z) < 270;
  }
  function signalState(axis) {
    const t = time % 20;
    if (axis === 'z') return t < 8 ? 'green' : t < 10 ? 'yellow' : 'red';
    return t < 10 ? 'red' : t < 18 ? 'green' : 'yellow';
  }

  // Instanced signal equipment keeps all 81 intersections inexpensive to render.
  const dummy = new THREE.Object3D();
  const count = STREET_POSITIONS.length ** 2;
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(.09,.12,5,6), material({color:0x263540,metalness:.6,roughness:.4}), count*2);
  const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(.60,1.65,.4), tireMaterial, count*2);
  const bulbs = {};
  for (const axis of ['x','z']) {
    bulbs[axis] = {};
    for (const [name,color] of [['red',0xff3238],['yellow',0xffc62b],['green',0x42fc99]]) {
      const signalMaterial = material({color:off,emissive:color,emissiveIntensity:.05});
      const instance = new THREE.InstancedMesh(new THREE.SphereGeometry(.18,8,6),signalMaterial,count);
      bulbs[axis][name] = instance;
      scene.add(instance);
    }
  }
  let index=0;
  for (const x of STREET_POSITIONS) for (const z of STREET_POSITIONS) {
    for (const [axis,dx,dz,rotation] of [['z',ROAD_WIDTH/2+1,-ROAD_WIDTH/2-1,Math.PI],['x',-ROAD_WIDTH/2-1,ROAD_WIDTH/2+1,-Math.PI/2]]) {
      const n = index*2 + (axis==='x'?1:0);
      dummy.position.set(x+dx,2.5,z+dz); dummy.rotation.set(0,rotation,0); dummy.updateMatrix(); pole.setMatrixAt(n,dummy.matrix);
      dummy.position.y=4.55; dummy.updateMatrix(); housing.setMatrixAt(n,dummy.matrix);
      for (const [i,name] of ['red','yellow','green'].entries()) {
        dummy.position.set(x+dx-Math.sin(rotation)*.23,5.05-i*.5,z+dz-Math.cos(rotation)*.23);
        dummy.updateMatrix(); bulbs[axis][name].setMatrixAt(index,dummy.matrix);
      }
    }
    index++;
  }
  scene.add(pole,housing);
  for (let i=0;i<22;i++) spawn(i);

  function update(dt, active) {
    if (active) time += dt;
    for (const axis of ['x','z']) for (const name of ['red','yellow','green']) {
      const material=bulbs[axis][name].material;
      material.emissiveIntensity = signalState(axis)===name ? 3.4 : .025;
      material.color.setHex(signalState(axis)===name ? material.emissive.getHex() : off);
    }
    if (!active) return;
    if (cars.length < Math.min(32,22+getLevel())) spawn();
    for (const car of cars) {
      let target = Math.min(25,car.desiredSpeed*(1+(getLevel()-1)*.04));
      let intersection = Infinity;
      for (const road of STREET_POSITIONS) {
        const distance = car.direction * (road-car.position);
        if (distance > .1) intersection = Math.min(intersection,distance);
      }
      const stop = intersection - ROAD_WIDTH/2-3;
      if (signalState(car.axis)!=='green' && stop > -1 && stop < 24) target=Math.min(target,Math.max(0,stop*.65));
      for (const other of cars) {
        if (other===car || other.axis!==car.axis || other.street!==car.street || other.direction!==car.direction) continue;
        const distance=car.direction*(other.position-car.position);
        if (distance>0 && distance<16) target=Math.min(target,Math.max(0,(distance-5)*.75));
      }
      const across = car.axis==='z' ? Math.abs(player.x-car.street-car.laneOffset) : Math.abs(player.z-car.street-car.laneOffset);
      const ahead = car.direction*((car.axis==='z'?player.z:player.x)-car.position);
      if (across<2.5 && ahead>0 && ahead<17) target=Math.min(target,Math.max(0,(ahead-4)*.7));
      car.speed=THREE.MathUtils.damp(car.speed,target,target<car.speed?5:2,dt);
      car.position += car.direction*car.speed*dt;
      if (car.position>CITY_HALF-5) car.position=-CITY_HALF+5;
      if (car.position<-CITY_HALF+5) car.position=CITY_HALF-5;
      place(car);
    }
  }
  function collide(x,z) {
    return cars.some(car=>Math.hypot(x-car.group.position.x,z-car.group.position.z)<2.45);
  }
  return { cars, update, collide };
}
