export type DogBackground = { id: string; label: string; uri: string };

export const DOG_BACKGROUNDS: DogBackground[] = [
  { id: 'dog-park', label: 'גינת כלבים מוארת', uri: 'https://images.unsplash.com/photo-1602684379319-1de467ca74e5?auto=format&fit=crop&w=1200&q=84' },
  { id: 'neighborhood-park', label: 'פארק שכונתי', uri: 'https://images.unsplash.com/photo-1774921665173-832f122fe44b?auto=format&fit=crop&w=1200&q=84' },
  { id: 'sunny-walk', label: 'טיול בפארק', uri: 'https://images.unsplash.com/photo-1779804152118-6ce4fda1c963?auto=format&fit=crop&w=1200&q=84' },
  { id: 'green-path', label: 'שביל ירוק', uri: 'https://images.unsplash.com/photo-1771187058704-3f594fc464a0?auto=format&fit=crop&w=1200&q=84' },
  { id: 'flowers', label: 'פארק ופרחים', uri: 'https://images.unsplash.com/photo-1552764040-3001daba7d81?auto=format&fit=crop&w=1200&q=84' },
  { id: 'park', label: 'דשא ושמיים', uri: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=84' },
];

export function getDogBackground(backgroundId?: string) {
  return DOG_BACKGROUNDS.find((item) => item.id === backgroundId);
}
