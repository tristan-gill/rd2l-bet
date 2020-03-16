require('dotenv').config();

const Discord = require('discord.js');
const client = new Discord.Client();
const fs = require("fs");
const db = require('./query');
const express = require('express');
const stats = require('./stats');

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


// **** Stats ****

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

    // 2 is est

    // $stats 11608 1579568400 1579590000 2 631605827337191426
    const s = await stats.getStats(args[0], args[1], args[2], args[3]);

    const channel = client.channels.get(args[4]);
    if (channel) {
      for (const embedInfo of s) {
        const embed = new Discord.RichEmbed();
        embed.setColor('GOLD');
        embed.setDescription(embedInfo.description);
        embed.setAuthor(embedInfo.author.name);
        embed.setThumbnail(embedInfo.thumbnail.url);
        embed.setURL(embedInfo.url);
        embed.setFooter(embedInfo.footer.text, embedInfo.footer.icon_url);

        channel.send(embed);
      }
    }
  },
};


// **** Predictions ****

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

    const collector = message.createReactionCollector(filter, { time: 60000 });
    collector.on('collect', async (reaction, reactionCollector) => {
      if (reaction.emoji.name === '1️⃣') {
        await message.reply(`You predicted that ${homeTeam.name} will beat ${awayTeam.name}.`);

        // save prediction
        predictionInfo.winning_team_id = homeTeam.id;
        await db.createPrediction(predictionInfo);

        collector.stop();
        return commandForName['predict'].execute(msg, args);
      } else if (reaction.emoji.name === '2️⃣') {
        await message.reply(`You predicted that ${awayTeam.name} will beat ${homeTeam.name}.`);

        // save prediction
        predictionInfo.winning_team_id = awayTeam.id;
        await db.createPrediction(predictionInfo);

        collector.stop();
        return commandForName['predict'].execute(msg, args);
      } else if (reaction.emoji.name === '🅰️') {
        // save prediction
        predictionInfo.winning_team_id = homeTeam.id;
        await db.createPrediction(predictionInfo);

        collector.stop();
        return message.reply(`You predicted that ${homeTeam.name} will beat ${awayTeam.name}.\n\`$reason ADD WORDS HERE\`: if you wish to explain why.\n\`$predict\`: if you didn't mean to do this and want to resume predicting`);
      } else if (reaction.emoji.name === '🅱️') {
        // save prediction
        predictionInfo.winning_team_id = awayTeam.id;
        await db.createPrediction(predictionInfo);

        collector.stop();
        return message.reply(`You predicted that ${awayTeam.name} will beat ${homeTeam.name}.\n\`$reason ADD WORDS HERE\`: if you wish to explain why.\n\`$predict\`: if you didn't mean to do this and want to resume predicting`);
      }
    });
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
        const team = teams.find((team) => team.name.toLowerCase() === teamName.toLowerCase());

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

// $results [add/] [winningteamname round order]
commandForName['results'] = {
  admin: true,
  execute: async (msg, args) => {
    const action = args[0];

    if (!args || args.length < 4 || !['add'].includes(action)) {
      return msg.channel.send('$results [add] [winningteamname] [round] [order]');
    }

    const winningTeamName = args[1];
    const round = args[2];
    const order = args[3];

    if (!winningTeamName || !round || !order) {
      return msg.channel.send('$results [add] [winningteamname] [round] [order]');
    }

    const teams = await db.getTeams();

    const winningTeam = teams.find((team) => team.name.toLowerCase() === winningTeamName.toLowerCase());

    if (!winningTeam) {
      await msg.channel.send(`I can't find a team name like this: ${winningTeamName}.`);
      // return teams list
      return commandForName['teams'].execute(msg, []);
    }

    const currentResults = await db.getAllResults();

    if (currentResults.find((r) => r.winning_team_id === winningTeam.id)) {
      // this result is already defined
    } else {
      //save result
      await db.createResult({
        matchup_round: round,
        matchup_order_num: order,
        winning_team_id: winningTeam.id
      });
    }

    // get matches for this round and order
    const predictionsForThisResult = await db.getPredictionsFor(order, round);

    const correctPredictions = [];
    const wrongPredictions = [];
    const reasons = [];

    for (const prediction of predictionsForThisResult) {
      console.log({prediction})
      if (prediction.winning_team_id === winningTeam.id) {
        correctPredictions.push(prediction);
      } else {
        wrongPredictions.push(prediction);
      }

      if (prediction.reason) {
        reasons.push(`**${prediction.predictor_name}:** ${prediction.reason}`);
      }
    }
    console.log({reasons})

    const embed = new Discord.RichEmbed();
    embed.setColor('GOLD');
    embed.setAuthor('Results');

    const correct = correctPredictions.length ?
      correctPredictions.map((p) => {
        return p.predictor_name;
      }).join(', ') :
      '-' ;
    embed.addField('Correct', correct);

    const incorrect = wrongPredictions.length ?
      wrongPredictions.map((p) => {
        return p.predictor_name;
      }).join(', ') :
      '-';
    embed.addField('Incorrect', incorrect);
    embed.addField('Predictions', reasons.length ? reasons.join('\n') : '-');

    return msg.channel.send(embed);
  }
};

// $record [empty/@user]
commandForName['record'] = {
  execute: async (msg, args) => {
    const mention = msg.mentions.users.first();

    let user;
    if (!mention) {
      // self stats
      user = await db.getUser(msg.author.id);
    } else {
      user = await db.getUser(mention.id);
    }

    if (!user || !user.id) {
      return msg.channel.send('Who dat.');
    }

    const records = await db.getRecordsForUser(user.id);

    const numExpectedPredictions = Math.pow(2, server_num_rounds) - 1;

    if (records.length !== numExpectedPredictions) {
      return msg.channel.send(`${user.username} has yet to complete their bracket predictions.`)
    }

    let correctCount = 0;
    let completeCount = 0;
    let overallWinnerName;
    for (const record of records) {
      if (record.result_id) {
        completeCount++;

        if (record.predicted_winner_id === record.actual_winner_id) {
          correctCount++;
        }
      }

      if (record.matchup_round === server_num_rounds) {
        overallWinnerName = record.predicted_winner_name;
      }
    }

    return msg.channel.send(`**${user.username}**: correctly predicted ${correctCount} / ${completeCount} completed games.\nTheir overall winner is: ${overallWinnerName}`);
  }
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
