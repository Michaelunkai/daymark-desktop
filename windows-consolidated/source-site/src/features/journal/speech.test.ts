import assert from "node:assert/strict";
import test from "node:test";

import { createSpeechTranscriptionController } from "./speech";

function fakeRecognition() {
  return {
    continuous: false,
    interimResults: false,
    lang: "",
    onend: undefined,
    onerror: undefined,
    onresult: undefined,
    onstart: undefined,
    start() {},
    stop() {},
  };
}

test("keeps long-form speech continuous and does not duplicate final results", () => {
  const recognition = fakeRecognition();
  let value = "Existing notes";
  const values: string[] = [];
  const controller = createSpeechTranscriptionController({
    createRecognition: () => recognition,
    getText: () => value,
    onText: (next) => {
      value = next;
      values.push(next);
    },
  });

  controller.start();
  assert.equal(recognition.continuous, true);
  assert.equal(recognition.interimResults, true);

  recognition.onresult?.({
    resultIndex: 0,
    results: [
      { isFinal: true, 0: { transcript: "hello" } },
      { isFinal: false, 0: { transcript: "world" } },
    ],
  });
  recognition.onresult?.({
    resultIndex: 1,
    results: [
      { isFinal: true, 0: { transcript: "hello" } },
      { isFinal: false, 0: { transcript: "world again" } },
    ],
  });
  recognition.onresult?.({
    resultIndex: 0,
    results: [
      { isFinal: true, 0: { transcript: "hello" } },
      { isFinal: false, 0: { transcript: "world again" } },
    ],
  });

  assert.equal(values.at(-1), "Existing notes hello world again");
  assert.equal(values.filter((entry) => entry.includes("hello")).length, 3);
  assert.equal(values.at(-1)?.split("hello").length, 2);
});

test("restarts after a browser recognition session ends and stops permanently on request", () => {
  const recognitions = [fakeRecognition(), fakeRecognition()];
  let index = 0;
  const states: string[] = [];
  const controller = createSpeechTranscriptionController({
    createRecognition: () => recognitions[index++],
    getText: () => "",
    onText: () => {},
    onState: (state) => states.push(state),
  });

  controller.start();
  recognitions[0].onend?.();
  assert.equal(states.includes("listening"), true);
  assert.equal(index, 2);

  controller.stop();
  recognitions[1].onend?.();
  assert.equal(index, 2);
  assert.equal(states.at(-1), "stopped");
});
