import { useState, useEffect } from "react";

interface ConnectionLostBannerProps {
  sessionId: string;
  onEndSession: () => void;
}

export function ConnectionLostBanner({
  sessionId,
  onEndSession,
}: ConnectionLostBannerProps) {
  const [secondsDisconnected, setSecondsDisconnected] = useState(0);
  const [showExtendedHelp, setShowExtendedHelp] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsDisconnected((s) => s + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Show extended help after 2 minutes
  useEffect(() => {
    if (secondsDisconnected >= 120) {
      setShowExtendedHelp(true);
    }
  }, [secondsDisconnected]);

  if (showExtendedHelp) {
    return (
      <div className="bg-amber-900/30 border-b border-amber-800/50 p-4">
        <div className="flex items-start gap-3">
          <svg
            className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <div className="flex-1">
            <h3 className="font-medium text-amber-200">
              Connection lost. Unable to reconnect.
            </h3>
            <p className="text-amber-300/70 text-sm mt-1 mb-3">
              Your session may still be running on your machine. You can:
            </p>
            <ul className="text-amber-300/70 text-sm space-y-1 mb-3">
              <li>
                Check daemon status:{" "}
                <code className="bg-amber-900/50 px-1 rounded">
                  openctl daemon status
                </code>
              </li>
              <li>
                Resume locally:{" "}
                <code className="bg-amber-900/50 px-1 rounded">
                  claude --resume {sessionId}
                </code>
              </li>
            </ul>
            <div className="flex gap-3">
              <button
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white text-sm rounded font-medium transition-colors"
              >
                Retry Connection
              </button>
              <button
                onClick={onEndSession}
                className="px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover text-text-primary text-sm rounded font-medium transition-colors"
              >
                End Session
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-amber-900/30 border-b border-amber-800/50 px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-amber-200">
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
          <span>Connection to daemon lost</span>
          <span className="text-amber-300/50">.</span>
          <span className="text-amber-300/70">Reconnecting...</span>
          <span className="text-amber-300/50 text-sm tabular-nums">
            ({secondsDisconnected}s)
          </span>
        </div>
        <button
          onClick={onEndSession}
          className="text-sm text-amber-300 hover:text-white transition-colors"
        >
          End Session
        </button>
      </div>
    </div>
  );
}
