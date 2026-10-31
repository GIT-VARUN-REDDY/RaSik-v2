export const C = {
  bg: '#0f0a14', card: '#1b1324', card2: '#251a31', line: '#33253f',
  ink: '#ffffff', mute: '#a99bbd', pink: '#ff4d8d', orange: '#ff7a59', gold: '#ffc857',
  ok: '#35d07f', bad: '#ff5b5b', overlay: 'rgba(0,0,0,0.38)',
};
export const GRAD = ['#ff4d8d', '#ff7a59'] as const;
export const R = { sm: 10, md: 16, lg: 24, pill: 999 };
export const STYLE_META = {
  girlfriend: { label: 'Girlfriend vibe', emoji: '💕', colors: ['#ff4d8d', '#c2185b'] as const, tagline: 'Sweet, caring, flirty-friendly' },
  friend: { label: 'Best friend', emoji: '🤝', colors: ['#ff9a3c', '#ff6a3c'] as const, tagline: 'Fun, honest, always up for a chat' },
  listener: { label: 'Listener', emoji: '🎧', colors: ['#7b5cff', '#4b3bd6'] as const, tagline: 'Share anything, no judgement' },
} as const;
export type StyleKey = keyof typeof STYLE_META;
export const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
