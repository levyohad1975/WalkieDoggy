export type DogBackground = { id: string; label: string; uri: string };

export const DOG_BACKGROUNDS: DogBackground[] = [
  { id: 'park', label: 'פארק ירוק', uri: 'https://images.unsplash.com/photo-1768058238839-46e6aded1437?auto=format&fit=crop&w=1200&q=82' },
  { id: 'forest', label: 'יער', uri: 'https://images.unsplash.com/photo-1765894518476-f183d3774129?auto=format&fit=crop&w=1200&q=82' },
  { id: 'flowers', label: 'פרחים', uri: 'https://images.unsplash.com/photo-1552764040-3001daba7d81?auto=format&fit=crop&w=1200&q=82' },
  { id: 'beach', label: 'חוף ים', uri: 'https://images.unsplash.com/photo-1497240299146-17ff4089466a?auto=format&fit=crop&w=1200&q=82' },
  { id: 'trail', label: 'שביל בטבע', uri: 'https://images.unsplash.com/photo-1501684990103-81819e5be7c3?auto=format&fit=crop&w=1200&q=82' },
  { id: 'lake', label: 'אגם והרים', uri: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1200&q=82' },
  { id: 'mountains', label: 'נוף הרים', uri: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1200&q=82' },
  { id: 'nature', label: 'טבע פתוח', uri: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=82' },
];

export function getDogBackground(backgroundId?: string) {
  return DOG_BACKGROUNDS.find((item) => item.id === backgroundId);
}
