const THREE = window.THREE;

const mount = document.querySelector('#game');
const speedEl = document.querySelector('#speed');
const surfaceEl = document.querySelector('#surface');
const handbrakeEl = document.querySelector('#handbrakeState');
const radarCanvas = document.querySelector('#radarCanvas');
const radarCtx = radarCanvas?.getContext('2d');
const startCard = document.querySelector('#startCard');
const startButton = document.querySelector('#startButton');
const resetButton = document.querySelector('#resetButton');
const cameraButton = document.querySelector('#cameraButton');
const controlButtons = [...document.querySelectorAll('[data-control]')];

if (!THREE) {
  const message = 'کتابخانه سه‌بعدی بارگذاری نشد. اتصال اینترنت را بررسی و صفحه را دوباره بارگذاری کن.';
  startCard?.querySelector('p')?.replaceChildren(document.createTextNode(message));
  if (startButton) {
    startButton.textContent = 'بارگذاری ناموفق بود';
    startButton.disabled = true;
  }
  throw new Error('Three.js failed to load');
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ed7f2);
scene.fog = new THREE.Fog(0x9ed7f2, 110, 320);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 700);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
} else if ('outputEncoding' in renderer && THREE.sRGBEncoding) {
  renderer.outputEncoding = THREE.sRGBEncoding;
}
mount.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xe7f8ff, 0x617563, 1.55));
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(90, 120, 50);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -180;
sun.shadow.camera.right = 180;
sun.shadow.camera.top = 180;
sun.shadow.camera.bottom = -180;
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 320;
scene.add(sun);


function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

const CITY_HALF = 150;
const ROAD_WIDTH = 18;
const ROAD_HALF = ROAD_WIDTH / 2;
const STREET_POSITIONS = [-108, -54, 0, 54, 108];
const obstacles = [];
const radarObstacles = [];

function createCanvasTexture(draw, w = 256, h = 256, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

const asphaltTexture = createCanvasTexture((ctx, w, h) => {
  ctx.fillStyle = '#30343b';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const a = 0.04 + Math.random() * 0.08;
    const g = 45 + Math.random() * 60;
    ctx.fillStyle = `rgba(${g},${g},${g},${a})`;
    ctx.fillRect(x, y, 2, 2);
  }
}, 256, 256, 6, 6);

const grassTexture = createCanvasTexture((ctx, w, h) => {
  ctx.fillStyle = '#4f8452';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1200; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.fillStyle = `rgba(${30 + Math.random() * 40}, ${90 + Math.random() * 70}, ${35 + Math.random() * 40}, 0.24)`;
    ctx.fillRect(x, y, 2 + Math.random() * 2, 2 + Math.random() * 2);
  }
}, 256, 256, 14, 14);

function createWindowTexture(baseColor, litColor) {
  return createCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, w, h);
    const cols = 6;
    const rows = 10;
    const cellW = w / cols;
    const cellH = h / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const lit = Math.random() > 0.26;
        ctx.fillStyle = lit ? litColor : 'rgba(10,16,24,0.7)';
        ctx.fillRect(x * cellW + 6, y * cellH + 6, cellW - 12, cellH - 12);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 4;
    for (let x = 1; x < cols; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cellW, 0);
      ctx.lineTo(x * cellW, h);
      ctx.stroke();
    }
    for (let y = 1; y < rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellH);
      ctx.lineTo(w, y * cellH);
      ctx.stroke();
    }
  }, 256, 256, 1, 2);
}

const materials = {
  grass: new THREE.MeshStandardMaterial({ map: grassTexture, roughness: 1 }),
  road: new THREE.MeshStandardMaterial({ map: asphaltTexture, roughness: 0.95 }),
  roadLine: new THREE.MeshStandardMaterial({ color: 0xf3e29d, emissive: 0x4a3d12, emissiveIntensity: 0.05, roughness: 0.65 }),
  stopLine: new THREE.MeshStandardMaterial({ color: 0xf3f3f3, roughness: 0.8 }),
  curb: new THREE.MeshStandardMaterial({ color: 0xbfc5c8, roughness: 1 }),
  pavement: new THREE.MeshStandardMaterial({ color: 0xd6d1c9, roughness: 1 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x765439, roughness: 1 }),
  leavesA: new THREE.MeshStandardMaterial({ color: 0x2f8a50, roughness: 0.95 }),
  leavesB: new THREE.MeshStandardMaterial({ color: 0x3e9f61, roughness: 0.95 }),
  pole: new THREE.MeshStandardMaterial({ color: 0x38424a, roughness: 0.65, metalness: 0.5 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xffe7a2, emissive: 0xffc557, emissiveIntensity: 1.2 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x97d8f2, roughness: 0.16, metalness: 0.18, transparent: true, opacity: 0.88 }),
};

function makeBox(w, h, d, material, x, y, z, cast = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), materials.grass);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const roadGroup = new THREE.Group();
scene.add(roadGroup);

function addRoadStrip(width, depth, x, z) {
  const road = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, depth), materials.road);
  road.position.set(x, 0.05, z);
  road.receiveShadow = true;
  roadGroup.add(road);
}

function addCurbStrip(width, depth, x, z) {
  const curb = new THREE.Mesh(new THREE.BoxGeometry(width, 0.18, depth), materials.curb);
  curb.position.set(x, 0.09, z);
  curb.receiveShadow = true;
  scene.add(curb);
}

for (const p of STREET_POSITIONS) {
  addRoadStrip(ROAD_WIDTH, 320, p, 0);
  addRoadStrip(320, ROAD_WIDTH, 0, p);

  addCurbStrip(2.2, 320, p - ROAD_HALF - 1.1, 0);
  addCurbStrip(2.2, 320, p + ROAD_HALF + 1.1, 0);
  addCurbStrip(320, 2.2, 0, p - ROAD_HALF - 1.1);
  addCurbStrip(320, 2.2, 0, p + ROAD_HALF + 1.1);

  for (let q = -145; q <= 145; q += 12) {
    const dashV = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 6.4), materials.roadLine);
    dashV.position.set(p, 0.115, q);
    dashV.receiveShadow = true;
    scene.add(dashV);

    const dashH = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.025, 0.3), materials.roadLine);
    dashH.position.set(q, 0.115, p);
    dashH.receiveShadow = true;
    scene.add(dashH);
  }

  for (const q of STREET_POSITIONS) {
    if (p === q) continue;
    for (let i = -6; i <= 6; i += 2) {
      const crossA = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.028, 0.38), materials.stopLine);
      crossA.position.set(p + i, 0.12, q - ROAD_HALF + 2.3);
      scene.add(crossA);
      const crossB = crossA.clone();
      crossB.position.z = q + ROAD_HALF - 2.3;
      scene.add(crossB);

      const crossC = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.028, 1.3), materials.stopLine);
      crossC.position.set(q - ROAD_HALF + 2.3, 0.12, p + i);
      scene.add(crossC);
      const crossD = crossC.clone();
      crossD.position.x = q + ROAD_HALF - 2.3;
      scene.add(crossD);
    }
  }
}

function isNearRoad(value) {
  return STREET_POSITIONS.some((p) => Math.abs(value - p) <= ROAD_HALF + 1.4);
}
function isOnRoad(x, z) {
  return isNearRoad(x) || isNearRoad(z);
}

function addTree(x, z, scale = 1) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24 * scale, 0.3 * scale, 2.2 * scale, 10), materials.trunk);
  trunk.position.set(x, 1.1 * scale, z);
  trunk.castShadow = true;
  scene.add(trunk);

  const crown1 = new THREE.Mesh(new THREE.SphereGeometry(1.15 * scale, 10, 10), materials.leavesA);
  crown1.position.set(x - 0.1 * scale, 2.7 * scale, z);
  crown1.castShadow = true;
  scene.add(crown1);

  const crown2 = new THREE.Mesh(new THREE.SphereGeometry(0.9 * scale, 10, 10), materials.leavesB);
  crown2.position.set(x + 0.65 * scale, 3.1 * scale, z + 0.2 * scale);
  crown2.castShadow = true;
  scene.add(crown2);
}

function addStreetLight(x, z, rotationY = 0) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 5.6, 10), materials.pole);
  pole.position.set(x, 2.8, z);
  pole.castShadow = true;
  scene.add(pole);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.12), materials.pole);
  arm.position.set(0.6, 5.45, 0);
  const fixture = new THREE.Group();
  fixture.position.set(x, 0, z);
  fixture.rotation.y = rotationY;
  fixture.add(arm);

  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), materials.lamp);
  bulb.position.set(1.2, 5.28, 0);
  fixture.add(bulb);
  scene.add(fixture);
}

function addHouse(x, z, w, d) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe4d8c8, roughness: 0.92 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8b4e45, roughness: 0.9 });
  const bodyH = 4.4;
  const body = makeBox(w, bodyH, d, bodyMat, x, bodyH / 2 + 0.18, z, true);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.7, 2.6, 4), roofMat);
  roof.rotation.y = Math.PI * 0.25;
  roof.position.set(x, bodyH + 1.5, z);
  roof.castShadow = true;
  roof.receiveShadow = true;
  scene.add(roof);
  obstacles.push({ minX: x - w / 2 - 0.8, maxX: x + w / 2 + 0.8, minZ: z - d / 2 - 0.8, maxZ: z + d / 2 + 0.8 });
  radarObstacles.push({ x, z, w: w + 1, d: d + 1, type: 'house' });
  return body;
}

function addTower(x, z, w, d, h, colorA, colorB) {
  const textures = [
    createWindowTexture(colorA, '#e7f2ff'),
    createWindowTexture(colorB, '#ffefc8'),
    createWindowTexture('#54616f', '#d7f3ff'),
  ];
  const mat = new THREE.MeshStandardMaterial({ map: textures[Math.floor(Math.random() * textures.length)], roughness: 0.66, metalness: 0.05 });
  const tower = makeBox(w, h, d, mat, x, h / 2 + 0.2, z, true);
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x38424c, roughness: 0.8, metalness: 0.08 });
  const crown = makeBox(w * 0.7, 1.1, d * 0.7, trimMat, x, h + 0.75, z, true);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.8, 8), trimMat);
  antenna.position.set(x, h + 2.4, z);
  antenna.castShadow = true;
  scene.add(antenna);
  obstacles.push({ minX: x - w / 2 - 1.0, maxX: x + w / 2 + 1.0, minZ: z - d / 2 - 1.0, maxZ: z + d / 2 + 1.0 });
  radarObstacles.push({ x, z, w: w + 1.5, d: d + 1.5, type: 'building' });
  return { tower, crown };
}

function addPark(cx, cz, w, d) {
  const park = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), new THREE.MeshStandardMaterial({ color: 0x72b86d, roughness: 1 }));
  park.position.set(cx, 0.07, cz);
  park.receiveShadow = true;
  scene.add(park);
  const path = new THREE.Mesh(new THREE.BoxGeometry(w * 0.15, 0.03, d * 0.82), new THREE.MeshStandardMaterial({ color: 0xd7c6a1, roughness: 1 }));
  path.position.set(cx, 0.14, cz);
  scene.add(path);
  for (let i = -2; i <= 2; i++) {
    addTree(cx - w * 0.26 + i * 2.8, cz - d * 0.16, 0.9);
    addTree(cx - w * 0.18 + i * 3.2, cz + d * 0.18, 0.75);
  }
}

function createCityBlocks() {
  const edges = [-150, -118, -98, -64, -44, -10, 10, 44, 64, 98, 118, 150];
  let index = 0;
  for (let i = 0; i < edges.length - 1; i += 2) {
    const minX = edges[i];
    const maxX = edges[i + 1];
    for (let j = 0; j < edges.length - 1; j += 2) {
      const minZ = edges[j];
      const maxZ = edges[j + 1];
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      const blockW = maxX - minX - 6;
      const blockD = maxZ - minZ - 6;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, 0.2, maxZ - minZ), materials.pavement);
      pad.position.set(cx, 0.1, cz);
      pad.receiveShadow = true;
      scene.add(pad);

      const type = index % 5;
      if (type === 0) {
        addPark(cx, cz, blockW, blockD);
      } else if (type === 1) {
        addHouse(cx - blockW * 0.18, cz, blockW * 0.35, blockD * 0.42);
        addHouse(cx + blockW * 0.18, cz, blockW * 0.35, blockD * 0.42);
        addTree(cx - blockW * 0.35, cz + blockD * 0.28, 0.9);
        addTree(cx + blockW * 0.34, cz - blockD * 0.24, 0.8);
      } else if (type === 2) {
        addTower(cx, cz, blockW * 0.68, blockD * 0.68, 18 + ((i + j) % 3) * 7, '#5f6d7a', '#73808d');
      } else if (type === 3) {
        addTower(cx - blockW * 0.18, cz, blockW * 0.35, blockD * 0.62, 16, '#6b7a86', '#8e9aa4');
        addTower(cx + blockW * 0.18, cz, blockW * 0.35, blockD * 0.52, 22, '#766a6f', '#b29689');
      } else {
        addHouse(cx, cz - blockD * 0.17, blockW * 0.5, blockD * 0.32);
        addTower(cx, cz + blockD * 0.18, blockW * 0.55, blockD * 0.3, 14, '#6e7c8d', '#8fa0b0');
      }
      index++;
    }
  }
}
createCityBlocks();

for (const p of STREET_POSITIONS) {
  for (let q = -136; q <= 136; q += 20) {
    if (STREET_POSITIONS.some((s) => Math.abs(q - s) < 12)) continue;
    addTree(p + ROAD_HALF + 5, q, 0.85);
    addTree(p - ROAD_HALF - 5, q + 4, 0.7);
    addTree(q, p + ROAD_HALF + 5, 0.85);
    addTree(q + 4, p - ROAD_HALF - 5, 0.72);
    addStreetLight(p + ROAD_HALF + 2.2, q, Math.PI);
    addStreetLight(p - ROAD_HALF - 2.2, q + 8, 0);
  }
}

function createCar() {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0x1f6fff, metalness: 0.42, roughness: 0.28 });
  const paintDark = new THREE.MeshStandardMaterial({ color: 0x1643a0, metalness: 0.3, roughness: 0.36 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x161c24, metalness: 0.35, roughness: 0.45 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd6dc, metalness: 0.85, roughness: 0.2 });
  const glass = materials.glass;
  const headLamp = new THREE.MeshStandardMaterial({ color: 0xf7f4d3, emissive: 0x8f7a27, emissiveIntensity: 0.5 });
  const tailLamp = new THREE.MeshStandardMaterial({ color: 0xe94343, emissive: 0x691919, emissiveIntensity: 0.35 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.45, 4.6), paint);
  chassis.position.y = 0.9;
  chassis.castShadow = true;
  car.add(chassis);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.22, 1.2), paintDark);
  nose.position.set(0, 1.12, -1.55);
  nose.castShadow = true;
  car.add(nose);

  const roofBase = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.35, 2.1), paint);
  roofBase.position.set(0, 1.58, -0.18);
  roofBase.castShadow = true;
  car.add(roofBase);

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.5, 0.92), glass);
  windshield.position.set(0, 1.72, -0.72);
  windshield.rotation.x = -0.35;
  windshield.castShadow = true;
  car.add(windshield);

  const rearWindow = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.45, 0.88), glass);
  rearWindow.position.set(0, 1.66, 0.52);
  rearWindow.rotation.x = 0.42;
  rearWindow.castShadow = true;
  car.add(rearWindow);

  const sideSkirtL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 3.5), trim);
  sideSkirtL.position.set(-1.08, 0.72, 0);
  car.add(sideSkirtL);
  const sideSkirtR = sideSkirtL.clone();
  sideSkirtR.position.x = 1.08;
  car.add(sideSkirtR);

  const bumperFront = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.18, 0.28), trim);
  bumperFront.position.set(0, 0.76, -2.12);
  car.add(bumperFront);
  const bumperRear = bumperFront.clone();
  bumperRear.position.z = 2.12;
  car.add(bumperRear);

  const grill = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.06), chrome);
  grill.position.set(0, 0.98, -2.28);
  car.add(grill);

  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.08, 0.24), trim);
  spoiler.position.set(0, 1.7, 2.1);
  car.add(spoiler);

  for (const x of [-0.72, 0.72]) {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.08), headLamp);
    headlight.position.set(x, 0.97, -2.28);
    car.add(headlight);
    const fogLight = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.06), headLamp);
    fogLight.position.set(x, 0.72, -2.24);
    car.add(fogLight);

    const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.08), tailLamp);
    taillight.position.set(x, 0.98, 2.28);
    car.add(taillight);
  }

  const wheelGeometry = new THREE.CylinderGeometry(0.46, 0.46, 0.38, 16);
  wheelGeometry.rotateZ(Math.PI / 2);
  const tire = new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.78 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xc3c7cd, metalness: 0.8, roughness: 0.24 });
  const wheels = [];
  const frontPivots = [];

  for (const [x, z, isFront] of [
    [-1.08, -1.4, true], [1.08, -1.4, true],
    [-1.08, 1.4, false], [1.08, 1.4, false],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.56, z);

    const tireMesh = new THREE.Mesh(wheelGeometry, tire);
    tireMesh.castShadow = true;
    pivot.add(tireMesh);

    const rimMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.4, 10), rim);
    rimMesh.rotation.z = Math.PI / 2;
    pivot.add(rimMesh);

    car.add(pivot);
    wheels.push(tireMesh);
    if (isFront) frontPivots.push(pivot);
  }

  // Mirrors, exhausts and sporty body details.
  for (const x of [-1.17, 1.17]) {
    const mirrorArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.34), trim);
    mirrorArm.position.set(x, 1.46, -0.52);
    car.add(mirrorArm);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.34), paintDark);
    mirror.position.set(x * 1.06, 1.5, -0.56);
    mirror.castShadow = true;
    car.add(mirror);
  }

  for (const x of [-0.54, 0.54]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.56), trim);
    vent.position.set(x, 1.27, -1.52);
    car.add(vent);
  }

  for (const x of [-0.65, 0.65]) {
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 0.35, 12), chrome);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(x, 0.67, 2.28);
    car.add(exhaust);
  }

  const rearDiffuser = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.09, 0.34), trim);
  rearDiffuser.position.set(0, 0.62, 2.18);
  car.add(rearDiffuser);

  car.userData.wheels = wheels;
  car.userData.frontPivots = frontPivots;
  car.userData.tailLamp = tailLamp;
  scene.add(car);
  return car;
}

const car = createCar();

const scoreEl = document.querySelector('#score');
const coinCountEl = document.querySelector('#coinCount');
const levelEl = document.querySelector('#level');
const soundButton = document.querySelector('#soundButton');
const levelToast = document.querySelector('#levelToast');

const state = {
  x: 0,
  z: 94,
  heading: Math.PI,
  speed: 0,
  steering: 0,
  wheelSpin: 0,
  driftAngle: 0,
};

const progress = {
  score: 0,
  coins: 0,
  level: 1,
  collisionCooldown: 0,
};

const keys = { up: false, down: false, left: false, right: false, handbrake: false };
let gameStarted = false;
let cameraMode = 0;
let radarSweep = 0;
let levelToastTimer = 0;
let skidTimer = 0;
let smokeTimer = 0;
let trafficClock = 0;

const keyByCode = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'handbrake',
};

const keyByValue = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right', ' ': 'handbrake',
};

// ---------- Audio ----------
class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.brakeGain = null;
    this.brakeFilter = null;
    this.noise = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0001;
    this.engineGain.connect(this.master);

    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    const engineFilter = this.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    this.engineOsc.connect(engineFilter);
    engineFilter.connect(this.engineGain);
    this.engineOsc.start();

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 28;
    const subGain = this.ctx.createGain();
    subGain.gain.value = 0.035;
    this.engineOsc2.connect(subGain);
    subGain.connect(this.engineGain);
    this.engineOsc2.start();

    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = this.ctx.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;
    this.brakeFilter = this.ctx.createBiquadFilter();
    this.brakeFilter.type = 'bandpass';
    this.brakeFilter.frequency.value = 1800;
    this.brakeFilter.Q.value = 1.2;
    this.brakeGain = this.ctx.createGain();
    this.brakeGain.gain.value = 0.0001;
    this.noise.connect(this.brakeFilter);
    this.brakeFilter.connect(this.brakeGain);
    this.brakeGain.connect(this.master);
    this.noise.start();
  }

  update(speed, throttle, braking, handbrake) {
    if (!this.ctx || !this.engineGain) return;
    const now = this.ctx.currentTime;
    const absSpeed = Math.abs(speed);
    const rpm = 58 + absSpeed * 5.2 + (throttle ? 38 : 0);
    this.engineOsc.frequency.setTargetAtTime(rpm, now, 0.06);
    this.engineOsc2.frequency.setTargetAtTime(rpm * 0.51, now, 0.08);
    const engineVol = this.muted ? 0.0001 : (0.025 + Math.min(absSpeed / 38, 1) * 0.07 + (throttle ? 0.025 : 0));
    this.engineGain.gain.setTargetAtTime(engineVol, now, 0.08);
    const brakeVol = (!this.muted && absSpeed > 5 && (handbrake || braking)) ? Math.min(0.09, 0.025 + absSpeed * 0.0018) : 0.0001;
    this.brakeGain.gain.setTargetAtTime(brakeVol, now, 0.05);
    this.brakeFilter.frequency.setTargetAtTime(1450 + absSpeed * 35, now, 0.06);
  }

  coin() {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(620, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1050, this.ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.08, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.22);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(this.ctx.currentTime + 0.24);
  }

  levelUp() {
    if (!this.ctx || this.muted) return;
    [440, 660, 880].forEach((freq, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      const t = this.ctx.currentTime + i * 0.08;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.24);
    });
  }

  crash() {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(90, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(38, this.ctx.currentTime + 0.18);
    g.gain.setValueAtTime(0.09, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.2);
    o.connect(g); g.connect(this.master); o.start(); o.stop(this.ctx.currentTime + 0.22);
  }

  toggle() {
    this.init();
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0.0001 : 0.55, this.ctx.currentTime, 0.03);
    soundButton.textContent = this.muted ? 'صدا خاموش' : 'صدا روشن';
  }
}
const audio = new GameAudio();

// ---------- Traffic lights ----------
const trafficSignals = [];
const signalMaterialOff = 0x2b3036;
function makeSignalBulb(color) {
  return new THREE.MeshStandardMaterial({ color: signalMaterialOff, emissive: color, emissiveIntensity: 0.04, roughness: 0.35 });
}

function createSignalHead(x, z, orientation) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.7, 8), materials.pole);
  pole.position.y = 2.35;
  pole.castShadow = true;
  group.add(pole);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.65, 0.42), new THREE.MeshStandardMaterial({ color: 0x20262b, roughness: 0.8, metalness: 0.2 }));
  housing.position.set(0, 4.15, 0);
  group.add(housing);
  const redMat = makeSignalBulb(0xff1717);
  const yellowMat = makeSignalBulb(0xffc21c);
  const greenMat = makeSignalBulb(0x32ef72);
  [redMat, yellowMat, greenMat].forEach((mat, i) => {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat);
    bulb.position.set(0, 4.65 - i * 0.5, -0.23);
    group.add(bulb);
  });
  group.rotation.y = orientation;
  scene.add(group);
  return { group, redMat, yellowMat, greenMat };
}

for (const ix of STREET_POSITIONS) {
  for (const iz of STREET_POSITIONS) {
    const ns = createSignalHead(ix + ROAD_HALF + 2.1, iz - ROAD_HALF - 2.0, Math.PI);
    const ew = createSignalHead(ix - ROAD_HALF - 2.0, iz + ROAD_HALF + 2.1, -Math.PI / 2);
    trafficSignals.push({ x: ix, z: iz, ns, ew });
  }
}

function signalState(axis) {
  const t = trafficClock % 16;
  if (axis === 'z') {
    if (t < 6.5) return 'green';
    if (t < 8) return 'yellow';
    return 'red';
  }
  if (t < 8) return 'red';
  if (t < 14.5) return 'green';
  return 'yellow';
}

function setSignalVisual(head, value) {
  head.redMat.emissiveIntensity = value === 'red' ? 3.2 : 0.04;
  head.yellowMat.emissiveIntensity = value === 'yellow' ? 2.8 : 0.04;
  head.greenMat.emissiveIntensity = value === 'green' ? 3.0 : 0.04;
  head.redMat.color.setHex(value === 'red' ? 0x7b1515 : signalMaterialOff);
  head.yellowMat.color.setHex(value === 'yellow' ? 0x795e13 : signalMaterialOff);
  head.greenMat.color.setHex(value === 'green' ? 0x176e35 : signalMaterialOff);
}

function updateTrafficLights(dt) {
  trafficClock += dt;
  const nsState = signalState('z');
  const ewState = signalState('x');
  for (const signal of trafficSignals) {
    setSignalVisual(signal.ns, nsState);
    setSignalVisual(signal.ew, ewState);
  }
}

// ---------- NPC traffic ----------
const npcCars = [];
const npcColors = [0xef5350, 0xffb74d, 0x66bb6a, 0xab47bc, 0x26c6da, 0xe0e0e0, 0x546e7a, 0xec407a];

function createNpcCar(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.38 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x8bc7dc, metalness: 0.1, roughness: 0.2 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.5, 3.6), paint);
  body.position.y = 0.78; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.62, 1.65), glass);
  cabin.position.set(0, 1.32, -0.05); cabin.castShadow = true; g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 12); wheelGeo.rotateZ(Math.PI / 2);
  for (const [x,z] of [[-.9,-1.05],[.9,-1.05],[-.9,1.05],[.9,1.05]]) {
    const w = new THREE.Mesh(wheelGeo, tire); w.position.set(x,.48,z); w.castShadow = true; g.add(w);
  }
  const rearLightMat = new THREE.MeshStandardMaterial({ color: 0xff4040, emissive: 0x5c1111, emissiveIntensity: .5 });
  for (const x of [-.55,.55]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(.28,.13,.07), rearLightMat); r.position.set(x,.8,1.84); g.add(r);
  }
  scene.add(g);
  return g;
}

function spawnNpc(index = npcCars.length) {
  const axis = index % 2 === 0 ? 'z' : 'x';
  const street = STREET_POSITIONS[index % STREET_POSITIONS.length];
  const direction = index % 4 < 2 ? 1 : -1;
  const laneOffset = direction > 0 ? -3.3 : 3.3;
  const group = createNpcCar(npcColors[index % npcColors.length]);
  const along = -138 + ((index * 31) % 276);
  const npc = {
    group,
    axis,
    street,
    direction,
    laneOffset,
    position: along,
    speed: 8 + (index % 5) * 0.7,
    desiredSpeed: 9 + (index % 4) * 0.9,
    radius: 1.6,
  };
  npcCars.push(npc);
  placeNpc(npc);
  return npc;
}

function placeNpc(npc) {
  if (npc.axis === 'z') {
    npc.group.position.set(npc.street + npc.laneOffset, 0.04, npc.position);
    npc.group.rotation.y = npc.direction > 0 ? Math.PI : 0;
  } else {
    npc.group.position.set(npc.position, 0.04, npc.street + npc.laneOffset);
    npc.group.rotation.y = npc.direction > 0 ? -Math.PI / 2 : Math.PI / 2;
  }
}

function nextIntersectionDistance(npc) {
  let best = Infinity;
  for (const p of STREET_POSITIONS) {
    const delta = npc.direction * (p - npc.position);
    if (delta > 0.1 && delta < best) best = delta;
  }
  return best;
}

function distanceToNpcAhead(npc) {
  let best = Infinity;
  for (const other of npcCars) {
    if (other === npc || other.axis !== npc.axis || other.street !== npc.street || other.direction !== npc.direction) continue;
    const d = npc.direction * (other.position - npc.position);
    if (d > 0 && d < best) best = d;
  }
  return best;
}

function updateNpcTraffic(dt) {
  const levelBoost = 1 + (progress.level - 1) * 0.06;
  for (const npc of npcCars) {
    let target = npc.desiredSpeed * levelBoost;
    const light = signalState(npc.axis);
    const intersectionDistance = nextIntersectionDistance(npc);
    const stopDistance = intersectionDistance - (ROAD_HALF + 4.2);
    if (light !== 'green' && stopDistance > -1 && stopDistance < 17) {
      target = stopDistance < 3.5 ? 0 : Math.min(target, Math.max(1.8, stopDistance * 0.7));
    }

    const carAhead = distanceToNpcAhead(npc);
    if (carAhead < 11) target = Math.min(target, Math.max(0, (carAhead - 3.5) * 0.8));

    // Slow down when the player is directly in the same lane.
    const playerAcross = npc.axis === 'z' ? Math.abs(state.x - (npc.street + npc.laneOffset)) : Math.abs(state.z - (npc.street + npc.laneOffset));
    const playerAlong = npc.axis === 'z' ? state.z : state.x;
    const playerAhead = npc.direction * (playerAlong - npc.position);
    if (playerAcross < 2.2 && playerAhead > 0 && playerAhead < 12) target = Math.min(target, Math.max(0, (playerAhead - 3.0) * 0.7));

    npc.speed = damp(npc.speed, target, target < npc.speed ? 5.4 : 1.8, dt);
    npc.position += npc.direction * npc.speed * dt;
    if (npc.position > 156) npc.position = -156;
    if (npc.position < -156) npc.position = 156;
    placeNpc(npc);
  }
}

for (let i = 0; i < 14; i++) spawnNpc(i);

// ---------- Coins / levels ----------
const coins = [];
const coinMaterial = new THREE.MeshStandardMaterial({ color: 0xffd43b, emissive: 0x8f6210, emissiveIntensity: 0.72, metalness: 0.7, roughness: 0.24 });
const coinInnerMaterial = new THREE.MeshStandardMaterial({ color: 0xffef93, emissive: 0x5d450e, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.25 });
const coinSpots = [];
for (const street of STREET_POSITIONS) {
  for (let q = -132; q <= 132; q += 22) {
    if (STREET_POSITIONS.some((p) => Math.abs(p - q) < 11)) continue;
    coinSpots.push({ x: street - 3.3, z: q });
    coinSpots.push({ x: q, z: street + 3.3 });
  }
}
let nextCoinSpot = 0;

function makeCoin() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.17, 10, 24), coinMaterial);
  ring.castShadow = true;
  g.add(ring);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 24), coinInnerMaterial);
  core.rotation.x = Math.PI / 2;
  g.add(core);
  scene.add(g);
  return g;
}

function spawnCoin() {
  const spot = coinSpots[nextCoinSpot % coinSpots.length];
  nextCoinSpot += 11;
  const mesh = makeCoin();
  mesh.position.set(spot.x, 1.45, spot.z);
  coins.push({ mesh, x: spot.x, z: spot.z, phase: Math.random() * Math.PI * 2 });
}

for (let i = 0; i < 16; i++) spawnCoin();

function updateHud() {
  scoreEl.textContent = String(progress.score);
  coinCountEl.textContent = `${progress.coins}/10`;
  levelEl.textContent = String(progress.level);
}

function showLevelToast() {
  if (!levelToast) return;
  levelToast.querySelector('strong').textContent = `مرحله ${progress.level}`;
  levelToast.querySelector('span').textContent = 'ترافیک سریع‌تر و شلوغ‌تر شد';
  levelToast.classList.add('show');
  levelToastTimer = 2.2;
}

function levelUp() {
  progress.level += 1;
  progress.coins = 0;
  progress.score += 500 * progress.level;
  const addCount = Math.min(2, 26 - npcCars.length);
  for (let i = 0; i < addCount; i++) spawnNpc();
  showLevelToast();
  audio.levelUp();
  updateHud();
}

function updateCoins(dt) {
  for (let i = coins.length - 1; i >= 0; i--) {
    const coin = coins[i];
    coin.phase += dt * 2.5;
    coin.mesh.rotation.y += dt * 2.4;
    coin.mesh.position.y = 1.45 + Math.sin(coin.phase) * 0.18;
    const d = Math.hypot(state.x - coin.x, state.z - coin.z);
    if (d < 2.15) {
      scene.remove(coin.mesh);
      coins.splice(i, 1);
      progress.score += 100;
      progress.coins += 1;
      audio.coin();
      spawnCoin();
      if (progress.coins >= 10) levelUp();
      else updateHud();
    }
  }
}

// ---------- Drift particles / skid marks ----------
const smokeParticles = [];
const skidMarks = [];
const smokeGeometry = new THREE.SphereGeometry(0.34, 8, 7);

function rearWheelWorld(localX) {
  const local = new THREE.Vector3(localX, 0.36, 1.45);
  return car.localToWorld(local.clone());
}

function spawnSmoke() {
  for (const localX of [-0.88, 0.88]) {
    const p = rearWheelWorld(localX);
    const mat = new THREE.MeshBasicMaterial({ color: 0xd8dde0, transparent: true, opacity: 0.34, depthWrite: false });
    const mesh = new THREE.Mesh(smokeGeometry, mat);
    mesh.position.copy(p);
    mesh.position.y = 0.5;
    scene.add(mesh);
    smokeParticles.push({ mesh, life: 0.72, vx: (Math.random() - .5) * .6, vz: (Math.random() - .5) * .6 });
  }
}

function spawnSkid() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x181b1e, transparent: true, opacity: 0.48, depthWrite: false });
  for (const localX of [-0.88, 0.88]) {
    const p = rearWheelWorld(localX);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.018, 1.25), mat.clone());
    mark.position.set(p.x, 0.135, p.z);
    mark.rotation.y = state.heading + state.driftAngle;
    scene.add(mark);
    skidMarks.push({ mesh: mark, life: 12 });
  }
  while (skidMarks.length > 180) {
    const old = skidMarks.shift();
    scene.remove(old.mesh);
    old.mesh.material.dispose();
  }
}

function updateDriftEffects(dt) {
  const drifting = keys.handbrake && Math.abs(state.speed) > 8 && Math.abs(state.steering) > 0.16;
  smokeTimer -= dt;
  skidTimer -= dt;
  if (drifting && smokeTimer <= 0) { spawnSmoke(); smokeTimer = 0.075; }
  if (drifting && skidTimer <= 0) { spawnSkid(); skidTimer = 0.11; }

  for (let i = smokeParticles.length - 1; i >= 0; i--) {
    const p = smokeParticles[i];
    p.life -= dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.z += p.vz * dt;
    p.mesh.position.y += dt * 0.55;
    p.mesh.scale.addScalar(dt * 0.65);
    p.mesh.material.opacity = Math.max(0, p.life * 0.45);
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
      smokeParticles.splice(i, 1);
    }
  }
  for (let i = skidMarks.length - 1; i >= 0; i--) {
    const s = skidMarks[i];
    s.life -= dt;
    if (s.life < 2.5) s.mesh.material.opacity = Math.max(0, s.life / 2.5 * 0.48);
    if (s.life <= 0) {
      scene.remove(s.mesh);
      s.mesh.material.dispose();
      skidMarks.splice(i, 1);
    }
  }
}

function clearInputs() {
  Object.keys(keys).forEach((k) => keys[k] = false);
  controlButtons.forEach((button) => button.classList.remove('is-active'));
}

function resetCar() {
  state.x = 0;
  state.z = 94;
  state.heading = Math.PI;
  state.speed = 0;
  state.steering = 0;
  state.wheelSpin = 0;
  state.driftAngle = 0;
  clearInputs();
}

function resetGame() {
  resetCar();
  progress.score = 0;
  progress.coins = 0;
  progress.level = 1;
  progress.collisionCooldown = 0;
  while (npcCars.length > 14) {
    const npc = npcCars.pop();
    scene.remove(npc.group);
  }
  npcCars.forEach((npc, i) => {
    npc.position = -138 + ((i * 31) % 276);
    npc.speed = 8 + (i % 5) * 0.7;
    placeNpc(npc);
  });
  updateHud();
}

function startGame() {
  gameStarted = true;
  startCard.classList.add('hidden');
  audio.init();
  mount.focus?.();
}

function cycleCamera() {
  cameraMode = (cameraMode + 1) % 3;
  cameraButton.textContent = `دوربین ${cameraMode + 1}/3`;
}

function setControl(control, pressed, button = null) {
  if (!(control in keys)) return;
  keys[control] = pressed;
  if (button) button.classList.toggle('is-active', pressed);
}

function lookupKey(event) {
  return keyByCode[event.code] || keyByValue[event.key];
}

addEventListener('keydown', (event) => {
  if (!gameStarted && (event.key === 'Enter' || event.code === 'Space' || event.key === ' ')) {
    startGame();
    if (event.code === 'Space' || event.key === ' ') keys.handbrake = true;
    event.preventDefault();
    return;
  }

  const key = lookupKey(event);
  if (key) {
    keys[key] = true;
    event.preventDefault();
  }
  if (event.code === 'KeyR' || event.key === 'r' || event.key === 'R') {
    resetCar();
    event.preventDefault();
  }
  if (event.code === 'KeyC' || event.key === 'c' || event.key === 'C') {
    cycleCamera();
    event.preventDefault();
  }
  if (event.code === 'KeyM' || event.key === 'm' || event.key === 'M') {
    audio.toggle();
    event.preventDefault();
  }
});

addEventListener('keyup', (event) => {
  const key = lookupKey(event);
  if (key) {
    keys[key] = false;
    event.preventDefault();
  }
});

startButton.addEventListener('click', startGame);
resetButton.addEventListener('click', resetGame);
cameraButton.addEventListener('click', cycleCamera);
soundButton.addEventListener('click', () => audio.toggle());

for (const button of controlButtons) {
  const control = button.dataset.control;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (!gameStarted) startGame();
    button.setPointerCapture?.(event.pointerId);
    setControl(control, true, button);
  });
  const release = (event) => {
    event.preventDefault();
    setControl(control, false, button);
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', () => setControl(control, false, button));
  button.addEventListener('contextmenu', (event) => event.preventDefault());
}

addEventListener('blur', clearInputs);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearInputs();
});

function collidesStatic(x, z) {
  if (Math.abs(x) > CITY_HALF || Math.abs(z) > CITY_HALF) return true;
  return obstacles.some((o) => x > o.minX && x < o.maxX && z > o.minZ && z < o.maxZ);
}

function collideNpc(x, z) {
  for (const npc of npcCars) {
    if (Math.hypot(x - npc.group.position.x, z - npc.group.position.z) < 2.15) return npc;
  }
  return null;
}

const clock = new THREE.Clock();
const cameraTarget = new THREE.Vector3();
const desiredCamera = new THREE.Vector3();

function updateCar(dt) {
  const onRoad = isOnRoad(state.x, state.z);
  const maxForward = onRoad ? 39 : 18;
  const maxReverse = -12;
  const acceleration = onRoad ? 23 : 12;
  const serviceBrake = onRoad ? 31 : 22;
  const handBrakeForce = onRoad ? 21 : 16;

  if (keys.up) {
    if (state.speed < -0.5) state.speed += serviceBrake * dt;
    else state.speed += acceleration * dt;
  } else if (keys.down) {
    if (state.speed > 1.2) state.speed -= serviceBrake * dt;
    else state.speed -= 13 * dt;
  } else {
    const drag = onRoad ? 5.2 : 9.0;
    state.speed = Math.abs(state.speed) <= drag * dt ? 0 : state.speed - Math.sign(state.speed) * drag * dt;
  }

  if (keys.handbrake) {
    const hb = handBrakeForce * dt;
    state.speed = Math.abs(state.speed) <= hb ? 0 : state.speed - Math.sign(state.speed) * hb;
  }

  state.speed = THREE.MathUtils.clamp(state.speed, maxReverse, maxForward);
  const steerInput = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
  const targetSteer = steerInput * (keys.handbrake ? 0.92 : 0.6);
  state.steering = damp(state.steering, targetSteer, keys.handbrake ? 12 : 8, dt);

  const speedRatio = Math.min(Math.abs(state.speed) / 14, 1);
  const driftTarget = keys.handbrake && Math.abs(state.speed) > 6 ? -state.steering * speedRatio * 0.38 : 0;
  state.driftAngle = damp(state.driftAngle, driftTarget, keys.handbrake ? 5 : 8, dt);

  if (Math.abs(state.speed) > 0.08) {
    const reverseSign = state.speed >= 0 ? 1 : -1;
    state.heading += state.steering * reverseSign * speedRatio * (keys.handbrake ? 2.25 : 1.58) * dt;
  }

  const motionHeading = state.heading + state.driftAngle * 0.48;
  const dx = -Math.sin(motionHeading) * state.speed * dt;
  const dz = -Math.cos(motionHeading) * state.speed * dt;
  const nextX = state.x + dx;
  const nextZ = state.z + dz;
  const npcHit = collideNpc(nextX, nextZ);

  if (!collidesStatic(nextX, nextZ) && !npcHit) {
    state.x = nextX;
    state.z = nextZ;
  } else {
    state.speed *= -0.2;
    if (progress.collisionCooldown <= 0) {
      progress.score = Math.max(0, progress.score - 50);
      progress.collisionCooldown = 0.7;
      audio.crash();
      updateHud();
    }
  }

  progress.collisionCooldown = Math.max(0, progress.collisionCooldown - dt);
  car.position.set(state.x, 0.04, state.z);
  car.rotation.y = state.heading + state.driftAngle;
  car.rotation.z = damp(car.rotation.z, -state.steering * speedRatio * 0.06, 6, dt);
  car.rotation.x = damp(car.rotation.x, (keys.down ? 0.025 : keys.up ? -0.015 : 0), 7, dt);

  for (const pivot of car.userData.frontPivots) pivot.rotation.y = state.steering * 0.74;
  state.wheelSpin -= state.speed * dt * 1.9;
  for (const wheel of car.userData.wheels) wheel.rotation.x = state.wheelSpin;

  speedEl.textContent = Math.round(Math.abs(state.speed) * 3.6);
  surfaceEl.textContent = onRoad ? 'خیابان' : 'خارج از خیابان';
  handbrakeEl.textContent = keys.handbrake ? 'ترمز دستی روشن' : 'ترمز دستی خاموش';
  handbrakeEl.classList.toggle('active', keys.handbrake);
  if (car.userData.tailLamp) {
    car.userData.tailLamp.emissiveIntensity = (keys.down || keys.handbrake) ? 2.2 : 0.35;
    car.userData.tailLamp.color.setHex((keys.down || keys.handbrake) ? 0xff2c2c : 0xe94343);
  }
  audio.update(state.speed, keys.up, keys.down, keys.handbrake);
}

function updateCamera(dt) {
  const visualHeading = state.heading + state.driftAngle * 0.75;
  if (cameraMode === 0) {
    const behind = 9.4;
    desiredCamera.set(state.x + Math.sin(visualHeading) * behind, 5.1, state.z + Math.cos(visualHeading) * behind);
    cameraTarget.set(state.x - Math.sin(visualHeading) * 5.6, 1.35, state.z - Math.cos(visualHeading) * 5.6);
  } else if (cameraMode === 1) {
    desiredCamera.set(state.x + Math.sin(visualHeading + 0.88) * 7.2, 3.7, state.z + Math.cos(visualHeading + 0.88) * 7.2);
    cameraTarget.set(state.x, 1.15, state.z);
  } else {
    desiredCamera.set(state.x - Math.sin(visualHeading) * 0.25, 2.02, state.z - Math.cos(visualHeading) * 0.25);
    cameraTarget.set(state.x - Math.sin(visualHeading) * 24, 1.58, state.z - Math.cos(visualHeading) * 24);
  }
  const alpha = 1 - Math.exp(-(cameraMode === 2 ? 8 : 6) * dt);
  camera.position.lerp(desiredCamera, alpha);
  camera.lookAt(cameraTarget);
}

function drawRadar() {
  if (!radarCtx || !radarCanvas) return;
  const ctx = radarCtx;
  const w = radarCanvas.width;
  const h = radarCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.45;
  ctx.clearRect(0, 0, w, h);

  const bg = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
  bg.addColorStop(0, 'rgba(16,58,66,0.95)');
  bg.addColorStop(1, 'rgba(3,10,18,0.98)');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.clip();

  ctx.strokeStyle = 'rgba(122,238,255,0.18)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, radius * (i / 4), 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke();

  const scale = 0.55;
  function worldToRadar(wx, wz) {
    const dx = wx - state.x;
    const dz = wz - state.z;
    const s = Math.sin(-state.heading);
    const c = Math.cos(-state.heading);
    const rx = dx * c - dz * s;
    const rz = dx * s + dz * c;
    return { x: cx + rx * scale, y: cy + rz * scale };
  }

  ctx.strokeStyle = 'rgba(82,242,255,0.32)';
  ctx.lineWidth = 3;
  for (const p of STREET_POSITIONS) {
    let a = worldToRadar(p, -150), b = worldToRadar(p, 150);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    a = worldToRadar(-150, p); b = worldToRadar(150, p);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }

  radarObstacles.forEach((o) => {
    const point = worldToRadar(o.x, o.z);
    if (Math.hypot(point.x - cx, point.y - cy) > radius + 12) return;
    const rw = Math.max(3, o.w * scale * 0.28), rh = Math.max(3, o.d * scale * 0.28);
    ctx.fillStyle = 'rgba(126,151,166,0.34)';
    ctx.fillRect(point.x - rw/2, point.y - rh/2, rw, rh);
  });

  for (const npc of npcCars) {
    const p = worldToRadar(npc.group.position.x, npc.group.position.z);
    if (Math.hypot(p.x-cx,p.y-cy) > radius) continue;
    ctx.fillStyle = '#ff6969';
    ctx.beginPath(); ctx.arc(p.x,p.y,3.1,0,Math.PI*2); ctx.fill();
  }

  for (const coin of coins) {
    const p = worldToRadar(coin.x, coin.z);
    if (Math.hypot(p.x-cx,p.y-cy) > radius) continue;
    ctx.fillStyle = '#ffd94d';
    ctx.beginPath(); ctx.arc(p.x,p.y,2.6,0,Math.PI*2); ctx.fill();
  }

  radarSweep += 0.025;
  const sweepAngle = radarSweep;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, 'rgba(138,255,132,0.26)'); grad.addColorStop(1, 'rgba(138,255,132,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, sweepAngle - 0.22, sweepAngle + 0.22); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(147,255,158,0.68)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx + Math.cos(sweepAngle)*radius, cy + Math.sin(sweepAngle)*radius); ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(cx,cy-10); ctx.lineTo(cx-7,cy+8); ctx.lineTo(cx+7,cy+8); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(96,226,255,0.5)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2); ctx.stroke();
}

resetGame();
camera.position.set(0, 6, 110);

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  updateTrafficLights(dt);
  if (gameStarted) {
    updateNpcTraffic(dt);
    updateCar(dt);
    updateCoins(dt);
    updateDriftEffects(dt);
  }
  if (levelToastTimer > 0) {
    levelToastTimer -= dt;
    if (levelToastTimer <= 0) levelToast?.classList.remove('show');
  }
  updateCamera(dt);
  drawRadar();
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
