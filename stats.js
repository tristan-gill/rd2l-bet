const db = require('./query');
const axios = require('axios');
const rateLimit = require('axios-rate-limit');

const Pool = require('pg').Pool;
const pool = new Pool({
  connectionString: process.env.HEROKU_POSTGRESQL_ONYX_URL,
  ssl: true
})

const stratz = axios.create({
  baseURL: 'https://api.stratz.com/api/v1',
  timeout: 10000
});
stratz.interceptors.response.use(r => r.data, err => Promise.reject(err));

const opendota = rateLimit(axios.create({
    baseURL: 'https://api.opendota.com/api',
    timeout: 10000
}), { maxRequests: 1, perMilliseconds: 2000});
opendota.interceptors.response.use(r => r.data, err => Promise.reject(err));

const getStratzMatches = async (leagueId, skip) => {
  return stratz.get(`/league/${leagueId}/matches`, {
    params: {
      include: 'Player,Team',
      take: 50,
      skip
    }
  });
}

const getAllMatches = async (leagueId) => {
  let fetched = 0;
  const savedMatches = await getAllMatchIds(leagueId);

  console.log('Fetching first batch');
  let matches = await getStratzMatches(leagueId, 0);
  fetched += 50;
  // console.log(JSON.stringify(matches))

  while (matches.length >= fetched) {
    console.log('Fetching next batch');
    matches.push(...(await getStratzMatches(leagueId, fetched)));
    fetched += 50;
  }
  console.log(`Total league matches: ${matches.length}`)

  const newMatches = matches.filter((match) => {
    return !Object.prototype.hasOwnProperty.call(savedMatches, match.id);
  });

  const client = await pool.connect();

  for (const newMatch of newMatches) {
    try {
    const match = await opendota.get(`/matches/${newMatch.id}`);

    let stratzMatch = matches.find(stratz => stratz.id == match.match_id);
    match.players.forEach(player => {
      player.steamAccount = stratzMatch.players.find(stratz => stratz.steamId == player.account_id).steamAccount;
    });
    match.regionId = stratzMatch.regionId;
    match.startDateTime = stratzMatch.startDateTime;
    match.endDateTime = stratzMatch.endDateTime;
    match.durationSeconds = stratzMatch.durationSeconds;
    match.direTeam = stratzMatch.direTeam;
    match.radiantTeam = stratzMatch.radiantTeam;

    await processMatch(match, client);
    console.log('done: ', match.match_id);
    } catch(e) {
      console.log('error:', newMatch.id)
    }

  }
}

const processMatch = async (match, client) => {
  const m = {
    id: match.match_id,
    dire_score: match.dire_score,
    dire_team_id: match.dire_team_id,
    duration: match.duration,
    radiant_gold_adv: match.radiant_gold_adv,
    radiant_score: match.radiant_score,
    radiant_win: match.radiant_win,
    radiant_team_id: match.radiant_team_id,
    radiant_xp_adv: match.radiant_xp_adv,
    region: match.region,
    start_time: match.startDateTime,
    radiant_team_name: match.radiantTeam.name,
    dire_team_name: match.direTeam.name,
    league_id: match.leagueid
  };
  await saveMatch(m, client);

  // save players
  for (const player of match.players) {
    const p = {
      id: player.steamAccount.id,
      profile_uri: player.steamAccount.profileUri,
      name: player.steamAccount.name,
      avatar: player.steamAccount.avatar
    };

    const mp = {
      matches_id: match.match_id,
      assists: player.assists,
      camps_stacked: player.camps_stacked,
      deaths: player.deaths,
      denies: player.denies,
      kills: player.kills,
      last_hits: player.last_hits,
      obs_placed: player.obs_placed,
      sen_placed: player.sen_placed,
      tower_damage: player.tower_damage,
      xp_per_min: player.xp_per_min,
      observer_kills: player.observer_kills,
      life_state_dead: player.life_state_dead,
      gold_per_min: player.benchmarks.gold_per_min.raw,
      hero_damage: player.hero_damage,
      hero_healing_per_min: player.benchmarks.hero_healing_per_min.raw,
      heroes_id: player.hero_id,
      players_id: player.steamAccount.id,
      win: player.win
    };

    await savePlayer(p, client);
    await saveMatchPlayer(mp, client);
  }
}

const getAllMatchIds = async (leagueId) => {
  const matchIds = {};

  const query = `
    select id from matches;
  `;

  const response = await pool.query(query);

  for (const row of response.rows) {
    matchIds[row.id] = true;
  }

  return matchIds;
}

const saveMatches = async (matches) => {
  const client = await pool.connect();

  for (const match of matches) {
    // save match
    const m = {
      id: match.match_id,
      dire_score: match.dire_score,
      dire_team_id: match.dire_team_id,
      duration: match.duration,
      radiant_gold_adv: match.radiant_gold_adv,
      radiant_score: match.radiant_score,
      radiant_win: match.radiant_win,
      radiant_team_id: match.radiant_team_id,
      radiant_xp_adv: match.radiant_xp_adv,
      region: match.region,
      start_time: match.startDateTime,
      radiant_team_name: match.radiantTeam.name,
      dire_team_name: match.direTeam.name,
      league_id: match.leagueid
    };
    await saveMatch(m, client);

    // save players
    for (const player of match.players) {
      const p = {
        id: player.steamAccount.id,
        profile_uri: player.steamAccount.profileUri,
        name: player.steamAccount.name,
        avatar: player.steamAccount.avatar
      };

      const mp = {
        matches_id: match.match_id,
        assists: player.assists,
        camps_stacked: player.camps_stacked,
        deaths: player.deaths,
        denies: player.denies,
        kills: player.kills,
        last_hits: player.last_hits,
        obs_placed: player.obs_placed,
        sen_placed: player.sen_placed,
        tower_damage: player.tower_damage,
        xp_per_min: player.xp_per_min,
        observer_kills: player.observer_kills,
        life_state_dead: player.life_state_dead,
        gold_per_min: player.benchmarks.gold_per_min.raw,
        hero_damage: player.hero_damage,
        hero_healing_per_min: player.benchmarks.hero_healing_per_min.raw,
        heroes_id: player.hero_id,
        players_id: player.steamAccount.id
      };

      await savePlayer(p, client);
      await saveMatchPlayer(mp, client);
    }
  }

  client.release();
}

const saveMatch = async (match, client) => {
  const text = `
    insert into matches(id, dire_score, dire_team_id, duration, radiant_gold_adv, radiant_score, radiant_win, radiant_team_id, radiant_xp_adv, region, start_time, radiant_team_name, dire_team_name, league_id)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    on conflict on constraint matches_pkey
    do nothing;
  `;
  const values = Object.values(match);
  await client.query(text, values)
}

const savePlayer = async (player, client) => {
  const text = `
    insert into players(id, profile_uri, name, avatar)
    values ($1, $2, $3, $4)
    on conflict on constraint players_pkey
    do
      update
      set profile_uri = $2, name = $3, avatar = $4;
  `;
  const values = Object.values(player);
  await client.query(text, values)
}

const saveMatchPlayer = async (matchPlayer, client) => {
  const text = `
    insert into matches_players(matches_id, assists, camps_stacked, deaths, denies, kills, last_hits, obs_placed, sen_placed, tower_damage, xp_per_min, observer_kills, life_state_dead, gold_per_min, hero_damage, hero_healing_per_min, heroes_id, players_id, win)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    on conflict on constraint matches_players_pkey
    do nothing;
  `;

  const values = Object.values(matchPlayer);
  await client.query(text, values);
}

const getMatches = async (league_id, start_time, end_time, region) => {
  let regionString = '';
  if (region !== '-') {
    regionString = `and region = ${region}`;
  }
  const query = `
    select
      matches.id as match_id,
      duration,
      assists,
      camps_stacked,
      deaths,
      denies,
      kills,
      last_hits,
      tower_damage,
      xp_per_min,
      observer_kills,
      life_state_dead,
      gold_per_min,
      hero_damage,
      hero_healing_per_min,
      players_id,
      profile_uri,
      players.name as players_name,
      avatar,
      heroes.name as heroes_name,
      picture,
      win
    from matches
    inner join matches_players on
      matches_players.matches_id = matches.id
    inner join players on
      matches_players.players_id = players.id
    inner join heroes on heroes.id = matches_players.heroes_id
    where league_id = ${league_id}
      and start_time between ${start_time} and ${end_time}
      ${regionString};
  `;

  const response = await pool.query(query);

  return response.rows;
}

const getStatsFromMatches = async (matches) => {
  // kills per minute
  const kpm = {
      value: 0,
      match_id: null,
      player_id: null
  };

  //last hits per minute
  const lhpm = {
      value: 0,
      match_id: null,
      player_id: null
  }

  // hero damage per min
  const dpm = {
      value: 0,
      match_id: null,
      player_id: null
  };

  // hero healing per min
  const hpm = {
      value: 0,
      match_id: null,
      player_id: null
  };

  const timeDead = {
      value: 0,
      percent: 0,
      match_id: null,
      player_id: null
  }

  const towerDamage = {
      value: 0,
      match_id: null,
      player_id: null
  }

  const gpm = {
      value: 0,
      match_id: null,
      player_id: null
  }

  const xpm = {
      value: 0,
      match_id: null,
      player_id: null
  }

  const stacks = {
      value: 0,
      match_id: null,
      player_id: null
  }

  const obsKills = {
      value: 0,
      match_id: null,
      player_id: null
  }

  for (const match of matches) {
    const kills_per_min = (match.kills / match.duration) * 60;
    const last_hits_per_min = (match.last_hits / match.duration) * 60;
    const damage_per_min = (match.hero_damage / match.duration) * 60;
    const percentDead = (match.life_state_dead / match.duration);

    if (kills_per_min > kpm.value) {
      kpm.value = kills_per_min;
      kpm.match_id = match.match_id;
      kpm.player_id = match.players_id;

      kpm.stat_display = `Kills/minute: ${kills_per_min.toFixed(2)}`;
      kpm.player_avatar = match.avatar;
      kpm.player_name = match.players_name;
      kpm.player_steam = match.profile_uri;
      kpm.value_display = `KDA: ${match.kills} - ${match.deaths} - ${match.assists}\nResult: ${match.win ? 'Won' : 'Lost'}`;
      kpm.hero = match.heroes_name;
      kpm.hero_url = match.picture;
    }

    if (last_hits_per_min > lhpm.value) {
      lhpm.value = last_hits_per_min;
      lhpm.match_id = match.match_id;
      lhpm.player_id = match.players_id;

      lhpm.stat_display = `Last hits/min: ${last_hits_per_min.toFixed(1)}`;
      lhpm.player_avatar = match.avatar;
      lhpm.player_name = match.players_name;
      lhpm.player_steam = match.profile_uri;
      lhpm.value_display = `KDA: ${match.kills} - ${match.deaths} - ${match.assists}\nResult: ${match.win ? 'Won' : 'Lost'}`;
      lhpm.hero = match.heroes_name;
      lhpm.hero_url = match.picture;
    }

    if (damage_per_min > dpm.value) {
      dpm.value = damage_per_min;
      dpm.match_id = match.match_id;
      dpm.player_id = match.players_id;

      dpm.stat_display = `Damage/min: ${damage_per_min}`;
      dpm.player_avatar = match.avatar;
      dpm.player_name = match.players_name;
      dpm.player_steam = match.profile_uri;
      dpm.value_display = `KDA: ${match.kills} - ${match.deaths} - ${match.assists}\nResult: ${match.win ? 'Won' : 'Lost'}`;
      dpm.hero = match.heroes_name;
      dpm.hero_url = match.picture;
    }

    if (match.hero_healing_per_min > hpm.value) {
      hpm.value = match.hero_healing_per_min;
      hpm.match_id = match.match_id;
      hpm.player_id = match.players_id;

      hpm.stat_display = `Healing/min: ${match.hero_healing_per_min.toFixed(1)}`;
      hpm.player_avatar = match.avatar;
      hpm.player_name = match.players_name;
      hpm.player_steam = match.profile_uri;
      hpm.value_display = `KDA: ${match.kills} - ${match.deaths} - ${match.assists}\nResult: ${match.win ? 'Won' : 'Lost'}`;
      hpm.hero = match.heroes_name;
      hpm.hero_url = match.picture;
    }

    if (percentDead > timeDead.value) {
      timeDead.value = percentDead;
      timeDead.time = match.life_state_dead;
      timeDead.match_id = match.match_id;
      timeDead.player_id = match.players_id;

      timeDead.stat_display = `Time dead: ${timeToString(match.life_state_dead)}`;
      timeDead.player_avatar = match.avatar;
      timeDead.player_name = match.players_name;
      timeDead.player_steam = match.profile_uri;
      timeDead.value_display = `KDA: ${match.kills} - ${match.deaths} - ${match.assists}\nResult: ${match.win ? 'Won' : 'Lost'}`;
      timeDead.hero = match.heroes_name;
      timeDead.hero_url = match.picture;
    }

    if (match.tower_damage > towerDamage.value) {
      towerDamage.value = match.tower_damage;
      towerDamage.match_id = match.match_id;
      towerDamage.player_id = match.players_id;

      towerDamage.stat_display = `Tower damage: ${match.tower_damage}`;
      towerDamage.player_avatar = match.avatar;
      towerDamage.player_name = match.players_name;
      towerDamage.player_steam = match.profile_uri;
      towerDamage.value_display = `KDA: ${match.kills} - ${match.deaths} - ${match.assists}\nResult: ${match.win ? 'Won' : 'Lost'}`;
      towerDamage.hero = match.heroes_name;
      towerDamage.hero_url = match.picture;
    }

    if (match.gold_per_min > gpm.value && match.heroes_name !== 'Alchemist') {
      gpm.value = match.gold_per_min;
      gpm.match_id = match.match_id;
      gpm.player_id = match.players_id;

      gpm.stat_display = `GPM: ${match.gold_per_min}`;
      gpm.player_avatar = match.avatar;
      gpm.player_name = match.players_name;
      gpm.player_steam = match.profile_uri;
      gpm.value_display = `KDA: ${match.kills} - ${match.deaths} - ${match.assists}\nResult: ${match.win ? 'Won' : 'Lost'}`;
      gpm.hero = match.heroes_name;
      gpm.hero_url = match.picture;
    }

    if (match.xp_per_min > xpm.value) {
      xpm.value = match.xp_per_min;
      xpm.match_id = match.match_id;
      xpm.player_id = match.players_id;

      xpm.stat_display = `XPM: ${match.xp_per_min}`;
      xpm.player_avatar = match.avatar;
      xpm.player_name = match.players_name;
      xpm.player_steam = match.profile_uri;
      xpm.value_display = `KDA: ${match.kills} - ${match.deaths} - ${match.assists}\nResult: ${match.win ? 'Won' : 'Lost'}`;
      xpm.hero = match.heroes_name;
      xpm.hero_url = match.picture;
    }

    if (match.camps_stacked > stacks.value) {
      stacks.value = match.camps_stacked;
      stacks.match_id = match.match_id;
      stacks.player_id = match.players_id;

      stacks.stat_display = `Stacks: ${match.camps_stacked}`;
      stacks.player_avatar = match.avatar;
      stacks.player_name = match.players_name;
      stacks.player_steam = match.profile_uri;
      stacks.value_display = `KDA: ${match.kills} - ${match.deaths} - ${match.assists}\nResult: ${match.win ? 'Won' : 'Lost'}`;
      stacks.hero = match.heroes_name;
      stacks.hero_url = match.picture;
    }

    if (match.observer_kills > obsKills.value) {
      obsKills.value = match.observer_kills;
      obsKills.match_id = match.match_id;
      obsKills.player_id = match.players_id;

      obsKills.stat_display = `Observer kills: ${match.observer_kills}`;
      obsKills.player_avatar = match.avatar;
      obsKills.player_name = match.players_name;
      obsKills.player_steam = match.profile_uri;
      obsKills.value_display = `KDA: ${match.kills} - ${match.deaths} - ${match.assists}\nResult: ${match.win ? 'Won' : 'Lost'}`;
      obsKills.hero = match.heroes_name;
      obsKills.hero_url = match.picture;
    }
  }

  return [
    discordify(kpm),
    discordify(lhpm),
    discordify(dpm),
    discordify(hpm),
    discordify(timeDead),
    discordify(towerDamage),
    discordify(gpm),
    discordify(xpm),
    discordify(stacks),
    discordify(obsKills)
  ];
}

const getStats = async (league_id, start_time, end_time, region) => {
  const matches = await getMatches(league_id, start_time, end_time, region);
  return getStatsFromMatches(matches);
}

const discordify = (stat) => {
  return {
    description: `**${stat.stat_display}**\n[${stat.value_display}](https://www.dotabuff.com/matches/${stat.match_id})\n\`                              \``,
    color: 14681087,
    author: {
        name: `${stat.player_name}`
    },
    thumbnail: {
        url: `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/${stat.player_avatar}`
    },
    url: stat.player_steam,
    footer: {
      icon_url: stat.hero_url,
      text: stat.hero
    },
  };
}

const timeToString = (time) => {
  let sign = time > 0 ? "" : "-";
  let date = new Date(null);
  date.setSeconds(Math.abs(time));
  return sign + date.toISOString().substr(11, 8);
}

const test = async () => {
  return await opendota.get(`/matches/5109562295`);
}

module.exports = {
  getAllMatches,
  getStats,
  test
}
