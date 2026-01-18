import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  useSpawnedSession,
  type QuestionPrompt,
  type PermissionPrompt,
  type StreamMessage,
} from "../hooks/useSpawnedSession";
import { SessionHeader } from "./SessionHeader";
import { SessionInput } from "./SessionInput";
import { MessageBlock } from "./MessageBlock";
import { QuestionModal } from "./QuestionModal";
import { ConnectionLostBanner } from "./ConnectionLostBanner";
import { buildToolResultMap } from "../blocks";
import { isNearBottom, scrollToBottom } from "../liveSession";
import type { Message } from "../../db/schema";

interface SpawnedSessionViewProps {
  sessionId: string;
  cwd: string;
  harness: string;
  model?: string;
}

export function SpawnedSessionView({
  sessionId,
  cwd,
  harness,
  model,
}: SpawnedSessionViewProps) {
  const [title, setTitle] = useState("New Session");
  const [startTime] = useState(new Date());
  const [duration, setDuration] = useState("0s");
  const [questionPrompt, setQuestionPrompt] = useState<QuestionPrompt | null>(
    null
  );
  const [permissionPrompt, setPermissionPrompt] =
    useState<PermissionPrompt | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const [showNewMessagesButton, setShowNewMessagesButton] = useState(false);

  const {
    state,
    messages,
    error,
    sendMessage,
    interrupt,
    endSession,
    answerQuestion,
    respondToPermission,
  } = useSpawnedSession({
    sessionId,
    onQuestionPrompt: setQuestionPrompt,
    onPermissionPrompt: setPermissionPrompt,
  });

  // Update duration every second
  useEffect(() => {
    const interval = setInterval(() => {
      const ms = Date.now() - startTime.getTime();
      setDuration(formatDuration(ms));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  // Convert StreamMessages to Message format for MessageBlock
  const convertedMessages: Message[] = useMemo(() => {
    return messages.map((msg, index) => {
      // Extract content blocks from the message
      const contentBlocks = msg.message?.content || [];

      return {
        id: msg.message?.id || `msg-${index}`,
        session_id: sessionId,
        index,
        role: (msg.message?.role || msg.type) as
          | "assistant"
          | "user"
          | "system",
        content_blocks: contentBlocks,
        timestamp: new Date().toISOString(),
        model: msg.message?.model,
        usage: msg.message?.usage,
      };
    });
  }, [messages, sessionId]);

  // Build tool result map for MessageBlock
  const toolResults = useMemo(() => {
    const allBlocks = convertedMessages.flatMap((m) => m.content_blocks || []);
    return buildToolResultMap(allBlocks);
  }, [convertedMessages]);

  // Derive title from first user message
  useEffect(() => {
    if (title !== "New Session") return;

    const firstUserMessage = messages.find(
      (m) => m.type === "user" || m.message?.role === "user"
    );

    if (firstUserMessage && firstUserMessage.message?.content) {
      const content = firstUserMessage.message.content;
      if (Array.isArray(content)) {
        const textBlock = content.find(
          (b): b is { type: "text"; text: string } =>
            b.type === "text" && typeof b.text === "string"
        );
        if (textBlock?.text) {
          const truncated =
            textBlock.text.slice(0, 50) +
            (textBlock.text.length > 50 ? "..." : "");
          setTitle(truncated);
        }
      }
    }
  }, [messages, title]);

  // Auto-scroll effect when messages change
  useEffect(() => {
    const hasNewMessages = convertedMessages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = convertedMessages.length;

    if (scrollContainerRef.current) {
      if (isNearBottom(scrollContainerRef.current)) {
        scrollToBottom(scrollContainerRef.current);
        setShowNewMessagesButton(false);
      } else if (hasNewMessages) {
        setShowNewMessagesButton(true);
      }
    }
  }, [convertedMessages.length]);

  // Scroll handler
  const handleScroll = useCallback(() => {
    if (
      scrollContainerRef.current &&
      isNearBottom(scrollContainerRef.current)
    ) {
      setShowNewMessagesButton(false);
    }
  }, []);

  const handleScrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollToBottom(scrollContainerRef.current);
      setShowNewMessagesButton(false);
    }
  }, []);

  // Handle question answer
  const handleQuestionAnswer = useCallback(
    (answer: string) => {
      if (questionPrompt) {
        answerQuestion(questionPrompt.toolUseId, answer);
        setQuestionPrompt(null);
      }
    },
    [questionPrompt, answerQuestion]
  );

  // Handle permission response
  const handlePermissionResponse = useCallback(
    (allow: boolean) => {
      if (permissionPrompt) {
        respondToPermission(permissionPrompt.requestId, allow);
        setPermissionPrompt(null);
      }
    },
    [permissionPrompt, respondToPermission]
  );

  const showTypingIndicator = state === "running" || state === "starting";

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <SessionHeader
        title={title}
        state={state}
        harness={harness}
        model={model}
        cwd={cwd}
        duration={duration}
        onInterrupt={interrupt}
        onEndSession={endSession}
      />

      {/* Connection lost banner */}
      {state === "disconnected" && (
        <ConnectionLostBanner sessionId={sessionId} onEndSession={endSession} />
      )}

      {/* Main content area */}
      <div className="flex-1 overflow-hidden flex">
        {/* Message list */}
        <div className="flex-1 overflow-hidden flex flex-col relative">
          <div className="flex items-center justify-between mb-4 px-6 pt-4">
            <h2 className="text-sm font-semibold text-text-primary">
              Conversation
            </h2>
            <span className="text-xs text-text-muted tabular-nums">
              {convertedMessages.length} messages
            </span>
          </div>
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto px-6"
            onScroll={handleScroll}
          >
            {convertedMessages.map((message, i) => {
              const prevRole =
                i > 0 ? convertedMessages[i - 1]?.role : null;
              const roleChanged =
                prevRole !== null && prevRole !== message.role;
              return (
                <div key={message.id} className={roleChanged ? "mt-2" : ""}>
                  <MessageBlock
                    message={message}
                    toolResults={toolResults}
                    showRoleBadge={
                      i === 0 || message.role !== convertedMessages[i - 1]?.role
                    }
                    messageIndex={i}
                  />
                </div>
              );
            })}

            {/* Typing indicator */}
            {showTypingIndicator && <TypingIndicator />}
          </div>

          {/* New messages button */}
          {showNewMessagesButton && (
            <button
              className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-accent-primary text-white rounded-full shadow-lg hover:bg-accent-primary/90 transition-all"
              onClick={handleScrollToBottom}
            >
              New messages
            </button>
          )}
        </div>
      </div>

      {/* Input area */}
      <SessionInput state={state} onSend={sendMessage} />

      {/* Question modal */}
      {questionPrompt && (
        <QuestionModal
          question={questionPrompt.question}
          options={questionPrompt.options}
          onAnswer={handleQuestionAnswer}
          onClose={() => setQuestionPrompt(null)}
        />
      )}

      {/* Permission modal */}
      {permissionPrompt && (
        <PermissionModal
          tool={permissionPrompt.tool}
          description={permissionPrompt.description}
          details={permissionPrompt.details}
          onAllow={() => handlePermissionResponse(true)}
          onDeny={() => handlePermissionResponse(false)}
        />
      )}

      {/* Error state */}
      {(state === "ended" || state === "failed") && error && (
        <div className="p-4 bg-red-900/30 border-t border-red-800">
          <p className="text-diff-del">Session ended with error: {error}</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 py-3 px-4 text-text-muted border-l-2 border-role-assistant">
      <div className="flex gap-1">
        <span
          className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="w-1.5 h-1.5 bg-text-muted rounded-full animate-bounce"
          style={{ animationDelay: "300ms" }}
        />
      </div>
      <span className="text-sm">Claude is working...</span>
    </div>
  );
}

interface PermissionModalProps {
  tool: string;
  description: string;
  details: Record<string, unknown>;
  onAllow: () => void;
  onDeny: () => void;
}

function PermissionModal({
  tool,
  description,
  details,
  onAllow,
  onDeny,
}: PermissionModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-secondary border border-bg-elevated rounded-lg w-full max-w-lg mx-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bg-elevated">
          <h2 className="text-lg font-semibold text-text-primary">
            Permission Request
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-amber-900/50 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-amber-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <p className="text-text-primary font-medium mb-1">
                Claude wants to use: {tool}
              </p>
              <p className="text-text-secondary text-sm">{description}</p>
            </div>
          </div>

          {/* Details */}
          {Object.keys(details).length > 0 && (
            <div className="bg-bg-tertiary rounded-md p-3 text-sm">
              <pre className="text-text-muted whitespace-pre-wrap break-words">
                {JSON.stringify(details, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-bg-elevated flex justify-end gap-3">
          <button
            onClick={onDeny}
            className="px-4 py-2 bg-diff-del hover:bg-red-500 text-white rounded-md font-medium transition-colors"
          >
            Deny
          </button>
          <button
            onClick={onAllow}
            className="px-4 py-2 bg-diff-add hover:bg-green-500 text-white rounded-md font-medium transition-colors"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}
