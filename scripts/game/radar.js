import { CITY_HALF, STREET_POSITIONS } from './world.js';

export function createRadar(canvas, player, world, traffic, collectibles) {
  const ctx=canvas?.getContext('2d');
  let sweep=0;
  return function draw(dt) {
    if (!ctx) return;
    const w=canvas.width,h=canvas.height,cx=w/2,cy=h/2,r=Math.min(w,h)*.46,scale=r/155;
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle='#0b1722'; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.clip();
    const sin=Math.sin(player.heading),cos=Math.cos(player.heading);
    function point(x,z) {
      const dx=x-player.x,dz=z-player.z;
      return {x:cx+(dx*cos-dz*sin)*scale,y:cy+(dx*sin+dz*cos)*scale};
    }
    function dot(x,z,color,size) {
      const p=point(x,z);
      if (Math.hypot(p.x-cx,p.y-cy)>r-3) return;
      ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,size,0,Math.PI*2);ctx.fill();
    }
    ctx.strokeStyle='#2f4b5b';ctx.lineWidth=7;
    for (const street of STREET_POSITIONS) {
      for (const [a,b] of [[point(street,-CITY_HALF),point(street,CITY_HALF)],[point(-CITY_HALF,street),point(CITY_HALF,street)]]) {
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      }
    }
    ctx.fillStyle='rgba(116,146,157,.25)';
    for (const o of world.radarObstacles) {
      const p=point(o.x,o.z);
      if (Math.hypot(p.x-cx,p.y-cy)>r+14) continue;
      ctx.fillRect(p.x-o.w*scale/2,p.y-o.d*scale/2,o.w*scale,o.d*scale);
    }
    for (const npc of traffic.cars) dot(npc.group.position.x,npc.group.position.z,'#fb7185',2.8);
    for (const coin of collectibles.coins) dot(coin.x,coin.z,'#f7ce60',2.5);
    for (const station of world.stations) {
      const p=point(station.x,station.z);
      if (Math.hypot(p.x-cx,p.y-cy)>r-5) continue;
      ctx.fillStyle='#5ce7b6';ctx.fillRect(p.x-4,p.y-4,8,8);
      ctx.fillStyle='#062622';ctx.font='bold 8px sans-serif';ctx.textAlign='center';ctx.fillText('F',p.x,p.y+3);
    }
    sweep+=dt*.8;
    ctx.strokeStyle='rgba(85,218,213,.08)';ctx.lineWidth=1;
    for (let i=1;i<=3;i++) {ctx.beginPath();ctx.arc(cx,cy,r*i/3,0,Math.PI*2);ctx.stroke();}
    ctx.strokeStyle='rgba(77,230,199,.25)';ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(sweep)*r,cy+Math.sin(sweep)*r);ctx.stroke();
    ctx.restore();
    ctx.fillStyle='#e8fffa';ctx.beginPath();ctx.moveTo(cx,cy-8);ctx.lineTo(cx-5,cy+6);ctx.lineTo(cx+5,cy+6);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#345461';ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
  };
}
