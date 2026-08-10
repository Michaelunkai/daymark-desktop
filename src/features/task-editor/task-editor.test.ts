import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./TaskEditor.tsx', import.meta.url),
  'utf8',
);

test('shows only the active transfer controls while a destination is being chosen', () => {
  assert.match(
    source,
    /\{mode === 'edit'\s*&&\s*!transferAction\s*&&/,
  );
  assert.match(
    source,
    /\{!transferAction \? \(\s*<div className="task-editor__actions">/,
  );
  assert.match(source, /onClick=\{cancelTransfer\}/);
  assert.match(source, /onClick=\{finishTransfer\}/);
});

test('keeps Order transfers in the explicit destination flow', () => {
  assert.match(source, /startTransfer\('moveToOrder'\)/);
  assert.match(source, /startTransfer\('copyToOrder'\)/);
  assert.match(source, /Choose the Order section/);
  assert.match(source, /getOrderTransferDestinationError/);
  assert.match(source, /After which Order item\?/);
  assert.match(source, /onMoveTaskToOrder\?\.\(nextDraft\)/);
  assert.match(source, /onCopyTaskToOrder\?\.\(nextDraft\)/);
});
