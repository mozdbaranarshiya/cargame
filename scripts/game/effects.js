import * as THREE from '../../vendor/three.module.js';
import { CITY_HALF, STREET_POSITIONS, ROAD_WIDTH } from './world.js';

export function distanceToSegment(x,z,from,to) {
  const dx=to.x-from.x,dz=to.z-from.z,lengthSquared=dx*dx+dz*dz;
  const t=lengthSquared>0?Math.max(0,Math.min(1,((x-from.x)*dx+(z-from.z)*dz)/lengthSquared)):0;
  return Math.hypot(x-from.x-t*dx,z-from.z-t*dz);
}

export function createCollectibles(scene, player, onCollect) {
  const spots = [{x:3.5,z:42},{x:3.5,z:28},{x:3.5,z:14},{x:3.5,z:-17},{x:3.5,z:-32},{x:3.5,z:-47}];
  for (const street of STREET_POSITIONS) for (let p=-CITY_HALF+24;p<CITY_HALF-24;p+=28) {
    if (STREET_POSITIONS.some(s=>Math.abs(s-p)<ROAD_WIDTH/2+3)) continue;
    spots.push({x:street+3.5,z:p},{x:p,z:street-3.5});
  }
  const coins=[];
  const ringGeometry=new THREE.TorusGeometry(.65,.17,8,20);
  const coreGeometry=new THREE.CylinderGeometry(.43,.43,.08,20);
  coreGeometry.rotateX(Math.PI/2);
  const gold=new THREE.MeshStandardMaterial({color:0xffcc3e,emissive:0xc78715,emissiveIntensity:.65,metalness:.8,roughness:.2});
  const face=new THREE.MeshStandardMaterial({color:0xffed9a,emissive:0x9c6f21,emissiveIntensity:.55,metalness:.6,roughness:.3});
  let next=6;
  for (let i=0;i<64;i++) {
    const mesh=new THREE.Group();
    mesh.add(new THREE.Mesh(ringGeometry,gold),new THREE.Mesh(coreGeometry,face));
    const spot=i<6?spots[i]:spots[6+((i-6)*17)%(spots.length-6)];
    mesh.position.set(spot.x,1.4,spot.z);
    scene.add(mesh);
    coins.push({mesh,x:spot.x,z:spot.z,phase:i*.7});
  }
  function update(dt,previousPosition=player) {
    for (const coin of coins) {
      coin.phase+=dt*2.5;
      coin.mesh.rotation.y+=dt*2.4;
      coin.mesh.position.y=1.4+Math.sin(coin.phase)*.2;
      coin.mesh.visible=Math.hypot(coin.x-player.x,coin.z-player.z)<240;
      if (distanceToSegment(coin.x,coin.z,previousPosition,player)<2.65) {
        onCollect();
        let spot;
        for (let attempt=0;attempt<spots.length;attempt++) {
          spot=spots[next%spots.length];
          next+=19;
          if (Math.hypot(spot.x-player.x,spot.z-player.z)>12 && !coins.some(c=>c!==coin && c.x===spot.x && c.z===spot.z)) break;
        }
        coin.x=spot.x; coin.z=spot.z;
        coin.mesh.position.set(coin.x,1.4,coin.z);
      }
    }
  }
  return {coins,update};
}

/** Fixed pools avoid accumulating disposable geometries while drifting. */
export function createDrivingEffects(scene, player) {
  const smokeGeometry=new THREE.SphereGeometry(.33,7,6);
  const markGeometry=new THREE.PlaneGeometry(.23,1.3);
  const smoke=[];
  const marks=[];
  for (let i=0;i<36;i++) {
    const mesh=new THREE.Mesh(smokeGeometry,new THREE.MeshBasicMaterial({color:0xe3dbd4,transparent:true,opacity:0,depthWrite:false}));
    mesh.visible=false; scene.add(mesh); smoke.push({mesh,life:0});
  }
  for (let i=0;i<140;i++) {
    const mesh=new THREE.Mesh(markGeometry,new THREE.MeshBasicMaterial({color:0x111a22,transparent:true,opacity:.46,depthWrite:false}));
    mesh.rotation.x=-Math.PI/2; mesh.visible=false; scene.add(mesh); marks.push({mesh,life:0});
  }
  let smokeIndex=0,markIndex=0,timer=0;
  function update(dt,drifting) {
    timer-=dt;
    if (drifting && timer<=0) {
      timer=.10;
      const h=player.heading+player.driftAngle;
      for (const side of [-.9,.9]) {
        const x=player.x+side*Math.cos(h)+1.4*Math.sin(h);
        const z=player.z-side*Math.sin(h)+1.4*Math.cos(h);
        const cloud=smoke[smokeIndex++%smoke.length];
        cloud.life=.85; cloud.mesh.visible=true; cloud.mesh.position.set(x,.5,z); cloud.mesh.scale.setScalar(1);
        const mark=marks[markIndex++%marks.length];
        mark.life=11; mark.mesh.visible=true; mark.mesh.position.set(x,.14,z); mark.mesh.rotation.set(-Math.PI/2,0,-h); mark.mesh.material.opacity=.46;
      }
    }
    for (const cloud of smoke) {
      if (cloud.life<=0) continue;
      cloud.life-=dt;
      cloud.mesh.position.y+=dt*.7;
      cloud.mesh.scale.addScalar(dt*.9);
      cloud.mesh.material.opacity=Math.max(0,cloud.life*.4);
      cloud.mesh.visible=cloud.life>0;
    }
    for (const mark of marks) {
      if (mark.life<=0) continue;
      mark.life-=dt;
      if (mark.life<2) mark.mesh.material.opacity=Math.max(0,mark.life*.23);
      mark.mesh.visible=mark.life>0;
    }
  }
  return {update};
}
