require('dotenv').config();

const Discord = require('discord.js');
const client = new Discord.Client();

const PREFIX = '!';

const queuableRoles = [process.env.COACH, process.env.TIER_ONE, process.env.TIER_TWO, process.env.TIER_THREE, process.env.TIER_GRAD];
const emojiNumbers = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

let queues;

client.once('ready', async () => {
  queues = [];
  console.log('Ready!');
});

const commandForName = {};

// DFZ queue

/*
queue {
  tiers: [],
  playerIds: [],
  coachIds: [],
  readyUps: 0,
  state: 'queue', 'readyCheck', 'started', 'failed',
  region: ''
}
*/

commandForName['join'] = {
  execute: async (msg, args) => {
    if (msg.channel instanceof Discord.DMChannel) {
      return;
    }

    const authorTierRole = msg.member.roles.find((role) => queuableRoles.includes(role.id));

    if (!authorTierRole) {
      return msg.channel.send('Sorry, looks like you don\'t have the correct role to queue.');
    }

    // check if theres a queue to join
    for (const queue of queues) {
      if (queue.tiers.some((tier) => tier === authorTierRole.id)) {
        if (queue.playerIds.includes(msg.author.id)) {
          return msg.channel.send('You are already in a lobby.');
        }

        if (queue.playerIds.length >= 10) {
          continue;
        }

        queue.playerIds.push(msg.author.id);

        const tiersString = queue.tiers.map((tier) => {
          return `<@&${tier}>`;
        }).join(' ');

        const playersString = queue.playerIds.map((playerId) => {
          return `<@${playerId}>`;
        }).join(' ');

        await msg.react(emojiNumbers[queue.playerIds.length]);

        // send a dm to them explaining shit
        await msg.author.send('You just joined the queue for the lobby. When the 10th person joins the queue, the lobby will be ready. I will DM you again with a ready check to which you must react.\n\n**Similar to Dota\'s queue, you will have 2 minutes to ready up. If you miss this ready check you will be removed from the queue.**\n\nIf you accidentally joined or are not prepared to wait for a game, you can reply to me with `!leave` to leave the queue.');

        if (queue.playerIds.length >= 10) {
          // queue is full, begin the process
          queue.readyUps = [];
          queue.state = 'readyCheck';
          queue.resolutionCount = 0;

          // dm each player letting them know its time to ready up
          for (const playerId of queue.playerIds) {
            const user = client.users.get(playerId);

            const message = await user.send('**Your game is ready!**\nYou have 2 mins to ready up by reacting to this message.');
            await message.react('✅');
            await message.react('❌');

            const filter = (reaction, usr) => {
              return ['✅', '❌'].includes(reaction.emoji.name) && usr.id === user.id;
            };

            const collector = message.createReactionCollector(filter, { time: 90000 });
            collector.on('collect', async (reaction, reactionCollector) => {
              if (reaction.emoji.name === '✅') {
                // another player ready
                queue.readyUps.push(playerId);

                // all players ready
                if (queue.readyUps.length >= 10) {
                  queue.state = 'started';
                  await msg.channel.send(`Lobby started! ${playersString}`);
                }

                collector.stop();
              } else if (reaction.emoji.name === '❌') {
                queue.resolutionCount++;
                collector.stop();
              }
            });

            collector.on('end', async (collected, reason) => {
              queue.resolutionCount++;

              if (queue.resolutionCount >= 10) {
                // all done, lets check the state and readyUps

                if (queue.state === 'started') {
                  // do nothing?
                } else {
                  // ready check failed
                  queue.playerIds = queue.readyUps;
                  queue.readyUps = [];
                  queue.state = 'queue'

                  await msg.channel.send('Ready check failed, queue has been restarted.')

                  const e = new Discord.RichEmbed();
                  e.setColor('GOLD');
                  e.setDescription(`${tiersString}\n\nPlayers:\n${queue.playerIds.map((playerId) => {
                    return `<@${playerId}>`;
                  }).join(' ')}`);
                  e.setAuthor(`${queue.region} Lobby - ${queue.playerIds.length}/10`);
                  await msg.channel.send(e);
                }
              }
            });
          }
        }

        // make sure we dont loop through all the queues
        return;
      }
    }

    // if we get here there wasnt a queue to join
    if (queues.length > 0) {
      return msg.channel.send('Sorry, looks like there was no lobby for your tier.\nYou can ask a coach to start one.');
    }
  }
}

commandForName['leave'] = {
  execute: async (msg, args) => {
    for (const queue of queues) {
      queue.playerIds = queue.playerIds.filter((playerId) => {
        return playerId !== msg.author.id;
      });
    }

    msg.channel.send('You have been removed from the queue.');
  }
}

// $lobby [add/remove/view] [region] [1 2 3 4]
commandForName['lobby'] = {
  execute: async (msg, args) => {

    //cleanup old lobbies
    queues = queues.filter((queue) => {
      return ['queue', 'readyCheck'].includes(queue.state);
    });

    if (msg.channel instanceof Discord.DMChannel) {
      return;
    }

    const action = args[0];

    if (!action || action === 'view') {
      if (queues.length < 1) {
        return msg.channel.send('No lobbies found.');
      }

      // show all the queues
      for (const queue of queues) {
        const tiersString = queue.tiers.map((tier) => {
          return `<@&${tier}>`;
        }).join(' ');

        const playersString = queue.playerIds.map((playerId) => {
          return `<@${playerId}>`;
        }).join(' ');

        const embed = new Discord.RichEmbed();
        embed.setColor('GOLD');
        embed.setDescription(`${tiersString}\n\nPlayers:\n${playersString}`);
        embed.setAuthor(`${queue.region} Lobby - ${queue.playerIds.length}/10`);

        await msg.channel.send(embed);
      }
      return;
    }

    const isCoach = msg.member.roles.some((role) => role.id === process.env.COACH);

    if (!isCoach && msg.channel.id !== process.env.DFZ_COACHES_CHANNEL) {
      return msg.channel.send('Sorry, only coaches can manage lobbies.');
    }

    // parse tiers
    const region = args[1];

    // gross
    let tierString;
    if (action === 'add') {
      tiersString = args.slice(2);
    } else if (action === 'remove') {
      tiersString = args.slice(1);
    }

    const tiers = [];
    for (const tierString of tiersString) {
      const tier = parseInt(tierString);

      if (isNaN(tier) || tier < 1 || tier > 4) {
        return msg.channel.send('Sorry, wrong format for command');
      }

      tiers.push(queuableRoles[tier]);
    }

    if (action === 'add') {
      queues.push({
        tiers,
        playerIds: [],
        coachIds: [msg.author.id],
        state: 'queue',
        region
      });

      const tiersEmbed = tiers.map((tier) => {
        return `<@&${tier}>`;
      }).join(' ');

      const embed = new Discord.RichEmbed();
      embed.setColor('GOLD');
      embed.setDescription(`${tiersEmbed}\n\nPlayers:\n`);
      embed.setAuthor(`${region} Lobby - 0/10`);

      return msg.channel.send(embed);
    } else if (action === 'remove') {
      // look for a queue with the same tiers
      // use a shitty array equals for simplicity
      for (let i = 0; i < queues.length; i++) {
        if (JSON.stringify(queues[i].tiers) === JSON.stringify(tiers)) {
          queues.splice(i, 1);
          break;
        }
      }
      return msg.channel.send('Lobby removed.');
    } else {
      return msg.channel.send('Sorry, wrong format for command');
    }
  }
}

commandForName['help'] = {
  execute: async (msg, args) => {
    const embed = new Discord.RichEmbed();
    embed.setColor('GOLD');
    embed.setDescription('This bot is here to help players organize lobbies outside the scheduled times. Similar to the normal dota queue you can join a queue and wait for enough players. When 10 people have queued up, a DM will be sent to each player as a ready check. You have 2 mins to ready up. Once all players have readied up, the bot will tag all the players and it\'s up to them to start the lobby.');
    embed.setAuthor(`Lobby Bot`);

    embed.addField('!join', 'Join the lobby, dictated by your tier. If no lobby exists this will do nothing.');
    embed.addField('!lobby [add/remove/view/ ] [region] [1 3]', "Only coaches can start a lobby (for now). Commands for starting, stopping and viewing the current lobbies.\n`!lobby add NA 1 3` - starts a lobby for tiers 1 and 3\n`!lobby remove 1 3` - removes the lobby for tiers 1 and 3\n`!lobby` or `!lobby view` - view the current lobbies");
    embed.addField('!leave', 'Removes yourself from all lobbies. You can DM the bot if you\'re timed out from the lobby chat.');

    return msg.channel.send(embed);
  }
}

function isOwner (userId) {
  return userId === process.env.OWNER_DISCORD_ID;
}

function isWatchingChannel (discord_id) {
  return (
    process.env.DFZ_LOBBY_CHANNEL === discord_id ||
    process.env.DFZ_COACHES_CHANNEL === discord_id
  );
}

client.on('message', async (msg) => {
  try {
    // not watching and not a dm
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

    // Separate the command arguments from the command prefix and name.
    const args = parts.slice(1);

    // Execute the command.
    await command.execute(msg, args);
  } catch (err) {
    console.warn('Error handling message create event');
    console.warn(err);
  }
});

// client.login(process.env.LOBBY_BOT_TOKEN);

module.exports.client = client;
