require('dotenv').config();

const Discord = require('discord.js');
const client = new Discord.Client();
const fs = require("fs");
const db = require('./query');
const express = require('express');

const PORT = process.env.PORT || 5000

express().listen(PORT, () => console.log(`Listening on ${ PORT }`));

const PREFIX = '$';

let channels, server_num_rounds = 3, server_num_matches = 4, server_matchups;

client.once('ready', async () => {
  const cs = await db.getChannels();

  channels = cs.map((channel) => {
    return {
      channel_discord_id: channel.channel_discord_id,
      server_id: channel.server_id,
      watch: channel.watch
    };
  });

  server_matchups = await db.getMatchups();

  console.log('Ready!');
});

const commandForName = {};

function getNextPrediction (user_id, predictions) {
  // find what prediction the person needs to make next
  const homeTeam = {};
  const awayTeam = {};
  const predictionInfo = {
    predictor_id: user_id
  };
  for (let round = 1; round <= server_num_rounds; round++) {
    const expectedMatches = server_num_matches / Math.pow(2, round - 1);

    const predictionsForRound = predictions.filter((prediction) => {
      return prediction.matchup_round === round;
    });

    if (!predictionsForRound || predictionsForRound.length < expectedMatches) {
      const matchNumToAdd = predictionsForRound.length ? predictionsForRound.length + 1 : 1;

      predictionInfo.matchup_round = round;
      predictionInfo.matchup_order_num = matchNumToAdd;

      // for first round, we look at the matchups to determine which prediction query to pose to the user
      if (round === 1) {
        const matchup = server_matchups.find((m) => {
          return (
            m.round === round &&
            m.order_num === matchNumToAdd
          );
        });

        homeTeam.id = matchup.home_id;
        homeTeam.name = matchup.home_team_name;

        awayTeam.id = matchup.away_id;
        awayTeam.name = matchup.away_team_name;

        return {
          homeTeam,
          awayTeam,
          predictionInfo
        };
      } else {
        // we are round 2 and above, meaning we have to use the persons previous predictions to pose the next query
        const desired = {
          round: round - 1,
          top: (matchNumToAdd * 2) - 1,
          bottom: (matchNumToAdd * 2)
        };

        for (const prediction of predictions) {
          if (prediction.matchup_round === desired.round && prediction.matchup_order_num === desired.top) {
            homeTeam.id = prediction.winning_team_id;
            homeTeam.name = prediction.winning_team_name;
          } else if (prediction.matchup_round === desired.round && prediction.matchup_order_num === desired.bottom) {
            awayTeam.id = prediction.winning_team_id;
            awayTeam.name = prediction.winning_team_name;
          }
        }

        return {
          homeTeam,
          awayTeam,
          predictionInfo
        };
      }
    }
  }

  return {
    completed: true
  };
}

// $predict
commandForName['predict'] = {
  execute: async (msg, args) => {

    let user = await db.getUser(msg.author.id);
    if (!user || !user.id) {
      // create user
      user = await db.createUser(msg.author.username, msg.author.id, getServerId(msg.channel.id));
    }

    // find the predictions this person has made
    const predictions = await db.getPredictions(user.id);

    const { homeTeam, awayTeam, predictionInfo, completed } = getNextPrediction(user.id, predictions)

    if (completed) {
      return msg.channel.send(`${msg.author.username} has completed predictions.`)
      // return msg.author.send('You have completed predictions');
    } else if (predictionInfo.matchup_round === 1 && predictionInfo.matchup_order_num === 1) {
      await msg.author.send('I am a bot that allows you to create a prediction bracket for RD2L playoffs. I will prompt you with a matchup and you can guess the outcome. Reacting with a 1️⃣ or 2️⃣ will indicate which team you think will win. If you want to type out a reason for your prediction, which might be used as content, then react with 🅰️ for 🅱️ instead of 1️⃣ or 2️⃣ to be asked for a writeup.')
    }
    // send the prediction query
    const message = await msg.author.send(`**Round ${predictionInfo.matchup_round} match ${predictionInfo.matchup_order_num}: ${homeTeam.name} vs ${awayTeam.name}**\n1️⃣ - ${homeTeam.name}\n2️⃣ - ${awayTeam.name}`);
    await message.react('1️⃣');
    await message.react('2️⃣');
    await message.react('🅰️');
    await message.react('🅱️');

    // wait for the react
    // use the react to create the proper prediction row
    const filter = (reaction, user) => {
      return ['1️⃣', '2️⃣', '🅰️', '🅱️'].includes(reaction.emoji.name) && user.id === msg.author.id;
    };

    const collector = message.createReactionCollector(filter, { max: 1, time: 60000 });
    collector.on('collect', async (reaction, reactionCollector) => {
      if (reaction.emoji.name === '1️⃣') {
        await message.reply(`You predicted that ${homeTeam.name} will beat ${awayTeam.name}.`);

        // save prediction
        predictionInfo.winning_team_id = homeTeam.id;
        await db.createPrediction(predictionInfo);

        return commandForName['predict'].execute(msg, args);
      } else if (reaction.emoji.name === '2️⃣') {
        await message.reply(`You predicted that ${awayTeam.name} will beat ${homeTeam.name}.`);

        // save prediction
        predictionInfo.winning_team_id = awayTeam.id;
        await db.createPrediction(predictionInfo);

        return commandForName['predict'].execute(msg, args);
      } else if (reaction.emoji.name === '🅰️') {
        // save prediction
        predictionInfo.winning_team_id = homeTeam.id;
        await db.createPrediction(predictionInfo);

        return message.reply(`You predicted that ${homeTeam.name} will beat ${awayTeam.name}.\n\`$reason ADD WORDS HERE\`: if you wish to explain why.\n\`$predict\`: if you didn't mean to do this and want to resume predicting`);
      } else if (reaction.emoji.name === '🅱️') {
        // save prediction
        predictionInfo.winning_team_id = awayTeam.id;
        await db.createPrediction(predictionInfo);

        return message.reply(`You predicted that ${awayTeam.name} will beat ${homeTeam.name}.\n\`$reason ADD WORDS HERE\`: if you wish to explain why.\n\`$predict\`: if you didn't mean to do this and want to resume predicting`);
      }
    });

    // await message.awaitReactions(filter, { max: 1, time: 60000, errors: ['time'] }).then((collected) => {
    //   console.log({collected})
    //   const reaction = collected.first();

    //   if (reaction.emoji.name === '1️⃣') {
    //     message.reply(`You predicted that ${homeTeam.name} will beat ${awayTeam.name}.`);

    //     predictionInfo.winning_team_id = homeTeam.id;

    //     // save prediction
    //     return db.createPrediction(predictionInfo);
    //   } else if (reaction.emoji.name === '2️⃣') {
    //     message.reply(`You predicted that ${awayTeam.name} will beat ${homeTeam.name}.`);

    //     predictionInfo.winning_team_id = awayTeam.id;

    //     // save prediction
    //     return db.createPrediction(predictionInfo);
    //   } else if (reaction.emoji.name === '🅰️') {
    //     predictionInfo.winning_team_id = homeTeam.id;
    //     db.createPrediction(predictionInfo);

    //     message.reply(`You predicted that ${homeTeam.name} will beat ${awayTeam.name}.\n\`$reason ADD WORDS HERE\`: if you wish to explain why.\n\`$predict\`: if you didn't mean to do this and want to resume predicting`);
    //     return false;
    //   } else if (reaction.emoji.name === '🅱️') {
    //     predictionInfo.winning_team_id = awayTeam.id;
    //     db.createPrediction(predictionInfo);

    //     message.reply(`You predicted that ${awayTeam.name} will beat ${homeTeam.name}.\n\`$reason ADD WORDS HERE\`: if you wish to explain why.\n\`$predict\`: if you didn't mean to do this and want to resume predicting`);
    //     return false;
    //   }
    // }).then((dontGoNext) => {
    //   if (dontGoNext === false) {
    //     return;
    //   }
    //   return commandForName['predict'].execute(msg, args);
    // }).catch((collected) => {
    //   // they did not react in time
    // });
  },
};

// $reason ADD WORDS HERE
commandForName['reason'] = {
  execute: async (msg, args) => {

    let user = await db.getUser(msg.author.id);
    if (!user || !user.id) {
      // they shouldnt be able to add a reason without having a user account
      return msg.reply('Something went wrong, you shouldn\'t be able to add a reason because you don\'t exist.');
    }

    // find the predictions this person has made, the most recent one should be first
    const predictions = await db.getPredictions(user.id);

    if (!predictions || predictions.length < 1) {
      return msg.reply('Something went wrong, you have no predictions to make a reason for.');
    }

    const prediction = predictions[0];

    if (!args || args.length < 1) {
      return msg.reply('Something went wrong, you can\'t provide an empty reason.');
    }

    const reason = args.join(' ');

    await db.addReason(prediction.id, reason);

    await msg.reply(`You added the following reason for ${prediction.winning_team_name} winning their round ${prediction.matchup_round} game:\n\`${reason}\``);

    return commandForName['predict'].execute(msg, args);
  }
};

// $teams [add] [teamname]
commandForName['teams'] = {
  admin: true,
  execute: async (msg, args) => {
    const action = args[0];

    if (!action) {
      const allTeams = await db.getTeams();

      const embed = new Discord.RichEmbed();
      embed.setColor('GOLD');
      embed.setDescription(allTeams.map((team) => team.name).join(', '));
      embed.setAuthor('Current teams');

      return msg.channel.send(embed);
    }

    if (!args || args.length < 1 || !['add', 'remove'].includes(action)) {
      return msg.channel.send('$teams [add] [teamname teamname]');
    }

    const teamNames = args.slice(1);
    const teams = await db.getTeams();

    if (action === 'add') {
      for (const teamName of teamNames) {
        const team = teams.find((team) => team.name.toLowerCase() === username.toLowerCase());

        if (!team) {
          await db.createTeam(teamName);
        }
      }

      const allTeams = await db.getTeams();

      const embed = new Discord.RichEmbed();
      embed.setColor('GOLD');
      embed.setDescription(allTeams.map((team) => team.name).join(', '));
      embed.setAuthor('Current teams');

      return msg.channel.send(embed);
    }
  },
};

// $matchups [add] [homename-awayname-round-order]
commandForName['matchups'] = {
  admin: true,
  execute: async (msg, args) => {
    const action = args[0];

    if (!args || args.length < 1 || !['add', 'remove'].includes(action)) {
      return msg.channel.send('$matchups [add] [homename-awayname-round-order]');
    }

    const matchups = args.slice(1);
    const teams = await db.getTeams();

    if (action === 'add') {
      for (const matchup of matchups) {
        const infoArray = matchup.split('-');

        const homeTeam = teams.find((team) => team.name.toLowerCase() === infoArray[0].toLowerCase());
        const awayTeam = teams.find((team) => team.name.toLowerCase() === infoArray[1].toLowerCase());

        await db.saveMatchup({
          home_id: homeTeam.id,
          away_id: awayTeam.id,
          round: infoArray[2],
          order_num: infoArray[3]
        });
      }

      return msg.channel.send('That probably worked');
    }
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

client.on('message', async (msg) => {
  try {
    if (!isWatchingChannel(msg.channel.id) && !(msg.channel instanceof Discord.DMChannel)) {
      return;
    }

    const content = msg.content;

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
      return await msg.reply('Only the owner can use that command');
    }

    const admin = await db.getAdmin(msg.author.id);
    if (command.admin && !admin) {
      return await msg.reply('Only admins can use that command');
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

client.login(process.env.BOT_TOKEN);
