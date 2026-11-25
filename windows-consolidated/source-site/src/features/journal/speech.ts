export type SpeechControllerState = "idle" | "listening" | "stopped" | "unsupported" | "error";

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}

export interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}

export interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}

export interface SpeechTranscriptionControllerOptions {
  createRecognition: () => SpeechRecognitionLike | null;
  getText: () => string;
  language?: string;
  onState?: (state: SpeechControllerState) => void;
  onText: (text: string) => void;
}

export interface SpeechTranscriptionController {
  dispose(): void;
  start(): boolean;
  stop(): void;
}

export function createSpeechTranscriptionController({
  createRecognition,
  getText,
  language = typeof navigator !== "undefined" ? navigator.language : "en-US",
  onState,
  onText,
}: SpeechTranscriptionControllerOptions): SpeechTranscriptionController {
  let recognition: SpeechRecognitionLike | null = null;
  let shouldRestart = false;
  let stopping = false;
  let baseText = "";
  let finalResults = new Map<number, string>();
  let interimResults = new Map<number, string>();
  let disposed = false;

  const emitState = (state: SpeechControllerState) => onState?.(state);

  const start = (): boolean => {
    if (disposed || recognition || stopping) return Boolean(recognition);
    const next = createRecognition();
    if (!next) {
      emitState("unsupported");
      return false;
    }

    recognition = next;
    shouldRestart = true;
    stopping = false;
    baseText = getText().trim();
    finalResults = new Map();
    interimResults = new Map();
    next.continuous = true;
    next.interimResults = true;
    next.lang = language;
    next.onstart = () => emitState("listening");
    next.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim() ?? "";
        if (result.isFinal) {
          finalResults.set(index, transcript);
          interimResults.delete(index);
        } else {
          interimResults.set(index, transcript);
        }
      }
      const recognizedText = [...new Set([...finalResults.keys(), ...interimResults.keys()])]
        .sort((left, right) => left - right)
        .map((index) => finalResults.get(index) ?? interimResults.get(index) ?? "")
        .filter(Boolean)
        .join(" ");
      onText(joinText(baseText, recognizedText));
    };
    next.onerror = () => emitState("error");
    next.onend = () => {
      if (recognition !== next) return;
      recognition = null;
      if (disposed || stopping || !shouldRestart) {
        stopping = false;
        emitState("stopped");
        return;
      }
      start();
    };

    try {
      next.start();
      emitState("listening");
      return true;
    } catch {
      recognition = null;
      shouldRestart = false;
      stopping = false;
      emitState("error");
      return false;
    }
  };

  const stop = () => {
    shouldRestart = false;
    if (!recognition) {
      emitState("stopped");
      return;
    }
    stopping = true;
    try {
      recognition.stop();
    } catch {
      recognition = null;
      stopping = false;
      emitState("stopped");
    }
  };

  return {
    start,
    stop,
    dispose: () => {
      disposed = true;
      stop();
      if (recognition) {
        recognition.onend = null;
        recognition.onerror = null;
        recognition.onresult = null;
        recognition.onstart = null;
      }
      recognition = null;
    },
  };
}

export function getSpeechRecognitionFactory(
  scope: Record<string, unknown> = typeof window === "undefined" ? {} : window as unknown as Record<string, unknown>,
): (() => SpeechRecognitionLike | null) | null {
  const Constructor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (typeof Constructor !== "function") return null;
  return () => new (Constructor as new () => SpeechRecognitionLike)();
}

function joinText(left: string, right: string): string {
  return [left, right].map((value) => value.trim()).filter(Boolean).join(" ");
}
