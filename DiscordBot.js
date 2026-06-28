equire('dotenv').config();
 
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const Database = require('better-sqlite3');
const crypto = require('crypto');
 
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
 
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('[FATAL] Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID in .env');
  process.exit(1);
}
 
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const db = new Database('quickdraw.db');
db.pragma('journal_mode = WAL');
 
db.exec(`
CREATE TABLE IF NOT EXISTS players (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  total_duels INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  fastest_ms INTEGER,
  total_reaction_ms INTEGER NOT NULL DEFAULT 0,
  recorded_shots INTEGER NOT NULL DEFAULT 0,
  false_starts INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  coins INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
 
CREATE TABLE IF NOT EXISTS duel_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  duel_id TEXT NOT NULL,
  challenger_id TEXT NOT NULL,
  opponent_id TEXT NOT NULL,
  winner_id TEXT,
  loser_id TEXT,
  challenger_reaction_ms INTEGER,
  opponent_reaction_ms INTEGER,
  result_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
 
// ---------------------------------------------------------------------------
// Constants / tuning
// ---------------------------------------------------------------------------
 
const COLORS = {
  PRIMARY: 0xf5a623,   // sandy gold — "western" accent
  SUCCESS: 0x57f287,
  DANGER: 0xed4245,
  INFO: 0x5865f2,
  NEUTRAL: 0x2b2d31
};
 
const EMOJI = {
  GUN: '🔫',
  FIRE: '🔥',
  SKULL: '💀',
  TROPHY: '🏆',
  MEDAL_1: '🥇',
  MEDAL_2: '🥈',
  MEDAL_3: '🥉',
  CLOCK: '⏱️',
  WARNING: '⚠️',
  COIN: '🪙',
  STAR: '⭐',
  BADGE: '🎖️'
};
 
const INVITE_TIMEOUT_MS = 60_000;
const COUNTDOWN_STEP_MS = 1000;
const MIN_DRAW_DELAY_MS = 1500;
const MAX_DRAW_DELAY_MS = 4000;
const SHOOTOUT_TIMEOUT_MS = 15_000; // time allowed to react after SHOOT appears
 
const WIN_XP = 35;
const LOSS_XP = 10;
const WIN_COINS = 15;
const LOSS_COINS = 3;
const FALSE_START_COIN_PENALTY = 5;
 
// ---------------------------------------------------------------------------
// Slash command definitions
// ---------------------------------------------------------------------------
 
const commands = [
  new SlashCommandBuilder()
    .setName('duel')
    .setDescription('Challenge another player to a quickdraw duel')
    .addUserOption(option =>
      option
        .setName('opponent')
        .setDescription('The player you want to duel')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top duelists'),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show your duel stats'),
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show a detailed profile card for yourself or another duelist')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Whose profile to view')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is online')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);
 
// activeDuels: duelId -> duel state object
const activeDuels = new Map();
// busyUsers: userId -> duelId (prevents joining/being challenged into multiple duels)
const busyUsers = new Map();
 
function registerCommands() {
  return rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands.map(command => command.toJSON()) }
  );
}
 
// ---------------------------------------------------------------------------
// Player / DB helpers
// ---------------------------------------------------------------------------
 
function getPlayer(user) {
  let player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(user.id);
 
  if (!player) {
    db.prepare(`
      INSERT INTO players (user_id, username)
      VALUES (?, ?)
    `).run(user.id, user.username);
 
    player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(user.id);
  } else if (player.username !== user.username) {
    db.prepare(`
      UPDATE players
      SET username = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(user.username, user.id);
 
    player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(user.id);
  }