/**
 * The product mark: a Q in the app's own palette, identical to the browser-tab
 * icon in `src/app/icon.svg`. Inline SVG so it stays crisp at any size and
 * needs no network request.
 */
export default function QimbyMark({
  size = 36,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Qimby"
      className={className}
    >
      <rect width="64" height="64" rx="15" fill="#0e1b33" />
      <g fill="none" stroke="#f5f7fa" strokeWidth="6.5" strokeLinecap="round">
        <circle cx="32" cy="32" r="13" />
        {/* The tail starts inside the counter and crosses the ring, or it reads as a magnifier */}
        <path d="M36 36 L45 45" />
      </g>
    </svg>
  );
}
