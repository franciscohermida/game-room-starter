// A light, general-purpose collision module for top-down / iso games.
//
// You register static colliders once at setup, then ask "would a
// circular mover at (x, z) overlap any of them?" each frame. The
// caller decides what to do with the answer — main.ts walks each axis
// separately so blocked moves slide along walls instead of stopping
// dead.
//
// Two shape primitives cover most small-game needs:
//   - Box   — axis-aligned rectangle on the floor (walls, fences,
//             square obstacles).
//   - Circle — disc on the floor (pillars, barrels, round obstacles).
//
// All math is 2D — only the ground plane (XZ) matters for collision.
// If you ever need rotated walls, polygons, velocities, joints, or
// real physics, reach for Rapier3D. The principle stays the same
// (broad-phase test + narrow-phase resolve); you just gain more shapes.

type Collider =
  | { kind: "box"; minX: number; maxX: number; minZ: number; maxZ: number }
  | { kind: "circle"; cx: number; cz: number; r: number };

export interface Colliders {
  /** Add an axis-aligned rectangle centred at (centerX, centerZ). */
  addBox(centerX: number, centerZ: number, sizeX: number, sizeZ: number): void;
  /** Add a disc on the floor centred at (cx, cz) with radius `r`. */
  addCircle(cx: number, cz: number, r: number): void;
  /** Would a circle of `radius` at (x, z) overlap any registered collider? */
  isBlocked(x: number, z: number, radius: number): boolean;
}

export function createColliders(): Colliders {
  const list: Collider[] = [];
  return {
    addBox(cx, cz, sx, sz) {
      list.push({
        kind: "box",
        minX: cx - sx / 2,
        maxX: cx + sx / 2,
        minZ: cz - sz / 2,
        maxZ: cz + sz / 2,
      });
    },

    addCircle(cx, cz, r) {
      list.push({ kind: "circle", cx, cz, r });
    },

    isBlocked(x, z, radius) {
      for (const c of list) {
        if (c.kind === "box") {
          // Circle vs box: find the closest point on the box to the
          // circle's centre, then check whether that point is inside
          // the circle. Handles sides + corners with the same math.
          const closestX = clamp(x, c.minX, c.maxX);
          const closestZ = clamp(z, c.minZ, c.maxZ);
          const dx = x - closestX;
          const dz = z - closestZ;
          if (dx * dx + dz * dz < radius * radius) return true;
        } else {
          // Circle vs circle: overlapping iff distance between centres
          // is less than the sum of the radii.
          const dx = x - c.cx;
          const dz = z - c.cz;
          const r = radius + c.r;
          if (dx * dx + dz * dz < r * r) return true;
        }
      }
      return false;
    },
  };
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
