require('dotenv').config();

const eris = require('eris');
const fs = require("fs");
const express = require('express');
const db = require('./query');
const stats = require('./stats');

const PORT = process.env.PORT || 5000

express().listen(PORT, () => console.log(`Listening on ${ PORT }`));

const PREFIX = '$';

const bot = new eris.Client(process.env.BOT_TOKEN);

let channels;

bot.on("ready", async () => {
  const cs = await db.getChannels();

  channels = cs.map((channel) => {
    return {
      channel_discord_id: channel.channel_discord_id,
      server_id: channel.server_id,
      watch: channel.watch
    };
  });
  console.log("Ready!");
});

const commandForName = {};

// $fetch leagueId
commandForName['fetch'] = {
  owner: true,
  execute: async (msg, args) => {
    // leagueId rd2l s18: 11278
    await stats.getAllMatches(args[0]);
  },
};

// $stats leagueId startTimestamp endTimestamp region channelId
commandForName['stats'] = {
  owner: true,
  execute: async (msg, args) => {
    // leagueId rd2l s18: 11278

    // $stats 11278 1573518600 1573543800 2 631605827337191426
    const s = await stats.getStats(args[0], args[1], args[2], args[3]);

    for (const embed of s) {
      bot.createMessage(args[4], {
        embed: embed
      });
    }
  },
};




// $bet [amount] [captain]
commandForName['bet'] = {
  admin: false,
  execute: async (msg, args) => {
    let betAmount;
    try {
      betAmount = Number(args[0]);
    } catch (error) {
      console.log(error);
      return await msg.channel.createMessage('That didn\'t seem to be a number');
    }

    if (!betAmount || args.length < 2 || betAmount < 1) {
      return await msg.channel.createMessage('$bet [amount] [captain]');
    }

    const bettingOpen = await db.isBettingOpen(getServerId(msg.channel.id));

    if (!bettingOpen) {
      return await msg.channel.createMessage('Betting is not open');
    }

    const authorId = msg.author.id;
    let captainName = args.slice(1).join(' ');

    const captains = await db.getCaptains(captainName, getServerId(msg.channel.id));

    if (!captainName || !captains || captains.length === 0) {
      return await msg.channel.createMessage(`${captainName} is not a captain`);
    }

    // correct capitalization
    captainName = captains[0].username;

    const userRecord = await db.getUser(authorId, null, getServerId(msg.channel.id));

    if (userRecord) {
      if (userRecord.amount <= 0) {
        return msg.channel.createMessage(`You have no ${userRecord.currency} left.`);
      }

      const existingFunds = userRecord.amount;

      if (!existingFunds || existingFunds < betAmount) {
        return msg.channel.createMessage(`You are broke, no ${userRecord.currency} left`);
      }

      await db.setUsersMoney(userRecord.id, userRecord.amount - betAmount)

      await db.createBet(userRecord.id, captains[0].id, userRecord.currency, betAmount);

      return msg.channel.createMessage(`${msg.author.username} bet ${betAmount} ${userRecord.currency} on \`${captainName}\``);
    } else {
      if (betAmount > 100) {
        return msg.channel.createMessage('You only start with 100');
      }

      const newUserRecord = await db.createUser(msg.author.username, authorId, getServerId(msg.channel.id));
      const currency = getCurrencyType();

      await db.createMoney(newUserRecord.id, currency, 100 - betAmount);

      await db.createBet(newUserRecord.id, captains[0].id, currency, betAmount);

      return msg.channel.createMessage(`${msg.author.username} bet ${betAmount} ${currency} on \`${captainName}\``);
    }
  },
};

// $donate [amount] [@user]
commandForName['donate'] = {
  admin: false,
  execute: (msg, args) => {
    return;
    let donateAmount;
    try {
      donateAmount = Number(args[0]);
    } catch (error) {
      console.log(error, args[0]);
      return msg.channel.createMessage('That didn\'t seem to be a number');
    }

    if (!donateAmount || args.length !== 1 || donateAmount < 1 || !msg.mentions || msg.mentions.length !== 1) {
      return msg.channel.createMessage('$donate [amount] [@user]\n You gotta @ the person.');
    }

    let giverIndex = -1;
    giverIndex = users.findIndex((user) => {
      return user.userId === msg.author.id;
    });

    if (giverIndex < 0) {
      // new user
      if (donateAmount > 5) {
        donateAmount = 5;
      }

      const user = {
        userId: msg.author.id,
        username: msg.author.username,
        money: 5,
        currencyType: getCurrencyType()
      };

      users.push(user);

      giverIndex = users.findIndex((user) => {
        return user.userId === msg.mentions[0].id;
      });
    } else {
      if (users[giverIndex].money < donateAmount) {
        donateAmount = users[giverIndex].money;
      }
    }

    let receiverIndex = -1;
    receiverIndex = users.findIndex((user) => {
      return user.userId === msg.mentions[0].id;
    });

    if (receiverIndex < 0) {
      // create that user
      const user = {
        userId: msg.mentions[0].id,
        username: msg.mentions[0].username,
        money: 5,
        currencyType: getCurrencyType()
      };

      users.push(user);

      receiverIndex = users.findIndex((user) => {
        return user.userId === msg.mentions[0].id;
      });
    }

    // shouldnt be needed, but just incase
    if (users[giverIndex].money < donateAmount) {
      donateAmount = users[giverIndex].money;
    }

    users[giverIndex].money = users[giverIndex].money - donateAmount;
    users[receiverIndex].money = users[receiverIndex].money + donateAmount;

    return msg.channel.createMessage(`${msg.author.username} gave ${donateAmount} ${users[giverIndex].currencyType} to \`${msg.mentions[0].username}\`\n ${msg.mentions[0].username} now has ${users[receiverIndex].money} ${users[receiverIndex].currencyType}.`);
  },
};

// $currency [new currency name] [@user]
commandForName['currency'] = {
  admin: true,
  execute: async (msg, args) => {
    if (!args.length || args.length < 2 || !msg.mentions || msg.mentions.length !== 1) {
      return msg.channel.createMessage('$currency [new currency name] [@user]');
    }
    // pop off the mention
    args.pop();

    let newCurrencyName = args[0];

    if (args.length > 1) {
      newCurrencyName = args.slice(0).join(' ');
    }

    let userRecord = await db.getUser(msg.mentions[0].id, null, getServerId(msg.channel.id));

    if (userRecord) {
      // update the currency name
      await db.updateCurrency(newCurrencyName, userRecord.id);

      return msg.channel.createMessage(`${userRecord.username} has ${userRecord.amount} ${newCurrencyName}`);
    } else {
      //new user
      userRecord = await db.createUser(msg.mentions[0].username, msg.mentions[0].id, getServerId(msg.channel.id));
      await db.createMoney(userRecord.id, newCurrencyName, 100);

      return msg.channel.createMessage(`${userRecord.username} has 100 ${newCurrencyName}`);
    }
  }
};

// $bets [all]
commandForName['bets'] = {
  admin: false,
  execute: async (msg, args) => {

    const fields = [];
    let usersBets;

    if (!args.length) {
      usersBets = await db.getAllBets(msg.author.id, getServerId(msg.channel.id));
    } else {
      usersBets = await db.getAllBets(null, getServerId(msg.channel.id));
    }

    for (const bet of usersBets) {
      fields.push({
        name: bet.username,
        value: `Bet ${bet.amount} ${bet.currency} on ${bet.captain}`
      });
    }

    return bot.createMessage(msg.channel.id, {
      embed: {
        color: 0x008000,
        author: {
          name: "Bets"
        },
        fields: fields
      }
    });
  }
};

function getCurrencyType () {
  const currencies = [
    'poonbucks', 'toxic dollars', 'chappys', 'truckwaffles', 'egifts', 'shrutebucks', 'dollaridoos', 'tangos',
    'bonks', 'badmins', 'litres of poonani\'s bathwater', 'funzos', 'missed echo slams', 'meepos'
  ];

  return currencies[Math.floor(Math.random() * currencies.length)];
}

// $money [username]
commandForName['money'] = {
  admin: false,
  execute: async (msg, args) => {
    // join, for users with spaces
    let otherUsername;
    if (args.length === 1) {
      otherUsername = args[0];
    } else if (args.length > 1) {
      otherUsername = args.join(' ');
    }

    let userRecord;

    if (msg.mentions.length === 1) {
      userRecord = await db.getUser(msg.mentions[0].id, null, getServerId(msg.channel.id));
    } else if (args.length > 0) {
      userRecord = await db.getUser(null, otherUsername, getServerId(msg.channel.id));
    } else {
      // own money
      userRecord = await db.getUser(msg.author.id, null, getServerId(msg.channel.id));

      if (!userRecord) {
        // create a new user

        const newUserRecord = await db.createUser(msg.author.username, msg.author.id, getServerId(msg.channel.id));
        const currency = getCurrencyType();
        await db.createMoney(newUserRecord.id, currency, 100);

        return msg.channel.createMessage(`${msg.author.username} has 100 ${currency}`);
      }
    }

    if (userRecord) {
      return msg.channel.createMessage(`${userRecord.username} has ${userRecord.amount} ${userRecord.currency}`);
    }

    return msg.channel.createMessage('They haven\'t started betting yet');
  },
};

// $leaderboard
commandForName['leaderboard'] = {
  admin: false,
  execute: async (msg, args) => {

    const allUsers = await db.getAllUsersWithBets(getServerId(msg.channel.id));

    if (!allUsers || allUsers.length === 0) {
      return msg.channel.createMessage(`Something went real wrong 1. <@130569142863396865>`);
    }

    for (const user of allUsers) {
      user.total = Number(user.banked) + (user.bets ? Number(user.bets) : 0);
    }

    allUsers.sort((userA, userB) => {
      return userB.total - userA.total;
    });

    const fields = [];

    for (let i = 0; i < allUsers.length && i < 5; i++) {
      fields.push({
        name: allUsers[i].username,
        value: `${allUsers[i].total} ${allUsers[i].currency}`
      });
    }

    return bot.createMessage(msg.channel.id, {
      embed: {
        color: 0x008000,
        author: {
          name: "Leaderboard"
        },
        fields: fields
      }
    });
  },
};

// $loserboard
commandForName['loserboard'] = {
  admin: false,
  execute: async (msg, args) => {

    const allUsers = await db.getAllUsersWithBets(getServerId(msg.channel.id));

    if (!allUsers || allUsers.length === 0) {
      return msg.channel.createMessage(`Something went real wrong 1. <@130569142863396865>`);
    }

    for (const user of allUsers) {
      user.total = Number(user.banked) + (user.bets ? Number(user.bets) : 0);
      console.log(user)
    }

    allUsers.sort((userA, userB) => {
      return userA.total - userB.total;
    });

    const fields = [];

    for (let i = 0; i < allUsers.length; i++) {
      if (fields.length < 5 && allUsers[i].total < 5) {
        fields.push({
          name: allUsers[i].username,
          value: `${allUsers[i].total} ${allUsers[i].currency}`
        });
      }
    }

    return bot.createMessage(msg.channel.id, {
      embed: {
        color: 0x008000,
        author: {
          name: "Loserboard"
        },
        fields: fields
      }
    });
  },
};

//todo matchups command?

// $captains [add/remove/get] [@user]
commandForName['captains'] = {
  admin: false,
  execute: async (msg, args) => {
    const admin = await db.getAdmin(msg.author.id);

    if (!admin || args.length === 0) {
      const captains = await db.getCaptains(null, getServerId(msg.channel.id));

      return bot.createMessage(msg.channel.id, {
        embed: {
          description: captains.map((captain) => captain.username).join(', '),
          color: 0x008000,
        }
      });
    }

    if (args.length < 2 || !msg.mentions || msg.mentions.length < 1) {
      return msg.channel.createMessage('$captains [add/remove] [@user]');
    }

    const captains = await db.getCaptains(null, getServerId(msg.channel.id));
    const users = await db.getAllUsers(getServerId(msg.channel.id));

    if (args[0] === 'add') {
      for (const mention of msg.mentions) {
        if (!captains.some((captain) => captain.discord_id === mention.id)) {
          let user = users.find((user) => user.discord_id === mention.id);

          if (!user) {
            user = await db.createUser(mention.username, mention.id, getServerId(msg.channel.id));
          }
          await db.createCaptain(user.id);
        }
      }
    }

    if (args[0] === 'remove') {
      const userIdsToDelete = msg.mentions.map((mention) => mention.id);
      await db.deleteCaptains(userIdsToDelete)
    }

    const updatedCaptains = await db.getCaptains(null, getServerId(msg.channel.id));

    return bot.createMessage(msg.channel.id, {
      embed: {
        description: updatedCaptains.map((captain) => captain.username).join(', '),
        color: 0x008000,
        author: {
          name: "Captains"
        }
      }
    });
  },
};

// $open
commandForName['open'] = {
  admin: true,
  execute: async (msg, args) => {
    await db.openBetting(getServerId(msg.channel.id));
    return msg.channel.createMessage('Betting is open');
  },
};

// $close
commandForName['close'] = {
  admin: true,
  execute: async (msg, args) => {
    await db.closeBetting(getServerId(msg.channel.id));
    return msg.channel.createMessage('Betting is closed');
  },
};

// $payout
commandForName['payout'] = {
  admin: true,
  execute: async (msg, args) => {
    await db.closeBetting(getServerId(msg.channel.id));

    const wonBets = [];
    const tiedBets = [];
    const lostBets = [];

    const results = await db.getBettingResults(getServerId(msg.channel.id));

    for (const result of results) {
      if (result.result === 2) {
        const payout = result.amount * 2;
        await db.updateUsersMoney(result.user_id, payout);
        wonBets.push(`${result.username} won ${payout} ${result.currency} betting on ${result.captain_username}\n`);
      } else if (result.result === 1) {
        const payout = result.amount;
        await db.updateUsersMoney(result.user_id, payout);
        tiedBets.push(`${result.username} recovered ${payout} ${result.currency} betting on ${result.captain_username}\n`);
      } else {
        lostBets.push(`${result.username} lost ${result.amount} ${result.currency} betting on ${result.captain_username}\n`);
      }
    }

    await db.resetBetting(getServerId(msg.channel.id));

    return bot.createMessage(msg.channel.id, {
      embed: {
        color: 0x008000,
        author: {
          name: "Results"
        },
        fields: [{
          name: "Won",
          value: wonBets.length ? wonBets.join('') : '~'
        }, {
          name: "Tied",
          value: tiedBets.length ? tiedBets.join('') : '~'
        }, {
          name: "Lost",
          value: lostBets.length ? lostBets.join('') : '~'
        }]
      }
    });
  },
};

function giveMoneyToUser (userId, amount) {
  const userIndex = users.findIndex((user) => user.userId === userId);
  users[userIndex].money = users[userIndex].money + amount;
}

// $winners [add/remove/get] [usernames]
commandForName['winners'] = {
  admin: true,
  execute: async (msg, args) => {
    const action = args[0];

    if (!args || args.length < 1 || (['add', 'remove'].includes(action) && args.length < 2)) {
      return msg.channel.createMessage('$winners [add/remove/get] [@usernames]');
    }

    const usernames = args.slice(1);
    const captains = await db.getCaptains(null, getServerId(msg.channel.id));

    if (action === 'add') {
      for (const username of usernames) {
        const captain = captains.find((captain) => captain.username.toLowerCase() === username.toLowerCase());

        if (captain && captain.id) {
          await db.createWinner(captain.id);
        }
      }

      const winners = await db.getWinners();

      return bot.createMessage(msg.channel.id, {
        embed: {
          description: winners.map((winner) => winner.username).join(', '),
          color: 0x008000,
          author: {
            name: "Current winners"
          },
        }
      });
    } else if (action === 'remove') {
      const captains = await db.getCaptains(usernames[0], getServerId(msg.channel.id));

      if (captains && captains.length > 0) {
        await db.deleteWinner(captains[0].id);
      }

      const winners = await db.getWinners();

      return bot.createMessage(msg.channel.id, {
        embed: {
          description: winners.map((winner) => winner.username).join(', '),
          color: 0x008000,
          author: {
            name: "Current winners"
          },
        }
      });
    } else if (action === 'get') {
      const winners = await db.getWinners();

      return bot.createMessage(msg.channel.id, {
        embed: {
          description: winners.map((winner) => winner.username).join(', '),
          color: 0x008000,
          author: {
            name: "Current winners"
          },
        }
      });
    }
  },
};

// $ties [add/remove/get] [users]
commandForName['ties'] = {
  admin: true,
  execute: async (msg, args) => {
    const action = args[0];

    if (!args || args.length < 1 || (['add', 'remove'].includes(action) && args.length < 2)) {
      return msg.channel.createMessage('$ties [add/remove/get] [@usernames]');
    }

    const usernames = args.slice(1);
    const captains = await db.getCaptains(null, getServerId(msg.channel.id));

    if (action === 'add') {
      for (const username of usernames) {
        const captain = captains.find((captain) => captain.username.toLowerCase() === username.toLowerCase());

        if (captain && captain.id) {
          await db.createTie(captain.id);
        }
      }

      const ties = await db.getTies();

      return bot.createMessage(msg.channel.id, {
        embed: {
          description: ties.map((tie) => tie.username).join(', '),
          color: 0x008000,
          author: {
            name: "Current ties"
          },
        }
      });
    } else if (action === 'remove') {
      const captains = await db.getCaptains(usernames[0], getServerId(msg.channel.id));

      if (captains && captains.length > 0) {
        await db.deleteTie(captains[0].id);
      }

      const ties = await db.getTies();

      return bot.createMessage(msg.channel.id, {
        embed: {
          description: ties.map((tie) => tie.username).join(', '),
          color: 0x008000,
          author: {
            name: "Current ties"
          },
        }
      });
    } else if (action === 'get') {
      const ties = await db.getTies();

      return bot.createMessage(msg.channel.id, {
        embed: {
          description: ties.map((tie) => tie.username).join(', '),
          color: 0x008000,
          author: {
            name: "Current ties"
          },
        }
      });
    }
  },
};

// $info
commandForName['info'] = {
  admin: false,
  execute: (msg, args) => {

    return bot.createMessage(msg.channel.id, {
      embed: {
        description: "This bot allows you to place bets on `captains` representing their team.\n Winning a bet doubles your money, for a tie, your bet is returned. Here is the list of commands.",
        color: 0x008000,
        author: {
          name: "RD2L Betting"
        },
        fields: [{
          name: "$bet",
          value: "Place a bet on a captain. Each player starts with 100 money.\n `$bet [amount] [captain name]`"
        }, {
          name: "$money",
          value: "Check to see how much money you have. You can optionally include a players discord name if you want to see their money. If you want to ping them, or they have a messed up name you can mention them.\n `$money`\n`$money TinT`\n`$money @TinT`"
        }, {
          name: "$captains",
          value: "See who the captains are, watch for spelling.\n `$captains`"
        }, {
          name: "$leaderboard / $loserboard",
          value: "See who the wealthiest and poorest people are.\n `$leaderboard`\n`$loserboard`"
        }, {
          name: "$bets",
          value: "Check out your currently placed bets. Include 'all' if you want to see all bets.\n `$bets`\n`$bets all`"
        }, {
          name: "$help",
          value: "See this information again. Optionally include 'admin' to see admin commands.\n `$help (admin)`"
        }]
      }
    });
  },
};

// $help
commandForName['help'] = {
  admin: false,
  execute: (msg, args) => {
    if (args.length) {
      return bot.createMessage(msg.channel.id, {
        embed: {
          description: "These commands have less validation than the basic commands, admins != supid.",
          color: 0x008000,
          author: {
            name: "RD2L Betting Admin commands"
          },
          fields: [{
            name: "$open",
            value: "Opens this round of betting, allowing users to place bets on captains."
          }, {
            name: "$close",
            value: "Closes this round of betting, preventing users from placing bets. Should be done once games start."
          }, {
            name: "$captains [add/remove/get] [@users]",
            value: "Manage this seasons captains.\n `$captains add @Zipper @Holo\n $captains remove @Holo\n $captains get`\n"
          }, {
            name: "$winners [add/remove/get] [captain names]",
            value: "Manage the winners for the current round of betting.\n `$winners add Zipper Holo\n $winners remove Holo\n $winners get`"
          }, {
            name: "$ties [add/remove/get] [captain names]",
            value: "Manage the ties for the current round of betting.\n `$ties add Zipper Holo\n $ties remove Holo\n $ties get`"
          }, {
            name: "$payout",
            value: "Resolves all the current bets using the existing winners and ties lists. Clears the bets, winners and ties when finished.\n `$payout`"
          }, {
            name: "$currency [new currency name] [@user]",
            value: "Sets the name of the type of currency that user has.\n `$currency dicks @TinT`"
          }]
        }
      });
    }

    return bot.createMessage(msg.channel.id, {
      embed: {
        color: 0x008000,
        author: {
          name: "RD2L Betting"
        },
        fields: [{
          name: "$bet",
          value: "Place a bet on a captain. Each player starts with 5 money. Winning a bet doubles your wager. Ties return your bet amount.\n `$bet [amount] [captain name]`"
        }, {
          name: "$money",
          value: "Check to see how much money you have. You can optionally include a players discord name if you want to see their money. If you want to ping them, or they have a messed up name you can mention them.\n `$money`\n `$money TinT`\n `$money @TinT`"
        }, {
          name: "$donate - currently disabled",
          value: "Send some of your money to the other person. You have to tag the user with `@`.\n `$donate 2 @TinT`"
        }, {
          name: "$captains",
          value: "See who the captains are, watch for spelling.\n `$captains`"
        }, {
          name: "$leaderboard / $loserboard",
          value: "See who the wealthiest and poorest people are.\n `$leaderboard`\n `$loserboard`"
        }, {
          name: "$bets",
          value: "Check out your currently placed bets. Include 'all' if you want to see all bets.\n `$bets`\n `$bets all`"
        }, {
          name: "$help",
          value: "See this information again. Optionally include 'admin' to see admin commands.\n `$help (admin)`"
        }]
      }
    });
  },
};

// $admins [add/remove] [@user]
commandForName['admins'] = {
  owner: true,
  execute: async (msg, args) => {
    if (args.length < 2 || !msg.mentions || msg.mentions.length < 1) {
      return msg.channel.createMessage('$admins [add/remove] [@users]');
    }

    const admins = await db.getAdmin();
    const users = await db.getAllUsers(getServerId(msg.channel.id));

    if (args[0] === 'add') {
      for (const mention of msg.mentions) {
        if (!admins.some((admin) => admin.discord_id === mention.id)) {
          let user = users.find((user) => user.discord_id === mention.id);

          if (!user) {
            user = await db.createUser(mention.username, mention.id, getServerId(msg.channel.id));
          }
          await db.createAdmin(user.id);
        }
      }
    }

    if (args[0] === 'remove') {
      const userIdsToDelete = msg.mentions.map((mention) => mention.id);
      await db.deleteAdmins(userIdsToDelete)
    }

    const updatedAdmins = await db.getAdmin();

    return bot.createMessage(msg.channel.id, {
      embed: {
        description: updatedAdmins.map((admin) => admin.username).join(', '),
        color: 0x008000,
        author: {
          name: "Admins"
        }
      }
    });
  },
};

function isOwner (userId) {
  return userId === process.env.OWNER_DISCORD_ID;
}

function isWatchingChannel (discord_id) {
  return channels.some((channel) => channel.channel_discord_id === discord_id && channel.watch);
}

function getServer (channel_discord_id) {
  return channels.find((channel) => channel.channel_discord_id === channel_discord_id);
}

function getServerId (channel_discord_id) {
  const server = getServer(channel_discord_id);
  if (server && server.server_id) {
    return server.server_id;
  }
  return null;
}

bot.on('messageCreate', async (msg) => {
  try {

    if (!isWatchingChannel(msg.channel.id)) {
      return;
    }

    const content = msg.content;

    // Ignore any messages sent as direct messages.
    // The bot will only accept commands issued in
    // a guild.
    if (!msg.channel.guild) {
      return;
    }

    // Ignore any message that doesn't start with the correct prefix.
    if (!content.startsWith(PREFIX)) {
      return;
    }

    // Ignore messages from self
    if (msg.author.id === process.env.SELF_DISCORD_ID) {
      return;
    }

    // Extract the name of the command
    const parts = content.split(' ').map(s => s.trim()).filter(s => s);

    const commandName = parts[0].substr(PREFIX.length);

    // Get the requested command, if there is one.
    const command = commandForName[commandName];
    if (!command) {
      return;
    }

    if (command.owner && !isOwner(msg.author.id)) {
      return await msg.channel.createMessage('Only the owner can use that command');
    }

    const admin = await db.getAdmin(msg.author.id);
    if (command.admin && !admin) {
      return await msg.channel.createMessage('Only admins can use that command');
    }

    // Separate the command arguments from the command prefix and name.
    const args = parts.slice(1);

    // ensure stored username is accurate
    // await db.updateUsername(msg.author.id, msg.author.username);

    // Execute the command.
    await command.execute(msg, args);
  } catch (err) {
    console.warn('Error handling message create event');
    console.warn(err);
  }
});

bot.on('error', err => {
  console.warn(err);
});

bot.connect();
