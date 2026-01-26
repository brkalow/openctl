import type { Session } from '../../db/schema';

/**
 * Default threshold for considering a session "recently active" (5 minutes)
 */
const DEFAULT_ACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Check if a session has had recent activity within the given threshold.
 */
export function isRecentlyActive(
  session: Session,
  thresholdMs: number = DEFAULT_ACTIVITY_THRESHOLD_MS
): boolean {
  const lastActivity = session.last_activity_at
    ? new Date(session.last_activity_at).getTime()
    : new Date(session.created_at).getTime();
  return Date.now() - lastActivity < thresholdMs;
}

/**
 * Check if a session is considered "live" - has live status and recent activity.
 */
export function isSessionLive(
  session: Session,
  thresholdMs: number = DEFAULT_ACTIVITY_THRESHOLD_MS
): boolean {
  if (session.status !== 'live') return false;
  return isRecentlyActive(session, thresholdMs);
}
