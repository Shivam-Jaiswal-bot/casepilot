export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <rect x="2" y="2" width="20" height="20" rx="5" className="fill-accent" />
        <path d="M8 7.5h6.5L17 10v6.5H8z" fill="none" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M10.5 12.5l1.6 1.6 3-3.2" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-serif text-[1.05rem] font-semibold tracking-tight text-ink">CasePilot</span>
    </span>
  );
}
