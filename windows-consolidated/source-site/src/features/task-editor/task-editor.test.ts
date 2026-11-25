import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./TaskEditor.tsx', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('./task-editor.css', import.meta.url),
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
  assert.doesNotMatch(source, /After which Order item\?/);
  assert.doesNotMatch(source, /Choose an Order item/);
  assert.match(source, /onMoveTaskToOrder\?\.\(nextDraft\)/);
  assert.match(source, /onCopyTaskToOrder\?\.\(nextDraft\)/);
});

test('keeps Today and arbitrary due dates inside every task transfer flow', () => {
  assert.match(source, /dueText:\s*draft\.dueText/);
  assert.match(source, /Schedule destination/);
  assert.match(source, />\s*Today\s*</);
  assert.match(source, />\s*Tomorrow\s*</);
  assert.match(source, />\s*No date\s*</);
  assert.match(source, /placeholder="e\.g\. today or 2026-12-31"/);
  assert.match(source, /'dueText',\s*transferTarget\.dueText/);
});

test('offers direct move and copy calendar actions for every editable task', () => {
  assert.match(source, /type TransferAction =[\s\S]*?'moveToDate'[\s\S]*?'copyToDate'/);
  assert.match(source, /startTransfer\('moveToDate'\)/);
  assert.match(source, /startTransfer\('copyToDate'\)/);
  assert.match(source, />\s*Move to date\s*</);
  assert.match(source, />\s*Copy to date\s*</);
  assert.match(source, /<DatePicker/);
  assert.match(source, /showTextEntry=\{false\}/);
  assert.match(source, /allowClear=\{false\}/);
  assert.match(source, /onChange=\{\(date\) => finishDateTransfer\(date\)\}/);
  assert.match(source, /dueTextForSelectedDate/);
});

test('keeps date and Order transfer actions reachable in compact Android viewports', () => {
  assert.match(
    source,
    /Move to date[\s\S]*?Copy to date[\s\S]*?Move to Order[\s\S]*?Copy to Order/,
  );
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.task-editor__transfer-actions\s*\{[\s\S]*?max-height:\s*min\(34dvh,\s*220px\)[\s\S]*?overflow-y:\s*auto[\s\S]*?overscroll-behavior:\s*contain[\s\S]*?-webkit-overflow-scrolling:\s*touch[\s\S]*?touch-action:\s*pan-y/,
  );
});
