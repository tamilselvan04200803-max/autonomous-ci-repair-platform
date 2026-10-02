"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * The evidence-gate seal. Drawn by hand as vector paths so it scales,
 * reverses to a single colour, and can be stamped with an overshoot.
 */
export function EvidenceSeal({
  className = "",
  runId = "AF-04-1187",
  animate = true,
}: {
  className?: string;
  runId?: string;
  animate?: boolean;
}) {
  const reduce = useReducedMotion();
  const shouldAnimate = animate && !reduce;

  const ticks = Array.from({ length: 60 }, (_, i) => i * 6);

  return (
    <motion.svg
      viewBox="0 0 320 320"
      className={className}
      role="img"
      aria-label={`Evidence gate certification seal for repair run ${runId}`}
      initial={shouldAnimate ? { scale: 1.22, rotate: -14, opacity: 0 } : false}
      whileInView={shouldAnimate ? { scale: 1, rotate: -7, opacity: 1 } : undefined}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ type: "spring", stiffness: 120, damping: 11, mass: 0.9 }}
    >
      <defs>
        <path
          id="seal-arc-top"
          d="M 160 160 m -118 0 a 118 118 0 0 1 236 0"
          fill="none"
        />
        <path
          id="seal-arc-bottom"
          d="M 160 160 m 112 0 a 112 112 0 0 1 -224 0"
          fill="none"
        />
        <g id="seal-tick">
          <rect x="159" y="14" width="2" height="11" fill="currentColor" />
        </g>
      </defs>

      <g color="currentColor">
        {/* Outer ring */}
        <motion.circle
          cx="160"
          cy="160"
          r="140"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          initial={shouldAnimate ? { pathLength: 0 } : false}
          whileInView={shouldAnimate ? { pathLength: 1 } : undefined}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: "easeInOut" }}
        />
        <circle cx="160" cy="160" r="132" fill="none" stroke="currentColor" strokeWidth="1.5" />

        {/* Tick ring */}
        {ticks.map((deg) => (
          <use key={deg} href="#seal-tick" transform={`rotate(${deg} 160 160)`} opacity={deg % 30 === 0 ? 1 : 0.42} />
        ))}

        <circle cx="160" cy="160" r="104" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="160" cy="160" r="97" fill="none" stroke="currentColor" strokeWidth="1" />

        {/* Curved seal lettering */}
        <text
          fill="currentColor"
          fontFamily="'Space Grotesk', sans-serif"
          fontSize="15"
          fontWeight="600"
          letterSpacing="5.2"
        >
          <textPath href="#seal-arc-top" startOffset="50%" textAnchor="middle">
            INDEPENDENT EVIDENCE GATE
          </textPath>
        </text>
        <text
          fill="currentColor"
          fontFamily="'Space Grotesk', sans-serif"
          fontSize="13"
          fontWeight="500"
          letterSpacing="4.4"
        >
          <textPath href="#seal-arc-bottom" startOffset="50%" textAnchor="middle">
            REPRODUCED · TESTED · ATTESTED
          </textPath>
        </text>

        {/* Centre shield */}
        <g transform="translate(160 128) scale(1.28) translate(-24 -28)">
          <path
            d="M24 1.5 L45 9.6 V27.4 C45 40.4 35.9 49.6 24 54.5 C12.1 49.6 3 40.4 3 27.4 V9.6 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path d="M15.4 37.6 V22.8 h4.2 v14.8 z M28.4 37.6 V22.8 h4.2 v14.8 z" fill="currentColor" />
          <path d="M12.6 18.4 h22.8 v4.2 h-22.8 z" fill="currentColor" />
          <path
            d="M18.4 28.6 l4.4 4.6 7.2 -9.2"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="square"
            fill="none"
          />
        </g>

        {/* Baseline plate */}
        <line x1="86" y1="216" x2="234" y2="216" stroke="currentColor" strokeWidth="2" />
        <text
          x="160"
          y="242"
          textAnchor="middle"
          fill="currentColor"
          fontFamily="'JetBrains Mono', monospace"
          fontSize="17"
          fontWeight="500"
          letterSpacing="1.5"
        >
          {runId}
        </text>
        <text
          x="160"
          y="266"
          textAnchor="middle"
          fill="currentColor"
          fontFamily="'Space Grotesk', sans-serif"
          fontSize="12"
          fontWeight="600"
          letterSpacing="4"
        >
          PATCH CERTIFIED
        </text>
      </g>
    </motion.svg>
  );
}
