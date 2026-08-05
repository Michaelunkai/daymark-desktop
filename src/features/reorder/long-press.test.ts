import assert from "node:assert/strict";
import test from "node:test";

import { createLongPressReorderController, moveInOrder } from "./long-press.js";

function createScheduler() {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  return {
    setTimeout(callback: () => void) {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    runAll() {
      for (const [id, callback] of timers) {
        timers.delete(id);
        callback();
      }
    },
  };
}

test("long press enters reorder mode and suppresses the follow-up activation", () => {
  const scheduler = createScheduler();
  const events: string[] = [];
  const controller = createLongPressReorderController({
    onCancel: () => events.push("cancel"),
    onLongPress: () => events.push("enter"),
    scheduler,
  });

  controller.pointerDown({ button: 0, clientX: 10, clientY: 20, isPrimary: true, pointerId: 4 });
  scheduler.runAll();
  controller.pointerUp({ pointerId: 4 });

  assert.deepEqual(events, ["enter"]);
  assert.equal(controller.consumeSuppressedClick(), true);
  assert.equal(controller.consumeSuppressedClick(), false);
});

test("moving or releasing before the threshold cancels without entering reorder mode", () => {
  const scheduler = createScheduler();
  const events: string[] = [];
  const controller = createLongPressReorderController({
    onCancel: () => events.push("cancel"),
    onLongPress: () => events.push("enter"),
    scheduler,
  });

  controller.pointerDown({ button: 0, clientX: 10, clientY: 20, isPrimary: true, pointerId: 4 });
  controller.pointerMove({ clientX: 25, clientY: 20, pointerId: 4 });
  controller.pointerUp({ pointerId: 4 });
  assert.deepEqual(events, ["cancel"]);

  controller.pointerDown({ button: 0, clientX: 10, clientY: 20, isPrimary: true, pointerId: 5 });
  controller.pointerUp({ pointerId: 5 });
  scheduler.runAll();
  assert.deepEqual(events, ["cancel"]);
  assert.equal(controller.consumeSuppressedClick(), false);
});

test("held mouse movement enters reorder without waiting for the long-press timer", () => {
  const scheduler = createScheduler();
  const events: string[] = [];
  const controller = createLongPressReorderController({
    onCancel: () => events.push("cancel"),
    onLongPress: () => events.push("enter"),
    onDragMove: () => events.push("move"),
    scheduler,
  });

  controller.pointerDown({ button: 0, clientX: 10, clientY: 20, isPrimary: true, pointerId: 4 });
  controller.pointerMove({ clientX: 30, clientY: 20, buttons: 1, pointerId: 4, pointerType: "mouse" });
  controller.pointerUp({ pointerId: 4 });

  assert.deepEqual(events, ["enter", "move"]);
  assert.equal(controller.consumeSuppressedClick(), true);
});

test("mouse travel is recognized when the release carries the final position", () => {
  const scheduler = createScheduler();
  const events: string[] = [];
  const controller = createLongPressReorderController({
    onCancel: () => events.push("cancel"),
    onLongPress: () => events.push("enter"),
    onDragMove: () => events.push("move"),
    scheduler,
  });

  controller.pointerDown({ button: 0, clientX: 10, clientY: 20, isPrimary: true, pointerId: 4, pointerType: "mouse" });
  controller.pointerUp({ pointerId: 4, clientX: 40, clientY: 20, pointerType: "mouse" });

  assert.deepEqual(events, ["enter", "move"]);
  assert.equal(controller.consumeSuppressedClick(), true);
});

test("touch travel after long press is recognized when only release carries the final position", () => {
  const scheduler = createScheduler();
  const events: string[] = [];
  const controller = createLongPressReorderController({
    onCancel: () => events.push("cancel"),
    onLongPress: () => events.push("enter"),
    onDragMove: () => events.push("move"),
    scheduler,
  });

  controller.pointerDown({ button: 0, clientX: 10, clientY: 20, isPrimary: true, pointerId: 4, pointerType: "touch" });
  scheduler.runAll();
  controller.pointerUp({ pointerId: 4, clientX: 40, clientY: 20, pointerType: "touch" });

  assert.deepEqual(events, ["enter", "move"]);
  assert.equal(controller.consumeSuppressedClick(), true);
});

test("touch travel stays pending until the long-press threshold is reached", () => {
  const scheduler = createScheduler();
  const events: string[] = [];
  const controller = createLongPressReorderController({
    onCancel: () => events.push("cancel"),
    onLongPress: () => events.push("enter"),
    onDragMove: () => events.push("move"),
    scheduler,
  });

  controller.pointerDown({ button: 0, clientX: 10, clientY: 20, isPrimary: true, pointerId: 4, pointerType: "touch" });
  controller.pointerMove({ clientX: 25, clientY: 20, pointerId: 4, pointerType: "touch" });
  assert.deepEqual(events, []);

  scheduler.runAll();
  controller.pointerMove({ clientX: 40, clientY: 20, pointerId: 4, pointerType: "touch" });
  controller.pointerUp({ pointerId: 4, pointerType: "touch" });

  assert.deepEqual(events, ["enter", "move"]);
  assert.equal(controller.consumeSuppressedClick(), true);
});

test("touch travel and release before the long-press threshold still cancel", () => {
  const scheduler = createScheduler();
  const events: string[] = [];
  const controller = createLongPressReorderController({
    onCancel: () => events.push("cancel"),
    onLongPress: () => events.push("enter"),
    scheduler,
  });

  controller.pointerDown({ button: 0, clientX: 10, clientY: 20, isPrimary: true, pointerId: 4, pointerType: "touch" });
  controller.pointerMove({ clientX: 25, clientY: 20, pointerId: 4, pointerType: "touch" });
  controller.pointerUp({ pointerId: 4, clientX: 25, clientY: 20, pointerType: "touch" });

  assert.deepEqual(events, ["cancel"]);
  assert.equal(controller.consumeSuppressedClick(), false);
});

test("touch travel is recognized when cancellation carries the final position", () => {
  const scheduler = createScheduler();
  const events: string[] = [];
  const controller = createLongPressReorderController({
    onLongPress: () => events.push("enter"),
    onDragMove: () => events.push("move"),
    onDragEnd: () => events.push("end"),
    scheduler,
  });

  controller.pointerDown({ button: 0, clientX: 10, clientY: 20, isPrimary: true, pointerId: 4, pointerType: "touch" });
  scheduler.runAll();
  controller.pointerCancel({ pointerId: 4, clientX: 40, clientY: 20, pointerType: "touch" });

  assert.deepEqual(events, ["enter", "move", "end"]);
  assert.equal(controller.consumeSuppressedClick(), true);
});

test("reorder selection moves earlier and later without changing item identity", () => {
  const original = ["first", "selected", "last"];
  assert.deepEqual(moveInOrder(original, "selected", -1), ["selected", "first", "last"]);
  assert.deepEqual(moveInOrder(original, "selected", 1), ["first", "last", "selected"]);
  assert.deepEqual(moveInOrder(original, "missing", -1), original);
});
