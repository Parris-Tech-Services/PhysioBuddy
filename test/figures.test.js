import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIGURES, renderDiagram, renderPictures, poseAt, keyframes, sideSkeleton, solveTwoLink, poseSvg } from '../js/figures.js';

test('every figure renders as a diagram and as start/end pictures', () => {
  for (const id of Object.keys(FIGURES)) {
    const svg = renderDiagram(id);
    assert.match(svg, /^<svg class="figure"/, id);
    assert.doesNotMatch(svg, /NaN|undefined/, id);
    assert.match(renderPictures(id), /Start<\/figcaption>.*End<\/figcaption>/s, id);
  }
  assert.equal(renderDiagram('missing'), null);
});

test('animation frames stay finite across the whole loop', () => {
  for (const [id, fig] of Object.entries(FIGURES)) {
    for (let ms = 0; ms < 12000; ms += 700) {
      const svg = poseSvg(fig, poseAt(fig, ms), '');
      assert.doesNotMatch(svg, /NaN|undefined/, `${id} at ${ms}`);
    }
  }
});

test('side-to-side figures can show just the side being exercised', () => {
  const fig = FIGURES['head-rotate-upright'];
  assert.equal(keyframes(fig).length, 4);
  assert.deepEqual(keyframes(fig, 'left'), [{ turn: 0 }, { turn: 1 }]);
  assert.match(renderDiagram('knee-rolling', { side: 'right' }), /rotate\(-38/);
});

test('arm reaching a target lands on it when within reach', () => {
  const { end } = solveTwoLink([0, 0], [50, 30], 40, 38, 'up');
  assert.ok(Math.hypot(end[0] - 50, end[1] - 30) < 0.5);
  const far = solveTwoLink([0, 0], [500, 0], 40, 38, 'down');
  assert.ok(Math.abs(far.end[0] - 78) < 0.5);
});

test('supported extension keeps the hand at the back of the head', () => {
  const pose = FIGURES['neck-extension-supported'].keys[1];
  const k = sideSkeleton(pose);
  const dist = Math.hypot(k.W[0] - k.H[0], k.W[1] - k.H[1]);
  assert.ok(dist < 22, `hand ${dist.toFixed(1)}px from head centre`);
  assert.ok(k.W[0] < k.H[0], 'hand is behind the head, not in front of the face');
});
