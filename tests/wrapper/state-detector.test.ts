import { describe, test, expect, beforeEach } from "bun:test";
import { StateDetector } from "../../cli/wrapper/state-detector";

describe("StateDetector", () => {
  describe("state detection", () => {
    test("starts in running state", () => {
      let capturedState: string | null = null;
      const detector = new StateDetector((state) => {
        capturedState = state;
      });

      expect(detector.getState()).toBe("running");
    });

    test("detects waiting state from standard prompt", () => {
      let capturedState: string | null = null;
      const detector = new StateDetector((state) => {
        capturedState = state;
      });

      detector.process("Some output\n");
      expect(detector.getState()).toBe("running");

      detector.process("❯ ");
      expect(detector.getState()).toBe("waiting");
      expect(capturedState).toBe("waiting");
    });

    test("detects waiting state from permission prompt", () => {
      let capturedState: string | null = null;
      const detector = new StateDetector((state) => {
        capturedState = state;
      });

      detector.process("Do you want to proceed? [Y/n]");
      expect(detector.getState()).toBe("waiting");
      expect(capturedState).toBe("waiting");
    });

    test("detects waiting state from confirmation prompt", () => {
      let capturedState: string | null = null;
      const detector = new StateDetector((state) => {
        capturedState = state;
      });

      detector.process("Press Enter to continue");
      expect(detector.getState()).toBe("waiting");
    });

    test("detects waiting state from (y/n) prompt", () => {
      let capturedState: string | null = null;
      const detector = new StateDetector((state) => {
        capturedState = state;
      });

      detector.process("Are you sure? (y/n)");
      expect(detector.getState()).toBe("waiting");
    });

    test("detects running state from spinner", () => {
      let capturedState: string | null = null;
      const detector = new StateDetector((state) => {
        capturedState = state;
      });

      // First go to waiting state
      detector.process("❯ ");
      expect(detector.getState()).toBe("waiting");

      // Then detect running from spinner
      detector.process("\r⠋ Thinking...");
      expect(detector.getState()).toBe("running");
      expect(capturedState).toBe("running");
    });

    test("detects running state from tool activity", () => {
      let capturedState: string | null = null;
      const detector = new StateDetector((state) => {
        capturedState = state;
      });

      // First go to waiting state
      detector.process("❯ ");
      expect(detector.getState()).toBe("waiting");

      // Then detect running from activity
      detector.process("Reading file...");
      expect(detector.getState()).toBe("running");
    });

    test("calls onStateChange only when state changes", () => {
      let callCount = 0;
      const detector = new StateDetector(() => {
        callCount++;
      });

      // Running -> Running (no change)
      detector.process("some output");
      detector.process("more output");
      expect(callCount).toBe(0);

      // Running -> Waiting
      detector.process("❯ ");
      expect(callCount).toBe(1);

      // Waiting -> Waiting (no change)
      detector.process("❯ ");
      expect(callCount).toBe(1);

      // Waiting -> Running
      detector.process("⠙ Working...");
      expect(callCount).toBe(2);
    });

    test("keeps only last 500 chars in buffer", () => {
      const detector = new StateDetector(() => {});

      // Process more than 500 chars
      detector.process("a".repeat(600));

      // Then add a prompt
      detector.process("❯ ");
      expect(detector.getState()).toBe("waiting");
    });

    test("reset clears buffer and state", () => {
      let capturedState: string | null = null;
      const detector = new StateDetector((state) => {
        capturedState = state;
      });

      detector.process("❯ ");
      expect(detector.getState()).toBe("waiting");

      detector.reset();
      expect(detector.getState()).toBe("running");
    });
  });

  describe("pattern matching edge cases", () => {
    test("handles alternative prompt >>>", () => {
      const detector = new StateDetector(() => {});
      detector.process(">>> ");
      expect(detector.getState()).toBe("waiting");
    });

    test("handles [yes/no] prompt", () => {
      const detector = new StateDetector(() => {});
      detector.process("Continue? [yes/no]");
      expect(detector.getState()).toBe("waiting");
    });

    test("handles various spinner chars", () => {
      const spinnerChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

      for (const char of spinnerChars) {
        const detector = new StateDetector(() => {});
        detector.process("❯ "); // First go to waiting
        detector.process(char);
        expect(detector.getState()).toBe("running");
      }
    });

    test("handles Writing activity", () => {
      const detector = new StateDetector(() => {});
      detector.process("❯ ");
      detector.process("Writing to file.ts...");
      expect(detector.getState()).toBe("running");
    });

    test("handles Editing activity", () => {
      const detector = new StateDetector(() => {});
      detector.process("❯ ");
      detector.process("Editing file.ts...");
      expect(detector.getState()).toBe("running");
    });

    test("handles Working... indicator", () => {
      const detector = new StateDetector(() => {});
      detector.process("❯ ");
      detector.process("Working...");
      expect(detector.getState()).toBe("running");
    });
  });
});
