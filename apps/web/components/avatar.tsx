export function Avatar({ initials, color, size = 24 }: { initials: string; color: string; size?: number }) {
  return (
    <div
      // Darkened a touch so white initials clear 4.5:1 on every palette colour; never below 10px.
      style={{ width: size, height: size, background: `color-mix(in oklch, ${color} 85%, black)`, fontSize: Math.max(10, size * 0.38) }}
      className="flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
    >
      {initials}
    </div>
  );
}
