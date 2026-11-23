// Line icons on a 24 grid, 1.8 stroke, round caps, currentColor (Orbit).
import type { ReactNode } from 'react'

function I({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const Icon = {
  pen: () => <I><path d="M4 20l1.2-4.4L15.8 5a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.4 18.8 4 20z" /><path d="M14 7l3 3" /></I>,
  eraser: () => <I><path d="M8.5 19.5h11" /><path d="M5.2 15.3l8.9-8.9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8l-7.8 7.8a1 1 0 0 1-.7.3H8.8a1 1 0 0 1-.7-.3l-2.9-2.9a.7.7 0 0 1 0-1z" /><path d="M9.5 11l4.8 4.8" /></I>,
  select: () => <I><path d="M4 7V5a1 1 0 0 1 1-1h2M11 4h2M17 4h2a1 1 0 0 1 1 1v2M20 11v2M4 11v2M4 17v2a1 1 0 0 0 1 1h2M11 20h2" /><path d="M15 14l5 2-2 1-1 2-2-5z" /></I>,
  pan: () => <I><path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-3 0-4.5-1.8-6-4.5L3.5 13a1.5 1.5 0 0 1 2.5-1.6L8 13" /></I>,
  undo: () => <I><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></I>,
  redo: () => <I><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></I>,
  back: () => <I><path d="M15 18l-6-6 6-6" /></I>,
  chevron: () => <I size={16}><path d="M6 9l6 6 6-6" /></I>,
  chat: () => <I><path d="M5 4.5h14a2 2 0 012 2v9a2 2 0 01-2 2h-7l-5 4v-4H5a2 2 0 01-2-2v-9a2 2 0 012-2z" /></I>,
  clock: () => <I><path d="M3.5 12a8.5 8.5 0 102.5-6" /><path d="M3 4v4h4M12 8v4l3 2" /></I>,
  bulb: () => <I size={16}><path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0012 3z" /></I>,
  book: () => <I size={16}><path d="M3 5h6a3 3 0 013 3v12a2 2 0 00-2-2H3zM21 5h-6a3 3 0 00-3 3v12a2 2 0 012-2h7z" /></I>,
  steps: () => <I size={16}><path d="M10 6h10M10 12h10M10 18h10M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></I>,
  edit: () => <I size={14}><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></I>,
  more: () => <I><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></I>,
  pages: () => <I><rect x="4" y="3" width="11" height="14" rx="1.5" /><path d="M9 21h9.5a1.5 1.5 0 0 0 1.5-1.5V8" /></I>,
  history: () => <I><path d="M4 5h16v11H9l-5 4V5z" /></I>,
  ask: () => <I><path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4L12 3z" /><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></I>,
  search: () => <I><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2" /></I>,
  upload: () => <I><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" /><path d="M5 15v4h14v-4" /></I>,
  mic: () => <I><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></I>,
  micOff: () => <I><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-5.7-1.3" /><path d="M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.4 2.3M12 18v3M3 3l18 18" /></I>,
  plus: () => <I><path d="M12 5v14M5 12h14" /></I>,
  close: () => <I><path d="M6 6l12 12M18 6L6 18" /></I>,
  check: () => <I><path d="M5 12.5l4.5 4.5L19 7.5" /></I>,
  play: () => <I><path d="M7 5l12 7-12 7V5z" /></I>,
  stop: () => <I><rect x="6" y="6" width="12" height="12" rx="1.5" /></I>,
  image: () => <I><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></I>,
  graph: () => <I><path d="M4 4v16h16" /><path d="M7 16l4-5 3 3 5-7" /></I>,
  send: () => <I><path d="M4 12l16-8-6 16-2.5-6.5L4 12z" /></I>,
  settings: () => <I><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></I>,
  focus: () => <I><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></I>,
  fit: () => <I><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" /></I>,
  read: () => <I><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></I>,
  notebook: () => <I><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 3v18M12 8h4M12 12h4" /></I>,
  share: () => <I><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" /></I>,
  download: () => <I><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M5 19h14" /></I>,
  printer: () => <I><path d="M7 9V4h10v5" /><rect x="4" y="9" width="16" height="7" rx="1.5" /><path d="M7 14h10v6H7z" /></I>,
  sun: () => <I><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></I>,
  moon: () => <I><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></I>,
  flame: () => <I><path d="M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-3.3 2.4-5.3 3.6-7.9.4 1.6 1.2 2.7 2.4 3.4C11.5 7.1 13 4.5 15.5 3c-.3 3 1.2 4.6 2.3 6.3.9 1.4 1.2 2.6 1.2 4 0 4.3-3 7.7-7 7.7z" /></I>,
  target: () => <I><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></I>,
  trash: () => <I><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></I>,
}
