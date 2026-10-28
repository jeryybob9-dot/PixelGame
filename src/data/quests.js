// Daily quests (3 per day) and lifetime achievements. Progress is driven by stat events.

export const QUEST_POOL = [
  { id: 'win3', text: 'Win 3 battles', stat: 'wins', goal: 3, reward: { gold: 200 } },
  { id: 'play40', text: 'Play 40 cards', stat: 'cardsPlayed', goal: 40, reward: { gold: 150 } },
  { id: 'towers4', text: 'Destroy 4 towers', stat: 'towers', goal: 4, reward: { gems: 10 } },
  { id: 'spells8', text: 'Cast 8 god-power spells', stat: 'spellsCast', goal: 8, reward: { gold: 150 } },
  { id: 'kills60', text: 'Defeat 60 enemy troops', stat: 'kills', goal: 60, reward: { gold: 180 } },
  { id: 'herokills8', text: 'Defeat 8 troops with your hero', stat: 'heroKills', goal: 8, reward: { gold: 160 } },
  { id: 'bricks400', text: 'Collect 400 bricks', stat: 'bricks', goal: 400, reward: { gold: 120 } },
  { id: 'forms3', text: 'Upgrade your hero form 3 times', stat: 'forms', goal: 3, reward: { gems: 8 } },
  { id: 'waves8', text: 'Survive 8 waves in Siege Waves', stat: 'wavesCleared', goal: 8, reward: { gold: 200 } },
  { id: 'elements2', text: 'Give 2 towers an element', stat: 'elements', goal: 2, reward: { gold: 120 } },
  { id: 'crowns6', text: 'Earn 6 crowns', stat: 'crowns', goal: 6, reward: { gems: 6 } },
];

export const ACHIEVEMENTS = [
  { id: 'first_win', text: 'Win your first battle', stat: 'wins', goal: 1, reward: { gems: 20 } },
  { id: 'wins_10', text: 'Win 10 battles', stat: 'wins', goal: 10, reward: { gems: 40 } },
  { id: 'wins_50', text: 'Win 50 battles', stat: 'wins', goal: 50, reward: { gems: 100 } },
  { id: 'wins_200', text: 'Win 200 battles', stat: 'wins', goal: 200, reward: { gems: 300 } },
  { id: 'three_5', text: 'Win 5 battles with three crowns', stat: 'threeCrowns', goal: 5, reward: { gems: 40 } },
  { id: 'towers_50', text: 'Destroy 50 towers', stat: 'towers', goal: 50, reward: { gems: 60 } },
  { id: 'kills_1000', text: 'Defeat 1,000 troops', stat: 'kills', goal: 1000, reward: { gems: 80 } },
  { id: 'hero_200', text: 'Defeat 200 troops with your hero', stat: 'heroKills', goal: 200, reward: { gems: 60 } },
  { id: 'wave_10', text: 'Reach wave 10 in Siege Waves', stat: 'bestWave', goal: 10, reward: { gems: 50 } },
  { id: 'wave_25', text: 'Reach wave 25 in Siege Waves', stat: 'bestWave', goal: 25, reward: { gems: 150 } },
  { id: 'trophies_1000', text: 'Reach 1,000 trophies', stat: 'bestTrophies', goal: 1000, reward: { gems: 80 } },
  { id: 'trophies_3000', text: 'Reach 3,000 trophies', stat: 'bestTrophies', goal: 3000, reward: { gems: 200 } },
  { id: 'king_5', text: 'Reach King level 5', stat: 'kingLevel', goal: 5, reward: { gems: 50 } },
  { id: 'king_10', text: 'Reach King level 10', stat: 'kingLevel', goal: 10, reward: { gems: 150 } },
  { id: 'cards_30', text: 'Collect 30 different cards', stat: 'cardsOwned', goal: 30, reward: { gems: 100 } },
  { id: 'godbox', text: 'Visit the God Box', stat: 'godboxVisits', goal: 1, reward: { gems: 15 } },
];
