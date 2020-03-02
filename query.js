const Pool = require('pg').Pool;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true
})

const getChannels = async () => {
  const query = `
    select
      servers.id as server_id,
      servers.name as server_name,
      servers.discord_id as server_discord_id,
      channels.id as channel_id,
      channels.name as channel_name,
      channels.discord_id as channel_discord_id,
      watch
    from servers
    inner join channels on channels.server_id = servers.id;
  `;

  const response = await pool.query(query);
  return response.rows;
}

const getAdmin = async (discord_id = null) => {
  const where = discord_id ? `where users.discord_id = '${discord_id}'` : '';

  const query = `
    select
      user_id,
      username,
      discord_id
    from admins
    inner join users on admins.user_id = users.id
    ${where};
  `;

  const response = await pool.query(query);

  if (discord_id) {
    if (response.rows && response.rows.length) {
      return response.rows[0];
    }
  } else {
    return response.rows;
  }
}

const getTeams = async () => {
  const query = 'select * from teams;';
  const response = await pool.query(query);

  return response.rows;
}

const createTeam = async (teamName) => {
  const client = await pool.connect();

  const text = `
    insert into teams(name)
    values ($1);
  `;

  const values = Object.values([teamName]);
  const response = await client.query(text, values)

  client.release();

  return response.rows;
}

const saveMatchup = async (matchup) => {
  const client = await pool.connect();

  const text = `
    insert into matchups(home_id, away_id, round, order_num)
    values ($1, $2, $3, $4);
  `;

  const values = Object.values(matchup);
  const response = await client.query(text, values);

  client.release();

  return response.rows;
}

const getUser = async (discord_id) => {
  const query = `
    select
      id,
      username,
      discord_id
    from users
    where discord_id = '${discord_id}';
  `;

  const response = await pool.query(query);

  if (response.rows && response.rows.length) {
    return response.rows[0];
  }
}

const createUser = async (username, discord_id, server_id) => {
  const query = `
    insert into users (username, discord_id, server_id)
    values ('${username}', '${discord_id}', ${server_id})
    returning id, username, discord_id;
  `;

  const response = await pool.query(query);

  if (response.rows && response.rows.length) {
    return response.rows[0];
  }
}

const getPredictions = async (user_id) => {
  const query = `
    select
      predictions.id as id,
      predictor_id,
      matchup_round,
      matchup_order_num,
      winning_team_id,
      teams.name as winning_team_name
    from predictions
    inner join teams on teams.id = winning_team_id
    where predictor_id = ${user_id}
    order by matchup_round desc, matchup_order_num desc;
  `;

  const response = await pool.query(query);
  return response.rows;
}

const createPrediction = async (prediction) => {
  const client = await pool.connect();

  const text = `
    insert into predictions(predictor_id, matchup_round, matchup_order_num, winning_team_id)
    values ($1, $2, $3, $4);
  `;

  const values = Object.values(prediction);
  const response = await client.query(text, values);

  client.release();

  return response.rows;
}

const getMatchups = async () => {
  const query = `
    select
      matchups.id,
      home_id,
      away_id,
      round,
      order_num,
      home_team.name as home_team_name,
      away_team.name as away_team_name
    from matchups
    inner join teams home_team on home_id = home_team.id
    inner join teams away_team on away_id = away_team.id;
  `;

  const response = await pool.query(query);
  return response.rows;
}

const addReason = async (prediction_id, reason) => {
  const text = `
    update predictions
    set reason = $1
    where id = $2;
  `;

  const response = await pool.query(text, [reason, prediction_id]);

  return response.rows;
}

module.exports = {
  getChannels,
  getAdmin,
  getTeams,
  createTeam,
  saveMatchup,
  getUser,
  createUser,
  getPredictions,
  createPrediction,
  getMatchups,
  addReason
}
