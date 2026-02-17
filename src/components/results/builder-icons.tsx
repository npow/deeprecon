"use client"

export function LovableIcon({ size = 16 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="lovable-grad-shared" x1="61.061" y1="31.632" x2="114.991" y2="179.932" gradientUnits="userSpaceOnUse">
          <stop offset="0.025" stopColor="#FF8E63"/>
          <stop offset="0.56" stopColor="#FF7EB0"/>
          <stop offset="0.95" stopColor="#4B73FF"/>
        </linearGradient>
      </defs>
      <path fillRule="evenodd" clipRule="evenodd" d="M54.6052 0C83.9389 0 107.719 23.8424 107.719 53.2535V73.4931H125.395C154.729 73.4931 178.508 97.3355 178.508 126.747C178.508 156.158 154.729 180 125.395 180H1.4917V53.2535C1.4917 23.8424 25.2714 0 54.6052 0Z" fill="url(#lovable-grad-shared)"/>
    </svg>
  )
}

export function BoltIcon({ size = 16 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <rect width="16" height="16" rx="2" fill="#1389fd" />
      <path d="M7.398 9.091h-3.58L10.364 2 8.602 6.909h3.58L5.636 14l1.762-4.909Z" fill="#fff" />
    </svg>
  )
}
