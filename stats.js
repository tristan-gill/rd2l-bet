const db = require('./query');
const axios = require('axios');
const rateLimit = require('axios-rate-limit');

const Pool = require('pg').Pool;
const pool = new Pool({
  connectionString: process.env.HEROKU_POSTGRESQL_ONYX,
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

const getMatches = async (leagueId, skip) => {
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
  let matches = await getMatches(leagueId, 0);
  fetched += 50;
  // console.log(JSON.stringify(matches))

  while (matches.length >= fetched) {
    console.log('Fetching next batch');
    matches.push(...(await getMatches(leagueId, fetched)));
    fetched += 50;
  }
  console.log(`Total league matches: ${matches.length}`)

  const newMatches = matches.filter((match) => {
    return !Object.prototype.hasOwnProperty.call(savedMatches, match.id);
  });

  console.log('Fetching opendota matches');
  let odota_matches = await Promise.all(newMatches.map(m => opendota.get(`/matches/${m.id}`)));
  odota_matches.forEach(m => {
    let match = matches.find(stratz => stratz.id == m.match_id);
    m.players.forEach(player => {
      player.steamAccount = match.players.find(stratz => stratz.steamId == player.account_id).steamAccount;
    });
    m.regionId = match.regionId;
    m.startDateTime = match.startDateTime;
    m.endDateTime = match.endDateTime;
    m.durationSeconds = match.durationSeconds;
    m.direTeam = match.direTeam;
    m.radiantTeam = match.radiantTeam;
  });

  await saveMatches(odota_matches);

  console.log('done')
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
      dire_team_name: match.direTeam.name
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
    insert into matches(id, dire_score, dire_team_id, duration, radiant_gold_adv, radiant_score, radiant_win, radiant_team_id, radiant_xp_adv, region, start_time, radiant_team_name, dire_team_name)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
    insert into matches_players(matches_id, assists, camps_stacked, deaths, denies, kills, last_hits, obs_placed, sen_placed, tower_damage, xp_per_min, observer_kills, life_state_dead, gold_per_min, hero_damage, hero_healing_per_min, heroes_id, players_id)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    on conflict on constraint matches_players_pkey
    do nothing;
  `;

  const values = Object.values(matchPlayer);
  await client.query(text, values);
}

module.exports = {
  getAllMatches
}
