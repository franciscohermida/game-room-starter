// Dungeon dressing: walls + torches + one stone pillar. Pure visual
// geometry and lighting — collision is owned by `./collision.ts`,
// which `buildDungeon` populates with the corresponding colliders.
//
// Self-contained: call `buildDungeon(scene, colliders)` from scene
// setup, then call the returned `update(time)` once per frame to
// animate the torch flicker. Forkers wanting to remix the room
// layout edit one function.

import * as THREE from "three";
import type { Colliders } from "./collision";

interface Torch {
  light: THREE.PointLight;
  flame: THREE.Mesh;
  baseIntensity: number;
  phase: number;
}

const WALL_HEIGHT = 1.6;
const WALL_THICKNESS = 0.4;

export interface Dungeon {
  update(time: number): void;
}

export function buildDungeon(
  scene: THREE.Scene,
  colliders: Colliders,
): Dungeon {
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x1f2030,
    roughness: 0.95,
  });

  function wall(cx: number, cz: number, sx: number, sz: number) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(sx, WALL_HEIGHT, sz),
      wallMat,
    );
    m.position.set(cx, WALL_HEIGHT / 2, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    // Match the visual geometry to a collider so players can't walk
    // through it. The two should always be added together.
    colliders.addBox(cx, cz, sx, sz);
  }

  // Internal wall at X=3 with a doorway from Z=-2 to Z=2. Splits the
  // map into a big room (left) and a small room (right).
  wall(3, -6, WALL_THICKNESS, 8); // north of doorway
  wall(3, 6, WALL_THICKNESS, 8); // south of doorway

  // Colonnade — two rows of three round stone pillars flanking the
  // doorway, forming a corridor that leads into the big room. Rows
  // sit at Z=±2, matching the doorway's opening width.
  const pillarRadius = 0.35;
  const pillarGeom = new THREE.CylinderGeometry(
    pillarRadius,
    pillarRadius,
    WALL_HEIGHT,
    16,
  );
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x2a2b3a,
    roughness: 0.9,
  });

  function pillar(x: number, z: number) {
    const m = new THREE.Mesh(pillarGeom, pillarMat);
    m.position.set(x, WALL_HEIGHT / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    colliders.addCircle(x, z, pillarRadius);
  }

  // Column rows sit flush with the doorway opening at Z=±2. Tight
  // corridor — players walking between the rows pass close to the
  // pillars and cast long fan-shaped shadows from their torchlight.
  for (const x of [-1, -4, -7]) {
    pillar(x, -3);
    pillar(x, 3);
  }

  const torches: Torch[] = [];

  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xffaa55,
    emissive: 0xff8844,
    emissiveIntensity: 2.5,
  });
  const handleMat = new THREE.MeshStandardMaterial({
    color: 0x3a2818,
    roughness: 0.9,
  });

  // Wall-mounted torch: small bracket sticking out of the wall plus a
  // flame above it. No floor handle — the bracket is what anchors it
  // visually to the wall.
  function wallTorch(x: number, y: number, z: number) {
    const phase = Math.random() * Math.PI * 2;
    const baseIntensity = 6;

    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.18, 0.14),
      handleMat,
    );
    bracket.position.set(x, y - 0.15, z);
    bracket.castShadow = true;
    scene.add(bracket);

    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 12),
      flameMat,
    );
    flame.position.set(x, y, z);
    scene.add(flame);

    const light = new THREE.PointLight(0xff8844, baseIntensity, 9, 1.5);
    light.position.set(x, y, z);
    scene.add(light);

    torches.push({ light, flame, baseIntensity, phase });
  }

  // Big room stays dark — players carrying torches do the lighting,
  // and the colonnade casts long shifting shadows as they walk. The
  // only fixed light is the pair of sconces in the small room
  // flanking the doorway — mounted on the small-room face of the
  // wall (X=3.2 surface, torch sits just off it at X=3.4), set back
  // from the doorway so they don't get clipped by the corner.
  wallTorch(3.4, 1.2, -4);
  wallTorch(3.4, 1.2, 4);

  return {
    update(time) {
      for (const t of torches) {
        // Two-tone flicker — quick small wobble plus a slower one so
        // it doesn't read as a uniform pulse.
        const flicker =
          1 +
          0.18 * Math.sin(time * 8 + t.phase) +
          0.12 * Math.sin(time * 13 + t.phase * 2);
        t.light.intensity = t.baseIntensity * flicker;
        const s = 1 + 0.05 * Math.sin(time * 10 + t.phase);
        t.flame.scale.set(s, s, s);
      }
    },
  };
}
