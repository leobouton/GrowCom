import { clsx } from 'clsx';

/** Logo GrowCom, identique à celui du site (marketing/src/components/Logo.astro). */
export function Logo({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  const large = size === 'lg';
  return (
    <span
      className={clsx('group inline-flex items-center gap-2 text-ink', className)}
      role="img"
      aria-label="GrowCom"
    >
      <svg
        viewBox="0 0 44 34"
        width={large ? 46 : 36}
        height={large ? 36 : 28}
        aria-hidden="true"
        className="shrink-0 overflow-visible"
      >
        <path
          d="M3 31c7.5 0 10.5-4.2 13.4-11.3C19.3 12.6 22.6 6.6 31 6.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <circle
          cx="35.2"
          cy="6.4"
          r="4.3"
          stroke="currentColor"
          strokeWidth="2.4"
          className="fill-lime origin-[35px_6px] transition-transform duration-300 group-hover:scale-125"
        />
      </svg>
      <span
        aria-hidden="true"
        className={clsx('font-display leading-none tracking-[-0.01em]', large ? 'text-[1.9rem]' : 'text-[1.5rem]')}
        style={{ fontWeight: 460 }}
      >
        GrowCom
      </span>
    </span>
  );
}
