// Things Home can ask a freshly opened notebook to do straight away.
export type StartAction = { type: 'pdf'; file: File } | { type: 'ask'; text?: string } | { type: 'practice'; topic: string; count?: number; allowHelp?: boolean } | { type: 'tip'; text: string }
