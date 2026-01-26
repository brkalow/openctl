import { useRef, useState, useCallback, type ReactNode, type CSSProperties } from 'react';

interface HolographicCardProps {
  children: ReactNode;
  className?: string;
  /** Max rotation angle in degrees (default: 3) */
  maxRotation?: number;
  /** Scale factor on hover (default: 1.005) */
  hoverScale?: number;
  /** Enable/disable the effect (default: true) */
  enabled?: boolean;
}

interface CardState {
  rotateX: number;
  rotateY: number;
  glareX: number;
  glareY: number;
  isHovering: boolean;
}

export function HolographicCard({
  children,
  className = '',
  maxRotation = 3,
  hoverScale = 1.005,
  enabled = true,
}: HolographicCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CardState>({
    rotateX: 0,
    rotateY: 0,
    glareX: 50,
    glareY: 50,
    isHovering: false,
  });

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!enabled || !cardRef.current) return;

      const rect = cardRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Calculate distance from center as percentage (-1 to 1)
      const percentX = (e.clientX - centerX) / (rect.width / 2);
      const percentY = (e.clientY - centerY) / (rect.height / 2);

      // Rotation: positive percentX = rotate right (negative rotateY)
      // positive percentY = rotate up (positive rotateX)
      const rotateX = -percentY * maxRotation;
      const rotateY = percentX * maxRotation;

      // Glare position: follows mouse as percentage
      const glareX = ((e.clientX - rect.left) / rect.width) * 100;
      const glareY = ((e.clientY - rect.top) / rect.height) * 100;

      setState({
        rotateX,
        rotateY,
        glareX,
        glareY,
        isHovering: true,
      });
    },
    [enabled, maxRotation]
  );

  const handleMouseEnter = useCallback(() => {
    if (!enabled) return;
    setState((prev) => ({ ...prev, isHovering: true }));
  }, [enabled]);

  const handleMouseLeave = useCallback(() => {
    // Keep glareX and glareY at their last positions so the glow fades out in place
    setState((prev) => ({
      ...prev,
      rotateX: 0,
      rotateY: 0,
      isHovering: false,
    }));
  }, []);

  const cardStyle: CSSProperties = {
    transform: state.isHovering
      ? `perspective(1000px) rotateX(${state.rotateX}deg) rotateY(${state.rotateY}deg) scale(${hoverScale})`
      : 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)',
    transition: state.isHovering
      ? 'transform 0.1s ease-out'
      : 'transform 0.5s ease-out',
    transformStyle: 'preserve-3d',
  };

  const angle = Math.atan2(state.glareY - 50, state.glareX - 50) * (180 / Math.PI) + 90;

  const borderFrameStyle: CSSProperties = {
    position: 'absolute',
    inset: -4,
    borderRadius: 'inherit',
    pointerEvents: 'none',
    background: state.isHovering
      ? `conic-gradient(
          from ${angle}deg at ${state.glareX}% ${state.glareY}%,
          rgba(103, 232, 249, 1) 0deg,
          rgba(167, 139, 250, 1) 60deg,
          rgba(251, 146, 60, 0.9) 120deg,
          rgba(134, 239, 172, 1) 180deg,
          rgba(103, 232, 249, 1) 240deg,
          rgba(167, 139, 250, 1) 300deg,
          rgba(103, 232, 249, 1) 360deg
        )`
      : `linear-gradient(
          135deg,
          rgba(103, 232, 249, 0.5) 0%,
          rgba(167, 139, 250, 0.4) 50%,
          rgba(134, 239, 172, 0.5) 100%
        )`,
    opacity: state.isHovering ? 0.7 : 0.5,
    transition: 'opacity 0.5s ease-out, background 0.5s ease-out',
  };

  const glareStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    borderRadius: 'inherit',
    pointerEvents: 'none',
    opacity: state.isHovering ? 1 : 0,
    transition: 'opacity 0.3s ease-out',
    background: `radial-gradient(ellipse 150% 120% at ${state.glareX}% ${state.glareY}%, rgba(103, 232, 249, 0.06) 0%, rgba(167, 139, 250, 0.03) 40%, transparent 70%)`,
  };

  // Subtle noise overlay for the card background
  const noiseStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 15,
    borderRadius: 'inherit',
    pointerEvents: 'none',
    opacity: 0.4,
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
    mixBlendMode: 'overlay',
  };

  const currentYear = new Date().getFullYear();

  return (
    <div
      ref={cardRef}
      className={`relative ${className}`}
      style={cardStyle}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div style={borderFrameStyle} className="border border-white/15" />
      <span
        className="absolute text-[6px] font-medium text-white/40 tracking-wider z-30 uppercase"
        style={{ bottom: 0, left: 6 }}
      >
        octl {currentYear}
      </span>
      <div className="relative z-10">{children}</div>
      <div style={noiseStyle} />
      <div style={glareStyle} />
    </div>
  );
}
