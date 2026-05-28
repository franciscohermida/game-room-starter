import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { buildDungeon, type Dungeon } from "./dungeon";
import { createColliders, type Colliders } from "./collision";

export const MAP_SIZE = 20;
export const PLAYER_RADIUS = 0.4;

export interface Player {
  id: string;
  name: string;
  color: string;
  // Rendered position (what the mesh is drawn at). For the local
  // player this is driven directly by input each frame. For remote
  // players it lerps toward `targetX`/`targetY`, which is the last
  // position the server sent — that's how 20 Hz state updates look
  // like smooth 60 fps motion.
  x: number;
  y: number;
  // Latest network position. Mirrors `x`/`y` for the local player.
  targetX: number;
  targetY: number;
  // Facing direction as a 2D unit vector in world space. Carried per
  // player so the body keeps facing the last direction it walked even
  // after stopping. Same interpolation pattern as position: rendered
  // `facingX/Y` lerps toward `targetFacingX/Y` for remote players so
  // turns look smooth instead of stepping at the 20 Hz send rate.
  facingX: number;
  facingY: number;
  targetFacingX: number;
  targetFacingY: number;
  body: THREE.Mesh;
  // Tiny white sphere positioned slightly ahead of the body in the
  // facing direction. Acts as a "nose" so you can tell which way each
  // sphere is pointing. Placed in world coords (not parented to the
  // body) — no rotation/lookAt math involved.
  indicator: THREE.Mesh;
  // A torch each player carries: a small emissive flame above their
  // head plus a point light that casts shadows. Follows the player
  // each frame; the light flickers like the dungeon torches do, with
  // a per-player phase offset so they don't pulse in lockstep.
  torchLight: THREE.PointLight;
  torchFlame: THREE.Mesh;
  torchPhase: number;
}

export function createScene(container: HTMLElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const aspect = container.clientWidth / container.clientHeight;
  const d = 10;
  const camera = new THREE.OrthographicCamera(
    -d * aspect,
    d * aspect,
    d,
    -d,
    0.1,
    100,
  );
  camera.position.set(15, 15, 15);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Dim ambient so the torches read. Sun acts as moonlight from
  // above, dim enough that the warm torchlight pools are obvious.
  scene.add(new THREE.AmbientLight(0xffffff, 0.14));
  const sun = new THREE.DirectionalLight(0xc6d4ff, 0.45);
  sun.position.set(10, 20, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  scene.add(sun);

  // Ground is a grid of low rounded boxes in a checkerboard tint —
  // gives the iso look some readable depth and makes it easier for
  // players to gauge how far they've moved. One shared geometry + two
  // shared materials keeps it cheap (~400 meshes, but tiny ones).
  const tileGeom = new RoundedBoxGeometry(0.94, 0.2, 0.94, 2, 0.08);
  const tileLight = new THREE.MeshStandardMaterial({ color: 0x3a3a5a });
  const tileDark = new THREE.MeshStandardMaterial({ color: 0x282844 });
  const half = MAP_SIZE / 2;
  for (let x = 0; x < MAP_SIZE; x++) {
    for (let z = 0; z < MAP_SIZE; z++) {
      const tile = new THREE.Mesh(
        tileGeom,
        (x + z) % 2 === 0 ? tileLight : tileDark,
      );
      tile.position.set(x - half + 0.5, -0.1, z - half + 0.5);
      tile.receiveShadow = true;
      scene.add(tile);
    }
  }

  const colliders = createColliders();
  const dungeon = buildDungeon(scene, colliders);

  window.addEventListener("resize", () => {
    const a = container.clientWidth / container.clientHeight;
    camera.left = -d * a;
    camera.right = d * a;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  return { scene, camera, renderer, dungeon, colliders };
}

export type { Dungeon, Colliders };

export const INDICATOR_OFFSET = PLAYER_RADIUS;
// Torch sits to the player's right at body height — looks like it's
// held in their right hand rather than floating above their head.
// "Right" is perpendicular to facing direction: (facingY, -facingX).
export const TORCH_SIDE_OFFSET = PLAYER_RADIUS + 0.1;
export const TORCH_HEIGHT = PLAYER_RADIUS + 0.35;
export const PLAYER_TORCH_BASE_INTENSITY = 5;

function torchOffsetForFacing(facingX: number, facingY: number) {
  // Right perpendicular to facing in 2D: rotate (fx, fy) by -90°.
  return { sideX: facingY, sideY: -facingX };
}

export function createPlayer(
  scene: THREE.Scene,
  p: Omit<
    Player,
    | "body"
    | "indicator"
    | "torchLight"
    | "torchFlame"
    | "torchPhase"
    | "targetX"
    | "targetY"
    | "targetFacingX"
    | "targetFacingY"
  >,
): Player {
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(PLAYER_RADIUS, 24, 24),
    new THREE.MeshStandardMaterial({ color: p.color }),
  );
  body.position.set(p.x, PLAYER_RADIUS, p.y);
  body.castShadow = true;
  scene.add(body);

  const indicator = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  indicator.position.set(
    p.x + p.facingX * INDICATOR_OFFSET,
    PLAYER_RADIUS,
    p.y + p.facingY * INDICATOR_OFFSET,
  );
  scene.add(indicator);

  // Torch flame at body height, held to the player's right side. A
  // small emissive sphere so it reads as "they're carrying something
  // glowing". The point light is what actually lights the room and
  // casts shadows.
  const { sideX, sideY } = torchOffsetForFacing(p.facingX, p.facingY);
  const torchX = p.x + sideX * TORCH_SIDE_OFFSET;
  const torchZ = p.y + sideY * TORCH_SIDE_OFFSET;

  const torchFlame = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 10),
    new THREE.MeshStandardMaterial({
      color: 0xffaa55,
      emissive: 0xff8844,
      emissiveIntensity: 2.5,
    }),
  );
  torchFlame.position.set(torchX, TORCH_HEIGHT, torchZ);
  scene.add(torchFlame);

  // Point light at the flame. Cube shadow maps are pricey — keep the
  // map small (256²) since the torch only casts soft, nearby shadows.
  // Range bumped to 12 so shadows from the colonnade reach further as
  // the player walks past the pillars.
  const torchLight = new THREE.PointLight(
    0xff8844,
    PLAYER_TORCH_BASE_INTENSITY,
    12,
    1.5,
  );
  torchLight.position.set(torchX, TORCH_HEIGHT, torchZ);
  torchLight.castShadow = true;
  torchLight.shadow.mapSize.set(256, 256);
  scene.add(torchLight);

  return {
    ...p,
    targetX: p.x,
    targetY: p.y,
    targetFacingX: p.facingX,
    targetFacingY: p.facingY,
    body,
    indicator,
    torchFlame,
    torchLight,
    torchPhase: Math.random() * Math.PI * 2,
  };
}

// Where the held torch sits in world space, given the player's
// position + facing. Exported so main.ts can reposition the torch
// each frame without duplicating the offset math.
export function torchPositionFor(
  playerX: number,
  playerY: number,
  facingX: number,
  facingY: number,
): { x: number; y: number; z: number } {
  const { sideX, sideY } = torchOffsetForFacing(facingX, facingY);
  return {
    x: playerX + sideX * TORCH_SIDE_OFFSET,
    y: TORCH_HEIGHT,
    z: playerY + sideY * TORCH_SIDE_OFFSET,
  };
}

export function projectToScreen(
  worldX: number,
  worldY: number,
  worldZ: number,
  camera: THREE.Camera,
  container: HTMLElement,
) {
  const v = new THREE.Vector3(worldX, worldY, worldZ).project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * container.clientWidth,
    y: (1 - (v.y * 0.5 + 0.5)) * container.clientHeight,
  };
}

// Inverse of projectToScreen: cast a ray from the pointer into the
// scene and intersect it with the ground plane (y = 0). Returns the
// world (x, y) — i.e. (mesh.x, mesh.z) — where the cursor is hovering.
// Used by click-to-walk: tap on a tile, sphere walks there.
const RAYCASTER = new THREE.Raycaster();
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const NDC = new THREE.Vector2();
const HIT = new THREE.Vector3();

export function screenToWorld(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  container: HTMLElement,
): { x: number; y: number } | null {
  const rect = container.getBoundingClientRect();
  NDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  NDC.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  RAYCASTER.setFromCamera(NDC, camera);
  const hit = RAYCASTER.ray.intersectPlane(GROUND, HIT);
  if (!hit) return null;
  return { x: HIT.x, y: HIT.z };
}
