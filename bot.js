const eris = require('eris');
const fs = require("fs");
const express = require('express');

const PORT = process.env.PORT || 5000

express().listen(PORT, () => console.log(`Listening on ${ PORT }`));

// const { BOT_OWNER_ID, BOT_TOKEN, LOG_CHANNEL_ID } = require('../config.json');

let admins = JSON.parse(fs.readFileSync('admins.json'));
let captains = JSON.parse(fs.readFileSync('captains.json'));
let bets = JSON.parse(fs.readFileSync('bets.json'));
let users = JSON.parse(fs.readFileSync('users.json'));
let winners = JSON.parse(fs.readFileSync('winners.json'));
let ties = JSON.parse(fs.readFileSync('ties.json'));

let bettingState = 'closed';

const PREFIX = '$';

const bot = new eris.Client(process.env.discord);

bot.on("ready", () => {
    console.log("Ready!");
});

const commandForName = {};

// $bet [amount] [captain]
commandForName['bet'] = {
  admin: false,
  execute: (msg, args) => {
    let betAmount;
    try {
      betAmount = Number(args[0]);
    } catch (error) {
      console.log(error);
      return msg.channel.createMessage('That didn\'t seem to be a number');
    }

    if (!betAmount || args.length !== 2 || betAmount < 1) {
      return msg.channel.createMessage('$bet [amount] [captain]');
    }

    if (!bettingState || bettingState !== 'open') {
      return msg.channel.createMessage('Betting is not open');
    }

    const authorId = msg.author.id;
    let captainName = args[1];

    if (!captainName || !isCaptain(captainName)) {
      return msg.channel.createMessage(`${captainName} is not a captain`);
    }

    // correct capitalization
    captainName = toCaptain(captainName);

    let userIndex = users.findIndex((user) => {
      return user.userId === authorId
    });

    if (userIndex >= 0) {
      const user = users[userIndex];

      if (!user || !user.money) {
        return;
      }

      const existingFunds = user.money;

      if (!existingFunds || existingFunds < betAmount) {
        return msg.channel.createMessage(`You are broke, no ${users[userIndex].currencyType} left`);
      }

      users[userIndex].money = users[userIndex].money - betAmount;

      const bet = {
        userId: authorId,
        captain: captainName,
        money: betAmount
      };

      bets.push(bet);

      return msg.channel.createMessage(`${msg.author.username} bet ${betAmount} ${users[userIndex].currencyType} on \`${captainName}\``);
    } else {
      if (betAmount > 5) {
        return msg.channel.createMessage('You only start with 5');
      }

      user = {
        userId: authorId,
        username: msg.author.username,
        money: (5 - betAmount),
        currencyType: getCurrencyType()
      };

      users.push(user);

      const bet = {
        userId: authorId,
        captain: captainName,
        money: betAmount
      };

      bets.push(bet);

      return msg.channel.createMessage(`${msg.author.username} bet ${betAmount} ${user.currencyType} on \`${captainName}\``);
    }
  },
};

// $donate [amount] [user]
commandForName['donate'] = {
  admin: false,
  execute: (msg, args) => {
    let betAmount;
    try {
      betAmount = Number(args[0]);
    } catch (error) {
      console.log(error);
      return msg.channel.createMessage('That didn\'t seem to be a number');
    }

    if (!betAmount || args.length !== 2 || betAmount < 1) {
      return msg.channel.createMessage('$bet [amount] [captain]');
    }

    if (!bettingState || bettingState !== 'open') {
      return msg.channel.createMessage('Betting is not open');
    }

    const authorId = msg.author.id;
    const captainName = args[1];

    if (!captainName || !isCaptain(captainName)) {
      return msg.channel.createMessage(`${captainName} is not a captain`);
    }

    let userIndex = users.findIndex((user) => {
      return user.userId === authorId
    });

    if (userIndex >= 0) {
      const user = users[userIndex];

      if (!user || !user.money) {
        return;
      }

      const existingFunds = user.money;

      if (!existingFunds || existingFunds < betAmount) {
        return msg.channel.createMessage(`You are broke, no ${users[userIndex].currencyType} left`);
      }

      users[userIndex].money = users[userIndex].money - betAmount;

      const bet = {
        userId: authorId,
        captain: captainName,
        money: betAmount
      };

      bets.push(bet);

      return msg.channel.createMessage(`${msg.author.username} bet ${betAmount} on \`${captainName}\``);
    } else {
      if (betAmount > 5) {
        return msg.channel.createMessage('You only start with 5');
      }

      user = {
        userId: authorId,
        username: msg.author.username,
        money: (5 - betAmount),
        currencyType: getCurrencyType()
      };

      users.push(user);

      const bet = {
        userId: authorId,
        captain: captainName,
        money: betAmount
      };

      bets.push(bet);

      return msg.channel.createMessage(`${msg.author.username} bet ${betAmount} ${user.currencyType} on \`${captainName}\``);
    }
  },
};

function getCurrencyType () {
  const currencies = [
    'poonbucks', 'toxic dollars', 'chappys', 'truckwaffles', 'aris', 'egifts', 'shrutebucks', 'dollaridoos', 'tangos',
    'bonks', 'rileys', 'badmins', 'litres of poonani\'s bathwater'
  ];

  return currencies[Math.floor(Math.random() * currencies.length)];
}

// $money [username]
commandForName['money'] = {
  admin: false,
  execute: (msg, args) => {
    // join, for users with spaces
    let otherUsername;
    if (args.length === 1) {
      otherUsername = args[0];
    } else if (args.length > 1) {
      otherUsername = args.join(' ');
    }

    let user;
    let userIndex = -1;

    if (msg.mentions.length === 1) {
      userIndex = users.findIndex((user) => {
        return user.userId === msg.mentions[0].id;
      });
    } else if (args.length > 0) {
      userIndex = users.findIndex((user) => {
        return user.username === otherUsername;
      });
    } else {
      userIndex = users.findIndex((user) => {
        return user.userId === msg.author.id;
      });

      if (userIndex < 0) {
        // create a new user
        user = {
          userId: msg.author.id,
          username: msg.author.username,
          money: 5,
          currencyType: getCurrencyType()
        };

        users.push(user);
        return msg.channel.createMessage(`${user.username} has ${user.money} ${user.currencyType}`);
      }
    }

    if (userIndex < 0) {
      // user not found, pretend they exist with max currency
      const username = args.length > 0 ? otherUsername : msg.author.username;
      return msg.channel.createMessage(`They haven't started betting yet.`);
    }

    user = users[userIndex];

    return msg.channel.createMessage(`${user.username} has ${user.money} ${user.currencyType}`);
  },
};

//todo matchups command?

// $captains [add/remove/get] [usernames]
commandForName['captains'] = {
  admin: false,
  execute: (msg, args) => {
    if (args.length < 1) {
      return msg.channel.createMessage('$captains [add/remove/get]');
    }

    if (!isAdmin(msg.author.id) || args[0] === 'get') {
      return bot.createMessage(msg.channel.id, {
          embed: {
            description: captains.join(', '),
            color: 0x008000,
          }
      });
    }

    if (args.length < 2) {
      return msg.channel.createMessage('$captains [add/remove] [user]');
    }

    if (args[0] === 'add') {
      const users = args.slice(1);
      if (!users || users.length < 1) {
        return msg.channel.createMessage('$captains [add/remove] [user]');
      }
      for (const user of users) {
        if (isCaptain(user)) {
          return msg.channel.createMessage('Already a captain');
        } else {
          captains.push(user);
          return msg.channel.createMessage(`Captain${users.length > 1 ? 's' : ''} added`);
        }
      }
    } else if (args[0] === 'remove') {
      if (args.length !== 2) {
        return msg.channel.createMessage('$captains [remove] [user]');
      }
      const usernameToRemove = args[1];
      const index = captains.indexOf(usernameToRemove);
      if (index >= 0) {
        captains.splice(index, 1);
        return msg.channel.createMessage(`${usernameToRemove} removed as captain`);
      }
    }
  },
};

// $open
commandForName['open'] = {
  admin: true,
  execute: (msg, args) => {
    bettingState = 'open';
    return msg.channel.createMessage('Betting is open');
  },
};

// $close
commandForName['close'] = {
  admin: true,
  execute: (msg, args) => {
    bettingState = 'closed';
    return msg.channel.createMessage('Betting is closed');
  },
};

// $payout
commandForName['payout'] = {
  admin: true,
  execute: (msg, args) => {
    bettingState = 'closed';

    for (const bet of bets) {
      if (winners.includes(bet.captain)) {
        giveMoneyToUser(bet.userId, bet.money * 2);
      } else if (ties.includes(bet.captain)) {
        giveMoneyToUser(bet.userId, bet.money);
      } else {
        // nothing?
      }
    }

    bets = [];
    winners = [];
    ties = [];
  },
};

function giveMoneyToUser (userId, amount) {
  const userIndex = users.findIndex((user) => user.userId === userId);
  users[userIndex].money = users[userIndex].money + amount;
}

// $winners [add/remove/removeall/get] [usernames]
commandForName['winners'] = {
  admin: true,
  execute: (msg, args) => {
    const action = args[0];

    if (!args || args.length < 1 || (['add', 'remove'].includes(action) && args.length < 2)) {
      return msg.channel.createMessage('$winners [add/remove/removeall/get] [usernames]');
    }

    const usernames = args.slice(1);

    if (action === 'add') {
      for (const username of usernames) {
        if (!winners.includes(username)) {
          winners.push(username);
        }
      }

      return bot.createMessage(msg.channel.id, {
        embed: {
          description: winners.join(', '),
          color: 0x008000,
          author: {
            name: "Current winners: "
          },
        }
      });
    } else if (action === 'remove') {
      const remainingWinners = winners.filter((username) => {
        return !usernames.includes(username)
      });
      winners = remainingWinners;

      return bot.createMessage(msg.channel.id, {
        embed: {
          description: winners.join(', '),
          color: 0x008000,
          author: {
            name: "Current winners: "
          },
        }
      });
    } else if (action === 'removeall') {
      winners = [];
      return msg.channel.createMessage(`Removed all winners`);
    } else if (action === 'get') {
      return bot.createMessage(msg.channel.id, {
        embed: {
          description: winners.join(', '),
          color: 0x008000,
          author: {
            name: "Current winners: "
          },
        }
      });
    }
  },
};

// $ties [add/remove/removeall/get] [users]
commandForName['ties'] = {
  admin: true,
  execute: (msg, args) => {
    const action = args[0];

    if (!args || args.length < 1 || (['add', 'remove'].includes(action) && args.length < 2)) {
      return msg.channel.createMessage('$ties [add/remove/removeall/get] [usernames]');
    }

    const usernames = args.slice(1);

    if (action === 'add') {
      for (const username of usernames) {
        if (!ties.includes(username)) {
          ties.push(username);
        }
      }
      return bot.createMessage(msg.channel.id, {
        embed: {
          description: ties.join(', '),
          color: 0x008000,
          author: {
            name: "Current ties: "
          },
        }
      });
    } else if (action === 'remove') {
      const remainingWinners = ties.filter((username) => {
        return !usernames.includes(username)
      });
      ties = remainingWinners;
      return bot.createMessage(msg.channel.id, {
        embed: {
          description: ties.join(', '),
          color: 0x008000,
          author: {
            name: "Current ties: "
          },
        }
      });
    } else if (action === 'removeall') {
      ties = [];
      return msg.channel.createMessage(`Removed all ties`);
    } else if (action === 'get') {
      return bot.createMessage(msg.channel.id, {
        embed: {
          description: ties.join(', '),
          color: 0x008000,
          author: {
            name: "Current ties: "
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
        description: "This bot allows you to place bets on `captains` representing their team during regular season and potentially playoffs.\n Here is the list of commands. Everything is case sensitive, I made this bot real quick and dirty, pls no break.",
        color: 0x008000,
        author: {
          name: "RD2L Betting"
        },
        fields: [{
          name: "$bet",
          value: "Place a bet on a captain. Each player starts with each of the 5 money.\n `$bet [amount] [captain name]`"
        }, {
          name: "$money",
          value: "Check to see how much money you have. You can optionally include a players discord name if you want to see their money. If you want to ping them, or they have a messed up name you can tag them in place of the (player name) field.\n `$money (player name)`"
        }, {
          name: "$captains",
          value: "See who the captains are, watch for spelling.\n `$captains get`"
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

    return bot.createMessage(msg.channel.id, {
      embed: {
        color: 0x008000,
        author: {
          name: "RD2L Betting"
        },
        fields: [{
          name: "$bet",
          value: "Place a bet on a captain. Each player starts with each of the 5 money. Winning a bet doubles your wager. Ties return your bet amount.\n `$bet [amount] [captain name]`"
        }, {
          name: "$money",
          value: "Check to see how much money you have. You can optionally include a players discord name if you want to see their money. If you want to ping them, or they have a messed up name you can tag them in place of the (player name) field.\n `$money (player name)`"
        }, {
          name: "$captains",
          value: "See who the captains are, watch for case and spelling.\n `$captains get`"
        }, {
          name: "$help",
          value: "See this information again. Optionally include 'admin' to see admin commands.\n `$help (admin)`"
        }]
      }
    });
  },
};

// $admin [add/remove] [@users]
commandForName['admin'] = {
  owner: true,
  execute: (msg, args) => {
    if (args.length < 2) {
      return msg.channel.createMessage('$admin [add/remove] [@user]');
    }

    if (args[0] === 'add') {
      for (const user of msg.mentions) {
        if (isAdmin(user.id)) {
          return msg.channel.createMessage('Already an admin');
        } else {
          admins.push(user.id);
          return msg.channel.createMessage('Added');
        }
      }
    } else if (args[0] === 'remove') {
      const index = admins.indexOf(msg.mentions[0].id);
      if (index >= 0) {
        admins.splice(index, 1);
        return msg.channel.createMessage('Removed');
      }
    }
  },
};

// $save
commandForName['save'] = {
  admin: true,
  execute: (msg, args) => {

    fs.writeFile('admins.json', JSON.stringify(admins), (err) => {
        if (err) {
            console.log(`Error writing admins data: ${err}`)
        }
    });

    fs.writeFile('captains.json', JSON.stringify(captains), (err) => {
        if (err) {
            console.log(`Error writing captains data: ${err}`)
        }
    });

    fs.writeFile('bets.json', JSON.stringify(bets), (err) => {
        if (err) {
            console.log(`Error writing admins data: ${err}`)
        }
    });

    fs.writeFile('users.json', JSON.stringify(users), (err) => {
        if (err) {
            console.log(`Error writing admins data: ${err}`)
        }
    });

    fs.writeFile('winners.json', JSON.stringify(winners), (err) => {
        if (err) {
            console.log(`Error writing admins data: ${err}`)
        }
    });

    fs.writeFile('ties.json', JSON.stringify(ties), (err) => {
        if (err) {
            console.log(`Error writing admins data: ${err}`)
        }
    });

    return msg.channel.createMessage('Saved data');
  },
};

function isOwner (userId) {
  //TODO config me
  return userId === '130569142863396865';
}

function isAdmin (userId) {
  return admins.some((id) => id === userId);
}

function isCaptain (username) {
  return captains.some((name) => name.toLowerCase() === username.toLowerCase());
}

function toCaptain (username) {
  return captains.find((name) => name.toLowerCase() === username.toLowerCase());

}

bot.on('messageCreate', async (msg) => {
  try {
    // console.log(msg)
    if (!['631605827337191426', '435511680836042763'].includes(msg.channel.id)) {
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
    if (msg.author.id === '631605093493637132') {//TODO confgi me
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

    if (command.admin && !isAdmin(msg.author.id)) {
      return await msg.channel.createMessage('Only admins can use that command');
    }

    // Separate the command arguments from the command prefix and name.
    const args = parts.slice(1);

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
