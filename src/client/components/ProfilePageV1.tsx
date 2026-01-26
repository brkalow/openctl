/**
 * ProfilePageV1 - Dashboard/Metrics-First Design Reference
 *
 * This is an alternative profile page design using stub data for exploration.
 * It serves as a reference for future iterations and is accessible at /profile/v1.
 * The main production profile page is at /profile (ProfilePage.tsx).
 *
 * TODO: If adopting this design, wire up to real /api/profile endpoint.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

// Types
interface ProfileUser {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  social: {
    github?: string;
    twitter?: string;
    linkedin?: string;
  };
  joinedAt: string;
}

interface ProfileStats {
  totalSessions: number;
  totalMessages: number;
  activeDays: number;
  longestStreak: number;
  preferredModel: string | null;
  preferredHarness: string | null;
  avgSessionDuration: string;
  filesEdited: number;
}

interface ProfileActivityDay {
  date: string;
  count: number;
}

interface ProfileTimelineSession {
  id: string;
  title: string;
  description: string | null;
  model: string | null;
  harness: string | null;
  repository: string | null;
  date: string;
  messageCount: number;
  linesAdded: number;
  linesRemoved: number;
  hasPr: boolean;
}

// Stub data generator
function getStubProfileData(): {
  user: ProfileUser;
  stats: ProfileStats;
  activity: ProfileActivityDay[];
  recentSessions: ProfileTimelineSession[];
} {
  // Generate activity data for the last 52 weeks (364 days)
  const activity: ProfileActivityDay[] = [];
  const today = new Date();

  for (let i = 363; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // Generate realistic-looking activity with some patterns
    const dayOfWeek = date.getDay();
    const weekNum = Math.floor(i / 7);

    // Higher activity on weekdays, some variance
    let baseChance = dayOfWeek === 0 || dayOfWeek === 6 ? 0.3 : 0.6;
    // Increase activity in recent weeks
    if (weekNum < 8) baseChance += 0.2;
    // Add some randomness
    const hasActivity = Math.random() < baseChance;
    const count = hasActivity ? Math.floor(Math.random() * 8) + 1 : 0;

    activity.push({
      date: date.toISOString().split("T")[0] ?? "",
      count,
    });
  }

  // Generate stub recent sessions
  const recentSessions: ProfileTimelineSession[] = [
    {
      id: "stub-1",
      title: "Implement user authentication flow",
      description: "Added OAuth2 integration with Google and GitHub providers",
      model: "claude-sonnet-4-20250514",
      harness: "Claude Code",
      repository: "acme/webapp",
      date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      messageCount: 47,
      linesAdded: 1034,
      linesRemoved: 79,
      hasPr: true,
    },
    {
      id: "stub-2",
      title: "Debug performance regression in API",
      description: null,
      model: "claude-sonnet-4-20250514",
      harness: "Claude Code",
      repository: "acme/api-server",
      date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      messageCount: 23,
      linesAdded: 45,
      linesRemoved: 12,
      hasPr: false,
    },
    {
      id: "stub-3",
      title: "Refactor database schema for v2",
      description: "Migrating from SQLite to PostgreSQL with new normalized schema",
      model: "claude-opus-4-20250514",
      harness: "Claude Code",
      repository: "acme/webapp",
      date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      messageCount: 89,
      linesAdded: 2341,
      linesRemoved: 1876,
      hasPr: true,
    },
    {
      id: "stub-4",
      title: "Add real-time collaboration features",
      description: "WebSocket-based live cursor and selection sync",
      model: "claude-sonnet-4-20250514",
      harness: "Claude Code",
      repository: "acme/collab-engine",
      date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      messageCount: 156,
      linesAdded: 3892,
      linesRemoved: 234,
      hasPr: true,
    },
    {
      id: "stub-5",
      title: "Fix edge case in diff rendering",
      description: null,
      model: "claude-sonnet-4-20250514",
      harness: "Claude Code",
      repository: "acme/diff-viewer",
      date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      messageCount: 12,
      linesAdded: 23,
      linesRemoved: 8,
      hasPr: false,
    },
    {
      id: "stub-6",
      title: "Add keyboard shortcuts for navigation",
      description: null,
      model: "claude-sonnet-4-20250514",
      harness: "Claude Code",
      repository: "acme/webapp",
      date: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      messageCount: 34,
      linesAdded: 456,
      linesRemoved: 89,
      hasPr: true,
    },
    {
      id: "stub-7",
      title: "Optimize bundle size with code splitting",
      description: null,
      model: "claude-sonnet-4-20250514",
      harness: "Claude Code",
      repository: "acme/webapp",
      date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      messageCount: 67,
      linesAdded: 178,
      linesRemoved: 1245,
      hasPr: true,
    },
    {
      id: "stub-8",
      title: "Implement search functionality",
      description: null,
      model: "claude-opus-4-20250514",
      harness: "Claude Code",
      repository: "acme/search-service",
      date: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      messageCount: 45,
      linesAdded: 892,
      linesRemoved: 0,
      hasPr: false,
    },
  ];

  return {
    user: {
      username: "developer",
      displayName: "Developer",
      avatarUrl: null,
      bio: "Building the future, one session at a time.",
      location: "San Francisco, CA",
      website: "https://example.com",
      social: {
        github: "developer",
        twitter: "developer",
      },
      joinedAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
    },
    stats: {
      totalSessions: 247,
      totalMessages: 12847,
      activeDays: 142,
      longestStreak: 23,
      preferredModel: "claude-sonnet-4-20250514",
      preferredHarness: "Claude Code",
      avgSessionDuration: "34m",
      filesEdited: 1893,
    },
    activity,
    recentSessions,
  };
}

// Format time ago helper
function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return "yesterday";
  } else {
    return `${diffDays}d ago`;
  }
}

// Trend indicator component
function TrendIndicator({ value, positive = true }: { value: string; positive?: boolean }) {
  return (
    <span className={`text-[10px] font-medium ${positive ? 'text-diff-add' : 'text-diff-del'}`}>
      {positive ? '+' : ''}{value}
    </span>
  );
}

// Mini sparkline SVG for stat cards
function MiniSparkline({ data, color = 'currentColor' }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1);
  const width = 48;
  const height = 16;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="opacity-50">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

// Stat Card Component
function StatCard({
  label,
  value,
  trend,
  trendPositive = true,
  sparklineData
}: {
  label: string;
  value: string | number;
  trend?: string;
  trendPositive?: boolean;
  sparklineData?: number[];
}) {
  return (
    <div className="bg-bg-secondary border border-bg-elevated rounded px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-text-muted mb-1">{label}</div>
          <div className="text-2xl font-semibold text-text-primary font-mono tabular-nums leading-none">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </div>
          {trend && (
            <div className="mt-1.5">
              <TrendIndicator value={trend} positive={trendPositive} />
              <span className="text-[10px] text-text-muted ml-1">vs last week</span>
            </div>
          )}
        </div>
        {sparklineData && (
          <div className="shrink-0 mt-1">
            <MiniSparkline data={sparklineData} color="var(--color-accent-primary)" />
          </div>
        )}
      </div>
    </div>
  );
}

// Horizontal Activity Bar (last 30 days)
function ActivityBar({ activity }: { activity: ProfileActivityDay[] }) {
  // Get last 30 days
  const last30 = activity.slice(-30);
  const maxCount = Math.max(...last30.map(d => d.count), 1);
  const totalLast30 = last30.reduce((sum, d) => sum + d.count, 0);
  const activeDaysLast30 = last30.filter(d => d.count > 0).length;

  return (
    <div className="bg-bg-secondary border border-bg-elevated rounded px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-wider text-text-muted">Last 30 Days</div>
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          <span><span className="font-mono text-text-secondary">{totalLast30}</span> sessions</span>
          <span><span className="font-mono text-text-secondary">{activeDaysLast30}</span> active days</span>
        </div>
      </div>
      <div className="flex items-end gap-[2px] h-8">
        {last30.map((day, i) => {
          const height = day.count > 0 ? Math.max((day.count / maxCount) * 100, 12) : 4;
          const date = new Date(day.date);
          const tooltip = `${day.count} session${day.count !== 1 ? 's' : ''} on ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-colors ${day.count > 0 ? 'bg-accent-primary hover:bg-accent-primary/80' : 'bg-bg-tertiary'}`}
              style={{ height: `${height}%` }}
              title={tooltip}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-text-muted font-mono">
        <span>{new Date(last30[0]?.date ?? '').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

// Compact Header with Avatar
function ProfileHeader({ user }: { user: ProfileUser }) {
  const initials = user.displayName
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex items-center gap-3 pb-4 mb-4 border-b border-bg-elevated">
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={user.displayName}
          className="w-10 h-10 rounded-full object-cover"
        />
      ) : (
        <div className="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center">
          <span className="text-sm font-medium text-text-secondary">{initials}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold text-text-primary">{user.displayName}</h1>
          <span className="text-xs text-text-muted font-mono">@{user.username}</span>
        </div>
        {user.bio && (
          <p className="text-xs text-text-secondary truncate">{user.bio}</p>
        )}
      </div>
      <div className="flex items-center gap-2 text-text-muted">
        {user.social.github && (
          <a
            href={`https://github.com/${user.social.github}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
        )}
        {user.social.twitter && (
          <a
            href={`https://twitter.com/${user.social.twitter}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

// Sort indicator icon
function SortIcon() {
  return (
    <svg className="w-3 h-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  );
}

// Session Data Table
function SessionsTable({ sessions }: { sessions: ProfileTimelineSession[] }) {
  return (
    <div className="bg-bg-secondary border border-bg-elevated rounded overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_140px_100px_80px] gap-2 px-4 py-2 bg-bg-tertiary border-b border-bg-elevated text-[11px] uppercase tracking-wider text-text-muted">
        <div className="flex items-center gap-1">
          Session
          <SortIcon />
        </div>
        <div className="flex items-center gap-1">
          Repository
          <SortIcon />
        </div>
        <div className="flex items-center gap-1 justify-end">
          Changes
          <SortIcon />
        </div>
        <div className="flex items-center gap-1 justify-end">
          Time
          <SortIcon />
        </div>
      </div>

      {/* Table rows */}
      <div className="divide-y divide-bg-elevated">
        {sessions.map((session) => (
          <Link
            key={session.id}
            to={`/sessions/${encodeURIComponent(session.id)}`}
            className="grid grid-cols-[1fr_140px_100px_80px] gap-2 px-4 py-2.5 hover:bg-bg-tertiary transition-colors group"
          >
            {/* Session name */}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-primary group-hover:text-accent-primary transition-colors truncate">
                  {session.title}
                </span>
                {session.hasPr && (
                  <span className="shrink-0 px-1 py-0.5 bg-accent-primary/10 text-accent-primary text-[10px] font-medium rounded">
                    PR
                  </span>
                )}
              </div>
              <div className="text-[11px] text-text-muted flex items-center gap-1.5 mt-0.5">
                <span className="font-mono">{session.messageCount} msgs</span>
                {session.model && (
                  <>
                    <span>·</span>
                    <span className="font-mono">{session.model.replace('claude-', '').replace('-20250514', '')}</span>
                  </>
                )}
              </div>
            </div>

            {/* Repository */}
            <div className="flex items-center">
              {session.repository ? (
                <span className="text-xs text-text-secondary font-mono truncate">
                  {session.repository}
                </span>
              ) : (
                <span className="text-xs text-text-muted">-</span>
              )}
            </div>

            {/* Changes */}
            <div className="flex items-center justify-end gap-1.5 text-xs font-mono tabular-nums">
              <span className="text-diff-add">+{session.linesAdded.toLocaleString()}</span>
              {session.linesRemoved > 0 && (
                <span className="text-diff-del">-{session.linesRemoved.toLocaleString()}</span>
              )}
            </div>

            {/* Time */}
            <div className="flex items-center justify-end">
              <span className="text-xs text-text-muted font-mono">{formatTimeAgo(session.date)}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Table footer */}
      <div className="px-4 py-2 bg-bg-tertiary border-t border-bg-elevated flex items-center justify-between">
        <span className="text-[11px] text-text-muted">
          Showing <span className="font-mono text-text-secondary">{sessions.length}</span> of <span className="font-mono text-text-secondary">247</span> sessions
        </span>
        <Link to="/sessions" className="text-[11px] text-accent-primary hover:underline">
          View all sessions
        </Link>
      </div>
    </div>
  );
}

// Main Profile Page V1 Component (Dashboard/Metrics-First)
export function ProfilePageV1() {
  const { user, stats, activity, recentSessions } = useMemo(() => getStubProfileData(), []);

  // Generate sparkline data for stats
  const sessionSparkline = useMemo(() => {
    // Last 7 weeks of session counts
    const weeklyData: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const weekStart = activity.length - 7 - (i * 7);
      const weekEnd = weekStart + 7;
      const weekTotal = activity.slice(Math.max(0, weekStart), weekEnd).reduce((sum, d) => sum + d.count, 0);
      weeklyData.push(weekTotal);
    }
    return weeklyData;
  }, [activity]);

  const filesSparkline = useMemo(() => [12, 18, 15, 24, 20, 28, 32], []);
  const streakSparkline = useMemo(() => [3, 5, 2, 8, 6, 12, 8], []);

  return (
    <div className="max-w-[900px] mx-auto px-6 py-6">
      {/* Compact header */}
      <ProfileHeader user={user} />

      {/* Metrics grid */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Sessions"
          value={stats.totalSessions}
          trend="12%"
          trendPositive={true}
          sparklineData={sessionSparkline}
        />
        <StatCard
          label="Messages"
          value={stats.totalMessages}
          trend="8%"
          trendPositive={true}
        />
        <StatCard
          label="Streak"
          value={`${stats.longestStreak}d`}
          trend="5d"
          trendPositive={true}
          sparklineData={streakSparkline}
        />
        <StatCard
          label="Files Edited"
          value={stats.filesEdited}
          trend="156"
          trendPositive={true}
          sparklineData={filesSparkline}
        />
      </div>

      {/* Activity bar */}
      <div className="mb-4">
        <ActivityBar activity={activity} />
      </div>

      {/* Sessions data table */}
      <SessionsTable sessions={recentSessions} />
    </div>
  );
}
