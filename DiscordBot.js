require('dotenv').config();

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

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) process.exit(1);

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
    .setName('ping')
    .setDescription('Check if the bot is online')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

const activeDuels = new Map();
const busyUsers = new Map();

function registerCommands() {
  return rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands.map(command => command.toJSON()) }
  );
}

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

  return player;
}

function addXP(user, amount) {
  const player = getPlayer(user);
  let xp = player.xp + amount;
  let level = player.level;

  while (xp >= level * 100) {
    xp -= level * 100;
    level += 1;
  }

  db.prepare(`
    UPDATE players
    SET xp = ?, level = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(xp, level, user.id);

  return { xp, level };
}
