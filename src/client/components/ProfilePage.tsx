import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useUser } from '@clerk/react';
import { useClerkConfigured } from './AuthContext';
import { SessionRow } from './HomePage';
import { HolographicCard } from './HolographicCard';
import { isSessionLive } from '../lib/sessionUtils';
import type { Session } from '../../db/schema';

// Types for profile API response
interface ProfileStats {
  totalSessions: number;
  totalMessages: number;
  activeDays: number;
  longestStreak: number;
  filesEdited: number;
  linesAdded: number;
  linesDeleted: number;
  preferredModel: string | null;
  preferredHarness: string | null;
  totalTokens: number;
}

interface ProfileActivityDay {
  date: string;
  count: number;
}

interface ProfileData {
  stats: ProfileStats;
  activity: ProfileActivityDay[];
  joinedAt: string | null;
}

interface UserInfo {
  fullName: string | null;
  username: string | null;
  imageUrl: string;
}

// Icons
function AnthropicIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017L3.592 20H0l6.569-16.48zm2.327 5.14l-2.36 6.076h4.873l-2.513-6.077z"/>
    </svg>
  );
}

function TerminalIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

// Helpers
function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatModelName(model: string): string {
  return model
    .replace("claude-", "")
    .replace(/-20\d{6}/, "")
    .split("-")
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function getActivityIntensity(count: number, maxCount: number): number {
  if (count === 0) return 0;
  const ratio = count / maxCount;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

// Custom hook for fetching profile data
function useProfileData() {
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [profileRes, sessionsRes] = await Promise.all([
          fetch('/api/profile', { credentials: 'include' }),
          fetch('/api/sessions', { credentials: 'include' }),
        ]);

        if (!profileRes.ok) throw new Error('Failed to fetch profile data');
        if (!sessionsRes.ok) throw new Error('Failed to fetch sessions');

        const [profile, sessionsData] = await Promise.all([
          profileRes.json(),
          sessionsRes.json(),
        ]);

        setProfileData(profile);
        const sortedSessions = (sessionsData.sessions || [])
          .sort((a: Session, b: Session) =>
            new Date(b.last_activity_at || b.created_at).getTime() -
            new Date(a.last_activity_at || a.created_at).getTime()
          )
          .slice(0, 20);
        setSessions(sortedSessions);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  return { profileData, sessions, isLoading, error };
}

// Pokemon card-style stat row
function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-sm font-semibold text-text-primary tabular-nums">{value}</span>
    </div>
  );
}

// Profile Sidebar Component - Pokemon card style
function ProfileSidebar({
  user,
  stats,
  activity,
  joinedAt,
}: {
  user: UserInfo;
  stats: ProfileStats;
  activity: ProfileActivityDay[];
  joinedAt: string | null;
}) {
  const displayName = user.fullName || user.username || 'User';
  const initials = displayName
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const modelDisplay = stats.preferredModel ? formatModelName(stats.preferredModel) : null;

  return (
    <HolographicCard className="rounded-lg aspect-[5/7]">
      <div className="bg-bg-secondary rounded-lg overflow-hidden p-4 h-full flex flex-col">
        {/* Top bar - name left, sessions right (like Pokemon name/HP) */}
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-0.5">@{user.username}</p>
            <h1 className="text-lg font-bold text-text-primary leading-tight">{displayName}</h1>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-text-muted">Sessions</p>
            <p className="text-xl font-bold text-text-primary tabular-nums">{formatNumber(stats.totalSessions)}</p>
          </div>
        </div>

        {/* Avatar */}
        <div className="mb-3">
          {user.imageUrl ? (
            <img
              src={user.imageUrl}
              alt={displayName}
              className="w-16 h-16 rounded-full object-cover border-2 border-white/10"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-bg-tertiary border-2 border-white/10 flex items-center justify-center">
              <span className="text-xl font-semibold text-text-secondary">{initials}</span>
            </div>
          )}
        </div>

        {/* Activity heatmap */}
        <div className="mb-3 overflow-visible">
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Activity</p>
          <ActivityChartCompact activity={activity} />
        </div>

        {/* Stats section - styled like Pokemon moves */}
        <div className="flex-1">
          <StatRow label="Messages" value={formatNumber(stats.totalMessages)} />
          <StatRow
            label="Lines"
            value={
              <>
                <span className="text-diff-add">+{formatNumber(stats.linesAdded)}</span>
                <span className="text-text-muted"> / </span>
                <span className="text-diff-del">-{formatNumber(stats.linesDeleted)}</span>
              </>
            }
          />
          <StatRow label="Files" value={formatNumber(stats.filesEdited)} />
          {stats.longestStreak > 0 && (
            <StatRow label="Streak" value={`${stats.longestStreak} ${stats.longestStreak === 1 ? 'day' : 'days'}`} />
          )}
        </div>

        {/* Footer - model/harness info */}
        <div className="pt-3 mt-auto border-t border-white/5 flex items-center justify-between text-xs text-text-muted">
          <div className="flex items-center gap-3">
            {modelDisplay && (
              <div className="flex items-center gap-1.5">
                <AnthropicIcon className="w-3.5 h-3.5" />
                <span>{modelDisplay}</span>
              </div>
            )}
            {stats.preferredHarness && (
              <div className="flex items-center gap-1.5">
                <TerminalIcon className="w-3.5 h-3.5" />
                <span>{stats.preferredHarness}</span>
              </div>
            )}
          </div>
          {joinedAt && (
            <span>{new Date(joinedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
          )}
        </div>
      </div>
    </HolographicCard>
  );
}


// Activity Chart
interface ActivityDayWithDayOfWeek extends ProfileActivityDay {
  dayOfWeek: number;
  formattedDate: string;
}

function formatActivityDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ActivityCell({
  day,
  intensity,
  onMouseEnter,
  onMouseLeave,
}: {
  day: ActivityDayWithDayOfWeek;
  intensity: number;
  onMouseEnter: (e: React.MouseEvent, day: ActivityDayWithDayOfWeek) => void;
  onMouseLeave: () => void;
}) {
  const baseClass = "w-[10px] h-[10px] rounded-sm";
  const colorClass = intensity === 0 ? "bg-bg-tertiary" : `activity-level-${intensity}`;

  return (
    <div
      className={`${baseClass} ${colorClass}`}
      onMouseEnter={(e) => onMouseEnter(e, day)}
      onMouseLeave={onMouseLeave}
    />
  );
}

// Max weeks to display - fits 288px content area (24 × 10px + 23 × 2px = 286px)
const MAX_WEEKS = 24;

interface TooltipState {
  day: ActivityDayWithDayOfWeek;
  /** Viewport X coordinate */
  x: number;
  /** Viewport Y coordinate */
  y: number;
}

function ActivityChartCompact({ activity }: { activity: ProfileActivityDay[] }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { weeks, maxCount } = useMemo(() => {
    // Pre-compute day of week and formatted date for each day
    const daysWithDow: ActivityDayWithDayOfWeek[] = activity.map(day => ({
      ...day,
      dayOfWeek: new Date(day.date).getDay(),
      formattedDate: formatActivityDate(day.date),
    }));

    const allWeeks: ActivityDayWithDayOfWeek[][] = [];
    let currentWeek: ActivityDayWithDayOfWeek[] = [];

    for (const day of daysWithDow) {
      if (day.dayOfWeek === 0 && currentWeek.length > 0) {
        allWeeks.push(currentWeek);
        currentWeek = [];
      }
      currentWeek.push(day);
    }
    if (currentWeek.length > 0) {
      allWeeks.push(currentWeek);
    }

    // Only show the most recent MAX_WEEKS weeks, pad with empty weeks if needed
    const recentWeeks = allWeeks.slice(-MAX_WEEKS);
    const emptyWeeksNeeded = MAX_WEEKS - recentWeeks.length;
    const weeks = [...Array(emptyWeeksNeeded).fill([]), ...recentWeeks];
    const recentDays = recentWeeks.flat();

    return { weeks, maxCount: Math.max(...recentDays.map(d => d.count), 1) };
  }, [activity]);

  const handleMouseEnter = (e: React.MouseEvent, day: ActivityDayWithDayOfWeek) => {
    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    // Use mouse coordinates directly to avoid issues with parent 3D transforms
    // affecting getBoundingClientRect() values
    setTooltip({
      day,
      x: e.clientX,
      y: e.clientY,
    });
    setIsVisible(true);
  };

  const handleMouseLeave = () => {
    // Small delay before hiding to allow moving between cells
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
      // Clear tooltip after fade out
      setTimeout(() => setTooltip(null), 150);
    }, 50);
  };

  const sessionText = tooltip?.day.count === 1 ? '1 session' : `${tooltip?.day.count} sessions`;

  return (
    <div className="overflow-visible relative">
      <div className="flex gap-[2px]">
        {weeks.map((week, weekIdx) => (
          <div key={weekIdx} className="flex flex-col gap-[2px] shrink-0">
            {Array.from({ length: 7 }, (_, dayIdx) => {
              const day = week.find((d: ActivityDayWithDayOfWeek) => d.dayOfWeek === dayIdx);
              if (!day) {
                return <div key={dayIdx} className="w-[10px] h-[10px]" />;
              }
              const intensity = getActivityIntensity(day.count, maxCount);
              return (
                <ActivityCell
                  key={dayIdx}
                  day={day}
                  intensity={intensity}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Tooltip rendered via portal to escape transformed parent containers */}
      {tooltip && createPortal(
        <div
          className={`fixed px-2 py-1.5 bg-bg-secondary border border-bg-elevated rounded text-xs text-text-primary whitespace-nowrap pointer-events-none z-50 shadow-lg transition-opacity duration-150 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%) translateY(-8px)',
          }}
        >
          <div className="font-medium">{sessionText}</div>
          <div className="text-text-muted text-[10px]">{tooltip.day.formattedDate}</div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-bg-secondary" />
        </div>,
        document.body
      )}
    </div>
  );
}

// Sessions List
function SessionsList({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) {
    return (
      <div>
        <SessionsHeader />
        <p className="text-sm text-text-muted py-8 text-center">No sessions yet</p>
      </div>
    );
  }

  return (
    <div>
      <SessionsHeader />
      <div className="border-l border-bg-elevated">
        {sessions.map((session, index) => (
          <SessionRow
            key={session.id}
            session={session}
            isLive={isSessionLive(session)}
            isLast={index === sessions.length - 1}
            showProject
          />
        ))}
      </div>
    </div>
  );
}

function SessionsHeader() {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold text-text-primary">Sessions</h2>
      <Link to="/" className="text-sm text-accent-primary hover:underline">
        View all
      </Link>
    </div>
  );
}

// Layout Components
function ProfileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      <div className="flex gap-12">{children}</div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <ProfileLayout>
      <div className="w-[320px] shrink-0">
        <div className="w-24 h-24 rounded-full bg-bg-tertiary animate-pulse mb-4" />
        <div className="h-6 w-32 bg-bg-tertiary animate-pulse rounded mb-2" />
        <div className="h-4 w-24 bg-bg-tertiary animate-pulse rounded mb-4" />
        <div className="h-20 bg-bg-tertiary animate-pulse rounded mb-4" />
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-5 bg-bg-tertiary animate-pulse rounded" />
          ))}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="h-6 w-24 bg-bg-tertiary animate-pulse rounded mb-4" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-16 bg-bg-tertiary animate-pulse rounded mb-2" />
        ))}
      </div>
    </ProfileLayout>
  );
}

function ProfileError({ message }: { message: string }) {
  return (
    <ProfileLayout>
      <div className="flex-1 text-center">
        <p className="text-diff-del">{message}</p>
      </div>
    </ProfileLayout>
  );
}

function ProfileContent({
  user,
  profileData,
  sessions,
}: {
  user: UserInfo;
  profileData: ProfileData;
  sessions: Session[];
}) {
  return (
    <ProfileLayout>
      <div className="w-[320px] shrink-0">
        <ProfileSidebar
          user={user}
          stats={profileData.stats}
          activity={profileData.activity}
          joinedAt={profileData.joinedAt}
        />
      </div>
      <div className="flex-1 min-w-0">
        <SessionsList sessions={sessions} />
      </div>
    </ProfileLayout>
  );
}

// Main Components
function ProfilePageWithClerk() {
  const { user, isLoaded: isUserLoaded } = useUser();
  const { profileData, sessions, isLoading, error } = useProfileData();

  if (!isUserLoaded || isLoading) return <ProfileSkeleton />;
  if (error) return <ProfileError message={error} />;
  if (!user || !profileData || !sessions) {
    return <ProfileError message="Unable to load profile" />;
  }

  return (
    <ProfileContent
      user={{
        fullName: user.fullName,
        username: user.username,
        imageUrl: user.imageUrl,
      }}
      profileData={profileData}
      sessions={sessions}
    />
  );
}

function ProfilePageNoClerk() {
  const { profileData, sessions, isLoading, error } = useProfileData();

  if (isLoading) return <ProfileSkeleton />;
  if (error || !profileData || !sessions) {
    return <ProfileError message={error || 'Unable to load profile'} />;
  }

  return (
    <ProfileContent
      user={{ fullName: 'User', username: null, imageUrl: '' }}
      profileData={profileData}
      sessions={sessions}
    />
  );
}

// Main export
export function ProfilePage() {
  const isClerkConfigured = useClerkConfigured();
  return isClerkConfigured ? <ProfilePageWithClerk /> : <ProfilePageNoClerk />;
}
