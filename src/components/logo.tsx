/**
 * شعار WatchBox الأصلي: مربع قرمزي متدرج بمثلث تشغيل مدمج بحرف W ضمنيًا.
 * SVG خالص — بلا ملفات خارجية ولا بلوبرنت من أي موقع.
 */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="WatchBox"
      className="shrink-0 drop-shadow"
    >
      <defs>
        <linearGradient id="wb-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f43f5e" />
          <stop offset="1" stopColor="#9f1239" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#wb-g)" />
      <path d="M19 15.5v17l14-8.5z" fill="#fff" />
      <circle cx="35.5" cy="12.5" r="3" fill="#fff" opacity="0.85" />
    </svg>
  );
}
