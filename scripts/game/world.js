import * as THREE from '../../vendor/three.module.js';

export const CITY_HALF = 540;
export const ROAD_WIDTH = 22;
export const STREET_POSITIONS = [-432, -324, -216, -108, 0, 108, 216, 324, 432];

const HALF_ROAD = ROAD_WIDTH / 2;

/** A static, instanced city. Coordinates and collision data share the same source. */
export function createWorld(scene, { lowQuality = false } = {}) {
  const root = new THREE.Group();
  root.name = 'Sunset city';
  scene.add(root);
  const obstacles = [];
  const radarObstacles = [];
  const stations = [
    { x: 18, z: 38, radius: 13, name: 'پمپ بنزین مرکزی' },
    { x: -198, z: -270, radius: 13, name: 'پمپ بنزین شمال' },
    { x: 342, z: 156, radius: 13, name: 'پمپ بنزین شرق' },
    { x: -306, z: 360, radius: 13, name: 'پمپ بنزین ساحل' },
    { x: 126, z: -390, radius: 13, name: 'پمپ بنزین کوهستان' },
  ];
  const batches = new Map();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 7);
  const cone = new THREE.ConeGeometry(1, 1, 7);
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  const material = (color, extra = {}) => lowQuality
    ? new THREE.MeshLambertMaterial({ color, ...Object.fromEntries(Object.entries(extra).filter(([key]) => ['emissive', 'emissiveIntensity', 'map', 'transparent', 'opacity'].includes(key))) })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const mat = {
    road: material(0x29333f, { roughness: 0.98 }),
    sidewalk: material(0xbcbab3),
    stripe: material(0xe4debd),
    yellow: material(0xe6b342),
    facade: material(0xffffff),
    roof: material(0x404b57),
    glass: material(0x254454, { metalness: 0.35, roughness: 0.32 }),
    litWindow: material(0xffe2a5, { emissive: 0xffc466, emissiveIntensity: 0.65, roughness: 0.3 }),
    trunk: material(0x705446),
    leaves: material(0xffffff),
    metal: material(0x354855, { metalness: 0.65, roughness: 0.5 }),
    lamp: material(0xffe5a4, { emissive: 0xffc572, emissiveIntensity: 1.8 }),
    lawn: material(0x54866d),
    path: material(0xc5ad8d),
    white: material(0xf0ece0),
    teal: material(0x23b79e),
    red: material(0xd3513d),
    water: material(0x397c91, { roughness: 0.22, metalness: 0.35 }),
  };
  function instance(name, geometry, meshMaterial, x, y, z, sx, sy, sz, color, rotation = 0) {
    if (!batches.has(name)) batches.set(name, { geometry, material: meshMaterial, items: [] });
    batches.get(name).items.push({ x, y, z, sx, sy, sz, color, rotation });
  }
  const b = (name, meshMaterial, x, y, z, sx, sy, sz, color, rotation = 0) => instance(name, box, meshMaterial, x, y, z, sx, sy, sz, color, rotation);
  const nearStation = (x, z, padding = 0) => stations.some((s) => Math.abs(s.x - x) < 21 + padding && Math.abs(s.z - z) < 25 + padding);
  const onStreet = (value, padding = 0) => STREET_POSITIONS.some((p) => Math.abs(value - p) <= HALF_ROAD + padding);
  const random = (a, c = 0) => {
    const n = Math.sin(a * 127.1 + c * 311.7 + 19.13) * 43758.5453;
    return n - Math.floor(n);
  };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1900, 1900), material(0x678374));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.15;
  ground.receiveShadow = true;
  root.add(ground);

  // Roads span the whole drivable area; curbs are visual, so a car can enter a forecourt.
  for (const p of STREET_POSITIONS) {
    b('roads', mat.road, p, -0.035, 0, ROAD_WIDTH, 0.15, CITY_HALF * 2);
    b('roads', mat.road, 0, -0.035, p, CITY_HALF * 2, 0.15, ROAD_WIDTH);
    const blocks = [-CITY_HALF, ...STREET_POSITIONS, CITY_HALF];
    for (let n = 0; n < blocks.length - 1; n++) {
      const start = blocks[n] + (n === 0 ? 0 : HALF_ROAD + 0.2);
      const end = blocks[n + 1] - (n === blocks.length - 2 ? 0 : HALF_ROAD + 0.2);
      for (const side of [-1, 1]) {
        b('sidewalks', mat.sidewalk, p + side * (HALF_ROAD + 1.75), 0.055, (start + end) / 2, 3.5, 0.12, end - start);
        b('sidewalks', mat.sidewalk, (start + end) / 2, 0.055, p + side * (HALF_ROAD + 1.75), end - start, 0.12, 3.5);
      }
    }
    for (let q = -CITY_HALF + 7; q < CITY_HALF; q += 13) {
      if (onStreet(q, 5)) continue;
      b('road markings', mat.stripe, p - 0.22, 0.055, q, 0.13, 0.015, 5.2);
      b('road markings', mat.stripe, p + 0.22, 0.055, q, 0.13, 0.015, 5.2);
      b('road markings', mat.stripe, q, 0.056, p - 0.22, 5.2, 0.015, 0.13);
      b('road markings', mat.stripe, q, 0.056, p + 0.22, 5.2, 0.015, 0.13);
    }
    for (const q of STREET_POSITIONS) {
      // Flush crossing slabs ensure the sidewalks never cover an intersection.
      b('roads', mat.road, p, 0.05, q, ROAD_WIDTH, 0.025, ROAD_WIDTH);
      for (let n = -7; n <= 7; n += 2.1) {
        for (const side of [-1, 1]) {
          b('crossings', mat.stripe, p + n, 0.08, q + side * 8.3, 1.05, 0.018, 3.0);
          b('crossings', mat.stripe, p + side * 8.3, 0.081, q + n, 3.0, 0.018, 1.05);
        }
      }
    }
  }

  function tree(x, z, size = 1, kind = 0) {
    if (nearStation(x, z, 4)) return;
    instance('tree trunks', cylinder, mat.trunk, x, 2.35 * size, z, 0.32 * size, 4.7 * size, 0.32 * size);
    if (kind === 1) {
      instance('cypress', cone, mat.leaves, x, 5.5 * size, z, 1.85 * size, 7.5 * size, 1.85 * size, 0x254f46);
    } else {
      instance('tree crowns', sphere, mat.leaves, x, 5.1 * size, z, 2.6 * size, 3.1 * size, 2.6 * size, kind === 2 ? 0xa68e57 : 0x42785d);
      instance('tree crowns', sphere, mat.leaves, x + size, 4.6 * size, z - size, 2.0 * size, 2.2 * size, 2.0 * size, 0x659069);
    }
  }

  function light(x, z, facing = 1) {
    if (nearStation(x, z, 1)) return;
    instance('light posts', cylinder, mat.metal, x, 4.25, z, 0.12, 8.5, 0.12);
    b('lamp arms', mat.metal, x + facing * 0.75, 8.4, z, 1.6, 0.14, 0.14);
    b('lamps', mat.lamp, x + facing * 1.4, 8.25, z, 0.85, 0.16, 0.42);
  }

  function building(x, z, width, depth, height, family, seed) {
    if (nearStation(x, z, Math.max(width, depth) / 2)) return;
    const colors = [0xcac6b5, 0xd0b3a0, 0x9cb2b3, 0x7e939c, 0xdda87f, 0xafb5b2, 0xc7bb98];
    const color = colors[Math.floor(random(seed, 9) * colors.length)];
    b('buildings', mat.facade, x, height / 2 + 0.15, z, width, height, depth, color);
    b('roof coping', mat.roof, x, height + 0.32, z, width + 0.7, 0.45, depth + 0.7);
    b('ground level shops', mat.glass, x, 1.7, z + depth / 2 + 0.04, width * 0.8, 2.3, 0.13);
    if (family === 1) {
      // Terraced Mediterranean apartments, with shadow lines and balconies.
      for (let y = 5; y < height; y += 5) {
        b('balcony slabs', mat.sidewalk, x, y, z + depth / 2 + 0.65, width + 0.8, 0.3, 1.5);
        b('balcony rails', mat.metal, x, y + 0.8, z + depth / 2 + 1.22, width, 0.1, 0.08);
      }
    } else if (family === 2) {
      b('tower spires', mat.roof, x, height + 3.5, z, width * 0.5, 6, depth * 0.5);
      b('tower accent', mat.teal, x, height * 0.56, z + depth / 2 + 0.07, width * 0.14, height * 0.8, 0.16);
    } else if (family === 3) {
      b('shop awnings', mat.red, x, 3.15, z + depth / 2 + 0.9, width * 0.88, 0.25, 1.9);
      b('roof water tanks', mat.metal, x - width * 0.25, height + 1.25, z, 2.2, 2, 2.2);
    }
    const columns = Math.min(5, Math.max(2, Math.floor(width / 5)));
    const rows = Math.floor((height - 4) / 4.1);
    for (let row = 0; row < rows; row++) {
      const y = 5.25 + row * 4.1;
      for (let column = 0; column < columns; column++) {
        const offset = (column - (columns - 1) / 2) * (width / (columns + 1));
        const lit = random(seed + row * 19, column) > 0.79;
        const name = lit ? 'lit windows' : 'windows';
        const windowMat = lit ? mat.litWindow : mat.glass;
        for (const side of [-1, 1]) instance(name, plane, windowMat, x + offset, y, z + side * (depth / 2 + 0.06), 1.65, 2.2, 1, undefined, side === 1 ? 0 : Math.PI);
        if (column < 3) for (const side of [-1, 1]) instance(name, plane, windowMat, x + side * (width / 2 + 0.06), y, z + offset * depth / width, 1.65, 2.2, 1, undefined, side * Math.PI / 2);
      }
    }
    obstacles.push({ minX: x - width / 2 - 1.25, maxX: x + width / 2 + 1.25, minZ: z - depth / 2 - 1.25, maxZ: z + depth / 2 + 1.25 });
    radarObstacles.push({ x, z, w: width + 1.5, d: depth + 1.5, type: 'building' });
  }

  function park(x, z, width = 75, depth = 75) {
    b('park lawns', mat.lawn, x, 0.015, z, width, 0.06, depth);
    b('park paths', mat.path, x, 0.055, z, width, 0.035, 3.5);
    b('park paths', mat.path, x, 0.057, z, 3.5, 0.035, depth);
    instance('fountain bases', cylinder, mat.sidewalk, x, 0.42, z, 7.5, 0.72, 7.5);
    instance('fountain water', cylinder, mat.water, x, 0.81, z, 6.8, 0.07, 6.8);
    instance('fountain sculpture', cone, mat.white, x, 2.2, z, 1.1, 3.8, 1.1);
    obstacles.push({ minX: x - 7, maxX: x + 7, minZ: z - 7, maxZ: z + 7 });
    radarObstacles.push({ x, z, w: width, d: depth, type: 'park' });
    for (const dx of [-26, -13, 13, 26]) for (const dz of [-26, 26]) tree(x + dx, z + dz, 0.9 + random(dx, dz) * 0.35, 1);
    for (const side of [-1, 1]) {
      b('bench seats', mat.trunk, x + side * 12, 0.75, z + 5.5, 4.2, 0.2, 0.9);
      b('bench backs', mat.trunk, x + side * 12, 1.3, z + 5.9, 4.2, 0.8, 0.15);
      b('bench legs', mat.metal, x + side * 12, 0.37, z + 5.5, 3.2, 0.75, 0.2);
    }
  }

  // Eight by eight blocks give a large city, with enough side streets to explore.
  for (let ix = 0; ix < STREET_POSITIONS.length - 1; ix++) {
    for (let iz = 0; iz < STREET_POSITIONS.length - 1; iz++) {
      const cx = STREET_POSITIONS[ix] + 54;
      const cz = STREET_POSITIONS[iz] + 54;
      if ((ix === 4 && iz === 4) || (ix * 3 + iz * 7) % 19 === 6) {
        if (!nearStation(cx, cz, 37)) park(cx, cz);
        else for (const dx of [-22, 22]) for (const dz of [-22, 22]) building(cx + dx, cz + dz, 23, 24, 14, 3, ix * 91 + iz * 19 + dx);
        continue;
      }
      for (const dx of [-22, 22]) {
        for (const dz of [-22, 22]) {
          const seed = ix * 103 + iz * 29 + dx * 3 + dz;
          const proximity = Math.max(0, 1 - Math.hypot(cx, cz) / 540);
          const family = Math.floor(random(seed, 2) * 4);
          const height = family === 2 ? 30 + proximity * 27 + random(seed, 3) * 14 : 12 + random(seed, 4) * 23 + proximity * 8;
          building(cx + dx, cz + dz, 23 + random(seed, 5) * 5, 23 + random(seed, 6) * 5, height, family, seed);
        }
      }
    }
  }

  // An open outer promenade breaks up the skyline without blocking the road grid.
  for (const side of [-1, 1]) {
    b('promenade', mat.path, side * 502, 0.025, 0, 8, 0.08, 1000);
    b('promenade', mat.path, 0, 0.025, side * 502, 1000, 0.08, 8);
    for (let q = -470; q <= 470; q += 31) {
      tree(side * 490, q, 1.2, 1);
      tree(q, side * 490, 1.2, 1);
    }
  }
  instance('lake', cylinder, mat.water, -479, 0.012, -235, 26, 0.025, 110);
  for (let n = 0; n < 28; n++) {
    const angle = n / 28 * Math.PI * 2;
    const radius = 735 + random(n, 4) * 170;
    instance('distant hills', sphere, mat.leaves, Math.sin(angle) * radius, 2, Math.cos(angle) * radius, 90 + random(n, 1) * 80, 28 + random(n, 2) * 70, 90 + random(n, 3) * 70, n % 2 ? 0x7e8e7a : 0x9caa91);
  }

  for (const p of STREET_POSITIONS) {
    for (let q = -510; q < 520; q += 27) {
      if (onStreet(q, 10)) continue;
      for (const side of [-1, 1]) {
        tree(p + side * 16.7, q, 0.73, Math.abs(Math.round(q)) % 3 === 0 ? 2 : 0);
        tree(q, p + side * 16.7, 0.73, 0);
        if (Math.abs(Math.round(q)) % 2 === 0) light(p + side * 13.8, q + 6, -side);
      }
    }
  }

  // A shared sign texture keeps all five stations conspicuous with one draw batch.
  let stationSign = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#064b4b';
      ctx.fillRect(0, 0, 512, 256);
      ctx.fillStyle = '#7ffff0';
      ctx.font = 'bold 100px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FUEL', 256, 111);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 62px sans-serif';
      ctx.fillText('بنزین', 256, 197);
      ctx.strokeStyle = '#48d2b7';
      ctx.lineWidth = 10;
      ctx.strokeRect(6, 6, 500, 244);
      const texture = new THREE.CanvasTexture(canvas);
      texture.encoding = THREE.sRGBEncoding;
      stationSign = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    }
  }
  for (const station of stations) {
    const { x, z } = station;
    b('station forecourts', mat.sidewalk, x + 1.5, 0.02, z, 33, 0.06, 32);
    b('station canopy', mat.teal, x + 3, 5.5, z, 17, 0.5, 22);
    b('station canopy rim', mat.white, x + 3, 5.76, z, 17.3, 0.17, 22.3);
    for (const dz of [-9.5, 9.5]) {
      b('station supports', mat.white, x + 10, 2.65, z + dz, 0.3, 5.3, 0.3);
      b('station lighting', mat.lamp, x + 2, 5.21, z + dz * 0.7, 10, 0.08, 0.15);
    }
    for (const dz of [-5.8, 5.8]) {
      b('pump island', mat.teal, x + 6.5, 0.18, z + dz, 3.1, 0.3, 3.2);
      b('fuel pumps', mat.white, x + 6.5, 1.25, z + dz, 1.05, 2.2, 0.9);
      b('fuel pump face', mat.metal, x + 5.94, 1.6, z + dz, 0.05, 0.72, 0.7);
      b('fuel pump display', mat.lamp, x + 5.9, 1.75, z + dz, 0.03, 0.25, 0.46);
      b('fuel pump hose', mat.metal, x + 6.5, 1.1, z + dz + 0.65, 0.1, 1.5, 0.1);
    }
    b('station sign posts', mat.teal, x - 5.2, 4.7, z - 13, 0.4, 9.4, 0.4);
    b('station sign backs', mat.teal, x - 5.2, 8.9, z - 13, 5.4, 3, 0.3);
    if (stationSign) {
      instance('station signs', new THREE.PlaneGeometry(1, 1), stationSign, x - 5.2, 8.9, z - 13.16, 5.2, 2.8, 1);
      instance('station side signs', new THREE.PlaneGeometry(1, 1), stationSign, x - 5.38, 8.9, z - 13, 5.2, 2.8, 1, undefined, Math.PI / 2);
    }
    radarObstacles.push({ x, z, w: 25, d: 29, type: 'station' });
  }

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (const [name, batch] of batches) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.items.length);
    batch.mesh = mesh;
    batch.radius = name === 'distant hills' ? Infinity
      : ['windows', 'lit windows'].includes(name) ? 140
        : ['tree crowns', 'tree trunks', 'cypress'].includes(name) ? 180
          : ['buildings', 'roof coping', 'tower spires', 'tower accent'].includes(name) ? 260 : 220;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = name;
    mesh.castShadow = ['buildings', 'tree crowns', 'tree trunks', 'cypress', 'station canopy', 'roof coping', 'tower spires'].includes(name);
    mesh.receiveShadow = !['lit windows', 'lamps', 'station signs', 'station side signs', 'distant hills'].includes(name);
    batch.geometry.computeBoundingBox();
    const bounds = batch.geometry.boundingBox;
    const geometryHalfX = (bounds.max.x - bounds.min.x) / 2;
    const geometryHalfZ = (bounds.max.z - bounds.min.z) / 2;
    batch.items.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(0, item.rotation, 0);
      dummy.scale.set(item.sx, item.sy, item.sz);
      dummy.updateMatrix();
      item.matrix = new Float32Array(dummy.matrix.elements);
      const c = Math.abs(Math.cos(item.rotation));
      const s = Math.abs(Math.sin(item.rotation));
      item.halfX = geometryHalfX * item.sx * c + geometryHalfZ * item.sz * s;
      item.halfZ = geometryHalfX * item.sx * s + geometryHalfZ * item.sz * c;
      mesh.setMatrixAt(index, dummy.matrix);
      if (item.color !== undefined) mesh.setColorAt(index, color.setHex(item.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }

  function isOnRoad(x, z) {
    if (onStreet(x, 0.5) || onStreet(z, 0.5)) return true;
    return stations.some((station) => Math.abs(x - station.x) < 18 && Math.abs(z - station.z) < 16);
  }

  // Instancing alone still submits the entire city. Compact each batch to the
  // player's neighborhood, retaining long road spans that intersect that area.
  let lastX = Infinity;
  let lastZ = Infinity;
  function update(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if ((x - lastX) ** 2 + (z - lastZ) ** 2 < 25 ** 2) return;
    lastX = x;
    lastZ = z;
    for (const batch of batches.values()) {
      const { mesh, radius } = batch;
      let count = 0;
      for (const item of batch.items) {
        const dx = Math.max(0, Math.abs(item.x - x) - item.halfX);
        const dz = Math.max(0, Math.abs(item.z - z) - item.halfZ);
        if (dx * dx + dz * dz > radius * radius) continue;
        mesh.instanceMatrix.array.set(item.matrix, count * 16);
        if (mesh.instanceColor) mesh.setColorAt(count, color.setHex(item.color ?? 0xffffff));
        count++;
      }
      mesh.count = count;
      mesh.visible = count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.boundingSphere = null;
      if (count > 0) mesh.computeBoundingSphere();
    }
  }
  update(3.5, 54);
  return { obstacles, radarObstacles, stations, isOnRoad, update };
}
