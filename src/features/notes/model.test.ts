import { createSampleState } from "../../core/sample-data";
import {
  countWords,
  getDiaryDates,
  parseTags,
  searchWriting,
  sortNotes,
} from "./model";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const state = createSampleState("2026-08-03T10:00:00.000Z", "notes-test-client");
const note = {
  ...state.notes["note-welcome"],
  id: "note-second",
  title: "Meeting ideas",
  content: "Remember the quiet room and the follow-up question.",
  tags: ["work"],
  isPinned: false,
  updatedAt: "2026-08-03T11:00:00.000Z",
};
const entry = {
  ...state.diaryEntries["diary-welcome"],
  id: "diary-second",
  date: "2026-08-02",
  title: "A slower evening",
  content: "Walked home without headphones.",
  tags: ["rest"],
  updatedAt: "2026-08-02T20:00:00.000Z",
};

assert(sortNotes([note, state.notes["note-welcome"]])[0].id === "note-welcome", "Pinned notes should sort first.");
assert(searchWriting("notes", "", [note, state.notes["note-welcome"]], [])[0].item.id === "note-welcome", "Empty notes search should preserve pinned ordering.");
assert(getDiaryDates([state.diaryEntries["diary-welcome"], entry]).join(",") === "2026-08-03,2026-08-02", "Diary dates should sort newest first.");
assert(searchWriting("notes", "quiet room", [note], []).length === 1, "Note body text should be searchable.");
assert(searchWriting("diary", "rest", [], [entry]).length === 1, "Diary tags should be searchable.");
assert(searchWriting("notes", "  MEETING IDEAS ", [note], []).at(0)?.item.id === "note-second", "Writing search should trim and ignore case.");
assert(searchWriting("diary", "missing", [], [entry]).length === 0, "Writing search should return an explicit empty result for misses.");
assert(parseTags(" work, rest, work ") .join(",") === "work,rest", "Tags should be trimmed and deduplicated.");
assert(countWords("one  two\nthree") === 3, "Word count should ignore repeated whitespace.");

console.log("NOTES_MODEL_TESTS_OK");
