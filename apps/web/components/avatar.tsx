export function Avatar({ initials, color, size = 24 }: { initials: string; color: string; size?: number }) {
  return (
    <div
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
      className="flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
    >
      {initials}
    </div>
  );
}
