export function AegisMark({
  className = "",
  title = "Aegis Forge",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 56"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Shield body and inner cut — compound path with evenodd rule so inner area is transparent */}
      <path
        d="M24 1.5 L45 9.6 V27.4 C45 40.4 35.9 49.6 24 54.5 C12.1 49.6 3 40.4 3 27.4 V9.6 Z M24 8.2 L39.2 14.1 V27.6 C39.2 37.3 32.5 44.3 24 48.1 C15.5 44.3 8.8 37.3 8.8 27.6 V14.1 Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      {/* The gate: two posts and a lintel */}
      <path
        d="M15.4 37.6 V22.8 h4.2 v14.8 z M28.4 37.6 V22.8 h4.2 v14.8 z"
        fill="currentColor"
      />
      <path d="M12.6 18.4 h22.8 v4.2 h-22.8 z" fill="currentColor" />
      {/* Certified chevron inside the gate */}
      <path
        d="M18.4 28.6 l4.4 4.6 7.2 -9.2"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
