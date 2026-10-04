import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../vendor/three.module.js';
import { createCollectibles } from '../scripts/game/effects.js';

test('a fast car collects coins crossed between frames, without collecting distant coins', () => {
  const player = { x: 3.5, z: 38 };
  let collected = 0;
  const collectibles = createCollectibles(new Scene(), player, () => collected++);
  // Both frame endpoints are outside the pickup circle at z=42.
  collectibles.update(0.05, { x: 3.5, z: 46 });
  assert.equal(collected, 1);
  // A stationary car must not collect another coin or count that coin again.
  collectibles.update(0.05, { ...player });
  assert.equal(collected, 1);
  // Returning to spawn is a teleport, not a sweep through all intermediate coins.
  player.z = 54;
  collectibles.update(0.05, { ...player });
  assert.equal(collected, 1);
});
