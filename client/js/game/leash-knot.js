// EntityLeashKnot / LeashFenceKnotEntity: spawn packets carry the fence BlockPos,
// while rendering, rope endpoints, bounds and light sampling use its centre.
export function placeLeashKnot(e, x = e.x, y = e.y, z = e.z) {
  e.x = e.prevX = e.newX = Math.floor(x) + 0.5;
  e.y = e.prevY = e.newY = Math.floor(y) + 0.5;
  e.z = e.prevZ = e.newZ = Math.floor(z) + 0.5;
  e.inc = 0;
  e.width = 0.375;
  e.height = 0.5;
  e.eyeHeight = -0.0625;
  e.box = [
    e.x - 0.1875,
    e.y - 0.125,
    e.z - 0.1875,
    e.x + 0.1875,
    e.y + 0.375,
    e.z + 0.1875,
  ];
}
