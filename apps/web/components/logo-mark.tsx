export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg bg-primary"
      style={{ width: size, height: size }}
    >
      <svg width={size / 2} height={size / 2} viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1.2" className="fill-primary-foreground" />
        <rect x="9" y="1" width="6" height="6" rx="1.2" className="fill-primary-foreground" opacity=".6" />
        <rect x="1" y="9" width="6" height="6" rx="1.2" className="fill-primary-foreground" opacity=".6" />
        <rect x="9" y="9" width="6" height="6" rx="1.2" className="fill-primary-foreground" opacity=".3" />
      </svg>
    </div>
  );
}
