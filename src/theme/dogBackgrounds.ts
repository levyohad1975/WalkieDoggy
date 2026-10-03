export type DogBackground = { id: string; label: string; uri: string };

const unsplash = (photoId: string) =>
  `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=1200&q=84`;

/**
 * Bright, walk-friendly hero scenes. Keep this list deliberately varied so
 * families can choose a mood without making the Dashboard feel dark/heavy.
 */
export const DOG_BACKGROUNDS: DogBackground[] = [
  // Walkie Park is the branded default park treatment: a real photographic park,
  // rendered by the same full-bleed image path as every other selectable background.
  { id: 'walkie-park', label: 'Walkie Park', uri: unsplash('photo-1762153487192-4ef24a15f675') },
  { id: 'dog-park', label: 'גינת כלבים מוארת', uri: unsplash('photo-1602684379319-1de467ca74e5') },
  { id: 'neighborhood-park', label: 'פארק שכונתי', uri: unsplash('photo-1774921665173-832f122fe44b') },
  { id: 'sunny-walk', label: 'טיול בפארק', uri: unsplash('photo-1779804152118-6ce4fda1c963') },
  { id: 'green-path', label: 'שביל ירוק', uri: unsplash('photo-1771187058704-3f594fc464a0') },
  { id: 'flowers', label: 'פארק ופרחים', uri: unsplash('photo-1552764040-3001daba7d81') },
  { id: 'park', label: 'דשא ושמיים', uri: unsplash('photo-1500530855697-b586d89ba3ee') },
  { id: 'tree-avenue', label: 'שדרת עצים', uri: unsplash('photo-1501854140801-50d01698950b') },
  { id: 'garden-path', label: 'שביל בגינה', uri: unsplash('photo-1441974231531-c6227db76b6e') },
  { id: 'open-meadow', label: 'מרחב ירוק', uri: unsplash('photo-1472396961693-142e6e269027') },
  { id: 'lake-park', label: 'פארק ליד אגם', uri: unsplash('photo-1470770841072-f978cf4d019e') },
  { id: 'sunny-field', label: 'שדה שטוף שמש', uri: unsplash('photo-1501785888041-af3ef285b470') },
  { id: 'spring-meadow', label: 'אחו אביבי', uri: unsplash('photo-1497250681960-ef046c08a56e') },
  { id: 'forest-light', label: 'יער מואר', uri: unsplash('photo-1448375240586-882707db888b') },
  { id: 'nature-trail', label: 'שביל בטבע', uri: unsplash('photo-1500534314209-a25ddb2bd429') },
  { id: 'coastal-walk', label: 'טיול ליד הים', uri: unsplash('photo-1507525428034-b723cf961d3e') },
  { id: 'beach-day', label: 'חוף בהיר', uri: unsplash('photo-1473116763249-2faaef81ccda') },
  { id: 'golden-park', label: 'פארק בשעת זהב', uri: unsplash('photo-1470252649378-9c29740c9fa8') },
  { id: 'autumn-walk', label: 'טיול בשלכת', uri: unsplash('photo-1476820865390-c52aeebb9891') },
  { id: 'country-path', label: 'שביל כפרי', uri: unsplash('photo-1501684990103-81819e5be7c3') },
  { id: 'mountain-meadow', label: 'אחו מול הרים', uri: unsplash('photo-1464822759023-fed622ff2c3b') },
  { id: 'wide-lawn', label: 'מדשאה פתוחה', uri: unsplash('photo-1500530855697-b586d89ba3ee') },
  { id: 'green-hills', label: 'גבעות ירוקות', uri: unsplash('photo-1464278533981-50106e6176b1') },
  { id: 'city-green', label: 'טבע בעיר', uri: unsplash('photo-1497250681960-ef046c08a56e') },
  { id: 'quiet-lake', label: 'אגם שקט', uri: unsplash('photo-1500534623283-312aade485b7') },
];

export function getDogBackground(backgroundId?: string) {
  return DOG_BACKGROUNDS.find((item) => item.id === backgroundId);
}
