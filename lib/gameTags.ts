// Single source of truth for game genre/style tags — previously three
// independent, drifted copies (the edit page's TAG_OPTIONS, the upload
// wizard's own shorter list missing "Roguelike"/"Multiplayer", and the old
// store landing's dead "Browse by Category" tile list). One list, every
// consumer (edit page, upload wizard, /browse's genre filter chips) reads
// from here now.

export const GAME_TAGS = [
  "Open World", "FPS", "RPG", "Third Person", "Zombie", "Survival Craft",
  "Exploration", "Atmospheric", "Singleplayer", "Hand-painted", "Cozy",
  "Underwater", "Story-rich", "Roguelike", "Multiplayer",
] as const;
