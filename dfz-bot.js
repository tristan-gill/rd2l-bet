require('dotenv').config();

const Discord = require('discord.js');
const client = new Discord.Client();
const moment = require('moment');

const PREFIX = '!';

const queuableRoles = [process.env.COACH, process.env.TIER_ONE, process.env.TIER_TWO, process.env.TIER_THREE, process.env.TIER_FOUR, process.env.TIER_GRAD];
const emojiNumbers = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const voiceChannels = [process.env.DFZ_VC_1, process.env.DFZ_VC_2, process.env.DFZ_VC_3, process.env.DFZ_VC_4];

let queues, lobbies;

client.once('ready', async () => {
  queues = [];
  lobbies = [];
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

    if (msg.channel.id !== process.env.DFZ_UNOFFICIAL_LOBBY) {
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
          return msg.channel.send('You are already in a queue.');
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
        await msg.author.send('You just joined the queue. When the 10th person joins the queue, the game will be ready. I will DM you again with a ready check to which you must react.\n\n**Similar to Dota\'s queue, you will have 5 minutes to ready up. If you miss this ready check you will be removed from the queue.**\n\nIf you accidentally joined or are not prepared to wait for a game, you can reply to me with `!leave` to leave the queue.');

        if (queue.playerIds.length >= 10) {
          // queue is full, begin the process
          queue.readyUps = [];
          queue.state = 'readyCheck';
          queue.resolutionCount = 0;

          // dm each player letting them know its time to ready up
          for (const playerId of queue.playerIds) {
            const user = client.users.get(playerId);

            const message = await user.send('**Your game is ready!**\nYou have 5 mins to ready up by reacting to this message.');
            await message.react('✅');
            await message.react('❌');

            const filter = (reaction, usr) => {
              return ['✅', '❌'].includes(reaction.emoji.name) && usr.id === user.id;
            };

            const collector = message.createReactionCollector(filter, { time: 150000 });
            collector.on('collect', async (reaction, reactionCollector) => {
              if (reaction.emoji.name === '✅') {
                // another player ready
                queue.readyUps.push(playerId);

                // all players ready
                if (queue.readyUps.length >= 10) {
                  queue.state = 'started';
                  await msg.channel.send(`Game started! ${playersString}`);
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
                  e.setAuthor(`${queue.region} Queue - ${queue.playerIds.length}/10`);
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
      return msg.channel.send('Sorry, looks like there was no queue for your tier.\nYou can ask a coach to start one or do it yourself.');
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

// $queue [add/remove/view] [region] [1 2 3 4]
commandForName['queue'] = {
  execute: async (msg, args) => {

    //cleanup old lobbies
    queues = queues.filter((queue) => {
      return ['queue', 'readyCheck'].includes(queue.state);
    });

    if (msg.channel instanceof Discord.DMChannel) {
      return;
    }

    const action = args[0];
    const isCoach = msg.member.roles.some((role) => role.id === process.env.COACH);

    if (![process.env.DFZ_UNOFFICIAL_LOBBY, process.env.DFZ_COACHES_CHANNEL].includes(msg.channel.id)) {
      return;
    }

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
        embed.setAuthor(`${queue.region} Queue - ${queue.playerIds.length}/10`);

        await msg.channel.send(embed);
      }
      return;
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

      if (isNaN(tier) || tier < 1 || tier > 5) {
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
      embed.setAuthor(`${region} Queue - 0/10`);

      return msg.channel.send(embed);
    } else if (action === 'remove') {
      // look for a queue with the same tiers
      // use a shitty array equals for simplicity
      for (let i = 0; i < queues.length; i++) {
        if (JSON.stringify(queues[i].tiers) === JSON.stringify(tiers)) {
          queues.splice(i, 1);
          return msg.channel.send('Queue removed.');
        }
      }
    } else {
      return msg.channel.send('Sorry, wrong format for command');
    }
  }
}

commandForName['dfzbot'] = {
  execute: async (msg, args) => {
    const embed = new Discord.RichEmbed();
    embed.setColor('GOLD');
    embed.setDescription('This bot is here to help players organize games outside the scheduled times. Two separate functions, unofficial queues and official lobby posts. \n**Unofficial queues**: similar to the normal dota queue you can join a queue and wait for enough players. When 10 people have queued up, a DM will be sent to each player as a ready check. You have 5 mins to ready up. Once all players have readied up, the bot will tag all the players and it\'s up to them to start a lobby.\n**Official posts**: The bot makes a post with reactions, players sign up for the lobby by reacting with the roles they like. Coaches can print a sorted list of players and send a "game time" dm to each player.');
    embed.setAuthor(`Lobby Bot`);

    embed.addField('Unofficial queue commands', 'These three commands are for managing the queues in the unofficial lobby chat.');
    embed.addField('!join', 'Unofficial: join the queue, dictated by your tier. If no queue exists this will do nothing.');
    embed.addField('!queue [add/remove/view/ ] [region] [1 3]', "Unofficial: commands for starting, stopping and viewing the current queues.\n`!queue add NA 1 3` - starts a queue for tiers 1 and 3\n`!queue remove 1 3` - removes the queue for tiers 1 and 3\n`!queue` or `!queue view` - view the current queues");
    embed.addField('!leave', 'Unofficial: Removes yourself from all queues. You can DM the bot this.');

    embed.addField('!post', 'Official: adds a new post with the text and tiers specified.\n`!post 123 NA Lobby` - creates a post for Tiers 1, 2 and 3 with the title "NA Lobby"');

    return msg.channel.send(embed);
  }
}

/*
lobby = {
  fields: [[]]
  players: []
  tiers: []
  locked: false
}

player = {
  id
  joinTime
  tierNumber
  roles
}
*/

//!post 12345 [NA 9:00pm EDT]
commandForName['post'] = {
  execute: async (msg, args) => {
    if (msg.channel instanceof Discord.DMChannel) {
      return;
    }
    const isCoach = msg.member.roles.some((role) => role.id === process.env.COACH);
    if (!isCoach && msg.channel.id !== process.env.DFZ_COACHES_CHANNEL) {
      return msg.channel.send('Sorry, only coaches can manage this.');
    }

    const tiersJoined = args[0];
    const freeText = args.slice(1).join(' ');

    const tiers = [];
    for (const tierString of tiersJoined) {
      const tier = parseInt(tierString);
      if (isNaN(tier) || tier < 1 || tier > 5) {
        return msg.channel.send('Incorrect format: \`!post 12345 [free text fields]\`');
      }

      tiers.push(queuableRoles[tier]);
    }

    const lobby = {
      fields: [
        []
      ],
      tiers,
      text: freeText,
      locked: false
    };

    const channel = await client.channels.get(process.env.DFZ_LOBBY_CHANNEL);

    const tiersString = tiers.map((tier) => {
      return `<@&${tier}>`;
    }).join(' ');

    await channel.send(`**New scheduled lobby!**\nReact to the message below with the number(s) corresponding to the roles you would like to play.\n${tiersString}`);

    const embed = generateEmbed(lobby);
    const message = await channel.send(embed);

    lobby.id = message.id;

    lobbies.push(lobby);

    await message.react('1️⃣');
    await message.react('2️⃣');
    await message.react('3️⃣');
    await message.react('4️⃣');
    await message.react('5️⃣');
    await message.react('✅');
    await message.react('🗒️');
    await message.react('🔒');
  }
}

function getPostPrintString (lobby) {
  const lobbyStrings = [];

  for (let j = 0; j < lobby.fields.length; j++) {
    const players = [...lobby.fields[j]];

    lobbyStrings.push(`**Lobby ${j+1}**\n`);

    players.sort((a, b) => {
      const aTier = queuableRoles.indexOf(a.tierId);
      const bTier = queuableRoles.indexOf(b.tierId);

      if (aTier === bTier) {
        const aNumRoles = a.roles.length;
        const bNumRoles = b.roles.length;

        if (aNumRoles === bNumRoles) {
          return a.roles[0] - b.roles[0];
        } else {
          return aNumRoles - bNumRoles;
        }
      } else {
        return bTier - aTier;
      }
    });

    const playersRoleBox = players.map((player) => {
      const rolesArray = [];
      for (let i = 1; i <= 5; i++) {
        rolesArray.push(`${player.roles.includes(i) ? i : ' '}`)
      }

      const rolesString = rolesArray.join(' ');

      return `\`${rolesString}\`|\`T${queuableRoles.indexOf(player.tierId)}\` <@!${player.id}>`;
    }).join('\n');

    lobbyStrings.push(`${playersRoleBox}\n`);
  }

  return lobbyStrings.join('');
}

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) {
    return;
  }

  const lobby = lobbies.find((lobby) => lobby.id === reaction.message.id);

  if (!lobby) {
    return;
  }

  const guildUser = await reaction.message.channel.guild.fetchMember(user.id);
  const tier = guildUser.roles.find((role) => queuableRoles.includes(role.id));

  // if is a coach
  const isCoach = guildUser.roles.some((role) => role.id === process.env.COACH);
  const isAdmin = guildUser.roles.some((role) => role.id === process.env.DFZ_ADMIN);

  if (isCoach || isAdmin) {
    if (reaction.emoji.name === '✅') {
      // remind
      let lobbyNumber = lobbies.indexOf(lobby) + 1;

      if (lobbyNumber === 2 && lobbies[0].fields.length > 1 && lobbies[0].fields[1].length >= 10) {
        lobbyNumber++;
      }

      for (let l = 0; l < lobby.fields.length; l++) {
        if (lobby.fields[l].length >= 10) {
          // soft cap on three vc rooms
          const voiceChannelIndex = Math.min(voiceChannels.length, lobbyNumber + l) - 1;
          const voiceChannel = await client.channels.get(voiceChannels[voiceChannelIndex]).createInvite();

          await user.send(`**Lobby reminder!**\nHead over to the voice channel: ${voiceChannel.url}`);

          for (const player of lobby.fields[l]) {
            const u = client.users.get(player.id);
            await u.send(`**Lobby reminder!**\nHead over to the voice channel: ${voiceChannel.url}`);
          }
        }
      }

      return reaction.remove(user);
    } else if (reaction.emoji.name === '🗒️') {
      // print
      await user.send(getPostPrintString(lobby));
      return reaction.remove(user);
    } else if (reaction.emoji.name === '🔒') {
      // lock future reactions
      lobby.locked = !lobby.locked;

      const embed = generateEmbed(lobby);
      await reaction.message.edit(embed);

      return reaction.remove(user);
    } else {
      return reaction.remove(user);
    }
  }

  if (!tier || !lobby.tiers.includes(tier.id)) {
    console.log('wrong tier breh')
    return reaction.remove(user);
  }

  const positionNumber = emojiNumbers.indexOf(reaction.emoji.name);

  if (positionNumber < 1 || positionNumber > 5) {
    console.log('wrong reaction')
    return reaction.remove(user);
  }

  if (!lobby) {
    return reaction.remove(user);
  }

  if (lobby.locked) {
    return reaction.remove(user);
  }

  // if already signed up, update roles
  for (const players of lobby.fields) {
    const player = players.find((player) => player.id === user.id);

    if (player) {
      if (player.roles.includes(positionNumber)) {
        // do nothing? this shouldnt happen
        return;
      } else {
        return player.roles.push(positionNumber);
      }
    }
  }

  // not yet signed up, add them
  await addToLobby(lobby, user, reaction, tier, positionNumber);
});

// no nice event handler for reaction removal, raw looks at all discord events
client.on('raw', async (event) => {
  if (event.t === 'MESSAGE_REACTION_REMOVE') {
    const { d: data } = event;

    const user = client.users.get(data.user_id);

    if (user.bot || !isWatchingChannel(data.channel_id)) {
      return;
    }

    const lobby = lobbies.find((lobby) => lobby.id === data.message_id);

    if (!lobby) {
      return;
    }

    const message = await client.channels.get(process.env.DFZ_LOBBY_CHANNEL).fetchMessage(data.message_id);
    const positionNumber = emojiNumbers.indexOf(data.emoji.name);

    if (positionNumber < 1 || positionNumber > 5) {
      console.log('wrong reaction')
      return;
    }

    // find the user
    for (const players of lobby.fields) {
      const player = players.find((player) => player.id === user.id);

      if (player) {
        player.roles = player.roles.filter((posNum) => posNum !== positionNumber);

        if (player.roles.length < 1) {
          // remove the user from this lobby
          await removeFromLobby(lobby, user, message);
        }

        return;
      }
    }
  }
});

async function addToLobby (lobby, user, reaction, tier, positionNumber) {
  const player = {
    id: user.id,
    tierId: tier.id,
    signupTime: moment(),
    roles: [positionNumber]
  };

  // which field they are going into
  let fieldIndex = lobby.fields.findIndex((playerList) => playerList.length < 10);

  if (fieldIndex < 0) {
    // need a new field for this person
    lobby.fields.push([]);

    fieldIndex = lobby.fields.length - 1;
  }

  // if this field has 9 players in it, sort it, and the previous fields
  const sortFields = lobby.fields[fieldIndex].length === 9;

  lobby.fields[fieldIndex].push(player);

  if (sortFields) {
    const allPlayers = [];
    for (let i = 0; i <= fieldIndex; i++) {
      allPlayers.push(...lobby.fields[i]);
    }

    allPlayers.sort((a, b) => {
      return queuableRoles.indexOf(a.tierId) - queuableRoles.indexOf(b.tierId);
    });

    const newFields = [];
    for (let i = 0; i < allPlayers.length; i += 10) {
      newFields.push(allPlayers.slice(i, i + 10));
    }

    lobby.fields = newFields;
  }

  const embed = generateEmbed(lobby);
  await reaction.message.edit(embed);
}

async function removeFromLobby (lobby, user, message) {
  // re-sort the whole thing by signup time, let add function handle tier sorting
  const allPlayers = [];
  for (let i = 0; i < lobby.fields.length; i++) {
    allPlayers.push(...lobby.fields[i]);
  }

  const index = allPlayers.findIndex((player) => player.id === user.id);
  allPlayers.splice(index, 1);

  allPlayers.sort((a, b) => {
    if (a.signupTime.isBefore(b.signupTime)) {
      return -1;
    }
    return 1;
  });

  const newFields = [];
  if (allPlayers.length === 0) {
    lobby.fields = [[]];
  } else {
    for (let i = 0; i < allPlayers.length; i += 10) {
      newFields.push(allPlayers.slice(i, i + 10));
    }

    lobby.fields = newFields;
  }

  const embed = generateEmbed(lobby);
  await message.edit(embed);
}

function generateEmbed (lobby) {
  let playerCount = 0;
  for (const playerList of lobby.fields) {
    playerCount += playerList.length;
  }

  const tiersString = lobby.tiers.map((tier) => {
    return `<@&${tier}>`;
  }).join(' ');

  const lockedString = lobby.locked ? '🔒 ' : '';

  const embed = new Discord.RichEmbed();
  embed.setColor('GOLD');
  embed.setAuthor(`${lockedString}${lobby.text} - (${playerCount})`);
  embed.setDescription(`Tiers: ${tiersString}`);

  for (let i = 0; i < lobby.fields.length; i++) {
    if (lobby.fields[i].length < 1) {
      embed.addField(`Lobby ${i+1}`, '-');
    } else {
      const playersString = lobby.fields[i].map((player) => {
        return `<@${player.id}>`;
      }).join(' ');

      embed.addField(`Lobby ${i+1}`, playersString);
    }
  }

  return embed;
}

function isOwner (userId) {
  return userId === process.env.OWNER_DISCORD_ID;
}

function isWatchingChannel (discord_id) {
  return (
    process.env.DFZ_LOBBY_CHANNEL === discord_id ||
    process.env.DFZ_COACHES_CHANNEL === discord_id ||
    process.env.DFZ_UNOFFICIAL_LOBBY === discord_id
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

module.exports.client = client;
