const dfzBot = require('./dfz-bot.js');
const rd2lBot = require('./bot.js');

dfzBot.client.login(process.env.LOBBY_BOT_TOKEN);
rd2lBot.client.login(process.env.BOT_TOKEN);
